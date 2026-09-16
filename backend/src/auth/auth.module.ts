import { Module, NestModule, MiddlewareConsumer, RequestMethod } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuditModule } from '../common/audit/audit.module';
import { PrismaModule } from '../common/prisma/prisma.module';
import { AuthController } from './auth.controller';
import { AuthLoginService } from './auth-login.service';
import { AuthResolutionMiddleware } from './auth-resolution.middleware';
import { RbacGuard } from './rbac.guard';
import { SupervisorAuthService } from './supervisor-auth.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [AuthController],
  providers: [
    AuthResolutionMiddleware,
    AuthLoginService,
    SupervisorAuthService,
    { provide: APP_GUARD, useClass: RbacGuard },
  ],
  exports: [SupervisorAuthService, AuthResolutionMiddleware, AuthLoginService],
})
export class AuthModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(AuthResolutionMiddleware).forRoutes({ path: '*', method: RequestMethod.ALL });
  }
}
