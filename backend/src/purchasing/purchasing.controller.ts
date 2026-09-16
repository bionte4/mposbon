import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/rbac.guard';
import {
  CreatePurchaseOrderInput,
  PurchasingService,
  ReceiveGoodsInput,
  UpsertSupplierInput,
} from './purchasing.service';

@Controller('purchasing')
export class PurchasingController {
  constructor(private readonly purchasing: PurchasingService) {}

  @Get('suppliers')
  @RequirePermissions('admin.access')
  listSuppliers(@Query('activeOnly') activeOnly?: string) {
    return this.purchasing.listSuppliers(activeOnly === '1' || activeOnly === 'true');
  }

  @Post('suppliers')
  @RequirePermissions('admin.catalog.write')
  createSupplier(@Body() body: UpsertSupplierInput) {
    return this.purchasing.createSupplier(body);
  }

  @Patch('suppliers/:id')
  @RequirePermissions('admin.catalog.write')
  updateSupplier(@Param('id') id: string, @Body() body: Partial<UpsertSupplierInput>) {
    return this.purchasing.updateSupplier(id, body);
  }

  @Get('orders')
  @RequirePermissions('admin.access')
  listOrders(@Query('limit') limit?: string) {
    return this.purchasing.listOrders(limit ? Number.parseInt(limit, 10) : 50);
  }

  @Get('orders/:id')
  @RequirePermissions('admin.access')
  getOrder(@Param('id') id: string) {
    return this.purchasing.getOrder(id);
  }

  @Post('orders')
  @RequirePermissions('admin.catalog.write')
  createOrder(@Body() body: CreatePurchaseOrderInput) {
    return this.purchasing.createOrder(body);
  }

  @Post('orders/:id/confirm')
  @RequirePermissions('admin.catalog.write')
  confirmOrder(@Param('id') id: string) {
    return this.purchasing.confirmOrder(id);
  }

  @Post('orders/:id/cancel')
  @RequirePermissions('admin.catalog.write')
  cancelOrder(@Param('id') id: string) {
    return this.purchasing.cancelOrder(id);
  }

  @Post('orders/:id/receive')
  @RequirePermissions('admin.catalog.write')
  receive(@Param('id') id: string, @Body() body: ReceiveGoodsInput) {
    return this.purchasing.receive(id, body);
  }
}
