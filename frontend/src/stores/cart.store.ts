import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { queryOpenCarts, posDb } from '../db/pos-db';
import { cloneForIdb } from '../db/serialize';
import type { LocalCart, LocalCartItem, ModifierSnapshot } from '../db/pos-types';
import { lineMoney, sumCents } from '../lib/money';
import { enqueueCartUpsert } from '../services/pos-sync.service';
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
    parkedAt: null,
    status: 'OPEN',
    items: [],
    subtotalInCents: 0,
    taxInCents: 0,
    totalInCents: 0,
    updatedAt: new Date().toISOString(),
  };
}

function retotal(items: LocalCartItem[]): Pick<LocalCart, 'subtotalInCents' | 'taxInCents' | 'totalInCents'> {
  const subtotalInCents = sumCents(items.map((item) => item.lineSubtotalInCents));
  const taxInCents = sumCents(items.map((item) => item.taxInCents));
  return {
    subtotalInCents,
    taxInCents,
    totalInCents: subtotalInCents + taxInCents,
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
    cart.value.parkedAt ??= null;
    for (const item of cart.value.items) {
      item.modifiers ??= [];
      item.guestIndex ??= 1;
    }
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
      parkedAt: cart.value.parkedAt,
      status: cart.value.status,
      clientUpdatedAt: cart.value.updatedAt,
      lines: cart.value.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        modifierOptionIds: item.modifiers.map((m) => m.optionId),
        guestIndex: item.guestIndex ?? 1,
      })),
    });
  }

  async function addProduct(
    productId: string,
    modifiers: ModifierSnapshot[] = [],
  ): Promise<void> {
    const catalog = useCatalogStore();
    const product = catalog.productById(productId);
    if (!product || !cart.value) {
      return;
    }
    const delta = modifiers.reduce((s, m) => s + m.priceDeltaInCents, 0);
    const unitPriceInCents = product.unitPriceInCents + delta;
    const key = modifiersKey(modifiers);
    const existing = cart.value.items.find(
      (item) =>
        item.productId === productId &&
        modifiersKey(item.modifiers ?? []) === key &&
        (item.guestIndex ?? 1) === 1,
    );
    if (existing) {
      existing.quantity += 1;
      Object.assign(existing, lineMoney(existing.unitPriceInCents, existing.quantity, existing.taxBps));
    } else {
      const money = lineMoney(unitPriceInCents, 1, product.taxBps);
      const suffix = modifiers.length ? ` (${modifiers.map((m) => m.name).join(', ')})` : '';
      cart.value.items.push({
        id: crypto.randomUUID(),
        productId: product.id,
        productName: `${product.name}${suffix}`,
        quantity: 1,
        unitPriceInCents,
        taxBps: product.taxBps,
        modifiers: [...modifiers],
        guestIndex: 1,
        ...money,
      });
    }
    Object.assign(cart.value, retotal(cart.value.items));
    await persist();
    await queueCartSnapshot();
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
    Object.assign(cart.value, retotal(cart.value.items));
    await persist();
    await queueCartSnapshot();
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
    Object.assign(cart.value, retotal(cart.value.items));
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
    cart.value.label = label?.trim() || cart.value.customerName || `Hold ${cart.value.clientUuid.slice(0, 4)}`;
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
  };
});
