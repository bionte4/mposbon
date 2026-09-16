import { Controller, Get } from '@nestjs/common';
import { TenantsService } from './tenants.service';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenants: TenantsService) {}

  @Get('current')
  current() {
    return this.tenants.current();
  }

  @Get('current/stores')
  stores() {
    return this.tenants.listStores();
  }
}
