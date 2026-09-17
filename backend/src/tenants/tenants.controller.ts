import { Body, Controller, Get, Patch } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { RequirePermissions } from '../auth/rbac.guard';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  /** Login chrome — JWT not required; tenant resolved via host / X-Tenant-Slug. */
  @Public()
  @Get('branding')
  branding() {
    return this.tenants.branding();
  }

  @Get('current')
  current() {
    return this.tenants.current();
  }

  @Get('current/stores')
  stores() {
    return this.tenants.listStores();
  }

  /** Reuses System hub — logo URL paste, no separate media admin product. */
  @RequirePermissions('admin.outlet.write')
  @Get('current/branding')
  brandingAdmin() {
    return this.tenants.branding();
  }

  @RequirePermissions('admin.outlet.write')
  @Patch('current/branding')
  updateBranding(
    @Body()
    body: {
      brandName?: string | null;
      logoUrl?: string | null;
      accentColor?: string | null;
    },
  ) {
    return this.tenants.updateBranding(body ?? {});
  }
}
