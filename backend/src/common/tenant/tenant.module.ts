import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { AppConfigModule } from '../../config/app-config.module';
import { PrismaModule } from '../prisma/prisma.module';
import { TenantResolutionMiddleware } from './tenant-resolution.middleware';
import { TenantTransactionInterceptor } from './tenant-transaction.interceptor';

@Module({
  imports: [AppConfigModule, PrismaModule],
  providers: [
    TenantResolutionMiddleware,
    {
      provide: APP_INTERCEPTOR,
      useClass: TenantTransactionInterceptor,
    },
  ],
  exports: [TenantResolutionMiddleware],
})
export class TenantModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TenantResolutionMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
