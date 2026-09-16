import {
  ForbiddenException,
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { NextFunction, Response } from 'express';
import { TenantRequest } from '../common/http/tenant-request';
import { PrismaAdminService } from '../common/prisma/prisma-admin.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { AuthContext, AuthUser, toAuthUser } from './auth-context';
import { verifyAccessToken } from './jwt';
import type { StaffRole } from './permissions';

export type AuthedRequest = TenantRequest & { user?: AuthUser };

/**
 * Resolves the acting staff user after tenant resolution.
 * Precedence: Authorization Bearer JWT → X-User-Id → X-User-Email → (dev) first cashier.
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

    let user = null;

    const bearer = this.extractBearer(req.header('authorization'));
    if (bearer) {
      try {
        const payload = verifyAccessToken(bearer);
        if (payload.tenantId !== tenant.id) {
          throw new ForbiddenException('Token tenant mismatch');
        }
        user = await this.prismaAdmin.user.findFirst({
          where: { id: payload.sub, tenantId: tenant.id, isActive: true },
        });
      } catch {
        throw new UnauthorizedException('Invalid or expired access token');
      }
    }

    const userId = req.header('x-user-id');
    const userEmail = req.header('x-user-email');

    if (!user && userId) {
      user = await this.prismaAdmin.user.findFirst({
        where: { id: userId, tenantId: tenant.id, isActive: true },
      });
    } else if (!user && userEmail) {
      user = await this.prismaAdmin.user.findFirst({
        where: { email: userEmail, tenantId: tenant.id, isActive: true },
      });
    }

    // Bootstrap without header/token: prefer cashier for local/dev POS.
    if (!user && process.env.NODE_ENV !== 'production') {
      user = await this.prismaAdmin.user.findFirst({
        where: { tenantId: tenant.id, isActive: true, role: 'CASHIER' },
        orderBy: { createdAt: 'asc' },
      });
      if (!user) {
        user = await this.prismaAdmin.user.findFirst({
          where: { tenantId: tenant.id, isActive: true },
          orderBy: { createdAt: 'asc' },
        });
      }
    }

    if (!user) {
      throw new UnauthorizedException(
        'Staff user required (Bearer token, X-User-Id, or X-User-Email)',
      );
    }
    if (user.tenantId !== tenant.id) {
      throw new ForbiddenException('User does not belong to resolved tenant');
    }

    const stationRows = await this.prismaAdmin.userKitchenStation.findMany({
      where: { tenantId: tenant.id, userId: user.id },
      select: { stationId: true },
    });

    const authUser = toAuthUser({
      id: user.id,
      tenantId: user.tenantId,
      email: user.email,
      displayName: user.displayName,
      role: user.role as StaffRole,
      kitchenStationIds: stationRows.map((r) => r.stationId),
    });
    req.user = authUser;
    AuthContext.run(authUser, () => next());
  }

  private extractBearer(header: string | undefined): string | null {
    if (!header) {
      return null;
    }
    const [scheme, token] = header.split(' ');
    if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
      return null;
    }
    return token.trim();
  }

  private isPublicPath(path: string): boolean {
    const normalized = path.split('?')[0].replace(/\/$/, '') || '/';
    if (normalized === '/health' || normalized.endsWith('/health')) {
      return true;
    }
    // Nest global prefix may be /api/v1
    if (normalized.endsWith('/auth/login') || normalized === '/auth/login') {
      return true;
    }
    if (
      normalized.endsWith('/payments/webhooks/midtrans') ||
      normalized.endsWith('/payments/webhooks/xendit')
    ) {
      return true;
    }
    return false;
  }
}
