import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { posDb } from '../db/pos-db';
import type { LocalSale, PaymentMethod } from '../db/pos-types';
import { cloneForIdb } from '../db/serialize';
import { t } from '../i18n';
import {
  bindServiceWorkerFlush,
  requestBackgroundSync,
} from '../lib/background-sync';
import {
  buildSaleReceipt,
  escPosOpenDrawer,
  sendToThermalPrinter,
  type PrintResult,
  type ReceiptData,
} from '../lib/escpos';
import {
  enqueue,
  flushSyncQueue,
  pendingCount,
  type StockConflictDetail,
} from '../services/pos-sync.service';
import { useAuthStore } from './auth.store';
import { useCartStore } from './cart.store';
import { useCatalogStore } from './catalog.store';
import { useShiftStore } from './shift.store';
import { useToastStore } from './toast.store';

export const useSyncStore = defineStore('sync', () => {
  const pending = ref(0);
  const lastResult = ref<string | null>(null);
  const lastReceiptHex = ref<string | null>(null);
  /** Latest sale receipt waiting for on-screen preview / explicit print. */
  const pendingReceipt = ref<ReceiptData | null>(null);
  const pendingReceiptOpenDrawer = ref(false);
  const lastConflicts = ref<StockConflictDetail[]>([]);
  const online = ref(typeof navigator !== 'undefined' ? navigator.onLine : true);
  let unbindSw: (() => void) | null = null;

  const label = computed(() => {
    if (!online.value) {
      return t('sync.offlineQueue', { count: pending.value });
    }
    return pending.value
      ? t('sync.pending', { count: pending.value })
      : t('sync.onlineOk');
  });

  async function refreshPending(): Promise<void> {
    pending.value = await pendingCount();
  }

  function notifyConflicts(conflicts: StockConflictDetail[]): void {
    if (!conflicts.length) {
      return;
    }
    lastConflicts.value = conflicts;
    const toast = useToastStore();
    const summary = conflicts
      .map((c) => `${c.productName} (${c.available}/${c.requested})`)
      .join(', ');
    toast.warning(t('sync.stockConflictTitle'), t('sync.stockConflictBody', { summary }));
    // Refresh in-memory catalog from IndexedDB after stock patch.
    void useCatalogStore().hydrateFromIndexedDb();
  }

  async function flush(): Promise<void> {
    let totalFlushed = 0;
    const allConflicts: StockConflictDetail[] = [];
    for (let pass = 0; pass < 32; pass += 1) {
      const result = await flushSyncQueue();
      totalFlushed += result.flushed;
      pending.value = result.remaining;
      allConflicts.push(...result.conflicts);
      if (result.remaining === 0 || result.flushed === 0) {
        break;
      }
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }
    lastResult.value = `flushed ${totalFlushed}, remaining ${pending.value}`;
    notifyConflicts(allConflicts);
    if (pending.value > 0) {
      void requestBackgroundSync();
    }
  }

  /**
   * Checkout writes the sale to IndexedDB first (UUID + clientCreatedAt),
   * then enqueues sync. Idempotent on the server via sale id.
   */
  async function checkout(
    paymentMethod: PaymentMethod,
    opts?: {
      amountTenderedInCents?: number;
      tipInCents?: number;
      guestIndex?: number;
      payments?: Array<{
        paymentMethod: Exclude<PaymentMethod, 'SPLIT'>;
        amountInCents: number;
        amountTenderedInCents?: number;
      }>;
    },
  ): Promise<LocalSale> {
    const cartStore = useCartStore();
    const catalog = useCatalogStore();
    const shift = useShiftStore();
    const auth = useAuthStore();
    const current = cartStore.cart;
    const session = catalog.session;
    if (!current || !session || current.items.length === 0) {
      throw new Error('Cart is empty');
    }
    if (!shift.isOpen || !shift.active) {
      throw new Error('Clock-in dulu sebelum menjual');
    }
    if (!auth.has('pos.sale.create')) {
      throw new Error('Tidak punya izin membuat penjualan');
    }

    const tipInCents = opts?.tipInCents ?? 0;
    const linesForSale =
      opts?.guestIndex != null
        ? current.items.filter((i) => (i.guestIndex ?? 1) === opts.guestIndex)
        : current.items;
    if (!linesForSale.length) {
      throw new Error('Tidak ada item untuk tamu ini');
    }
    const subtotalInCents = linesForSale.reduce((s, i) => s + i.lineSubtotalInCents, 0);
    const taxInCents = linesForSale.reduce((s, i) => s + i.taxInCents, 0);
    const totalInCents = subtotalInCents + taxInCents + tipInCents;

    const payments =
      opts?.payments ??
      ([
        {
          paymentMethod: paymentMethod === 'SPLIT' ? 'CASH' : paymentMethod,
          amountInCents: totalInCents,
          amountTenderedInCents: opts?.amountTenderedInCents,
        },
      ] as Array<{
        paymentMethod: Exclude<PaymentMethod, 'SPLIT'>;
        amountInCents: number;
        amountTenderedInCents?: number;
      }>);

    const clientCreatedAt = new Date().toISOString();
    const sale: LocalSale = {
      id: crypto.randomUUID(),
      tenantId: session.tenantId,
      storeId: session.storeId,
      cashierUserId: session.cashierUserId,
      shiftId: shift.active.id,
      cartClientUuid: current.clientUuid,
      customerId: current.customerId,
      paymentMethod,
      clientCreatedAt,
      subtotalInCents,
      taxInCents,
      discountInCents: 0,
      tipInCents,
      totalInCents,
      syncStatus: 'pending',
      lines: linesForSale.map((item) => ({ ...item, modifiers: item.modifiers ?? [] })),
    };

    const isPartialGuest =
      opts?.guestIndex != null && linesForSale.length < current.items.length;

    if (!isPartialGuest) {
      current.status = 'CHECKED_OUT';
      await cartStore.persist();
    }

    await posDb.sales.put(cloneForIdb(sale));
    await enqueue(
      'sale.sync',
      {
        id: sale.id,
        storeId: sale.storeId,
        cashierUserId: sale.cashierUserId,
        shiftId: sale.shiftId,
        cartClientUuid: sale.cartClientUuid,
        customerId: sale.customerId,
        paymentMethod: sale.paymentMethod,
        payments,
        tipInCents,
        clientCreatedAt: sale.clientCreatedAt,
        lines: sale.lines.map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          modifierOptionIds: (line.modifiers ?? []).map((m) => m.optionId),
          guestIndex: line.guestIndex ?? 1,
        })),
        subtotalInCents: sale.subtotalInCents,
        taxInCents: sale.taxInCents,
        discountInCents: sale.discountInCents,
        totalInCents: sale.totalInCents,
      },
      { entityId: sale.id, clientTimestamp: clientCreatedAt },
    );

    if (isPartialGuest) {
      await cartStore.removeItems(linesForSale.map((i) => i.id));
    }

    const cashLine = payments.find((p) => p.paymentMethod === 'CASH');
    const tendered = cashLine?.amountTenderedInCents ?? opts?.amountTenderedInCents;
    const change =
      cashLine && tendered != null
        ? Math.max(0, tendered - cashLine.amountInCents)
        : undefined;

    // Hold receipt for on-screen preview — print only after cashier confirms.
    pendingReceipt.value = {
      storeName: session.storeName || 'BonPOS',
      cashierName: session.cashierName || auth.staff?.displayName || 'Kasir',
      saleId: sale.id,
      createdAt: sale.clientCreatedAt,
      paymentMethod: sale.paymentMethod,
      lines: sale.lines.map((line) => ({
        name: line.productName,
        quantity: line.quantity,
        unitPriceInCents: line.unitPriceInCents,
        lineTotalInCents: line.lineTotalInCents,
      })),
      subtotalInCents: sale.subtotalInCents,
      taxInCents: sale.taxInCents,
      discountInCents: sale.discountInCents,
      totalInCents: sale.totalInCents,
      amountTenderedInCents: tendered,
      changeInCents: change,
    };
    pendingReceiptOpenDrawer.value = payments.some((p) => p.paymentMethod === 'CASH');

    await cartStore.startNewCart();
    await refreshPending();
    if (navigator.onLine) {
      void flush();
    } else {
      void requestBackgroundSync();
    }
    return sale;
  }

  function dismissPendingReceipt(): void {
    pendingReceipt.value = null;
    pendingReceiptOpenDrawer.value = false;
  }

  /** Print after preview — call from a user gesture so Web Serial/USB can prompt. */
  async function printPendingReceipt(options?: {
    prompt?: boolean;
  }): Promise<PrintResult | null> {
    const data = pendingReceipt.value;
    if (!data) {
      return null;
    }
    const bytes = buildSaleReceipt(data);
    const sent = await sendToThermalPrinter(bytes, options);
    lastReceiptHex.value = sent.hex;
    if (pendingReceiptOpenDrawer.value) {
      void sendToThermalPrinter(escPosOpenDrawer()).catch((err) => {
        console.warn('Drawer kick skipped', err);
      });
    }
    return sent;
  }

  function bindNetwork(): void {
    online.value = navigator.onLine;
    window.addEventListener('online', () => {
      online.value = true;
      void flush();
    });
    window.addEventListener('offline', () => {
      online.value = false;
      void requestBackgroundSync();
    });
    unbindSw?.();
    unbindSw = bindServiceWorkerFlush(() => {
      void flush();
    });
    void requestBackgroundSync();
  }

  return {
    pending,
    lastResult,
    lastReceiptHex,
    pendingReceipt,
    pendingReceiptOpenDrawer,
    lastConflicts,
    online,
    label,
    refreshPending,
    flush,
    checkout,
    printPendingReceipt,
    dismissPendingReceipt,
    bindNetwork,
  };
});
