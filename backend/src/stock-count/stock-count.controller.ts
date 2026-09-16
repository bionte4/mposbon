import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/rbac.guard';
import {
  CreateStockCountInput,
  StockCountService,
  UpdateStockCountLineInput,
} from './stock-count.service';

@Controller('stock-counts')
export class StockCountController {
  constructor(private readonly stockCount: StockCountService) {}

  @Get()
  @RequirePermissions('admin.inventory.read')
  list(
    @Query('storeId') storeId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.stockCount.listSessions(
      storeId,
      limit ? Number.parseInt(limit, 10) : 30,
    );
  }

  @Get(':id')
  @RequirePermissions('admin.inventory.read')
  get(@Param('id') id: string) {
    return this.stockCount.getSession(id);
  }

  @Post()
  @RequirePermissions('admin.inventory.write')
  create(@Body() body: CreateStockCountInput) {
    return this.stockCount.createSession(body);
  }

  @Patch(':id/lines')
  @RequirePermissions('admin.inventory.write')
  updateLine(
    @Param('id') id: string,
    @Body() body: UpdateStockCountLineInput,
  ) {
    return this.stockCount.updateLine(id, body);
  }

  @Post(':id/complete')
  @RequirePermissions('admin.inventory.write')
  complete(@Param('id') id: string) {
    return this.stockCount.completeSession(id);
  }

  @Post(':id/cancel')
  @RequirePermissions('admin.inventory.write')
  cancel(@Param('id') id: string) {
    return this.stockCount.cancelSession(id);
  }
}
