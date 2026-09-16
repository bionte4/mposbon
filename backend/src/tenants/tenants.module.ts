import { Module } from '@nestjs/common';
import { AppConfigModule } from '../config/app-config.module';
import { PrismaModule } from '../common/prisma/prisma.module';
import { TenantsController } from './tenants.controller';
import { TenantsService } from './tenants.service';

@Module({
  imports: [AppConfigModule, PrismaModule],
  controllers: [TenantsController],
  providers: [TenantsService],
})
export class TenantsModule {}
