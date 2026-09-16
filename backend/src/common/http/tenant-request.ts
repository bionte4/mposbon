import { Request } from 'express';
import { TenantActor } from '../tenant/tenant-context';

export type TenantRequest = Request & { tenant?: TenantActor };
