import { Module } from '@nestjs/common';
import { AnalyticsModule } from '../analytics/analytics.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../common/audit/audit.module';
import { EdgeSyncModule } from '../edge-sync/edge-sync.module';
import { ShiftModule } from '../shifts/shift.module';
import { PosController } from './pos.controller';
import { PosService } from './pos.service';
import { SensitivePosService } from './sensitive-pos.service';

@Module({
  imports: [AuthModule, ShiftModule, AnalyticsModule, AuditModule, EdgeSyncModule],
  controllers: [PosController],
  providers: [PosService, SensitivePosService],
})
export class PosModule {}
