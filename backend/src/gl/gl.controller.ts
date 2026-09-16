import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/rbac.guard';
import { GlService } from './gl.service';

@Controller('gl')
export class GlController {
  constructor(private readonly gl: GlService) {}

  @Get('accounts')
  @RequirePermissions('admin.finance.read')
  listAccounts() {
    return this.gl.listAccounts();
  }

  @Get('entries')
  @RequirePermissions('admin.finance.read')
  listEntries(@Query('limit') limit?: string) {
    return this.gl.listEntries(limit ? Number(limit) : 50);
  }
}
