import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { HealthController } from './health.controller';

@Module({
  imports: [AppConfigModule],
  controllers: [HealthController],
})
export class HealthModule {}
