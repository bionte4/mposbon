import {
  ForbiddenException,
  Injectable,
  NestMiddleware,
  UnauthorizedException,
} from '@nestjs/common';
import { DeploymentMode } from '@prisma/client';
import { NextFunction, Response } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { TenantRequest } from '../http/tenant-request';
import { PrismaAdminService } from '../prisma/prisma-admin.service';
import { PrismaService } from '../prisma/prisma.service';
import { TenantActor, TenantContext } from './tenant-context';

type ResolvedRow = {
  id: string;
  slug: string;
  name: string;
  status: string;
  deployment_mode: string;
  domain: string | null;
};

@Injectable()
export class TenantResolutionMiddleware implements NestMiddleware {
  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
    private readonly prismaAdmin: PrismaAdminService,
  ) {}

  async use(req: TenantRequest, _res: Response, next: NextFunction): Promise<void> {
    if (this.isPublicPath(req.path)) {
      next();
      return;
    }

    const tenant = await this.resolve(req);
    this.assertDeploymentLock(tenant);
    if (tenant.status !== 'ACTIVE') {
      throw new ForbiddenException(`Tenant is ${tenant.status}`);
    }

    req.tenant = tenant;
    TenantContext.run(tenant, () => next());
  }

  private isPublicPath(path: string): boolean {
    const normalized = path.split('?')[0].replace(/\/$/, '') || '/';
    return normalized === '/health' || normalized.endsWith('/health');
  }

  /**
   * Resolution order:
   * 1. On-prem: env DEFAULT_TENANT_ID / DEFAULT_TENANT_SLUG (hardware lock)
   * 2. Cloud: subdomain `{slug}.{TENANT_HOST_BASE}`
   * 3. Cloud: custom domain Host header
   * 4. Bootstrap header X-Tenant-Slug (login before JWT exists)
   */
  private async resolve(req: TenantRequest): Promise<TenantActor> {
    if (this.config.isOnPrem) {
      if (this.config.defaultTenantId) {
        const byId = await this.lookupById(this.config.defaultTenantId);
        if (byId) {
          return byId;
        }
      }
      const bySlug = await this.lookupBySlug(this.config.defaultTenantSlug);
      if (!bySlug) {
        throw new UnauthorizedException(
          `On-prem tenant "${this.config.defaultTenantSlug}" is not provisioned`,
        );
      }
      return bySlug;
    }

    const host = (req.headers.host ?? '').split(':')[0].toLowerCase();
    const base = this.config.tenantHostBase.toLowerCase();
    if (host.endsWith(`.${base}`)) {
      const slug = host.slice(0, -(base.length + 1));
      const fromHost = await this.lookupBySlug(slug);
      if (fromHost) {
        return fromHost;
      }
    }

    const fromDomain = await this.lookupByDomain(host);
    if (fromDomain) {
      return fromDomain;
    }

    const headerSlug = req.header('x-tenant-slug');
    if (headerSlug) {
      const fromHeader = await this.lookupBySlug(headerSlug);
      if (fromHeader) {
        return fromHeader;
      }
    }

    throw new UnauthorizedException('Unable to resolve tenant for this request');
  }

  private assertDeploymentLock(tenant: TenantActor): void {
    if (this.config.isOnPrem && tenant.slug !== this.config.defaultTenantSlug) {
      throw new ForbiddenException('On-prem deployment is locked to a single tenant');
    }
  }

  private toActor(row: ResolvedRow): TenantActor {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      deploymentMode: row.deployment_mode,
      domain: row.domain,
    };
  }

  private async lookupBySlug(slug: string): Promise<TenantActor | null> {
    const rows = await this.prisma.root.$queryRaw<ResolvedRow[]>`
      SELECT id, slug, name, status::text, deployment_mode::text, domain
      FROM resolve_tenant_by_slug(${slug})
    `;
    return rows[0] ? this.toActor(rows[0]) : null;
  }

  private async lookupByDomain(domain: string): Promise<TenantActor | null> {
    if (!domain) {
      return null;
    }
    const rows = await this.prisma.root.$queryRaw<ResolvedRow[]>`
      SELECT id, slug, name, status::text, deployment_mode::text, domain
      FROM resolve_tenant_by_domain(${domain})
    `;
    return rows[0] ? this.toActor(rows[0]) : null;
  }

  private async lookupById(id: string): Promise<TenantActor | null> {
    const row = await this.prismaAdmin.tenant.findUnique({ where: { id } });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      status: row.status,
      deploymentMode: row.deploymentMode,
      domain: row.domain,
    };
  }
}

export function toPrismaDeploymentMode(mode: 'cloud' | 'onprem'): DeploymentMode {
  return mode === 'onprem' ? DeploymentMode.ONPREM : DeploymentMode.CLOUD;
}
