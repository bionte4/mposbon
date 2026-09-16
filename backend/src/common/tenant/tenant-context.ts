export type TenantActor = {
  id: string;
  slug: string;
  name: string;
  status: string;
  deploymentMode: string;
  domain: string | null;
};

/**
 * AsyncLocalStorage-backed tenant context.
 * Isolation strategy: every tenant-scoped query also runs inside a Postgres
 * transaction that SET LOCAL app.current_tenant_id, which RLS policies read.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

const storage = new AsyncLocalStorage<TenantActor>();

export const TenantContext = {
  run<T>(tenant: TenantActor, fn: () => T): T {
    return storage.run(tenant, fn);
  },
  current(): TenantActor | undefined {
    return storage.getStore();
  },
  require(): TenantActor {
    const tenant = storage.getStore();
    if (!tenant) {
      throw new Error('Tenant context is missing for this request');
    }
    return tenant;
  },
};
