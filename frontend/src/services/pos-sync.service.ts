import {
  posDb,
  querySyncedSalesBefore,
  SYNC_FLUSH_BATCH_SIZE,
  SYNCED_SALE_RETENTION_MS,
} from '../db/pos-db';
import type { SyncJob, SyncJobType } from '../db/pos-types';
import { ApiError, isOfflineError } from '../api/errors';
import { requestBackgroundSync } from '../lib/background-sync';
import {
  postCart,
  postSaleSync,
  type SyncSalePayload,
  type UpsertCartPayload,
} from './pos-api.service';

function newId(): string {
  return crypto.randomUUID();
}

export type StockConflictDetail = {
  productId: string;
  productName: string;
  requested: number;
  available: number;
};

export function parseStockConflicts(error: unknown): StockConflictDetail[] | null {
  if (!(error instanceof ApiError) || error.status !== 409) {
    return null;
  }
  try {
    const json = JSON.parse(error.message) as {
      code?: string;
      details?: { conflicts?: StockConflictDetail[] };
      conflicts?: StockConflictDetail[];
    };
    if (json.code !== 'STOCK_CONFLICT') {
      // Still accept 409 bodies that carry conflicts without code (filter shape).
      const list = json.details?.conflicts ?? json.conflicts;
      return Array.isArray(list) ? list : null;
    }
    const list = json.details?.conflicts ?? json.conflicts;
    return Array.isArray(list) ? list : [];
  } catch {
    return null;
  }
}

export async function enqueueCartUpsert(payload: UpsertCartPayload): Promise<void> {
  const clientTimestamp = payload.clientUpdatedAt ?? new Date().toISOString();
  await posDb.transaction('rw', posDb.syncQueue, async () => {
    // Compound [type+entityId] — O(log n) dedupe instead of scanning all cart.upsert jobs.
    const dupes = await posDb.syncQueue
      .where('[type+entityId]')
      .equals(['cart.upsert', payload.clientUuid])
      .primaryKeys();
    if (dupes.length) {
      await posDb.syncQueue.bulkDelete(dupes);
    }
    await enqueue('cart.upsert', payload, {
      entityId: payload.clientUuid,
      clientTimestamp,
    });
  });
  void requestBackgroundSync();
}

export async function enqueue(
  type: SyncJobType,
  payload: unknown,
  meta: { entityId: string; clientTimestamp: string },
): Promise<void> {
  const job: SyncJob = {
    id: newId(),
    type,
    entityId: meta.entityId,
    clientTimestamp: meta.clientTimestamp,
    createdAt: new Date().toISOString(),
    attempts: 0,
    lastError: null,
    payload,
  };
  await posDb.syncQueue.add(job);
  // Never await SW registration on the critical path (ready can hang forever).
  void requestBackgroundSync();
}

export type FlushResult = {
  flushed: number;
  remaining: number;
  conflicts: StockConflictDetail[];
};

/**
 * Drain IndexedDB queue in small batches.
 * Sale UUID idempotency is enforced server-side; stock conflicts drop the job
 * and mark the local sale as `error` so we do not infinite-retry.
 */
export async function flushSyncQueue(): Promise<FlushResult> {
  if (!navigator.onLine) {
    return { flushed: 0, remaining: await posDb.syncQueue.count(), conflicts: [] };
  }

  let flushed = 0;
  let processed = 0;
  const conflicts: StockConflictDetail[] = [];

  while (processed < SYNC_FLUSH_BATCH_SIZE && navigator.onLine) {
    const job = await posDb.syncQueue.orderBy('createdAt').first();
    if (!job) {
      break;
    }
    processed += 1;

    try {
      if (job.type === 'cart.upsert') {
        await postCart(job.payload as UpsertCartPayload);
      } else if (job.type === 'sale.sync') {
        await postSaleSync(job.payload as SyncSalePayload);
        const saleId = (job.payload as SyncSalePayload).id;
        await posDb.sales.update(saleId, { syncStatus: 'synced' });
      }
      await posDb.syncQueue.delete(job.id);
      flushed += 1;
    } catch (error) {
      const stockConflicts = parseStockConflicts(error);
      if (stockConflicts) {
        conflicts.push(...stockConflicts);
        if (job.type === 'sale.sync') {
          const saleId = (job.payload as SyncSalePayload).id;
          await posDb.sales.update(saleId, { syncStatus: 'error' });
          await applyLocalStockFromConflicts(stockConflicts);
        }
        await posDb.syncQueue.delete(job.id);
        flushed += 1;
        continue;
      }

      const status = error instanceof ApiError ? error.status : 0;
      const message = error instanceof Error ? error.message : 'sync failed';
      // Permanent client errors must not retry forever (toast storms).
      if (status >= 400 && status < 500 && status !== 401 && status !== 408 && status !== 429) {
        if (job.type === 'sale.sync') {
          const saleId = (job.payload as SyncSalePayload).id;
          await posDb.sales.update(saleId, { syncStatus: 'error' });
        }
        await posDb.syncQueue.delete(job.id);
        flushed += 1;
        continue;
      }

      await posDb.syncQueue.update(job.id, {
        attempts: job.attempts + 1,
        lastError: message,
        createdAt: new Date(Date.now() + processed).toISOString(),
      });
      if (isOfflineError(error)) {
        void requestBackgroundSync();
        break;
      }
    }
  }

  if (flushed > 0) {
    await pruneLocalPosState();
  }

  return { flushed, remaining: await posDb.syncQueue.count(), conflicts };
}

/** Patch IndexedDB + in-memory catalog stock from server conflict payload. */
async function applyLocalStockFromConflicts(conflicts: StockConflictDetail[]): Promise<void> {
  for (const row of conflicts) {
    await posDb.products.update(row.productId, { stockQty: row.available });
  }
}

export async function pruneLocalPosState(): Promise<{ salesRemoved: number; cartsRemoved: number }> {
  const cutoff = new Date(Date.now() - SYNCED_SALE_RETENTION_MS).toISOString();
  let salesRemoved = 0;
  let cartsRemoved = 0;

  await posDb.transaction('rw', posDb.sales, posDb.carts, async () => {
    // Range delete on compound [syncStatus+clientCreatedAt] — no per-row get.
    const staleSaleKeys = await querySyncedSalesBefore(cutoff).primaryKeys();
    if (staleSaleKeys.length) {
      await posDb.sales.bulkDelete(staleSaleKeys);
      salesRemoved = staleSaleKeys.length;
    }

    const cartKeys = await posDb.carts
      .where('status')
      .anyOf(['CHECKED_OUT', 'ABANDONED'])
      .primaryKeys();

    const toDelete: string[] = [];
    for (const key of cartKeys) {
      const cart = await posDb.carts.get(key);
      if (!cart) continue;
      const ageMs = Date.now() - Date.parse(cart.updatedAt);
      if (Number.isFinite(ageMs) && ageMs > 60 * 60 * 1000) {
        toDelete.push(key);
      }
    }
    if (toDelete.length) {
      await posDb.carts.bulkDelete(toDelete);
      cartsRemoved = toDelete.length;
    }
  });

  return { salesRemoved, cartsRemoved };
}

export async function pendingCount(): Promise<number> {
  return posDb.syncQueue.count();
}
