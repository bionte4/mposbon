import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RequirePermissions } from '../auth/rbac.guard';
import { AnalyticsService } from './analytics.service';
import { SalesExportService } from './sales-export.service';

@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly salesExport: SalesExportService,
  ) {}

  @Get('overview')
  @RequirePermissions('dashboard.read')
  overview(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('storeId') storeId?: string,
  ) {
    return this.analytics.overview({ from, to, storeId });
  }

  @Get('top-products')
  @RequirePermissions('dashboard.read')
  topProducts(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('storeId') storeId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.analytics.topProducts({
      from,
      to,
      storeId,
      limit: limit ? Number.parseInt(limit, 10) : undefined,
    });
  }

  @Get('shifts')
  @RequirePermissions('dashboard.read')
  shifts() {
    return this.analytics.shiftWidgets();
  }

  /** Soft journal API for external accounting import (JSON). */
  @Get('export/journal')
  @RequirePermissions('dashboard.read_store')
  journalJson(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('storeId') storeId?: string,
  ) {
    return this.salesExport.journalJson({ from, to, storeId });
  }

  @Get('export/journal.csv')
  @RequirePermissions('dashboard.read_store')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async journalCsv(
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('storeId') storeId?: string,
  ) {
    const csv = await this.salesExport.journalCsv({ from, to, storeId });
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="bonpos-journal-${dateStamp()}.csv"`,
    );
    res.send(csv);
  }

  @Get('export/sales.csv')
  @RequirePermissions('dashboard.read_store')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async salesCsv(
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('storeId') storeId?: string,
  ) {
    const csv = await this.salesExport.salesDetailCsv({ from, to, storeId });
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="bonpos-sales-${dateStamp()}.csv"`,
    );
    res.send(csv);
  }
}

function dateStamp(): string {
  return new Date().toISOString().slice(0, 10);
}
