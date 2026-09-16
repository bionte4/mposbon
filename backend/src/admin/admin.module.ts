import { Module } from '@nestjs/common';
import { AuditModule } from '../common/audit/audit.module';
import { PrismaModule } from '../common/prisma/prisma.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
