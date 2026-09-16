import { Controller, Get, Query } from '@nestjs/common';
import { RequirePermissions } from '../../auth/rbac.guard';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('logs')
  @RequirePermissions('dashboard.read_store')
  list(@Query('limit') limit?: string) {
    return this.audit.listRecent(limit ? Number.parseInt(limit, 10) : 50);
  }
}
