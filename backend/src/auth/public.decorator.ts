import { SetMetadata } from '@nestjs/common';

/** Skip RBAC for public routes (login, health). Auth middleware still may run. */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
