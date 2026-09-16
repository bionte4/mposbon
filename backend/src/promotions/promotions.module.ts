import { Module } from '@nestjs/common';
import { AuditModule } from '../common/audit/audit.module';
import { PrismaModule } from '../common/prisma/prisma.module';
import { PromoController } from './promo.controller';
import { PromoService } from './promo.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [PromoController],
  providers: [PromoService],
  exports: [PromoService],
})
export class PromotionsModule {}
