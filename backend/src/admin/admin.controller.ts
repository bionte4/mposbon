import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { StaffRole } from '@prisma/client';
import { RequirePermissions } from '../auth/rbac.guard';
import {
  AdminService,
  type PatchCategoryInput,
  type PatchProductInput,
  type UpsertCategoryInput,
  type UpsertProductInput,
} from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('categories')
  @RequirePermissions('admin.access')
  listCategories() {
    return this.admin.listCategories();
  }

  @Post('categories')
  @RequirePermissions('admin.catalog.write')
  createCategory(@Body() body: UpsertCategoryInput) {
    return this.admin.createCategory(body);
  }

  @Patch('categories/:id')
  @RequirePermissions('admin.catalog.write')
  updateCategory(@Param('id') id: string, @Body() body: PatchCategoryInput) {
    return this.admin.updateCategory(id, body);
  }

  @Delete('categories/:id')
  @RequirePermissions('admin.catalog.write')
  deleteCategory(@Param('id') id: string) {
    return this.admin.deleteCategory(id);
  }

  @Get('products')
  @RequirePermissions('admin.access')
  listProducts() {
    return this.admin.listProducts();
  }

  @Post('products')
  @RequirePermissions('admin.catalog.write')
  createProduct(@Body() body: UpsertProductInput) {
    return this.admin.createProduct(body);
  }

  @Patch('products/:id')
  @RequirePermissions('admin.catalog.write')
  updateProduct(@Param('id') id: string, @Body() body: PatchProductInput) {
    return this.admin.updateProduct(id, body);
  }

  @Post('products/:productId/modifier-groups')
  @RequirePermissions('admin.catalog.write')
  createModifierGroup(
    @Param('productId') productId: string,
    @Body()
    body: {
      name: string;
      minSelect?: number;
      maxSelect?: number;
      sortOrder?: number;
    },
  ) {
    return this.admin.createModifierGroup(productId, body);
  }

  @Patch('modifier-groups/:id')
  @RequirePermissions('admin.catalog.write')
  updateModifierGroup(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      minSelect?: number;
      maxSelect?: number;
      sortOrder?: number;
    },
  ) {
    return this.admin.updateModifierGroup(id, body);
  }

  @Delete('modifier-groups/:id')
  @RequirePermissions('admin.catalog.write')
  deleteModifierGroup(@Param('id') id: string) {
    return this.admin.deleteModifierGroup(id);
  }

  @Post('modifier-groups/:groupId/options')
  @RequirePermissions('admin.catalog.write')
  createModifierOption(
    @Param('groupId') groupId: string,
    @Body()
    body: {
      name: string;
      priceDeltaInCents?: number;
      sortOrder?: number;
      isActive?: boolean;
    },
  ) {
    return this.admin.createModifierOption(groupId, body);
  }

  @Patch('modifier-options/:id')
  @RequirePermissions('admin.catalog.write')
  updateModifierOption(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      priceDeltaInCents?: number;
      sortOrder?: number;
      isActive?: boolean;
    },
  ) {
    return this.admin.updateModifierOption(id, body);
  }

  @Delete('modifier-options/:id')
  @RequirePermissions('admin.catalog.write')
  deleteModifierOption(@Param('id') id: string) {
    return this.admin.deleteModifierOption(id);
  }

  @Get('staff')
  @RequirePermissions('admin.staff.read')
  listStaff() {
    return this.admin.listStaff();
  }

  @Post('staff')
  @RequirePermissions('admin.staff.write')
  createStaff(
    @Body()
    body: {
      email: string;
      displayName: string;
      role: StaffRole;
      pin: string;
      isActive?: boolean;
      kitchenStationIds?: string[];
    },
  ) {
    return this.admin.createStaff(body);
  }

  @Patch('staff/:id')
  @RequirePermissions('admin.staff.write')
  updateStaff(
    @Param('id') id: string,
    @Body()
    body: {
      email?: string;
      displayName?: string;
      role?: StaffRole;
      pin?: string | null;
      isActive?: boolean;
      kitchenStationIds?: string[];
    },
  ) {
    return this.admin.updateStaff(id, body);
  }

  @Get('stores')
  @RequirePermissions('admin.access')
  listStores() {
    return this.admin.listStores();
  }

  @Post('stores')
  @RequirePermissions('admin.outlet.write')
  createStore(
    @Body()
    body: {
      code: string;
      name: string;
      address?: string | null;
      phone?: string | null;
      timezone?: string;
      receiptHeader?: string | null;
      receiptFooter?: string | null;
      qrisPayload?: string | null;
      isActive?: boolean;
    },
  ) {
    return this.admin.createStore(body);
  }

  @Patch('stores/:id')
  @RequirePermissions('admin.outlet.write')
  updateStore(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      address?: string | null;
      phone?: string | null;
      timezone?: string;
      receiptHeader?: string | null;
      receiptFooter?: string | null;
      isActive?: boolean;
      qrisPayload?: string | null;
    },
  ) {
    return this.admin.updateStore(id, body);
  }

  @Get('stores/:storeId/inventory')
  @RequirePermissions('admin.inventory.read')
  listStoreInventory(@Param('storeId') storeId: string) {
    return this.admin.listStoreInventory(storeId);
  }

  @Patch('stores/:storeId/inventory/:productId')
  @RequirePermissions('admin.inventory.write')
  patchStoreInventory(
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @Body()
    body: {
      qty?: number;
      qtyDelta?: number;
      unitPriceInCents?: number | null;
      note?: string;
    },
  ) {
    return this.admin.patchStoreInventory(storeId, productId, body);
  }

  @Get('stock-transfers')
  @RequirePermissions('admin.inventory.read')
  listTransfers() {
    return this.admin.listTransfers();
  }

  @Post('stock-transfers')
  @RequirePermissions('admin.inventory.write')
  createTransfer(
    @Body()
    body: {
      fromStoreId: string;
      toStoreId: string;
      note?: string;
      mode?: 'draft' | 'in_transit' | 'immediate';
      lines: Array<{ productId: string; qty: number }>;
    },
  ) {
    return this.admin.createTransfer(body);
  }

  @Post('stock-transfers/:id/ship')
  @RequirePermissions('admin.inventory.write')
  shipTransfer(@Param('id') id: string) {
    return this.admin.shipTransfer(id);
  }

  @Post('stock-transfers/:id/receive')
  @RequirePermissions('admin.inventory.write')
  receiveTransfer(@Param('id') id: string) {
    return this.admin.receiveTransfer(id);
  }

  @Post('stock-transfers/:id/cancel')
  @RequirePermissions('admin.inventory.write')
  cancelTransfer(@Param('id') id: string) {
    return this.admin.cancelTransfer(id);
  }

  @Get('products/:productId/variants')
  @RequirePermissions('admin.access')
  listVariants(@Param('productId') productId: string) {
    return this.admin.listVariants(productId);
  }

  @Post('products/:productId/variants')
  @RequirePermissions('admin.catalog.write')
  createVariant(
    @Param('productId') productId: string,
    @Body()
    body: {
      sku: string;
      name: string;
      barcode?: string | null;
      unitPriceInCents: number;
      sortOrder?: number;
      isActive?: boolean;
      initialQtyByStore?: Array<{ storeId: string; qty: number }>;
    },
  ) {
    return this.admin.createVariant({ ...body, productId });
  }

  @Patch('variants/:id')
  @RequirePermissions('admin.catalog.write')
  updateVariant(
    @Param('id') id: string,
    @Body()
    body: Partial<{
      name: string;
      barcode: string | null;
      unitPriceInCents: number;
      sortOrder: number;
      isActive: boolean;
    }>,
  ) {
    return this.admin.updateVariant(id, body);
  }
}
