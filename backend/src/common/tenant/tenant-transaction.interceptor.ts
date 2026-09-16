import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, from, lastValueFrom } from 'rxjs';
import { AuthContext, AuthUser } from '../../auth/auth-context';
import { AuthedRequest } from '../../auth/auth-resolution.middleware';
import { PrismaService } from '../prisma/prisma.service';
import { TenantActor, TenantContext } from './tenant-context';

/**
 * Binds the remaining request pipeline to tenant RLS + auth ALS.
 * Skip when no tenant is resolved (health checks).
 */
@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(private readonly prisma: PrismaService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const tenant: TenantActor | undefined = TenantContext.current() ?? req.tenant;
    if (!tenant) {
      return next.handle();
    }
    const user: AuthUser | undefined = AuthContext.current() ?? req.user;

    const runPipeline = () =>
      this.prisma.runInTenantTransaction(() => lastValueFrom(next.handle()));

    return from(
      TenantContext.run(tenant, () =>
        user ? AuthContext.run(user, runPipeline) : runPipeline(),
      ),
    );
  }
}
