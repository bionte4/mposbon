import { AsyncLocalStorage } from 'node:async_hooks';
import type { Permission, StaffRole } from './permissions';
import { permissionsForRole } from './permissions';

export type AuthUser = {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: StaffRole;
  permissions: Permission[];
  /** When role=KITCHEN and non-empty, KDS is scoped to these stations. */
  kitchenStationIds: string[];
};

const storage = new AsyncLocalStorage<AuthUser>();

export const AuthContext = {
  run<T>(user: AuthUser, fn: () => T): T {
    return storage.run(user, fn);
  },
  current(): AuthUser | undefined {
    return storage.getStore();
  },
  require(): AuthUser {
    const user = storage.getStore();
    if (!user) {
      throw new Error('Auth context is missing for this request');
    }
    return user;
  },
};

export function toAuthUser(row: {
  id: string;
  tenantId: string;
  email: string;
  displayName: string;
  role: StaffRole;
  kitchenStationIds?: string[];
}): AuthUser {
  return {
    id: row.id,
    tenantId: row.tenantId,
    email: row.email,
    displayName: row.displayName,
    role: row.role,
    permissions: permissionsForRole(row.role),
    kitchenStationIds: row.kitchenStationIds ?? [],
  };
}
