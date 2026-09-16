import { Controller, Get, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/rbac.guard';
import { EdgeSyncService } from './edge-sync.service';

@Controller('edge-sync')
export class EdgeSyncController {
  constructor(private readonly edgeSync: EdgeSyncService) {}

  @Get('status')
  @RequirePermissions('admin.access')
  status() {
    return this.edgeSync.status();
  }

  @Post('push')
  @RequirePermissions('admin.access')
  push(@Query('limit') limit?: string) {
    return this.edgeSync.push(limit ? Number(limit) : 50);
  }

  @Get('pull')
  @RequirePermissions('admin.access')
  pull(@Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.edgeSync.pull(cursor, limit ? Number(limit) : 50);
  }
}
