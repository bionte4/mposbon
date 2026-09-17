import {
  ForbiddenException,
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { TenantRequest } from '../common/http/tenant-request';
import { PrismaAdminService } from '../common/prisma/prisma-admin.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { AuthContext, AuthUser, toAuthUser } from './auth-context';
import { verifyAccessToken } from './jwt';
import type { Permission, StaffRole } from './permissions';

export type AuthedRequest = TenantRequest & { user?: AuthUser };

const FINANCE_SCOPES: Permission[] = ['admin.finance.read', 'admin.finance.write'];
const KEY_PREFIX_LEN = 16;

/**
 * Resolves the acting staff user after tenant resolution.
 * Precedence: Integration API key → Authorization Bearer JWT → X-User-Id → X-User-Email → (dev) first cashier.
 */
@Injectable()
export class AuthResolutionMiddleware implements NestMiddleware {
  constructor(private readonly prismaAdmin: PrismaAdminService) {}

  async use(req: AuthedRequest, _res: Response, next: NextFunction): Promise<void> {
    if (this.isPublicPath(req.path)) {
      next();
      return;
    }

    const tenant = TenantContext.current() ?? req.tenant;
    if (!tenant) {
      throw new UnauthorizedException('Tenant context required before auth');
    }

    let user: AuthUser | null = null;

    const apiKeyRaw =
      req.header('x-api-key')?.trim() ||
      this.extractApiKeyBearer(req.header('authorization'));
    if (apiKeyRaw) {
      user = await this.resolveApiKeyUser(apiKeyRaw, tenant.id);
      if (!user) {
        throw new UnauthorizedException('Invalid or revoked API key');
      }
      req.user = user;
      AuthContext.run(user, () => next());
      return;
    }

    const bearer = this.extractBearer(req.header('authorization'));
    if (bearer) {
      try {
        const payload = verifyAccessToken(bearer);
        if (payload.tenantId !== tenant.id) {
          throw new ForbiddenException('Token tenant mismatch');
        }
        const row = await this.prismaAdmin.user.findFirst({
          where: { id: payload.sub, tenantId: tenant.id, isActive: true },
        });
        if (row) {
          user = await this.toUserWithStations(row, tenant.id);
        }
      } catch (err) {
        if (err instanceof ForbiddenException) throw err;
        throw new UnauthorizedException('Invalid or expired access token');
      }
    }

    const userId = req.header('x-user-id');
    const userEmail = req.header('x-user-email');

    if (!user && userId) {
      const row = await this.prismaAdmin.user.findFirst({
        where: { id: userId, tenantId: tenant.id, isActive: true },
      });
      if (row) user = await this.toUserWithStations(row, tenant.id);
    } else if (!user && userEmail) {
      const row = await this.prismaAdmin.user.findFirst({
        where: { email: userEmail, tenantId: tenant.id, isActive: true },
      });
      if (row) user = await this.toUserWithStations(row, tenant.id);
    }

    if (!user && process.env.NODE_ENV !== 'production') {
      let row = await this.prismaAdmin.user.findFirst({
        where: { tenantId: tenant.id, isActive: true, role: 'CASHIER' },
        orderBy: { createdAt: 'asc' },
      });
      if (!row) {
        row = await this.prismaAdmin.user.findFirst({
          where: { tenantId: tenant.id, isActive: true },
          orderBy: { createdAt: 'asc' },
        });
      }
      if (row) user = await this.toUserWithStations(row, tenant.id);
    }

    if (!user) {
      throw new UnauthorizedException(
        'Staff user required (Bearer token, X-Api-Key, X-User-Id, or X-User-Email)',
      );
    }
    if (user.tenantId !== tenant.id) {
      throw new ForbiddenException('User does not belong to resolved tenant');
    }

    req.user = user;
    AuthContext.run(user, () => next());
  }

  private async resolveApiKeyUser(
    rawKey: string,
    tenantId: string,
  ): Promise<AuthUser | null> {
    const trimmed = rawKey.trim();
    if (!trimmed.startsWith('bp_live_') || !trimmed.includes('.')) {
      return null;
    }
    const keyPrefix = trimmed.slice(0, KEY_PREFIX_LEN);
    const row = await this.prismaAdmin.integrationApiKey.findFirst({
      where: { tenantId, keyPrefix, revokedAt: null },
    });
    if (!row) return null;
    const expected = Buffer.from(row.keyHash, 'hex');
    const actual = Buffer.from(createHash('sha256').update(trimmed).digest('hex'), 'hex');
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      return null;
    }
    void this.prismaAdmin.integrationApiKey
      .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
      .catch(() => undefined);

    const scopes = (row.scopes as string[]).filter((s): s is Permission =>
      FINANCE_SCOPES.includes(s as Permission),
    );
    if (!scopes.length) return null;

    const actor = row.createdByUserId
      ? await this.prismaAdmin.user.findFirst({
          where: { id: row.createdByUserId, tenantId, isActive: true },
        })
      : null;

    return toAuthUser(
      {
        id: actor?.id ?? '00000000-0000-4000-8000-000000000001',
        tenantId,
        email: actor?.email ?? `apikey+${row.id}@integration.local`,
        displayName: actor?.displayName ?? `API Key: ${row.name}`,
        role: (actor?.role as StaffRole) ?? 'TENANT_ADMIN',
        kitchenStationIds: [],
      },
      scopes,
    );
  }

  private async toUserWithStations(
    row: {
      id: string;
      tenantId: string;
      email: string;
      displayName: string;
      role: string;
    },
    tenantId: string,
  ): Promise<AuthUser> {
    const stationRows = await this.prismaAdmin.userKitchenStation.findMany({
      where: { tenantId, userId: row.id },
      select: { stationId: true },
    });
    return toAuthUser({
      id: row.id,
      tenantId: row.tenantId,
      email: row.email,
      displayName: row.displayName,
      role: row.role as StaffRole,
      kitchenStationIds: stationRows.map((r) => r.stationId),
    });
  }

  private extractBearer(header: string | undefined): string | null {
    if (!header) return null;
    const [scheme, token] = header.split(' ');
    if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
    const value = token.trim();
    if (value.startsWith('bp_live_')) return null;
    return value;
  }

  private extractApiKeyBearer(header: string | undefined): string | null {
    if (!header) return null;
    const [scheme, token] = header.split(' ');
    if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return null;
    const value = token.trim();
    return value.startsWith('bp_live_') ? value : null;
  }

  private isPublicPath(path: string): boolean {
    const normalized = path.split('?')[0].replace(/\/$/, '') || '/';
    if (normalized === '/health' || normalized.endsWith('/health')) return true;
    if (normalized.endsWith('/auth/login') || normalized === '/auth/login') return true;
    // Tenant login chrome (logo / brand name) — still requires tenant resolution.
    if (normalized.endsWith('/tenants/branding') || normalized === '/tenants/branding') return true;
    if (
      normalized.endsWith('/payments/webhooks/midtrans') ||
      normalized.endsWith('/payments/webhooks/xendit')
    ) {
      return true;
    }
    return false;
  }
}
