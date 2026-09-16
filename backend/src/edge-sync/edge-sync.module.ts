import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { EdgeSyncController } from './edge-sync.controller';
import { EdgeSyncService } from './edge-sync.service';

@Module({
  imports: [AppConfigModule],
  controllers: [EdgeSyncController],
  providers: [EdgeSyncService],
  exports: [EdgeSyncService],
})
export class EdgeSyncModule {}
