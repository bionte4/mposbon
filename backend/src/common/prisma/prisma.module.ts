import { Global, Module } from '@nestjs/common';
import { AppConfigModule } from '../../config/app-config.module';
import { PrismaAdminService } from './prisma-admin.service';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  imports: [AppConfigModule],
  providers: [PrismaService, PrismaAdminService],
  exports: [PrismaService, PrismaAdminService],
})
export class PrismaModule {}
