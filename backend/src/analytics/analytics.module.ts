import { Module } from '@nestjs/common';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { AnalyticsSummaryService } from './analytics-summary.service';
import { SalesExportService } from './sales-export.service';

@Module({
  controllers: [AnalyticsController],
  providers: [AnalyticsService, AnalyticsSummaryService, SalesExportService],
  exports: [AnalyticsSummaryService, AnalyticsService, SalesExportService],
})
export class AnalyticsModule {}
