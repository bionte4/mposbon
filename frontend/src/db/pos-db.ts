/**
 * Offline-first POS store (Odoo-style IndexedDB catalog + cart + sync queue).
 * Keep queries keyed by tenantId so a shared browser profile cannot mix tenants.
 *
 * Memory notes (mobile / tablet):
 * - Prefer compound indexes / batch reads over full-table filter scans.
 * - Prune synced sales & abandoned carts so IndexedDB does not grow unbounded.
 */
import Dexie, { type Table } from 'dexie';
import type {
  CachedCategory,
  CachedProduct,
  LocalCart,
  LocalSale,
  PosSession,
  SyncJob,
} from './pos-types';

export class PosDatabase extends Dexie {
  session!: Table<PosSession, string>;
  categories!: Table<CachedCategory, string>;
  products!: Table<CachedProduct, string>;
  carts!: Table<LocalCart, string>;
  sales!: Table<LocalSale, string>;
  syncQueue!: Table<SyncJob, string>;

  constructor() {
    super('bonpos-pos');

    // v1 — initial schema (kept for upgrade path)
    this.version(1).stores({
      session: 'id',
      categories: 'id, tenantId, sortOrder',
      products: 'id, tenantId, categoryId, sku',
      carts: 'clientUuid, tenantId, storeId, status',
      sales: 'id, tenantId, syncStatus, clientCreatedAt',
      syncQueue: 'id, type, createdAt',
    });

    /**
     * v2 — compound indexes for scoped queries on low-spec devices.
     * Avoid `.where('tenantId').filter(...)` full scans for carts/products.
     */
    this.version(2).stores({
      session: 'id',
      categories: 'id, tenantId, [tenantId+sortOrder]',
      products:
        'id, tenantId, categoryId, sku, barcode, [tenantId+categoryId], [tenantId+sku], [tenantId+barcode]',
      carts: 'clientUuid, tenantId, storeId, status, updatedAt, [tenantId+storeId+status]',
      sales: 'id, tenantId, syncStatus, clientCreatedAt, [syncStatus+clientCreatedAt]',
      syncQueue: 'id, type, createdAt, entityId, [type+entityId]',
    });
  }
}

export const posDb = new PosDatabase();

/** How long to keep successfully synced sales locally (ms). */
export const SYNCED_SALE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

/** Max jobs processed per flush pass — keeps peak heap small on low-end devices. */
export const SYNC_FLUSH_BATCH_SIZE = 8;

/** Chunk size for bulkPut so a huge catalog does not spike memory. */
export const IDB_BULK_CHUNK = 200;

export async function bulkPutChunked<T>(
  table: Table<T, string>,
  rows: T[],
  chunkSize = IDB_BULK_CHUNK,
): Promise<void> {
  for (let i = 0; i < rows.length; i += chunkSize) {
    await table.bulkPut(rows.slice(i, i + chunkSize));
  }
}

/** Open carts for a store (compound index — no full-tenant filter scan). */
export function queryOpenCarts(tenantId: string, storeId: string) {
  return posDb.carts
    .where('[tenantId+storeId+status]')
    .equals([tenantId, storeId, 'OPEN']);
}

/** Active products in a category via compound index. */
export function queryProductsByCategory(tenantId: string, categoryId: string) {
  return posDb.products.where('[tenantId+categoryId]').equals([tenantId, categoryId]);
}

/** Synced sales older than ISO cutoff (compound range). */
export function querySyncedSalesBefore(cutoffIso: string) {
  return posDb.sales
    .where('[syncStatus+clientCreatedAt]')
    .between(['synced', Dexie.minKey], ['synced', cutoffIso], true, false);
}
