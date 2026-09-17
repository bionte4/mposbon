import { defineStore } from 'pinia';
import { computed, ref, shallowRef } from 'vue';
import Dexie from 'dexie';
import type { StaffRole } from '../auth/permissions';
import { bulkPutChunked, posDb } from '../db/pos-db';
import { cloneForIdb } from '../db/serialize';
import type { CachedCategory, CachedProduct, PosSession } from '../db/pos-types';
import { fetchBootstrap } from '../services/pos-api.service';
import { pruneLocalPosState } from '../services/pos-sync.service';
import { useAuthStore } from './auth.store';
import { useShiftStore } from './shift.store';

/**
 * Catalog in Pinia uses shallowRef arrays so Vue does not deep-reactive-wrap
 * every product field (large catalogs on tablets). Lookup via Map, not Array.find.
 */
export const useCatalogStore = defineStore('catalog', () => {
  const session = ref<PosSession | null>(null);
  const categories = shallowRef<CachedCategory[]>([]);
  const products = shallowRef<CachedProduct[]>([]);
  const productIndex = shallowRef<Map<string, CachedProduct>>(new Map());
  /** O(1) barcode / SKU scan path — avoids Array.find on every scan beep. */
  const codeIndex = shallowRef<Map<string, CachedProduct>>(new Map());
  const stores = shallowRef<Array<{ id: string; code: string; name: string }>>([]);
  const online = ref(typeof navigator !== 'undefined' ? navigator.onLine : true);
  const loadError = ref<string | null>(null);

  const productsByCategory = computed(() => {
    const groups = new Map<string, CachedProduct[]>();
    for (const product of products.value) {
      const list = groups.get(product.categoryId) ?? [];
      list.push(product);
      groups.set(product.categoryId, list);
    }
    return groups;
  });

  function normalizeCategory(row: Record<string, unknown>): CachedCategory {
    return {
      id: String(row.id),
      tenantId: String(row.tenantId),
      name: String(row.name),
      sortOrder: Number(row.sortOrder ?? 0),
    };
  }

  function normalizeProduct(row: Record<string, unknown>): CachedProduct {
    const groupsRaw = Array.isArray(row.modifierGroups) ? row.modifierGroups : [];
    const modifierGroups = groupsRaw.map((g) => {
      const group = g as Record<string, unknown>;
      const optionsRaw = Array.isArray(group.options) ? group.options : [];
      return {
        id: String(group.id),
        name: String(group.name),
        minSelect: Number(group.minSelect ?? 0),
        maxSelect: Number(group.maxSelect ?? 1),
        sortOrder: Number(group.sortOrder ?? 0),
        options: optionsRaw.map((o) => {
          const opt = o as Record<string, unknown>;
          return {
            id: String(opt.id),
            name: String(opt.name),
            priceDeltaInCents: Number(opt.priceDeltaInCents ?? 0),
            sortOrder: Number(opt.sortOrder ?? 0),
          };
        }),
      };
    });
    return {
      id: String(row.id),
      tenantId: String(row.tenantId),
      categoryId: String(row.categoryId),
      sku: String(row.sku),
      barcode: row.barcode == null ? null : String(row.barcode),
      name: String(row.name),
      unitPriceInCents: Number(row.unitPriceInCents),
      taxBps: Number(row.taxBps ?? 0),
      stockQty: Number(row.stockQty ?? 0),
      isActive: Boolean(row.isActive),
      productType: row.productType as CachedProduct['productType'],
      kitchenStationId:
        row.kitchenStationId == null ? null : String(row.kitchenStationId),
      modifierGroups,
      variants: Array.isArray(row.variants)
        ? (row.variants as Record<string, unknown>[]).map((v) => ({
            id: String(v.id),
            sku: String(v.sku),
            name: String(v.name),
            unitPriceInCents: Number(v.unitPriceInCents),
            stockQty: Number(v.stockQty ?? 0),
            sortOrder: Number(v.sortOrder ?? 0),
          }))
        : [],
    };
  }

  function setProducts(next: CachedProduct[]): void {
    const active = next.filter((p) => p.isActive);
    products.value = active;
    const map = new Map<string, CachedProduct>();
    const codes = new Map<string, CachedProduct>();
    for (const product of active) {
      map.set(product.id, product);
      if (product.sku) {
        codes.set(product.sku, product);
        codes.set(product.sku.toLowerCase(), product);
      }
      if (product.barcode) {
        codes.set(product.barcode, product);
      }
      for (const v of product.variants ?? []) {
        if (v.sku) {
          codes.set(v.sku, product);
          codes.set(v.sku.toLowerCase(), product);
          codes.set(`variant:${v.sku}`, product);
        }
      }
    }
    productIndex.value = map;
    codeIndex.value = codes;
  }

  async function hydrateFromIndexedDb(): Promise<void> {
    const raw = (await posDb.session.get('current')) ?? null;
    session.value = raw
      ? { ...raw, qrisPayload: raw.qrisPayload ?? null }
      : null;
    if (!session.value) {
      return;
    }
    const tenantId = session.value.tenantId;
    categories.value = await posDb.categories
      .where('[tenantId+sortOrder]')
      .between([tenantId, Dexie.minKey], [tenantId, Dexie.maxKey], true, true)
      .toArray();
    const rows = await posDb.products.where('tenantId').equals(tenantId).sortBy('name');
    setProducts(
      rows.map((row) => ({
        ...row,
        modifierGroups: Array.isArray(row.modifierGroups) ? row.modifierGroups : [],
        variants: Array.isArray(row.variants) ? row.variants : [],
      })),
    );
  }

  async function refreshFromApi(preferredStoreId?: string | null): Promise<void> {
    loadError.value = null;
    const storeId = preferredStoreId ?? session.value?.storeId ?? localStorage.getItem('bonpos.storeId');
    const bootstrap = await fetchBootstrap(storeId);
    if (!bootstrap.store) {
      throw new Error('No store provisioned for this tenant');
    }

    const auth = useAuthStore();
    if (bootstrap.cashier) {
      auth.setStaff({
        id: bootstrap.cashier.id,
        displayName: bootstrap.cashier.displayName,
        email: bootstrap.cashier.email,
        role: bootstrap.cashier.role as StaffRole,
        permissions: bootstrap.cashier.permissions,
        kitchenStationIds: auth.staff?.kitchenStationIds ?? [],
      });
    }

    const shift = useShiftStore();
    shift.active = bootstrap.activeShift;

    const nextSession: PosSession = {
      id: 'current',
      tenantId: bootstrap.tenant.id,
      tenantSlug: bootstrap.tenant.slug,
      storeId: bootstrap.store.id,
      storeName: bootstrap.store.name,
      qrisPayload: bootstrap.store.qrisPayload ?? null,
      cashierUserId: bootstrap.cashier?.id ?? null,
      cashierName: bootstrap.cashier?.displayName ?? null,
      shiftId: bootstrap.activeShift?.id ?? null,
    };

    const plainCategories = (bootstrap.categories as unknown as Record<string, unknown>[]).map(
      normalizeCategory,
    );
    const plainProducts = (bootstrap.products as unknown as Record<string, unknown>[]).map(
      normalizeProduct,
    );

    await posDb.transaction('rw', posDb.session, posDb.categories, posDb.products, async () => {
      await posDb.session.put(cloneForIdb(nextSession));
      await posDb.categories.where('tenantId').equals(nextSession.tenantId).delete();
      await posDb.products.where('tenantId').equals(nextSession.tenantId).delete();
      if (plainCategories.length) {
        await bulkPutChunked(posDb.categories, cloneForIdb(plainCategories));
      }
      if (plainProducts.length) {
        await bulkPutChunked(posDb.products, cloneForIdb(plainProducts));
      }
    });

    session.value = nextSession;
    stores.value = bootstrap.stores ?? [bootstrap.store];
    categories.value = plainCategories;
    setProducts(plainProducts);
    localStorage.setItem('bonpos.storeId', nextSession.storeId);
    void pruneLocalPosState();
  }

  async function switchStore(storeId: string): Promise<void> {
    await refreshFromApi(storeId);
    const cart = (await import('./cart.store')).useCartStore();
    await cart.loadOpenCart();
  }

  async function bindShiftId(shiftId: string | null): Promise<void> {
    if (!session.value) {
      return;
    }
    session.value = { ...session.value, shiftId };
    await posDb.session.put(cloneForIdb(session.value));
  }

  async function init(): Promise<void> {
    await hydrateFromIndexedDb();
    if (!navigator.onLine) {
      return;
    }
    try {
      await refreshFromApi();
    } catch (error) {
      loadError.value = error instanceof Error ? error.message : 'Catalog sync failed';
      if (!products.value.length) {
        throw error;
      }
    }
  }

  function productById(id: string): CachedProduct | undefined {
    return productIndex.value.get(id);
  }

  /** Resolve product (+ variant when SKU matches a variant). */
  function findByBarcodeOrSku(
    code: string,
  ): { product: CachedProduct; variantId: string | null } | undefined {
    const normalized = code.trim();
    if (!normalized) {
      return undefined;
    }
    const product =
      codeIndex.value.get(normalized) ?? codeIndex.value.get(normalized.toLowerCase());
    if (!product) {
      return undefined;
    }
    const variant =
      product.variants?.find(
        (v) => v.sku === normalized || v.sku.toLowerCase() === normalized.toLowerCase(),
      ) ?? null;
    return { product, variantId: variant?.id ?? null };
  }

  return {
    session,
    categories,
    products,
    productsByCategory,
    stores,
    online,
    loadError,
    init,
    hydrateFromIndexedDb,
    refreshFromApi,
    switchStore,
    productById,
    findByBarcodeOrSku,
    bindShiftId,
  };
});
