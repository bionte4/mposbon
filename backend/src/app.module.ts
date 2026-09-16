import { Module } from '@nestjs/common';
import { AppConfigModule } from './config/app-config.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { TenantModule } from './common/tenant/tenant.module';
import { HealthModule } from './health/health.module';
import { TenantsModule } from './tenants/tenants.module';
import { PosModule } from './pos/pos.module';
import { AuthModule } from './auth/auth.module';
import { ShiftModule } from './shifts/shift.module';
import { HrisModule } from './hris/hris.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { AuditModule } from './common/audit/audit.module';
import { AdminModule } from './admin/admin.module';
import { CustomersModule } from './customers/customers.module';
import { EdgeSyncModule } from './edge-sync/edge-sync.module';
import { PurchasingModule } from './purchasing/purchasing.module';
import { PromotionsModule } from './promotions/promotions.module';
import { PaymentsModule } from './payments/payments.module';
import { TablesModule } from './tables/tables.module';
import { StockCountModule } from './stock-count/stock-count.module';
import { RecipesModule } from './recipes/recipes.module';
import { KitchenModule } from './kitchen/kitchen.module';
import { GlModule } from './gl/gl.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    TenantModule,
    AuthModule,
    AuditModule,
    HealthModule,
    TenantsModule,
    ShiftModule,
    PosModule,
    HrisModule,
    AnalyticsModule,
    AdminModule,
    CustomersModule,
    EdgeSyncModule,
    PurchasingModule,
    PromotionsModule,
    PaymentsModule,
    TablesModule,
    StockCountModule,
    RecipesModule,
    KitchenModule,
    GlModule,
  ],
})
export class AppModule {}
