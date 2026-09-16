import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { PromoScope, PromoType } from '@prisma/client';
import { RequirePermissions } from '../auth/rbac.guard';
import { PromoService, type UpsertPromoInput } from './promo.service';

@Controller('promos')
export class PromoController {
  constructor(private readonly promos: PromoService) {}

  @Get()
  @RequirePermissions('admin.access')
  list(@Query('activeOnly') activeOnly?: string) {
    return this.promos.list(activeOnly === '1' || activeOnly === 'true');
  }

  @Post()
  @RequirePermissions('admin.catalog.write')
  create(@Body() body: UpsertPromoInput) {
    return this.promos.create(body);
  }

  @Patch(':id')
  @RequirePermissions('admin.catalog.write')
  update(@Param('id') id: string, @Body() body: Partial<UpsertPromoInput>) {
    return this.promos.update(id, body);
  }

  /** Cashier preview — any POS seller can evaluate an active voucher. */
  @Post('preview')
  @RequirePermissions('pos.sale.create')
  preview(
    @Body()
    body: {
      code?: string;
      promoId?: string;
      lines: Array<{
        productId: string;
        categoryId?: string | null;
        quantity: number;
        lineSubtotalInCents: number;
        taxInCents: number;
      }>;
    },
  ) {
    return this.promos.preview(body);
  }
}

/** Re-export enums for OpenAPI-ish consumers; unused in controller body. */
void PromoType;
void PromoScope;
