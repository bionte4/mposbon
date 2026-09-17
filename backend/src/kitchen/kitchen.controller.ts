import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { KitchenLineStatus } from '@prisma/client';
import { RequirePermissions } from '../auth/rbac.guard';
import {
  FireKitchenInput,
  KitchenService,
  UpsertKitchenStationInput,
} from './kitchen.service';

@Controller('kitchen')
export class KitchenController {
  constructor(private readonly kitchen: KitchenService) {}

  @Get('stations')
  @RequirePermissions('kitchen.display')
  listStations(@Query('storeId') storeId: string) {
    if (!storeId?.trim()) throw new BadRequestException('storeId is required');
    return this.kitchen.listStations(storeId);
  }

  @Post('stations')
  @RequirePermissions('admin.outlet.write')
  createStation(@Body() body: UpsertKitchenStationInput) {
    return this.kitchen.createStation(body);
  }

  @Patch('stations/:id')
  @RequirePermissions('admin.outlet.write')
  updateStation(
    @Param('id') id: string,
    @Body() body: Partial<UpsertKitchenStationInput>,
  ) {
    return this.kitchen.updateStation(id, body);
  }

  @Get('tickets')
  @RequirePermissions('kitchen.display')
  listTickets(
    @Query('storeId') storeId: string,
    @Query('stationId') stationId?: string,
  ) {
    if (!storeId?.trim()) throw new BadRequestException('storeId is required');
    return this.kitchen.listActiveTickets(storeId, stationId);
  }

  /** Cashier fires tickets from POS — not a KDS-only action. */
  @Post('fire')
  @RequirePermissions('pos.sale.create')
  fire(@Body() body: FireKitchenInput) {
    return this.kitchen.fireToKitchen(body);
  }

  @Patch('lines/:id/status')
  @RequirePermissions('kitchen.bump')
  bumpLine(
    @Param('id') id: string,
    @Body() body: { status: KitchenLineStatus },
  ) {
    return this.kitchen.bumpLine(id, body.status);
  }
}
