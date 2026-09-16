import { Module } from '@nestjs/common';
import { AuditModule } from '../common/audit/audit.module';
import { GlController } from './gl.controller';
import { GlService } from './gl.service';

@Module({
  imports: [AuditModule],
  controllers: [GlController],
  providers: [GlService],
  exports: [GlService],
})
export class GlModule {}
