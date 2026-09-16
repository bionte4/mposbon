import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/rbac.guard';
import { PosService } from './pos.service';
import { SensitivePosService } from './sensitive-pos.service';
import { SyncSaleInput, UpsertCartInput } from './pos.types';

@Controller('pos')
export class PosController {
  constructor(
    private readonly pos: PosService,
    private readonly sensitive: SensitivePosService,
  ) {}

  @Get('bootstrap')
  bootstrap(@Query('storeId') storeId?: string) {
    return this.pos.bootstrap(storeId);
  }

  @Post('carts')
  @RequirePermissions('pos.sale.create')
  upsertCart(@Body() body: UpsertCartInput) {
    return this.pos.upsertCart(body);
  }

  @Post('sales/sync')
  @RequirePermissions('pos.sale.create')
  syncSale(@Body() body: SyncSaleInput) {
    return this.pos.syncSale(body);
  }

  @Post('sales/void')
  @RequirePermissions('pos.void')
  voidSale(
    @Body() body: { saleId: string; supervisorPin: string; reason?: string },
  ) {
    return this.sensitive.voidSale(body);
  }

  @Post('sales/refund')
  @RequirePermissions('pos.void')
  refundSale(
    @Body() body: { saleId: string; supervisorPin: string; reason?: string },
  ) {
    return this.sensitive.refundSale(body);
  }

  @Post('sales/discount')
  @RequirePermissions('pos.discount.manual')
  discount(
    @Body()
    body: {
      saleId: string;
      discountInCents: number;
      supervisorPin: string;
      reason?: string;
    },
  ) {
    return this.sensitive.applyManualDiscount(body);
  }

  @Post('drawer/force-open')
  @RequirePermissions('pos.drawer.open_force')
  forceOpenDrawer(@Body() body: { supervisorPin: string; reason?: string }) {
    return this.sensitive.forceOpenDrawer(body);
  }

  @Post('cart/remove-item')
  @RequirePermissions('pos.void')
  removeCartItem(
    @Body()
    body: {
      cartClientUuid: string;
      productId: string;
      productName?: string;
      quantity?: number;
      unitPriceInCents?: number;
      supervisorPin: string;
      reason?: string;
    },
  ) {
    return this.sensitive.removeCartItem(body);
  }

  @Post('cart/price-override')
  @RequirePermissions('pos.discount.manual')
  priceOverride(
    @Body()
    body: {
      cartClientUuid: string;
      productId: string;
      productName?: string;
      originalPriceInCents: number;
      newPriceInCents: number;
      supervisorPin: string;
      reason?: string;
    },
  ) {
    return this.sensitive.overrideCartItemPrice(body);
  }
}
