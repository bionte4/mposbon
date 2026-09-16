import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/rbac.guard';
import {
  TablesService,
  UpsertDiningTableInput,
  UpsertTableAreaInput,
} from './tables.service';

@Controller('tables')
export class TablesController {
  constructor(private readonly tables: TablesService) {}

  @Get('floor')
  @RequirePermissions('pos.sale.create')
  floor(@Query('storeId') storeId: string) {
    return this.tables.getFloor(storeId);
  }

  @Get('areas')
  @RequirePermissions('admin.access')
  listAreas(@Query('storeId') storeId: string) {
    return this.tables.listAreas(storeId);
  }

  @Post('areas')
  @RequirePermissions('admin.outlet.write')
  createArea(@Body() body: UpsertTableAreaInput) {
    return this.tables.createArea(body);
  }

  @Patch('areas/:id')
  @RequirePermissions('admin.outlet.write')
  updateArea(@Param('id') id: string, @Body() body: Partial<UpsertTableAreaInput>) {
    return this.tables.updateArea(id, body);
  }

  @Get()
  @RequirePermissions('admin.access')
  listTables(
    @Query('storeId') storeId: string,
    @Query('activeOnly') activeOnly?: string,
  ) {
    return this.tables.listTables(storeId, activeOnly === '1' || activeOnly === 'true');
  }

  @Post()
  @RequirePermissions('admin.outlet.write')
  createTable(@Body() body: UpsertDiningTableInput) {
    return this.tables.createTable(body);
  }

  @Patch(':id')
  @RequirePermissions('admin.outlet.write')
  updateTable(@Param('id') id: string, @Body() body: Partial<UpsertDiningTableInput>) {
    return this.tables.updateTable(id, body);
  }

  @Get(':id')
  @RequirePermissions('admin.access')
  getTable(@Param('id') id: string) {
    return this.tables.getTable(id);
  }
}
