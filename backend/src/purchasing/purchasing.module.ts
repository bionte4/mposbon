import { Module } from '@nestjs/common';
import { AuditModule } from '../common/audit/audit.module';
import { PrismaModule } from '../common/prisma/prisma.module';
import { PurchasingController } from './purchasing.controller';
import { PurchasingService } from './purchasing.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [PurchasingController],
  providers: [PurchasingService],
  exports: [PurchasingService],
})
export class PurchasingModule {}
