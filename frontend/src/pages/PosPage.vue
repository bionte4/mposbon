<script setup lang="ts">
import { computed, ref } from 'vue';
import { storeToRefs } from 'pinia';
import CheckoutPanel from '../components/CheckoutPanel.vue';
import CashDrawerModal from '../components/CashDrawerModal.vue';
import ModifierPickerModal from '../components/ModifierPickerModal.vue';
import PrinterSetupModal from '../components/PrinterSetupModal.vue';
import ReceiptPreviewPanel from '../components/ReceiptPreviewPanel.vue';
import SupervisorPinModal from '../components/SupervisorPinModal.vue';
import SwipeRevealRow from '../components/SwipeRevealRow.vue';
import TableFloorPanel from '../components/TableFloorPanel.vue';
import VirtualProductGrid from '../components/VirtualProductGrid.vue';
import { useBarcodeScanner } from '../composables/useBarcodeScanner';
import { useSwipe } from '../composables/useSwipe';
import { parseApiError } from '../api/parse-error';
import { useI18n } from '../i18n';
import { formatIdrFromCents } from '../lib/money';
import {
  buildZReportReceipt,
  bytesToHex,
  escPosOpenDrawer,
  sendToThermalPrinter,
} from '../lib/escpos';
import type { CachedProduct, ModifierSnapshot, PaymentMethod, PosCustomer } from '../db/pos-types';
import {
  forceOpenDrawer,
  refundSale,
  removeCartItemAuthorized,
  voidSale,
} from '../services/pos-api.service';
import type { FloorTable } from '../services/tables-api.service';
import { fireToKitchen } from '../services/kitchen-api.service';
import { createCustomer, searchCustomers } from '../services/customers-api.service';
import { previewPromo } from '../services/promo-api.service';
import { useAuthStore } from '../stores/auth.store';
import { useCatalogStore } from '../stores/catalog.store';
import { useCartStore } from '../stores/cart.store';
import { usePrinterStore } from '../stores/printer.store';
import { useShiftStore } from '../stores/shift.store';
import { useSyncStore } from '../stores/sync.store';
import { useToastStore } from '../stores/toast.store';

/** Must match backend LOYALTY_POINT_VALUE_CENTS (default Rp 100 / point). */
const LOYALTY_POINT_VALUE_CENTS = 100;

const { t } = useI18n();
const catalog = useCatalogStore();
const cartStore = useCartStore();
const sync = useSyncStore();
const shift = useShiftStore();
const auth = useAuthStore();
const toast = useToastStore();
const printer = usePrinterStore();

const { categories, products, loadError, session } = storeToRefs(catalog);
const { cart, heldCarts } = storeToRefs(cartStore);
const { label: syncLabel, online, lastReceiptHex, pendingReceipt } = storeToRefs(sync);
const { isConnected: printerConnected, statusLabelKey: printerStatusKey } = storeToRefs(printer);
const receiptPrinting = ref(false);
const { active: activeShift, isOpen: shiftOpen, lastZReport } = storeToRefs(shift);

const selectedCategory = ref<string | 'all'>('all');
const lastSaleId = ref<string | null>(null);
const busy = ref(false);
const pageError = ref<string | null>(null);
const openingFloat = ref(100000);
const countedCash = ref(0);
const showCheckout = ref(false);
const payGuest = ref<number | null>(null);
const drawerMode = ref<'drop' | 'midCount' | null>(null);
const modifierProduct = ref<CachedProduct | null>(null);
const variantProduct = ref<CachedProduct | null>(null);
const pendingVariantId = ref<string | null>(null);
const holdLabel = ref('');
const showHeld = ref(false);
const posView = ref<'products' | 'tables'>('products');
/** Collapse shift tools once clocked in — keeps catalog primary on tablets. */
const shiftToolsOpen = ref(false);
const tableFloorRef = ref<InstanceType<typeof TableFloorPanel> | null>(null);
const showCartTools = ref(false);
/** Customer search + promo collapsed by default to free cart list height. */
const cartMetaOpen = ref(false);
const customerQuery = ref('');
const customerHits = ref<PosCustomer[]>([]);
const customerPoints = ref(0);
const promoCodeInput = ref('');
const loyaltyRedeemInput = ref(0);
const pinAction = ref<'drawer' | 'void' | 'refund' | 'remove' | null>(null);
const pendingRemove = ref<{
  itemId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceInCents: number;
} | null>(null);
const scanHint = ref<string | null>(null);

const scannerEnabled = computed(() => shiftOpen.value);

useBarcodeScanner({
  enabled: scannerEnabled,
  onScan(code) {
    const hit = catalog.findByBarcodeOrSku(code);
    if (!hit) {
      scanHint.value = t('pos.scan.notFound', { code });
      toast.warning(t('pos.scan.missTitle'), code);
      return;
    }
    if (hit.variantId) {
      void onVariantScan(hit.product, hit.variantId);
    } else {
      void onProductTap(hit.product);
    }
    scanHint.value = t('pos.scan.added', { name: hit.product.name });
  },
});

async function onVariantScan(product: CachedProduct, variantId: string): Promise<void> {
  if (!shiftOpen.value) return;
  if (product.modifierGroups?.length) {
    pendingVariantId.value = variantId;
    modifierProduct.value = product;
    return;
  }
  const item = await cartStore.addProduct(product.id, [], variantId);
  if (item) await fireKitchenItem(product, item);
}

async function fireKitchenItem(
  product: CachedProduct,
  item: { id: string; productName: string; quantity: number; guestIndex: number; modifiers: ModifierSnapshot[] },
): Promise<void> {
  if (!product.kitchenStationId || !session.value || !cart.value) return;
  try {
    await fireToKitchen({
      storeId: session.value.storeId,
      cartClientUuid: cart.value.clientUuid,
      tableLabel: cart.value.label,
      lines: [
        {
          clientLineId: item.id,
          productId: product.id,
          productName: item.productName,
          quantity: item.quantity,
          guestIndex: item.guestIndex,
          modifiers: item.modifiers,
        },
      ],
    });
  } catch {
    // Kitchen fire is best-effort; sale still works if KDS offline.
  }
}

async function onProductTap(product: CachedProduct): Promise<void> {
  if (!shiftOpen.value) return;
  const variants = product.variants ?? [];
  if (variants.length === 1) {
    await onVariantPick(variants[0]!.id);
    return;
  }
  if (variants.length > 1) {
    variantProduct.value = product;
    return;
  }
  if (product.modifierGroups?.length) {
    modifierProduct.value = product;
    return;
  }
  const item = await cartStore.addProduct(product.id);
  if (item) await fireKitchenItem(product, item);
}

async function onVariantPick(variantId: string): Promise<void> {
  const product = variantProduct.value;
  variantProduct.value = null;
  if (!product) return;
  if (product.modifierGroups?.length) {
    pendingVariantId.value = variantId;
    modifierProduct.value = product;
    return;
  }
  const item = await cartStore.addProduct(product.id, [], variantId);
  if (item) await fireKitchenItem(product, item);
}

async function onModifiersConfirm(mods: ModifierSnapshot[]): Promise<void> {
  const product = modifierProduct.value;
  const variantId = pendingVariantId.value;
  modifierProduct.value = null;
  pendingVariantId.value = null;
  if (!product) return;
  const item = await cartStore.addProduct(product.id, mods, variantId);
  if (item) await fireKitchenItem(product, item);
}

async function searchCustomer(): Promise<void> {
  try {
    customerHits.value = await searchCustomers(customerQuery.value.trim());
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : t('pos.errors.customer');
  }
}

async function addCustomerQuick(): Promise<void> {
  const phone = customerQuery.value.trim();
  if (!phone) return;
  try {
    const row = await createCustomer({ name: phone, phone });
    await cartStore.setCustomer({ id: row.id, name: row.name });
    customerPoints.value = row.loyaltyPoints ?? 0;
    customerHits.value = [];
    customerQuery.value = '';
    toast.success(t('pos.customer.attached'), row.name);
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : t('pos.errors.customer');
  }
}

async function applyPromoCode(): Promise<void> {
  if (!cart.value?.items.length) return;
  const code = promoCodeInput.value.trim().toUpperCase();
  if (!code) {
    await cartStore.clearDiscount();
    loyaltyRedeemInput.value = 0;
    return;
  }
  try {
    const lines = cart.value.items.map((item) => {
      const product = catalog.productById(item.productId);
      return {
        productId: item.productId,
        categoryId: product?.categoryId ?? null,
        quantity: item.quantity,
        lineSubtotalInCents: item.lineSubtotalInCents,
        taxInCents: item.taxInCents,
      };
    });
    const preview = await previewPromo({ code, lines });
    if (!preview.promo || preview.discountInCents < 1) {
      toast.error(t('pos.promo.invalid'));
      return;
    }
    const loyaltyPts = cart.value.loyaltyPointsRedeemed ?? 0;
    if (!preview.stackWithLoyalty && loyaltyPts > 0) {
      toast.error(t('pos.promo.noStackLoyalty'));
      return;
    }
    const loyaltyDiscount = loyaltyPts * LOYALTY_POINT_VALUE_CENTS;
    await cartStore.applyDiscount({
      discountInCents: preview.discountInCents + loyaltyDiscount,
      promoId: preview.promo.id,
      promoCode: preview.promo.code,
      loyaltyPointsRedeemed: loyaltyPts,
    });
    promoCodeInput.value = preview.promo.code;
    toast.success(t('pos.promo.applied'), formatIdrFromCents(preview.discountInCents));
  } catch (error) {
    toast.error(t('pos.promo.invalid'), parseApiError(error).message);
  }
}

async function applyLoyaltyRedeem(): Promise<void> {
  if (!cart.value) return;
  if (!cart.value.customerId) {
    toast.error(t('pos.promo.needCustomer'));
    return;
  }
  const pts = Math.max(0, Math.trunc(loyaltyRedeemInput.value));
  if (pts > customerPoints.value) {
    toast.error(t('pos.promo.insufficientPoints'));
    return;
  }
  const loyaltyDiscount = pts * LOYALTY_POINT_VALUE_CENTS;
  let promoDiscount = 0;
  if (cart.value.promoCode) {
    const lines = cart.value.items.map((item) => {
      const product = catalog.productById(item.productId);
      return {
        productId: item.productId,
        categoryId: product?.categoryId ?? null,
        quantity: item.quantity,
        lineSubtotalInCents: item.lineSubtotalInCents,
        taxInCents: item.taxInCents,
      };
    });
    const preview = await previewPromo({ code: cart.value.promoCode, lines });
    if (preview.promo && !preview.stackWithLoyalty && pts > 0) {
      toast.error(t('pos.promo.noStackLoyalty'));
      return;
    }
    promoDiscount = preview.discountInCents;
  }
  await cartStore.applyDiscount({
    discountInCents: promoDiscount + loyaltyDiscount,
    promoId: cart.value.promoId,
    promoCode: cart.value.promoCode,
    loyaltyPointsRedeemed: pts,
  });
  toast.success(t('pos.promo.loyaltyOk'), formatIdrFromCents(loyaltyDiscount));
}

async function parkCart(): Promise<void> {
  if (!cart.value?.items.length) return;
  await cartStore.park(holdLabel.value || undefined);
  holdLabel.value = '';
  toast.success(t('pos.hold.parked'));
  tableFloorRef.value?.reload();
}

async function onTableSelect(table: FloorTable): Promise<void> {
  if (busy.value) return;
  if (!shiftOpen.value) {
    toast.warning(t('pos.shiftClosed'), t('pos.errors.needClockIn'));
    return;
  }
  busy.value = true;
  try {
    await cartStore.openTable(table);
    posView.value = 'products';
    toast.success(
      table.activeCart ? t('pos.tables.resumed', { code: table.code }) : t('pos.tables.opened', { code: table.code }),
    );
  } catch (error) {
    toast.error(parseApiError(error));
  } finally {
    busy.value = false;
  }
}

const visibleProducts = computed(() => {
  if (selectedCategory.value === 'all') {
    return products.value;
  }
  return products.value.filter((product) => product.categoryId === selectedCategory.value);
});

/** Category strip options including "all" for swipe cycling. */
const categoryKeys = computed((): Array<string | 'all'> => [
  'all',
  ...categories.value.map((c) => c.id),
]);

const categorySwipe = useSwipe({
  threshold: 48,
  onSwipeLeft: () => {
    const keys = categoryKeys.value;
    const len = keys.length;
    if (len <= 1) return;
    const cur = keys.indexOf(selectedCategory.value);
    const next = (Math.max(0, cur) + 1) % len;
    selectedCategory.value = keys[next]!;
  },
  onSwipeRight: () => {
    const keys = categoryKeys.value;
    const len = keys.length;
    if (len <= 1) return;
    const cur = keys.indexOf(selectedCategory.value);
    const next = (Math.max(0, cur) - 1 + len) % len;
    selectedCategory.value = keys[next]!;
  },
});

const pinTitle = computed(() => {
  if (pinAction.value === 'drawer') return t('pin.drawer');
  if (pinAction.value === 'remove') return t('pin.remove');
  if (pinAction.value === 'refund') return t('pin.refund');
  return t('pin.void');
});

const cartItemCount = computed(() =>
  (cart.value?.items ?? []).reduce((n, item) => n + item.quantity, 0),
);

async function boot(): Promise<void> {
  sync.bindNetwork();
  catalog.bindLiveRefresh();
  try {
    await catalog.init();
    await cartStore.loadOpenCart();
    await sync.refreshPending();
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : t('pos.errors.load');
  }
}
void boot();

function openCheckout(guestIndex?: number): void {
  if (busy.value) {
    toast.warning(t('pos.errors.busy'));
    return;
  }
  if (!shiftOpen.value) {
    toast.warning(t('pos.shiftClosed'), t('pos.errors.needClockIn'));
    return;
  }
  if (!(cart.value?.items.length)) {
    toast.warning(t('pos.emptyCart'));
    return;
  }
  payGuest.value = guestIndex ?? null;
  showCheckout.value = true;
}

const checkoutTotal = computed(() => {
  if (payGuest.value == null) return cart.value?.totalInCents ?? 0;
  return cartStore.guestTotals(payGuest.value).totalInCents;
});

const guestPayOptions = computed(() => {
  const set = new Set((cart.value?.items ?? []).map((i) => i.guestIndex ?? 1));
  return [...set].filter((g) => g > 1 || set.size > 1).sort((a, b) => a - b);
});

async function onCheckoutConfirm(payload: {
  paymentMethod: PaymentMethod;
  amountTenderedInCents?: number;
  tipInCents?: number;
  paymentChargeId?: string;
  payments: Array<{
    paymentMethod: Exclude<PaymentMethod, 'SPLIT'>;
    amountInCents: number;
    amountTenderedInCents?: number;
  }>;
}): Promise<void> {
  showCheckout.value = false;
  const guest = payGuest.value;
  payGuest.value = null;
  busy.value = true;
  pageError.value = null;
  try {
    const sale = await sync.checkout(payload.paymentMethod, {
      amountTenderedInCents: payload.amountTenderedInCents,
      tipInCents: payload.tipInCents,
      guestIndex: guest ?? undefined,
      payments: payload.payments,
      paymentChargeId: payload.paymentChargeId,
    });
    lastSaleId.value = sale.id;
    toast.success(
      t('pos.toast.paidOk'),
      t('pos.toast.paidBody', { method: payload.paymentMethod }),
    );
    // Receipt stays in pendingReceipt for preview → print/skip.
  } catch (error) {
    pageError.value = parseApiError(error).message || t('pos.errors.checkout');
    toast.error(t('pos.errors.checkout'), parseApiError(error).message);
  } finally {
    busy.value = false;
  }
}

async function onReceiptPrint(): Promise<void> {
  if (receiptPrinting.value || !pendingReceipt.value) return;
  receiptPrinting.value = true;
  pageError.value = null;
  try {
    const result = await sync.printPendingReceipt({ prompt: true });
    if (!result) return;
    if (result.ok) {
      toast.success(t('pos.receipt.printOk'), result.method);
      printer.markPrintResult(result.method, true);
    } else {
      toast.warning(t('pos.toast.printerPreview'), t('pos.toast.printerPreviewBody'));
      lastReceiptHex.value = result.hex;
      printer.markPrintResult(result.method, false);
    }
    sync.dismissPendingReceipt();
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : t('pos.errors.printer');
    toast.error(t('pos.errors.printer'), parseApiError(error).message);
  } finally {
    receiptPrinting.value = false;
  }
}

function onReceiptSkip(): void {
  sync.dismissPendingReceipt();
}

async function onDrawerConfirm(payload: { amountInCents: number; note?: string }): Promise<void> {
  const mode = drawerMode.value;
  drawerMode.value = null;
  if (!mode) return;
  busy.value = true;
  pageError.value = null;
  try {
    if (mode === 'drop') {
      await shift.cashDrop(payload.amountInCents, payload.note);
      toast.success(t('pos.drawer.dropOk'), formatIdrFromCents(payload.amountInCents));
    } else {
      const result = await shift.midCount(payload.amountInCents, payload.note);
      toast.success(
        t('pos.drawer.midOk'),
        t('pos.drawer.midResult', {
          expected: formatIdrFromCents(result.expectedCashInCents),
          variance: formatIdrFromCents(result.varianceInCents),
        }),
      );
    }
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : t('pos.errors.drawerMove');
  } finally {
    busy.value = false;
  }
}

async function doClockIn(): Promise<void> {
  busy.value = true;
  pageError.value = null;
  const hadOpen = shift.isOpen;
  try {
    await shift.clockIn(openingFloat.value);
    await catalog.bindShiftId(shift.active?.id ?? null);
    if (!hadOpen && shift.isOpen) {
      toast.success(t('pos.toast.shiftOpen'));
    }
  } catch (error) {
    pageError.value = parseApiError(error).message || t('pos.errors.clockIn');
  } finally {
    busy.value = false;
  }
}

async function doClockOut(): Promise<void> {
  busy.value = true;
  pageError.value = null;
  try {
    const report = await shift.clockOut(countedCash.value);
    await catalog.bindShiftId(null);
    const bytes = buildZReportReceipt({
      storeName: report.shift.store.name,
      cashierName: report.shift.cashier.displayName,
      shiftId: report.shift.id,
      clockInAt: report.shift.clockInAt,
      clockOutAt: report.shift.clockOutAt,
      saleCount: report.sales.count,
      cashInCents: report.sales.cashInCents,
      cardInCents: report.sales.cardInCents,
      qrisInCents: report.sales.qrisInCents,
      grossInCents: report.sales.grossInCents,
      openingFloatInCents: report.drawer.openingFloatInCents,
      expectedCashInCents: report.drawer.expectedCashInCents,
      countedCashInCents: report.drawer.countedCashInCents ?? countedCash.value,
      discrepancyInCents: report.drawer.discrepancyInCents ?? 0,
    });
    const zPrinted = await sendToThermalPrinter(bytes);
    printer.markPrintResult(zPrinted.method, zPrinted.ok);
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : t('pos.errors.clockOut');
  } finally {
    busy.value = false;
  }
}

function openPrinterSetup(): void {
  printer.openSetup();
}

function requestDrawer(): void {
  if (!auth.has('pos.drawer.open_force')) {
    pageError.value = t('pos.errors.drawerDenied');
    return;
  }
  pinAction.value = 'drawer';
}

function requestVoid(): void {
  if (!lastSaleId.value) {
    pageError.value = t('pos.errors.voidEmpty');
    return;
  }
  if (!auth.has('pos.void')) {
    pageError.value = t('pos.errors.voidDenied');
    return;
  }
  pinAction.value = 'void';
}

function requestRefund(): void {
  if (!lastSaleId.value) {
    pageError.value = t('pos.errors.refundEmpty');
    return;
  }
  if (!auth.has('pos.void')) {
    pageError.value = t('pos.errors.voidDenied');
    return;
  }
  pinAction.value = 'refund';
}

function requestRemoveItem(item: {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceInCents: number;
}): void {
  if (item.quantity > 1) {
    void cartStore.setQuantity(item.id, item.quantity - 1);
    return;
  }
  pendingRemove.value = {
    itemId: item.id,
    productId: item.productId,
    productName: item.productName,
    quantity: item.quantity,
    unitPriceInCents: item.unitPriceInCents,
  };
  pinAction.value = 'remove';
}

async function onPinConfirm(pin: string): Promise<void> {
  const action = pinAction.value;
  pinAction.value = null;
  busy.value = true;
  pageError.value = null;
  try {
    if (action === 'drawer') {
      const result = await forceOpenDrawer(pin, 'Force open from POS');
      const kick = escPosOpenDrawer();
      await sendToThermalPrinter(kick, { prompt: false });
      lastReceiptHex.value = result.escPosKickHex || bytesToHex(kick);
      toast.success(t('pos.toast.drawerOk'), t('pos.toast.drawerBody'));
    } else if (action === 'void' && lastSaleId.value) {
      await voidSale(lastSaleId.value, pin, 'Void from POS');
      lastSaleId.value = null;
      await catalog.refreshFromApi().catch(() => undefined);
      toast.success(t('pos.toast.voidOk'), t('pos.toast.voidBody'));
    } else if (action === 'refund' && lastSaleId.value) {
      await refundSale(lastSaleId.value, pin, 'Refund / return from POS');
      lastSaleId.value = null;
      await catalog.refreshFromApi().catch(() => undefined);
      toast.success(t('pos.toast.refundOk'), t('pos.toast.refundBody'));
    } else if (action === 'remove' && pendingRemove.value && cart.value) {
      const target = pendingRemove.value;
      await removeCartItemAuthorized({
        cartClientUuid: cart.value.clientUuid,
        productId: target.productId,
        productName: target.productName,
        quantity: target.quantity,
        unitPriceInCents: target.unitPriceInCents,
        supervisorPin: pin,
        reason: 'Remove last unit from cart',
      });
      await cartStore.setQuantity(target.itemId, 0);
      pendingRemove.value = null;
      toast.success(t('pos.toast.removeOk'), t('pos.toast.removeBody'));
    }
  } catch (error) {
    pageError.value = error instanceof Error ? error.message : t('pos.errors.supervisor');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div
    class="pos-shell flex h-[calc(100dvh-3.25rem)] flex-col overflow-hidden bg-slate-100 md:flex-row"
  >
    <CashDrawerModal
      v-if="drawerMode"
      :mode="drawerMode"
      @confirm="onDrawerConfirm"
      @cancel="drawerMode = null"
    />
    <ModifierPickerModal
      v-if="modifierProduct"
      :product="modifierProduct"
      @confirm="onModifiersConfirm"
      @cancel="modifierProduct = null; pendingVariantId = null"
    />
    <div
      v-if="variantProduct"
      class="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center"
      @click.self="variantProduct = null"
    >
      <div class="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl">
        <h2 class="text-lg font-bold">{{ variantProduct.name }}</h2>
        <p class="mb-3 text-sm text-slate-500">Pilih varian</p>
        <div class="grid gap-2">
          <button
            v-for="v in variantProduct.variants"
            :key="v.id"
            type="button"
            class="min-h-12 rounded-2xl bg-slate-900 px-4 text-left text-sm font-semibold text-white"
            @click="onVariantPick(v.id)"
          >
            {{ v.name }}
            <span class="float-right font-normal opacity-90">
              {{ formatIdrFromCents(v.unitPriceInCents) }}
            </span>
          </button>
        </div>
        <button
          type="button"
          class="mt-3 min-h-11 w-full rounded-2xl bg-slate-100 text-sm font-semibold"
          @click="variantProduct = null"
        >
          {{ t('common.cancel') }}
        </button>
      </div>
    </div>
    <SupervisorPinModal
      v-if="pinAction"
      :title="pinTitle"
      :subtitle="t('pin.subtitle')"
      @confirm="onPinConfirm"
      @cancel="pinAction = null; pendingRemove = null"
    />
    <PrinterSetupModal />

    <!-- Catalog column -->
    <section
      class="flex min-h-0 flex-1 flex-col overflow-hidden p-2.5 sm:p-3 md:min-w-0 md:flex-1 md:pb-3"
    >
      <header class="mb-2 flex shrink-0 flex-wrap items-center justify-between gap-2">
        <div class="min-w-0">
          <p class="truncate text-xs font-semibold uppercase tracking-wide text-slate-500">
            {{ auth.staff?.displayName || t('app.roles.cashier') }}
            <span class="font-medium normal-case text-slate-400">· {{ auth.role || '—' }}</span>
          </p>
          <p v-if="scanHint" class="mt-0.5 text-sm text-slate-600">{{ scanHint }}</p>
        </div>
        <div class="flex flex-wrap items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            class="touch-target rounded-full px-3 text-sm font-semibold ring-1"
            :class="
              printerConnected
                ? 'bg-emerald-50 text-emerald-900 ring-emerald-200'
                : 'bg-amber-50 text-amber-950 ring-amber-200'
            "
            :disabled="busy"
            @click="openPrinterSetup"
          >
            {{ t(printerStatusKey) }}
          </button>
          <p
            class="touch-target rounded-full px-3 text-sm font-semibold"
            :class="shiftOpen ? 'bg-sky-100 text-sky-900' : 'bg-slate-200 text-slate-700'"
          >
            {{ shiftOpen ? t('pos.shiftOpen') : t('pos.shiftClosed') }}
          </p>
          <p
            class="touch-target rounded-full px-3 text-sm font-semibold"
            :class="online ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-900'"
          >
            {{ syncLabel }}
          </p>
        </div>
      </header>

      <div
        v-if="!shiftOpen"
        class="mb-2 flex shrink-0 flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3"
      >
        <div>
          <label class="text-sm font-medium text-slate-600">{{ t('pos.openingFloat') }}</label>
          <input
            v-model.number="openingFloat"
            class="mt-1 min-h-14 w-44 rounded-2xl border border-slate-300 px-3 text-lg tabular-nums"
            type="number"
            step="1"
            inputmode="numeric"
          />
        </div>
        <button
          class="touch-target rounded-2xl bg-sky-700 px-6 text-base font-semibold text-white"
          type="button"
          :disabled="busy"
          @click="doClockIn"
        >
          {{ t('pos.clockIn') }}
        </button>
      </div>

      <div
        v-else
        class="mb-2 shrink-0 rounded-2xl border border-slate-200 bg-white"
      >
        <div class="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
          <p class="min-w-0 flex-1 truncate text-sm text-slate-600">
            {{
              t('pos.shiftSummary', {
                id: activeShift?.id.slice(0, 8) ?? '—',
                sales: activeShift?.saleCount ?? 0,
                cash: formatIdrFromCents(activeShift?.cashSalesInCents ?? 0),
              })
            }}
          </p>
          <button
            type="button"
            class="touch-target shrink-0 rounded-xl bg-slate-100 px-3 text-sm font-semibold text-slate-800"
            @click="shiftToolsOpen = !shiftToolsOpen"
          >
            {{ shiftToolsOpen ? t('pos.shiftToolsHide') : t('pos.shiftTools') }}
          </button>
        </div>
        <div
          v-if="shiftToolsOpen"
          class="flex flex-wrap items-end gap-3 border-t border-slate-100 px-3 py-3"
        >
          <div>
            <label class="text-sm font-medium text-slate-600">{{ t('pos.countedCash') }}</label>
            <input
              v-model.number="countedCash"
              class="mt-1 min-h-14 w-44 rounded-2xl border border-slate-300 px-3 text-lg tabular-nums"
              type="number"
              step="1"
              inputmode="numeric"
            />
          </div>
          <button
            class="touch-target rounded-2xl bg-amber-700 px-4 text-base font-semibold text-white"
            type="button"
            :disabled="busy"
            @click="drawerMode = 'drop'"
          >
            {{ t('pos.drawer.drop') }}
          </button>
          <button
            class="touch-target rounded-2xl bg-amber-900 px-4 text-base font-semibold text-white"
            type="button"
            :disabled="busy"
            @click="drawerMode = 'midCount'"
          >
            {{ t('pos.drawer.mid') }}
          </button>
          <button
            class="touch-target rounded-2xl bg-slate-800 px-6 text-base font-semibold text-white"
            type="button"
            :disabled="busy"
            @click="doClockOut"
          >
            {{ t('pos.clockOut') }}
          </button>
        </div>
      </div>

      <p
        v-if="pageError || loadError"
        class="mb-2 shrink-0 rounded-2xl bg-red-50 p-3 text-red-800"
      >
        {{ pageError || loadError }}
      </p>
      <p v-if="lastSaleId" class="mb-2 shrink-0 rounded-2xl bg-emerald-50 p-3 text-emerald-900">
        {{ t('pos.localSale') }}
        <code class="text-xs">{{ lastSaleId }}</code>
      </p>
      <p v-if="lastZReport" class="mb-2 shrink-0 rounded-2xl bg-sky-50 p-3 text-sky-900">
        {{ t('pos.zDiscrepancy') }}
        {{ formatIdrFromCents(lastZReport.drawer.discrepancyInCents ?? 0) }}
      </p>

      <div class="mb-2 flex shrink-0 gap-2">
        <button
          type="button"
          class="touch-target rounded-2xl px-4 text-sm font-semibold sm:px-5 sm:text-base"
          :class="posView === 'products' ? 'bg-slate-900 text-white' : 'bg-white text-slate-800'"
          @click="posView = 'products'"
        >
          {{ t('pos.view.products') }}
        </button>
        <button
          type="button"
          class="touch-target rounded-2xl px-4 text-sm font-semibold sm:px-5 sm:text-base"
          :class="posView === 'tables' ? 'bg-violet-700 text-white' : 'bg-white text-slate-800'"
          @click="posView = 'tables'"
        >
          {{ t('pos.view.tables') }}
        </button>
      </div>

      <div
        v-if="posView === 'products'"
        class="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div
          class="mb-2 flex shrink-0 gap-2 overflow-x-auto pb-0.5"
          v-on="categorySwipe.handlers"
        >
          <button
            class="touch-target shrink-0 rounded-2xl px-4 text-sm font-semibold sm:px-5 sm:text-base"
            :class="selectedCategory === 'all' ? 'bg-slate-900 text-white' : 'bg-white text-slate-800'"
            type="button"
            @click="selectedCategory = 'all'"
          >
            {{ t('common.all') }}
          </button>
          <button
            v-for="category in categories"
            :key="category.id"
            class="touch-target shrink-0 rounded-2xl px-4 text-sm font-semibold sm:px-5 sm:text-base"
            :class="selectedCategory === category.id ? 'bg-slate-900 text-white' : 'bg-white text-slate-800'"
            type="button"
            @click="selectedCategory = category.id"
          >
            {{ category.name }}
          </button>
        </div>

        <VirtualProductGrid
          :products="visibleProducts"
          :disabled="!shiftOpen"
          @select="onProductTap"
        />
      </div>

      <div
        v-else-if="session?.storeId"
        class="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <TableFloorPanel
          ref="tableFloorRef"
          :store-id="session.storeId"
          @select="onTableSelect"
        />
      </div>
    </section>

    <!-- Cart column: full-height sidebar from md up; capped share on phone stack -->
    <aside
      class="pos-cart-pane flex min-h-0 w-full flex-col overflow-hidden border-t border-slate-200 bg-white max-md:max-h-[46%] max-md:min-h-[16rem] md:h-full md:w-[22rem] md:max-h-none md:min-h-0 md:flex-none md:shrink-0 md:border-l md:border-t-0 lg:w-[26rem] pos:w-[28rem] kiosk:w-[32rem]"
    >
      <CheckoutPanel
        v-if="showCheckout"
        :total-in-cents="checkoutTotal"
        :qris-payload="session?.qrisPayload"
        :bill-number="cart?.clientUuid?.slice(0, 8) ?? null"
        :store-id="session?.storeId ?? ''"
        :client-uuid="cart?.clientUuid ?? ''"
        @confirm="onCheckoutConfirm"
        @cancel="showCheckout = false; payGuest = null"
      />

      <ReceiptPreviewPanel
        v-else-if="pendingReceipt"
        :receipt="pendingReceipt"
        :printing="receiptPrinting"
        @print="onReceiptPrint"
        @skip="onReceiptSkip"
      />

      <template v-else>
      <div class="flex shrink-0 items-center justify-between gap-2 border-b border-slate-100 px-3 py-2">
        <div class="min-w-0">
          <h2 class="text-base font-semibold leading-tight sm:text-lg">{{ t('pos.cart') }}</h2>
          <p class="truncate text-[11px] text-slate-500 sm:text-xs">{{ session?.storeName }}</p>
          <p v-if="cart?.tableCode" class="mt-0.5 text-[11px] font-semibold text-violet-800 sm:text-xs">
            {{ t('pos.tables.current', { code: cart.tableCode, name: cart.tableName ?? '' }) }}
            <button type="button" class="ml-1 underline" @click="cartStore.clearTable()">
              {{ t('pos.tables.clear') }}
            </button>
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            class="rounded-lg px-2 py-1.5 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 sm:text-xs"
            @click="cartMetaOpen = !cartMetaOpen"
          >
            {{ cartMetaOpen ? t('pos.cartMetaHide') : t('pos.cartMeta') }}
          </button>
          <span
            v-if="cartItemCount"
            class="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-semibold text-white"
          >
            {{ cartItemCount }}
          </span>
        </div>
      </div>

      <div
        v-if="cartMetaOpen || cart?.customerName"
        class="shrink-0 border-b border-slate-100 px-3 py-1.5"
      >
        <p v-if="cart?.customerName && !cartMetaOpen" class="text-xs font-medium text-emerald-800">
          {{ t('pos.customer.current', { name: cart.customerName }) }}
          <button type="button" class="ml-1 underline" @click="cartStore.setCustomer(null)">
            {{ t('common.close') }}
          </button>
        </p>
        <template v-if="cartMetaOpen">
          <div class="flex gap-1.5">
            <input
              v-model="customerQuery"
              class="min-h-10 flex-1 rounded-xl border border-slate-300 px-2.5 text-sm"
              :placeholder="t('pos.customer.search')"
              @keyup.enter="searchCustomer"
            />
            <button
              type="button"
              class="min-h-10 rounded-xl bg-slate-200 px-2.5 text-sm font-semibold"
              @click="searchCustomer"
            >
              {{ t('pos.customer.find') }}
            </button>
          </div>
          <p v-if="cart?.customerName" class="mt-1 text-xs text-emerald-800">
            {{ t('pos.customer.current', { name: cart.customerName }) }}
            <button type="button" class="ml-1 underline" @click="cartStore.setCustomer(null)">
              {{ t('common.close') }}
            </button>
          </p>
          <ul v-if="customerHits.length" class="mt-1 max-h-20 space-y-0.5 overflow-auto text-xs">
            <li v-for="c in customerHits" :key="c.id">
              <button
                type="button"
                class="w-full rounded-lg bg-slate-50 px-2.5 py-1.5 text-left hover:bg-slate-100"
                @click="
                  cartStore.setCustomer({ id: c.id, name: c.name });
                  customerPoints = c.loyaltyPoints ?? 0;
                  customerHits = [];
                  customerQuery = '';
                "
              >
                {{ c.name }}
                <span class="text-slate-500">· {{ c.phone || '—' }} · {{ c.loyaltyPoints }} pts</span>
              </button>
            </li>
          </ul>
          <button
            v-if="customerQuery.trim()"
            type="button"
            class="mt-1 text-xs font-semibold text-sky-700"
            @click="addCustomerQuick"
          >
            {{ t('pos.customer.create') }}
          </button>
          <div class="mt-1.5 grid grid-cols-[1fr_auto] gap-1.5">
            <input
              v-model="promoCodeInput"
              class="min-h-10 rounded-xl border border-slate-300 px-2 text-sm uppercase"
              :placeholder="t('pos.promo.codePlaceholder')"
              @keyup.enter="applyPromoCode"
            />
            <button
              type="button"
              class="min-h-10 rounded-xl bg-slate-900 px-2.5 text-sm font-semibold text-white"
              :disabled="!cart?.items.length"
              @click="applyPromoCode"
            >
              {{ t('pos.promo.apply') }}
            </button>
          </div>
          <div v-if="cart?.customerId" class="mt-1.5 grid grid-cols-[1fr_auto] gap-1.5">
            <input
              v-model.number="loyaltyRedeemInput"
              class="min-h-10 rounded-xl border border-slate-300 px-2 text-sm tabular-nums"
              type="number"
              min="0"
              step="1"
              :placeholder="t('pos.promo.redeemPlaceholder', { pts: customerPoints })"
            />
            <button
              type="button"
              class="min-h-10 rounded-xl bg-amber-600 px-2.5 text-sm font-semibold text-white"
              @click="applyLoyaltyRedeem"
            >
              {{ t('pos.promo.redeem') }}
            </button>
          </div>
        </template>
      </div>

      <ul class="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain px-2.5 py-1.5 sm:px-3">
        <li v-for="item in cart?.items ?? []" :key="item.id">
          <SwipeRevealRow
            :action-label="t('pos.swipe.remove')"
            :disabled="!shiftOpen"
            @commit="requestRemoveItem(item)"
          >
            <div class="flex items-center justify-between gap-1.5 rounded-xl bg-slate-50 px-2 py-1.5 sm:gap-2 sm:px-2.5 sm:py-2">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-semibold leading-tight">{{ item.productName }}</p>
                <p class="text-xs tabular-nums text-slate-600 sm:text-sm">
                  {{ formatIdrFromCents(item.lineTotalInCents) }}
                </p>
                <div class="mt-1 flex gap-0.5">
                  <button
                    v-for="g in [1, 2, 3, 4]"
                    :key="g"
                    type="button"
                    class="flex h-8 min-w-8 items-center justify-center rounded-lg text-[11px] font-semibold"
                    :class="
                      (item.guestIndex ?? 1) === g
                        ? 'bg-sky-700 text-white'
                        : 'bg-slate-200 text-slate-700'
                    "
                    @click="cartStore.setGuest(item.id, g)"
                  >
                    G{{ g }}
                  </button>
                </div>
              </div>
              <div class="flex shrink-0 items-center gap-1">
                <button
                  class="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-200 text-lg font-semibold"
                  type="button"
                  :aria-label="t('pos.swipe.remove')"
                  @click="requestRemoveItem(item)"
                >
                  −
                </button>
                <span class="w-6 text-center text-base font-semibold tabular-nums">{{
                  item.quantity
                }}</span>
                <button
                  class="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-900 text-lg font-semibold text-white"
                  type="button"
                  @click="cartStore.setQuantity(item.id, item.quantity + 1)"
                >
                  +
                </button>
              </div>
            </div>
          </SwipeRevealRow>
        </li>
        <li
          v-if="!(cart?.items.length)"
          class="rounded-xl border border-dashed border-slate-200 px-3 py-5 text-center text-xs text-slate-500 sm:text-sm"
        >
          {{ t('pos.emptyCart') }}
        </li>
      </ul>

      <!-- Compact checkout dock: totals + pay always visible -->
      <div class="pos-cart-dock space-y-1.5">
        <p
          v-if="cart?.promoCode && !cartMetaOpen"
          class="text-[11px] font-medium text-emerald-800"
        >
          {{ t('pos.promo.applied') }}: {{ cart.promoCode }}
        </p>

        <div class="rounded-xl bg-slate-50 px-2.5 py-1.5 text-xs sm:text-sm">
          <div class="flex justify-between text-slate-600">
            <span>{{ t('pos.subtotal') }}</span>
            <span class="tabular-nums">{{ formatIdrFromCents(cart?.subtotalInCents ?? 0) }}</span>
          </div>
          <div class="flex justify-between text-slate-600">
            <span>{{ t('pos.tax') }}</span>
            <span class="tabular-nums">{{ formatIdrFromCents(cart?.taxInCents ?? 0) }}</span>
          </div>
          <div
            v-if="cart?.discountInCents"
            class="flex justify-between text-emerald-800"
          >
            <span>
              {{ t('pos.discount') }}
              <span v-if="cart.promoCode" class="text-[10px]">({{ cart.promoCode }})</span>
            </span>
            <span class="tabular-nums">-{{ formatIdrFromCents(cart.discountInCents) }}</span>
          </div>
          <div class="mt-1 flex items-baseline justify-between border-t border-slate-200 pt-1 text-base font-bold sm:text-lg">
            <span>{{ t('pos.total') }}</span>
            <span class="tabular-nums">{{ formatIdrFromCents(cart?.totalInCents ?? 0) }}</span>
          </div>
        </div>

        <button
          class="pos-pay-btn"
          type="button"
          :disabled="busy || !shiftOpen || !(cart?.items.length)"
          @click="openCheckout()"
        >
          {{ t('pos.pay') }}
        </button>

        <div v-if="guestPayOptions.length" class="flex flex-wrap gap-1">
          <button
            v-for="g in guestPayOptions"
            :key="g"
            type="button"
            class="min-h-9 rounded-lg bg-sky-100 px-2.5 text-xs font-semibold text-sky-900"
            :disabled="busy || !shiftOpen"
            @click="openCheckout(g)"
          >
            {{ t('pos.payGuest', { n: g }) }}
          </button>
        </div>

        <div class="flex gap-1">
          <button
            type="button"
            class="pos-cart-tool bg-violet-100 text-violet-950"
            :disabled="!cart?.items.length"
            @click="parkCart"
          >
            {{ t('pos.hold.park') }}
          </button>
          <button
            type="button"
            class="pos-cart-tool max-w-[2.75rem] bg-violet-50 text-violet-900"
            @click="showHeld = !showHeld; cartStore.refreshHeld()"
          >
            {{ heldCarts.length }}
          </button>
          <button
            type="button"
            class="pos-cart-tool bg-amber-100 text-amber-950"
            :disabled="!shiftOpen"
            @click="requestDrawer"
          >
            {{ t('pos.openDrawer') }}
          </button>
          <button
            type="button"
            class="pos-cart-tool bg-slate-100 text-slate-800"
            @click="showCartTools = !showCartTools"
          >
            {{ showCartTools ? t('common.close') : t('pos.moreActions') }}
          </button>
        </div>

        <div v-if="showCartTools || showHeld" class="space-y-2 border-t border-slate-100 pt-2">
          <div v-if="showCartTools" class="flex gap-2">
            <input
              v-model="holdLabel"
              class="min-h-11 flex-1 rounded-xl border border-slate-300 px-3 text-sm"
              :placeholder="t('pos.hold.label')"
            />
          </div>
          <div v-if="showCartTools" class="grid grid-cols-3 gap-1.5">
            <button
              class="pos-cart-tool bg-red-100 text-red-900"
              type="button"
              @click="requestVoid"
            >
              {{ t('pos.void') }}
            </button>
            <button
              class="pos-cart-tool bg-orange-100 text-orange-950"
              type="button"
              @click="requestRefund"
            >
              {{ t('pos.refund') }}
            </button>
            <button
              class="pos-cart-tool bg-slate-200 text-slate-800"
              type="button"
              @click="cartStore.clear"
            >
              {{ t('pos.clearCart') }}
            </button>
          </div>
          <ul v-if="showHeld && heldCarts.length" class="max-h-28 space-y-1 overflow-auto text-sm">
            <li v-for="h in heldCarts" :key="h.clientUuid">
              <button
                type="button"
                class="w-full rounded-xl bg-violet-50 px-3 py-2 text-left"
                @click="cartStore.resume(h.clientUuid); showHeld = false"
              >
                {{ h.label || h.clientUuid.slice(0, 8) }}
                · {{ formatIdrFromCents(h.totalInCents) }}
                · {{ h.items.length }} item
              </button>
            </li>
          </ul>
          <p v-if="lastReceiptHex" class="break-all text-[10px] text-slate-400">
            {{ t('pos.escposPreview') }}: {{ lastReceiptHex.slice(0, 48) }}…
          </p>
        </div>
      </div>
      </template>
    </aside>
  </div>
</template>
