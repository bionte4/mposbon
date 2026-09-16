import { Injectable } from '@nestjs/common';
import { TenantContext } from '../common/tenant/tenant-context';
import { PrismaService } from '../common/prisma/prisma.service';
import { AppConfigService } from '../config/app-config.service';

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  current() {
    const tenant = TenantContext.require();
    return {
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      status: tenant.status,
      deploymentMode: tenant.deploymentMode,
      domain: tenant.domain,
      runtime: {
        processMode: this.config.deploymentMode,
        edgeSync: this.config.featureEdgeSync,
        licenseValidationMode: this.config.licenseValidationMode,
      },
    };
  }

  listStores() {
    // RLS + request transaction already pin tenant_id; extra where is belt-and-suspenders.
    const tenant = TenantContext.require();
    return this.prisma.db.store.findMany({
      where: { tenantId: tenant.id },
      orderBy: { code: 'asc' },
    });
  }
}
