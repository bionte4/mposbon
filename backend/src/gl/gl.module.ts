import { Module } from '@nestjs/common';
import { AuditModule } from '../common/audit/audit.module';
import { GlController } from './gl.controller';
import { GlService } from './gl.service';
import { IntegrationService } from './integration.service';
import { IntegrationsGlController } from './integrations-gl.controller';

@Module({
  imports: [AuditModule],
  controllers: [GlController, IntegrationsGlController],
  providers: [GlService, IntegrationService],
  exports: [GlService, IntegrationService],
})
export class GlModule {}
