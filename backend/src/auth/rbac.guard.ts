import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthedRequest } from './auth-resolution.middleware';
import { AuthContext } from './auth-context';
import { Permission } from './permissions';
import { IS_PUBLIC_KEY } from './public.decorator';

export const PERMISSIONS_KEY = 'permissions';
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) {
      return true;
    }

    const req = context.switchToHttp().getRequest<AuthedRequest>();
    const user = AuthContext.current() ?? req.user;
    if (!user) {
      throw new UnauthorizedException('Authentication required');
    }

    for (const permission of required) {
      if (!user.permissions.includes(permission)) {
        throw new ForbiddenException(`Missing permission: ${permission}`);
      }
    }
    return true;
  }
}
