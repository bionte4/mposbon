import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { queryOpenCarts, posDb } from '../db/pos-db';
import { cloneForIdb } from '../db/serialize';
import type { LocalCart, LocalCartItem, ModifierSnapshot } from '../db/pos-types';
import { lineMoney, sumCents } from '../lib/money';
import { fetchOpenCart, type RemoteOpenCart } from '../services/pos-api.service';
import { enqueueCartUpsert } from '../services/pos-sync.service';
import type { FloorTable } from '../services/tables-api.service';
import { useCatalogStore } from './catalog.store';

function emptyCart(tenantId: string, storeId: string, cashierUserId: string | null): LocalCart {
  return {
    clientUuid: crypto.randomUUID(),
    tenantId,
    storeId,
    cashierUserId,
    customerId: null,
    customerName: null,
    label: null,
    tableId: null,
    tableCode: null,
    tableName: null,
    parkedAt: null,
    status: 'OPEN',
    items: [],
    subtotalInCents: 0,
    taxInCents: 0,
    discountInCents: 0,
    totalInCents: 0,
    promoId: null,
    promoCode: null,
    loyaltyPointsRedeemed: 0,
    updatedAt: new Date().toISOString(),
  };
}

function retotal(
  items: LocalCartItem[],
  discountInCents = 0,
): Pick<LocalCart, 'subtotalInCents' | 'taxInCents' | 'totalInCents' | 'discountInCents'> {
  const subtotalInCents = sumCents(items.map((item) => item.lineSubtotalInCents));
  const taxInCents = sumCents(items.map((item) => item.taxInCents));
  const safeDiscount = Math.max(0, Math.min(discountInCents, subtotalInCents + taxInCents));
  return {
    subtotalInCents,
    taxInCents,
    discountInCents: safeDiscount,
    totalInCents: subtotalInCents + taxInCents - safeDiscount,
  };
}

function modifiersKey(mods: ModifierSnapshot[]): string {
  return [...mods.map((m) => m.optionId)].sort().join(',');
}

export const useCartStore = defineStore('cart', () => {
  const cart = ref<LocalCart | null>(null);
  const heldCarts = ref<LocalCart[]>([]);

  const itemCount = computed(() =>
    cart.value ? cart.value.items.reduce((sum, item) => sum + item.quantity, 0) : 0,
  );

  async function refreshHeld(): Promise<void> {
    const catalog = useCatalogStore();
    const session = catalog.session;
    if (!session || !cart.value) {
      heldCarts.value = [];
      return;
    }
    // Compound [tenantId+storeId+status] — no full-tenant filter scan.
    const open = await queryOpenCarts(session.tenantId, session.storeId)
      .filter(
        (row) =>
          row.clientUuid !== cart.value?.clientUuid &&
          (Boolean(row.parkedAt) || row.items.length > 0),
      )
      .toArray();
    heldCarts.value = open.sort((a, b) =>
      (b.parkedAt ?? b.updatedAt).localeCompare(a.parkedAt ?? a.updatedAt),
    );
  }

  async function loadOpenCart(): Promise<void> {
    const catalog = useCatalogStore();
    const session = catalog.session;
    if (!session) {
      cart.value = null;
      return;
    }
    // Prefer a non-parked open cart for this cashier; else create empty.
    const open = await queryOpenCarts(session.tenantId, session.storeId)
      .filter(
        (row) =>
          !row.parkedAt &&
          (session.cashierUserId == null || row.cashierUserId === session.cashierUserId),
      )
      .first();
    cart.value =
      open ?? emptyCart(session.tenantId, session.storeId, session.cashierUserId);
    // Migrate older IndexedDB carts missing new fields.
    cart.value.customerId ??= null;
    cart.value.customerName ??= null;
    cart.value.label ??= null;
    cart.value.tableId ??= null;
    cart.value.tableCode ??= null;
    cart.value.tableName ??= null;
    cart.value.parkedAt ??= null;
    cart.value.discountInCents ??= 0;
    cart.value.promoId ??= null;
    cart.value.promoCode ??= null;
    cart.value.loyaltyPointsRedeemed ??= 0;
    for (const item of cart.value.items) {
      item.modifiers ??= [];
      item.guestIndex ??= 1;
    }
    Object.assign(cart.value, retotal(cart.value.items, cart.value.discountInCents));
    await persist();
    await refreshHeld();
  }

  async function persist(): Promise<void> {
    if (!cart.value) {
      return;
    }
    cart.value.updatedAt = new Date().toISOString();
    await posDb.carts.put(cloneForIdb(cart.value));
  }

  async function queueCartSnapshot(): Promise<void> {
    if (!cart.value) {
      return;
    }
    await enqueueCartUpsert({
      clientUuid: cart.value.clientUuid,
      storeId: cart.value.storeId,
      cashierUserId: cart.value.cashierUserId,
      customerId: cart.value.customerId,
      label: cart.value.label,
      tableId: cart.value.tableId,
      parkedAt: cart.value.parkedAt,
      status: cart.value.status,
      clientUpdatedAt: cart.value.updatedAt,
      lines: cart.value.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        variantId: item.variantId ?? null,
        modifierOptionIds: item.modifiers.map((m) => m.optionId),
        guestIndex: item.guestIndex ?? 1,
      })),
    });
  }

  async function addProduct(
    productId: string,
    modifiers: ModifierSnapshot[] = [],
    variantId?: string | null,
  ): Promise<LocalCartItem | null> {
    const catalog = useCatalogStore();
    const product = catalog.productById(productId);
    if (!product || !cart.value) {
      return null;
    }
    const variant =
      variantId && product.variants?.length
        ? product.variants.find((v) => v.id === variantId)
        : undefined;
    if ((product.variants?.length ?? 0) > 0 && !variant) {
      return null;
    }
    const delta = modifiers.reduce((s, m) => s + m.priceDeltaInCents, 0);
    const base = variant ? variant.unitPriceInCents : product.unitPriceInCents;
    const unitPriceInCents = base + delta;
    const key = modifiersKey(modifiers);
    const existing = cart.value.items.find(
      (item) =>
        item.productId === productId &&
        (item.variantId ?? null) === (variant?.id ?? null) &&
        modifiersKey(item.modifiers ?? []) === key &&
        (item.guestIndex ?? 1) === 1,
    );
    let target: LocalCartItem;
    if (existing) {
      existing.quantity += 1;
      Object.assign(existing, lineMoney(existing.unitPriceInCents, existing.quantity, existing.taxBps));
      target = existing;
    } else {
      const money = lineMoney(unitPriceInCents, 1, product.taxBps);
      const variantSuffix = variant ? ` · ${variant.name}` : '';
      const suffix = modifiers.length ? ` (${modifiers.map((m) => m.name).join(', ')})` : '';
      target = {
        id: crypto.randomUUID(),
        productId: product.id,
        variantId: variant?.id ?? null,
        productName: `${product.name}${variantSuffix}${suffix}`,
        quantity: 1,
        unitPriceInCents,
        taxBps: product.taxBps,
        modifiers: [...modifiers],
        guestIndex: 1,
        ...money,
      };
      cart.value.items.push(target);
    }
    Object.assign(cart.value, retotal(cart.value.items, cart.value.discountInCents));
    await persist();
    await queueCartSnapshot();
    return target;
  }

  async function setQuantity(itemId: string, quantity: number): Promise<void> {
    if (!cart.value) {
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      return;
    }
    const item = cart.value.items.find((row) => row.id === itemId);
    if (!item) {
      return;
    }
    if (quantity === 0) {
      cart.value.items = cart.value.items.filter((row) => row.id !== itemId);
    } else {
      item.quantity = quantity;
      Object.assign(item, lineMoney(item.unitPriceInCents, item.quantity, item.taxBps));
    }
    Object.assign(cart.value, retotal(cart.value.items, cart.value.discountInCents));
    await persist();
    await queueCartSnapshot();
  }

  async function applyDiscount(input: {
    discountInCents: number;
    promoId?: string | null;
    promoCode?: string | null;
    loyaltyPointsRedeemed?: number;
  }): Promise<void> {
    if (!cart.value) return;
    cart.value.promoId = input.promoId ?? null;
    cart.value.promoCode = input.promoCode ?? null;
    cart.value.loyaltyPointsRedeemed = input.loyaltyPointsRedeemed ?? 0;
    Object.assign(cart.value, retotal(cart.value.items, input.discountInCents));
    await persist();
  }

  async function clearDiscount(): Promise<void> {
    if (!cart.value) return;
    cart.value.promoId = null;
    cart.value.promoCode = null;
    cart.value.loyaltyPointsRedeemed = 0;
    Object.assign(cart.value, retotal(cart.value.items, 0));
    await persist();
  }

  async function setCustomer(customer: { id: string; name: string } | null): Promise<void> {
    if (!cart.value) {
      return;
    }
    cart.value.customerId = customer?.id ?? null;
    cart.value.customerName = customer?.name ?? null;
    await persist();
    await queueCartSnapshot();
  }

  async function setGuest(itemId: string, guestIndex: number): Promise<void> {
    if (!cart.value) return;
    if (!Number.isInteger(guestIndex) || guestIndex < 1 || guestIndex > 8) return;
    const item = cart.value.items.find((row) => row.id === itemId);
    if (!item) return;
    item.guestIndex = guestIndex;
    await persist();
    await queueCartSnapshot();
  }

  function guestTotals(guestIndex: number) {
    const items = (cart.value?.items ?? []).filter((i) => (i.guestIndex ?? 1) === guestIndex);
    return { items, ...retotal(items) };
  }

  async function removeItems(itemIds: string[]): Promise<void> {
    if (!cart.value || !itemIds.length) return;
    const remove = new Set(itemIds);
    cart.value.items = cart.value.items.filter((i) => !remove.has(i.id));
    Object.assign(cart.value, retotal(cart.value.items, cart.value.discountInCents));
    await persist();
    await queueCartSnapshot();
  }

  async function park(label?: string): Promise<void> {
    if (!cart.value || cart.value.items.length === 0) {
      return;
    }
    const catalog = useCatalogStore();
    const session = catalog.session;
    if (!session) {
      return;
    }
    cart.value.label =
      label?.trim() ||
      (cart.value.tableCode ? `${cart.value.tableCode} · ${cart.value.tableName ?? ''}`.trim() : null) ||
      cart.value.customerName ||
      `Hold ${cart.value.clientUuid.slice(0, 4)}`;
    cart.value.parkedAt = new Date().toISOString();
    await persist();
    await queueCartSnapshot();
    cart.value = emptyCart(session.tenantId, session.storeId, session.cashierUserId);
    await persist();
    await refreshHeld();
  }

  async function resume(clientUuid: string): Promise<void> {
    const catalog = useCatalogStore();
    const session = catalog.session;
    if (!session) {
      return;
    }
    const target = await posDb.carts.get(clientUuid);
    if (!target || target.status !== 'OPEN') {
      return;
    }
    // Park current if it has items.
    if (cart.value && cart.value.items.length > 0) {
      cart.value.parkedAt = cart.value.parkedAt ?? new Date().toISOString();
      cart.value.label =
        cart.value.label || cart.value.customerName || `Hold ${cart.value.clientUuid.slice(0, 4)}`;
      await persist();
      await queueCartSnapshot();
    }
    target.parkedAt = null;
    cart.value = target;
    await persist();
    await queueCartSnapshot();
    await refreshHeld();
  }

  async function assignTable(table: {
    id: string;
    code: string;
    name: string;
  }): Promise<void> {
    if (!cart.value) return;
    cart.value.tableId = table.id;
    cart.value.tableCode = table.code;
    cart.value.tableName = table.name;
    cart.value.label = `${table.code} · ${table.name}`;
    await persist();
    await queueCartSnapshot();
  }

  async function clearTable(): Promise<void> {
    if (!cart.value) return;
    cart.value.tableId = null;
    cart.value.tableCode = null;
    cart.value.tableName = null;
    if (!cart.value.label?.includes('·')) {
      cart.value.label = null;
    }
    await persist();
    await queueCartSnapshot();
  }

  function mapRemoteCart(remote: RemoteOpenCart): LocalCart {
    return {
      clientUuid: remote.clientUuid,
      tenantId: remote.tenantId,
      storeId: remote.storeId,
      cashierUserId: remote.cashierUserId,
      customerId: remote.customerId,
      customerName: remote.customer?.name ?? null,
      label: remote.label,
      tableId: remote.tableId,
      tableCode: remote.table?.code ?? null,
      tableName: remote.table?.name ?? null,
      parkedAt: remote.parkedAt,
      status: 'OPEN',
      items: remote.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPriceInCents: item.unitPriceInCents,
        taxBps: item.taxBps,
        taxInCents: item.taxInCents,
        lineSubtotalInCents: item.lineSubtotalInCents,
        lineTotalInCents: item.lineTotalInCents,
        modifiers: item.modifiersJson ?? [],
        guestIndex: item.guestIndex ?? 1,
      })),
      subtotalInCents: remote.subtotalInCents,
      taxInCents: remote.taxInCents,
      discountInCents: 0,
      totalInCents: remote.totalInCents,
      promoId: null,
      promoCode: null,
      loyaltyPointsRedeemed: 0,
      updatedAt: remote.updatedAt,
    };
  }

  async function importFromServer(clientUuid: string): Promise<void> {
    const remote = await fetchOpenCart(clientUuid);
    const mapped = mapRemoteCart(remote);
    Object.assign(mapped, retotal(mapped.items, mapped.discountInCents));
    if (cart.value && cart.value.items.length > 0) {
      cart.value.parkedAt = cart.value.parkedAt ?? new Date().toISOString();
      cart.value.label =
        cart.value.label || cart.value.customerName || `Hold ${cart.value.clientUuid.slice(0, 4)}`;
      await persist();
      await queueCartSnapshot();
    }
    mapped.parkedAt = null;
    cart.value = mapped;
    await persist();
    await queueCartSnapshot();
    await refreshHeld();
  }

  async function openTable(table: FloorTable): Promise<void> {
    if (table.activeCart) {
      const local = await posDb.carts.get(table.activeCart.clientUuid);
      if (local && local.status === 'OPEN') {
        await resume(table.activeCart.clientUuid);
        return;
      }
      await importFromServer(table.activeCart.clientUuid);
      return;
    }
    await startNewCart();
    await assignTable({ id: table.id, code: table.code, name: table.name });
  }

  async function startNewCart(): Promise<void> {
    const catalog = useCatalogStore();
    const session = catalog.session;
    if (!session) {
      return;
    }
    cart.value = emptyCart(session.tenantId, session.storeId, session.cashierUserId);
    await persist();
    await refreshHeld();
  }

  async function clear(): Promise<void> {
    const catalog = useCatalogStore();
    const session = catalog.session;
    if (!session) {
      return;
    }
    if (cart.value) {
      cart.value.status = 'ABANDONED';
      await persist();
    }
    cart.value = emptyCart(session.tenantId, session.storeId, session.cashierUserId);
    await persist();
    await queueCartSnapshot();
    await refreshHeld();
  }

  return {
    cart,
    heldCarts,
    itemCount,
    loadOpenCart,
    refreshHeld,
    addProduct,
    setQuantity,
    setCustomer,
    setGuest,
    guestTotals,
    removeItems,
    park,
    resume,
    clear,
    persist,
    startNewCart,
    assignTable,
    clearTable,
    openTable,
    applyDiscount,
    clearDiscount,
  };
});
