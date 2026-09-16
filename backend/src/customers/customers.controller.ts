import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/rbac.guard';
import { CustomersService, type UpsertCustomerInput } from './customers.service';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions('pos.sale.create')
  search(@Query('q') q?: string, @Query('limit') limit?: string) {
    return this.customers.search(q ?? '', limit ? Number(limit) : 20);
  }

  @Get(':id')
  @RequirePermissions('pos.sale.create')
  get(@Param('id') id: string) {
    return this.customers.get(id);
  }

  @Post()
  @RequirePermissions('pos.sale.create')
  create(@Body() body: UpsertCustomerInput) {
    return this.customers.create(body);
  }
}
