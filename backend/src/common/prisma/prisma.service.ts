import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { AsyncLocalStorage } from 'node:async_hooks';
import { AppConfigService } from '../../config/app-config.service';
import { TenantContext } from '../tenant/tenant-context';

const txStorage = new AsyncLocalStorage<Prisma.TransactionClient>();

/**
 * Request-bound Prisma access.
 *
 * Concurrency: each HTTP request that has a tenant runs inside one Postgres
 * transaction. SET LOCAL app.current_tenant_id is transaction-scoped, so
 * pooled connections cannot leak another tenant's GUC after the request ends.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly root: PrismaClient;

  constructor(config: AppConfigService) {
    this.root = new PrismaClient({
      datasources: { db: { url: config.databaseUrl } },
    });
  }

  /** Transaction client when inside a tenant request; otherwise the pool root. */
  get db(): Prisma.TransactionClient | PrismaClient {
    return txStorage.getStore() ?? this.root;
  }

  async onModuleInit(): Promise<void> {
    await this.root.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.root.$disconnect();
  }

  async runInTenantTransaction<T>(work: () => Promise<T>): Promise<T> {
    const tenant = TenantContext.require();
    return this.root.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenant.id}, true)`;
      return txStorage.run(tx, work);
    });
  }
}
