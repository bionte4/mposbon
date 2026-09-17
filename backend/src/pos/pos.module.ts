import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../common/audit/audit.module';
import { EdgeSyncModule } from '../edge-sync/edge-sync.module';
import { GlModule } from '../gl/gl.module';
import { PaymentsModule } from '../payments/payments.module';
import { PromotionsModule } from '../promotions/promotions.module';
import { RecipesModule } from '../recipes/recipes.module';
import { KitchenModule } from '../kitchen/kitchen.module';
import { ShiftModule } from '../shifts/shift.module';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { PrinterService } from './printer.service';
import { SensitivePosService } from './sensitive-pos.service';

@Module({
  imports: [
    AuthModule,
    ShiftModule,
    AnalyticsModule,
    AuditModule,
    EdgeSyncModule,
    PromotionsModule,
    PaymentsModule,
    RecipesModule,
    KitchenModule,
    GlModule,
  ],
  controllers: [PosController],
  providers: [PosService, SensitivePosService, PrinterService],
})
export class PosModule {}
