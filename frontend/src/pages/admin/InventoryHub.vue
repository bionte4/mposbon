<script setup lang="ts">
import { computed, inject, onMounted, onUnmounted, ref } from 'vue';
import MoneyIdrInput from '../../components/MoneyIdrInput.vue';
import UiPanel from '../../components/UiPanel.vue';
import { useAdminHubTab } from '../../composables/useAdminHubTab';
import { useI18n } from '../../i18n';
import { formatIdrFromCents } from '../../lib/money';
import type { AdminShellApi } from './AdminShell.vue';
import {
  cancelStockTransfer,
  createStockTransfer,
  fetchAdminProducts,
  fetchAdminStores,
  fetchStockTransfers,
  fetchStoreInventory,
  patchStoreInventory,
  receiveStockTransfer,
  shipStockTransfer,
  type AdminProduct,
  type AdminStore,
  type StockTransfer,
  type StoreInventoryItem,
} from '../../services/admin-api.service';
import {
  cancelPurchaseOrder,
  confirmPurchaseOrder,
  createPurchaseOrder,
  createSupplier,
  fetchPurchaseOrders,
  fetchSuppliers,
  receivePurchaseOrder,
  updateSupplier,
  type PurchaseOrder,
  type Supplier,
} from '../../services/purchasing-api.service';
import {
  cancelStockCount,
  completeStockCount,
  createStockCount,
  fetchStockCount,
  fetchStockCounts,
  updateStockCountLine,
  type StockCountSession,
} from '../../services/stock-count-api.service';
import { fetchRecipes, previewCogs, upsertRecipe, type Recipe } from '../../services/recipes-api.service';
import { useAuthStore } from '../../stores/auth.store';
import { useCatalogStore } from '../../stores/catalog.store';
import { useToastStore } from '../../stores/toast.store';

type SubTab = 'inventory' | 'transfer' | 'stockOpname' | 'suppliers' | 'purchasing' | 'recipes';

const { t } = useI18n();
const auth = useAuthStore();
const catalog = useCatalogStore();
const toast = useToastStore();
const shell = inject<AdminShellApi>('adminShell')!;

const canInvWrite = computed(() => auth.has('admin.inventory.write'));
const canInvRead = computed(
  () => auth.has('admin.inventory.read') || auth.has('admin.inventory.write'),
);
const canPurchase = computed(() => auth.has('admin.purchasing.write'));

const visibleTabs = computed(() => {
  const tabs: SubTab[] = [];
  if (canInvRead.value) {
    tabs.push('inventory', 'transfer', 'stockOpname', 'recipes');
  }
  if (canPurchase.value) {
    tabs.push('suppliers', 'purchasing');
  }
  return tabs;
});

const defaultTab = computed(() => visibleTabs.value[0] ?? 'inventory');
const { tab } = useAdminHubTab<SubTab>(
  ['inventory', 'transfer', 'stockOpname', 'suppliers', 'purchasing', 'recipes'] as const,
  'inventory',
);

const stores = ref<AdminStore[]>([]);
const products = ref<AdminProduct[]>([]);
const transfers = ref<StockTransfer[]>([]);
const suppliers = ref<Supplier[]>([]);
const purchaseOrders = ref<PurchaseOrder[]>([]);
const stockCounts = ref<StockCountSession[]>([]);
const recipes = ref<Recipe[]>([]);

const inventoryStoreId = ref('');
const inventoryItems = ref<StoreInventoryItem[]>([]);
const invQty = ref<Record<string, number>>({});
const invPrice = ref<Record<string, number>>({});
const invClearPrice = ref<Record<string, boolean>>({});
const inventoryQuery = ref('');

const transferFrom = ref('');
const transferTo = ref('');
const transferNote = ref('');
const transferLineProductId = ref('');
const transferLineQty = ref(1);
const transferLines = ref<Array<{ productId: string; productName: string; qty: number }>>([]);

const stockOpnameStoreId = ref('');
const activeStockCount = ref<StockCountSession | null>(null);
const countDraft = ref<Record<string, number>>({});

const newSupplier = ref({ code: '', name: '', phone: '', email: '', address: '', notes: '' });
const supplierDraft = ref<
  Record<string, { name: string; phone: string; email: string; address: string; notes: string }>
>({});

const poSupplierId = ref('');
const poStoreId = ref('');
const poNote = ref('');
const poProductId = ref('');
const poQty = ref(1);
const poUnitCost = ref(0);
const poLines = ref<
  Array<{ productId: string; productName: string; qtyOrdered: number; unitCostInCents: number }>
>([]);
const receiveQty = ref<Record<string, number>>({});
const receiveStoreId = ref<Record<string, string>>({});

const recipeProductId = ref('');
const recipeLines = ref<Array<{ ingredientProductId: string; qty: number; unitCostInCents: number }>>([
  { ingredientProductId: '', qty: 1, unitCostInCents: 0 },
]);
const recipeCogsPreview = ref<number | null>(null);

const filteredInventory = computed(() => {
  const q = inventoryQuery.value.trim().toLowerCase();
  if (!q) return inventoryItems.value;
  return inventoryItems.value.filter(
    (i) =>
      i.name.toLowerCase().includes(q) ||
      i.sku.toLowerCase().includes(q) ||
      (i.barcode ?? '').toLowerCase().includes(q),
  );
});

onMounted(() => {
  void refresh();
  window.addEventListener('admin:reload', onReload);
});
onUnmounted(() => window.removeEventListener('admin:reload', onReload));
function onReload(): void {
  void refresh();
}

async function refresh(): Promise<void> {
  if (!canInvRead.value && !canPurchase.value) {
    shell.setError(t('admin.denied'));
    return;
  }
  shell.setBusy(true);
  shell.setError(null);
  try {
    const [storeRows, prods] = await Promise.all([fetchAdminStores(), fetchAdminProducts()]);
    stores.value = storeRows;
    products.value = prods;

    if (canInvRead.value) {
      const [xfers, recipeRows] = await Promise.all([
        fetchStockTransfers().catch(() => [] as StockTransfer[]),
        fetchRecipes().catch(() => [] as Recipe[]),
      ]);
      transfers.value = xfers;
      recipes.value = recipeRows;
      if (!transferFrom.value && storeRows[0]) transferFrom.value = storeRows[0].id;
      if (!transferTo.value && storeRows[1]) transferTo.value = storeRows[1].id;
      if (!transferLineProductId.value && prods[0]) transferLineProductId.value = prods[0].id;
      if (!inventoryStoreId.value && storeRows[0]) inventoryStoreId.value = storeRows[0].id;
      if (!stockOpnameStoreId.value && storeRows[0]) stockOpnameStoreId.value = storeRows[0].id;
      if (inventoryStoreId.value) await loadInventory(inventoryStoreId.value);
      if (stockOpnameStoreId.value) {
        stockCounts.value = await fetchStockCounts(stockOpnameStoreId.value).catch(() => []);
      }
      if (!recipeProductId.value && prods.find((p) => p.productType !== 'INGREDIENT')) {
        recipeProductId.value = prods.find((p) => p.productType !== 'INGREDIENT')!.id;
      }
    }

    if (canPurchase.value) {
      const [supplierRows, orders] = await Promise.all([
        fetchSuppliers().catch(() => [] as Supplier[]),
        fetchPurchaseOrders().catch(() => [] as PurchaseOrder[]),
      ]);
      suppliers.value = supplierRows;
      purchaseOrders.value = orders;
      for (const s of supplierRows) {
        supplierDraft.value[s.id] = {
          name: s.name,
          phone: s.phone ?? '',
          email: s.email ?? '',
          address: s.address ?? '',
          notes: s.notes ?? '',
        };
      }
      if (!poSupplierId.value && supplierRows.find((s) => s.isActive)) {
        poSupplierId.value = supplierRows.find((s) => s.isActive)!.id;
      }
      if (!poStoreId.value && storeRows[0]) poStoreId.value = storeRows[0].id;
      if (!poProductId.value && prods[0]) poProductId.value = prods[0].id;
      for (const o of orders) {
        if (!receiveStoreId.value[o.id]) receiveStoreId.value[o.id] = o.store.id;
        for (const line of o.lines) {
          const rem = line.qtyOrdered - line.qtyReceived;
          if (receiveQty.value[line.id] === undefined) {
            receiveQty.value[line.id] = rem > 0 ? rem : 0;
          }
        }
      }
    }

    if (visibleTabs.value.length && !visibleTabs.value.includes(tab.value)) {
      tab.value = defaultTab.value;
    }
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function loadInventory(storeId: string): Promise<void> {
  if (!storeId) {
    inventoryItems.value = [];
    return;
  }
  const data = await fetchStoreInventory(storeId);
  inventoryItems.value = data.items;
  const qty: Record<string, number> = {};
  const price: Record<string, number> = {};
  const clear: Record<string, boolean> = {};
  for (const item of data.items) {
    qty[item.productId] = item.onHandQty;
    price[item.productId] = item.storeUnitPriceInCents ?? item.catalogUnitPriceInCents;
    clear[item.productId] = false;
  }
  invQty.value = qty;
  invPrice.value = price;
  invClearPrice.value = clear;
}

async function onInventoryStoreChange(): Promise<void> {
  shell.setBusy(true);
  shell.setError(null);
  try {
    await loadInventory(inventoryStoreId.value);
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function saveInventoryRow(item: StoreInventoryItem): Promise<void> {
  if (!canInvWrite.value || !inventoryStoreId.value) return;
  const qty = invQty.value[item.productId];
  if (!Number.isInteger(qty) || qty < 0) {
    shell.setError(t('admin.inventory.qtyInvalid'));
    return;
  }
  const clearPrice = invClearPrice.value[item.productId];
  const price = invPrice.value[item.productId];
  if (!clearPrice && (!Number.isInteger(price) || price < 0)) {
    shell.setError(t('admin.inventory.priceInvalid'));
    return;
  }
  const body: { qty?: number; unitPriceInCents?: number | null; note?: string } = {};
  if (qty !== item.onHandQty) body.qty = qty;
  if (clearPrice) {
    if (item.storeUnitPriceInCents != null) body.unitPriceInCents = null;
  } else if (
    item.storeUnitPriceInCents == null
      ? price !== item.catalogUnitPriceInCents
      : price !== item.storeUnitPriceInCents
  ) {
    body.unitPriceInCents = price;
  }
  if (body.qty === undefined && body.unitPriceInCents === undefined) {
    toast.success(t('admin.inventory.noChange'));
    return;
  }
  shell.setBusy(true);
  shell.setError(null);
  try {
    await patchStoreInventory(inventoryStoreId.value, item.productId, {
      ...body,
      note: 'admin.inventory.ui',
    });
    toast.success(t('admin.inventory.saved'));
    await loadInventory(inventoryStoreId.value);
    void catalog.refreshFromApi().then(() => catalog.broadcastInvalidate());
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

function addTransferLine(): void {
  if (!transferLineProductId.value) return;
  if (!Number.isInteger(transferLineQty.value) || transferLineQty.value < 1) return;
  const product = products.value.find((p) => p.id === transferLineProductId.value);
  if (!product) return;
  transferLines.value = [
    ...transferLines.value,
    { productId: product.id, productName: product.name, qty: transferLineQty.value },
  ];
  transferLineQty.value = 1;
}

function removeTransferLine(index: number): void {
  transferLines.value = transferLines.value.filter((_, i) => i !== index);
}

async function runTransfer(): Promise<void> {
  if (!canInvWrite.value) return;
  if (!transferFrom.value || !transferTo.value || !transferLines.value.length) return;
  shell.setBusy(true);
  try {
    await createStockTransfer({
      fromStoreId: transferFrom.value,
      toStoreId: transferTo.value,
      note: transferNote.value.trim() || undefined,
      mode: 'in_transit',
      lines: transferLines.value.map((l) => ({ productId: l.productId, qty: l.qty })),
    });
    toast.success(t('admin.transfer.shipped'));
    transferNote.value = '';
    transferLines.value = [];
    await refresh();
    await catalog.refreshFromApi();
    catalog.broadcastInvalidate();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function receiveTransferRow(id: string): Promise<void> {
  if (!canInvWrite.value) return;
  shell.setBusy(true);
  try {
    await receiveStockTransfer(id);
    toast.success(t('admin.transfer.received'));
    await refresh();
    await catalog.refreshFromApi();
    catalog.broadcastInvalidate();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function shipTransferRow(id: string): Promise<void> {
  if (!canInvWrite.value) return;
  shell.setBusy(true);
  try {
    await shipStockTransfer(id);
    toast.success(t('admin.transfer.shipped'));
    await refresh();
    await catalog.refreshFromApi();
    catalog.broadcastInvalidate();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function cancelTransferRow(id: string): Promise<void> {
  if (!canInvWrite.value) return;
  shell.setBusy(true);
  try {
    await cancelStockTransfer(id);
    toast.success(t('admin.transfer.cancelled'));
    await refresh();
    await catalog.refreshFromApi();
    catalog.broadcastInvalidate();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function loadStockCountsAdmin(storeId: string): Promise<void> {
  stockCounts.value = await fetchStockCounts(storeId);
}

async function startStockOpname(): Promise<void> {
  if (!canInvWrite.value || !stockOpnameStoreId.value) return;
  shell.setBusy(true);
  try {
    const session = await createStockCount({ storeId: stockOpnameStoreId.value });
    toast.success(t('admin.stockOpname.created', { code: session.code }));
    activeStockCount.value = session;
    for (const line of session.lines ?? []) {
      countDraft.value[line.id] = line.countedQty ?? line.systemQty;
    }
    await loadStockCountsAdmin(stockOpnameStoreId.value);
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function openStockOpname(id: string): Promise<void> {
  shell.setBusy(true);
  try {
    const session = await fetchStockCount(id);
    activeStockCount.value = session;
    countDraft.value = {};
    for (const line of session.lines ?? []) {
      countDraft.value[line.id] = line.countedQty ?? line.systemQty;
    }
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function saveStockOpnameLine(lineId: string): Promise<void> {
  if (!canInvWrite.value || !activeStockCount.value) return;
  const countedQty = countDraft.value[lineId];
  if (!Number.isInteger(countedQty) || countedQty < 0) {
    toast.warning(t('admin.stockOpname.qtyInvalid'));
    return;
  }
  shell.setBusy(true);
  try {
    activeStockCount.value = await updateStockCountLine(activeStockCount.value.id, {
      lineId,
      countedQty,
    });
    toast.success(t('admin.saved'));
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function finishStockOpname(): Promise<void> {
  if (!canInvWrite.value || !activeStockCount.value) return;
  shell.setBusy(true);
  try {
    for (const line of activeStockCount.value.lines ?? []) {
      const countedQty = countDraft.value[line.id];
      if (line.countedQty !== countedQty) {
        await updateStockCountLine(activeStockCount.value.id, { lineId: line.id, countedQty });
      }
    }
    activeStockCount.value = await completeStockCount(activeStockCount.value.id);
    toast.success(t('admin.stockOpname.completed'));
    await loadStockCountsAdmin(stockOpnameStoreId.value);
    if (inventoryStoreId.value) await loadInventory(inventoryStoreId.value);
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function cancelStockOpnameSession(): Promise<void> {
  if (!canInvWrite.value || !activeStockCount.value) return;
  shell.setBusy(true);
  try {
    await cancelStockCount(activeStockCount.value.id);
    toast.success(t('admin.stockOpname.cancelled'));
    activeStockCount.value = null;
    await loadStockCountsAdmin(stockOpnameStoreId.value);
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function addSupplier(): Promise<void> {
  if (!canPurchase.value) return;
  if (!newSupplier.value.code.trim() || !newSupplier.value.name.trim()) return;
  shell.setBusy(true);
  shell.setError(null);
  try {
    await createSupplier({
      code: newSupplier.value.code.trim(),
      name: newSupplier.value.name.trim(),
      phone: newSupplier.value.phone.trim() || undefined,
      email: newSupplier.value.email.trim() || undefined,
      address: newSupplier.value.address.trim() || undefined,
      notes: newSupplier.value.notes.trim() || undefined,
    });
    toast.success(t('admin.suppliers.created'));
    newSupplier.value = { code: '', name: '', phone: '', email: '', address: '', notes: '' };
    await refresh();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function saveSupplier(row: Supplier): Promise<void> {
  if (!canPurchase.value) return;
  const d = supplierDraft.value[row.id];
  if (!d || !d.name.trim()) return;
  shell.setBusy(true);
  try {
    await updateSupplier(row.id, {
      name: d.name.trim(),
      phone: d.phone.trim() || null,
      email: d.email.trim() || null,
      address: d.address.trim() || null,
      notes: d.notes.trim() || null,
    });
    toast.success(t('admin.suppliers.saved'));
    await refresh();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function toggleSupplierActive(row: Supplier): Promise<void> {
  if (!canPurchase.value) return;
  shell.setBusy(true);
  try {
    await updateSupplier(row.id, { isActive: !row.isActive });
    toast.success(t('admin.suppliers.saved'));
    await refresh();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

function addPoLine(): void {
  if (!poProductId.value) return;
  if (!Number.isInteger(poQty.value) || poQty.value < 1) {
    shell.setError(t('admin.purchasing.invalidLine'));
    return;
  }
  if (!Number.isInteger(poUnitCost.value) || poUnitCost.value < 0) {
    shell.setError(t('admin.purchasing.invalidLine'));
    return;
  }
  const product = products.value.find((p) => p.id === poProductId.value);
  if (!product) return;
  poLines.value = [
    ...poLines.value,
    {
      productId: product.id,
      productName: product.name,
      qtyOrdered: poQty.value,
      unitCostInCents: poUnitCost.value,
    },
  ];
  poQty.value = 1;
  poUnitCost.value = 0;
}

function removePoLine(index: number): void {
  poLines.value = poLines.value.filter((_, i) => i !== index);
}

async function submitPurchaseOrder(confirm: boolean): Promise<void> {
  if (!canPurchase.value) return;
  if (!poSupplierId.value || !poStoreId.value || !poLines.value.length) return;
  shell.setBusy(true);
  shell.setError(null);
  try {
    await createPurchaseOrder({
      supplierId: poSupplierId.value,
      storeId: poStoreId.value,
      note: poNote.value.trim() || undefined,
      confirm,
      lines: poLines.value.map((l) => ({
        productId: l.productId,
        qtyOrdered: l.qtyOrdered,
        unitCostInCents: l.unitCostInCents,
      })),
    });
    toast.success(t('admin.purchasing.created'));
    poLines.value = [];
    poNote.value = '';
    await refresh();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function confirmPo(id: string): Promise<void> {
  if (!canPurchase.value) return;
  shell.setBusy(true);
  try {
    await confirmPurchaseOrder(id);
    toast.success(t('admin.purchasing.confirmed'));
    await refresh();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function cancelPo(id: string): Promise<void> {
  if (!canPurchase.value) return;
  shell.setBusy(true);
  try {
    await cancelPurchaseOrder(id);
    toast.success(t('admin.purchasing.cancelled'));
    await refresh();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function receivePo(order: PurchaseOrder): Promise<void> {
  if (!canPurchase.value) return;
  const lines = order.lines
    .map((line) => ({
      purchaseOrderLineId: line.id,
      qty: receiveQty.value[line.id] ?? 0,
    }))
    .filter((l) => Number.isInteger(l.qty) && l.qty > 0);
  if (!lines.length) return;
  shell.setBusy(true);
  try {
    await receivePurchaseOrder(order.id, {
      storeId: receiveStoreId.value[order.id] || order.store.id,
      lines,
    });
    toast.success(t('admin.purchasing.receiveOk'));
    await refresh();
    void catalog.refreshFromApi().then(() => catalog.broadcastInvalidate());
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

async function loadRecipeEditor(): Promise<void> {
  if (!recipeProductId.value) return;
  try {
    const row = await fetchRecipes().then((rows) =>
      rows.find((r) => r.productId === recipeProductId.value),
    );
    if (row?.lines.length) {
      recipeLines.value = row.lines.map((l) => ({
        ingredientProductId: l.ingredient.id,
        qty: l.qty,
        unitCostInCents: l.unitCostInCents,
      }));
    } else {
      recipeLines.value = [{ ingredientProductId: '', qty: 1, unitCostInCents: 0 }];
    }
    const preview = await previewCogs(recipeProductId.value, 1);
    recipeCogsPreview.value = preview.cogsInCents;
  } catch {
    recipeCogsPreview.value = null;
  }
}

async function saveRecipe(): Promise<void> {
  if (!canInvWrite.value || !recipeProductId.value) return;
  const lines = recipeLines.value.filter((l) => l.ingredientProductId && l.qty > 0);
  if (!lines.length) return;
  shell.setBusy(true);
  try {
    await upsertRecipe({ productId: recipeProductId.value, lines });
    toast.success(t('admin.recipes.saved'));
    recipes.value = await fetchRecipes();
    await loadRecipeEditor();
  } catch (err) {
    shell.setError(err instanceof Error ? err.message : t('admin.loadFailed'));
  } finally {
    shell.setBusy(false);
  }
}

const busy = computed(() => shell.busy.value);
</script>

<template>
  <div>
    <p v-if="!visibleTabs.length" class="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
      {{ t('admin.denied') }}
    </p>
    <template v-else>
      <div class="mb-3 flex gap-1.5 overflow-x-auto pb-0.5">
        <button
          v-for="key in visibleTabs"
          :key="key"
          type="button"
          class="admin-sub-tab shrink-0"
          :class="tab === key ? 'bg-teal-800 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'"
          @click="tab = key"
        >
          {{ t(`admin.tabs.${key}`) }}
        </button>
      </div>

      <UiPanel v-if="tab === 'inventory'" dense :title="t('admin.tabs.inventory')" :padded="false">
        <div class="space-y-2 p-3">
          <p class="text-sm text-slate-600">{{ t('admin.inventory.hint') }}</p>
          <div class="grid gap-2 sm:grid-cols-2">
            <label class="text-sm font-medium text-slate-600">
              {{ t('admin.inventory.store') }}
              <select v-model="inventoryStoreId" class="mt-1 min-h-10 w-full rounded-xl border px-3" @change="onInventoryStoreChange">
                <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.code }} · {{ s.name }}</option>
              </select>
            </label>
            <label class="text-sm font-medium text-slate-600">
              {{ t('admin.inventory.search') }}
              <input v-model="inventoryQuery" class="mt-1 min-h-10 w-full rounded-xl border px-3" type="search" :placeholder="t('admin.inventory.searchPlaceholder')" />
            </label>
          </div>
          <div class="overflow-x-auto rounded-xl border border-slate-200">
            <table class="min-w-full text-left text-sm">
              <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th class="px-2.5 py-1.5 font-medium">{{ t('admin.name') }}</th>
                  <th class="px-2.5 py-1.5 font-medium">{{ t('admin.sku') }}</th>
                  <th class="px-2.5 py-1.5 font-medium">{{ t('admin.inventory.onHand') }}</th>
                  <th class="px-2.5 py-1.5 font-medium">{{ t('admin.inventory.storePrice') }}</th>
                  <th class="px-2.5 py-1.5 font-medium">{{ t('admin.inventory.catalogPrice') }}</th>
                  <th v-if="canInvWrite" class="px-2.5 py-1.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="item in filteredInventory" :key="item.productId" class="border-b border-slate-100 last:border-0" :class="item.isActive ? '' : 'opacity-50'">
                  <td class="px-2.5 py-1.5 font-medium">
                    {{ item.name }}
                    <span v-if="item.storeUnitPriceInCents != null" class="ml-1 rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-800">
                      {{ t('admin.inventory.override') }}
                    </span>
                  </td>
                  <td class="px-2.5 py-1.5 tabular-nums text-slate-600">{{ item.sku }}</td>
                  <td class="px-2.5 py-1.5">
                    <input v-if="canInvWrite" v-model.number="invQty[item.productId]" class="min-h-10 w-24 rounded-lg border px-2 tabular-nums" type="number" min="0" step="1" />
                    <span v-else class="tabular-nums">{{ item.onHandQty }}</span>
                  </td>
                  <td class="px-2.5 py-1.5">
                    <div v-if="canInvWrite" class="flex flex-col gap-1">
                      <MoneyIdrInput v-model="invPrice[item.productId]!" :disabled="invClearPrice[item.productId]" />
                      <label v-if="item.storeUnitPriceInCents != null" class="inline-flex items-center gap-1 text-xs text-slate-500">
                        <input v-model="invClearPrice[item.productId]" type="checkbox" class="h-3.5 w-3.5" />
                        {{ t('admin.inventory.clearOverride') }}
                      </label>
                    </div>
                    <span v-else class="tabular-nums">{{ formatIdrFromCents(item.effectiveUnitPriceInCents) }}</span>
                  </td>
                  <td class="px-2.5 py-1.5 tabular-nums text-slate-500">{{ formatIdrFromCents(item.catalogUnitPriceInCents) }}</td>
                  <td v-if="canInvWrite" class="px-2.5 py-1.5">
                    <button type="button" class="min-h-8 rounded-lg bg-slate-900 px-2.5 text-xs font-semibold text-white disabled:opacity-40" :disabled="busy" @click="saveInventoryRow(item)">
                      {{ t('admin.save') }}
                    </button>
                  </td>
                </tr>
                <tr v-if="!filteredInventory.length">
                  <td class="px-3 py-4 text-slate-500" :colspan="canInvWrite ? 6 : 5">{{ t('admin.inventory.empty') }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </UiPanel>

      <UiPanel v-else-if="tab === 'transfer'" dense :title="t('admin.tabs.transfer')">
        <div v-if="canInvWrite" class="mb-2 grid gap-2 sm:grid-cols-2">
          <label class="text-sm">
            {{ t('admin.transfer.from') }}
            <select v-model="transferFrom" class="mt-1 min-h-10 w-full rounded-xl border px-3">
              <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.code }} · {{ s.name }}</option>
            </select>
          </label>
          <label class="text-sm">
            {{ t('admin.transfer.to') }}
            <select v-model="transferTo" class="mt-1 min-h-10 w-full rounded-xl border px-3">
              <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.code }} · {{ s.name }}</option>
            </select>
          </label>
          <label class="text-sm sm:col-span-2">
            {{ t('admin.transfer.note') }}
            <input v-model="transferNote" class="mt-1 min-h-10 w-full rounded-xl border px-3" type="text" />
          </label>
          <label class="text-sm sm:col-span-2">
            {{ t('admin.transfer.product') }}
            <select v-model="transferLineProductId" class="mt-1 min-h-10 w-full rounded-xl border px-3">
              <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }} ({{ p.sku }})</option>
            </select>
          </label>
          <label class="text-sm">
            {{ t('admin.transfer.qty') }}
            <input v-model.number="transferLineQty" class="mt-1 min-h-10 w-full rounded-xl border px-3 tabular-nums" type="number" min="1" step="1" />
          </label>
          <button type="button" class="min-h-9 self-end rounded-lg bg-white text-sm font-semibold ring-1 ring-slate-300" @click="addTransferLine">
            {{ t('admin.transfer.addLine') }}
          </button>
          <ul v-if="transferLines.length" class="sm:col-span-2 space-y-1 text-sm">
            <li v-for="(line, idx) in transferLines" :key="`${line.productId}-${idx}`" class="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2">
              <span>{{ line.productName }} × {{ line.qty }}</span>
              <button type="button" class="text-red-600" @click="removeTransferLine(idx)">×</button>
            </li>
          </ul>
          <button type="button" class="min-h-10 rounded-xl bg-slate-900 text-sm font-semibold text-white sm:col-span-2" :disabled="busy || !transferLines.length" @click="runTransfer">
            {{ t('admin.transfer.submit') }}
          </button>
        </div>
        <ul class="divide-y divide-slate-100 overflow-hidden rounded-xl text-sm ring-1 ring-slate-200">
          <li v-for="x in transfers" :key="x.id" class="bg-white px-3 py-2">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <span
                  class="mr-2 rounded-full px-2 py-0.5 text-xs font-semibold"
                  :class="{
                    'bg-amber-100 text-amber-900': x.status === 'IN_TRANSIT',
                    'bg-emerald-100 text-emerald-900': x.status === 'COMPLETED',
                    'bg-slate-200 text-slate-700': x.status === 'DRAFT',
                    'bg-red-100 text-red-800': x.status === 'CANCELLED',
                  }"
                >{{ x.status }}</span>
                <strong>{{ x.fromStore.code }} → {{ x.toStore.code }}</strong>
                · {{ x.lines.map((l) => `${l.product.name}×${l.qty}`).join(', ') }}
              </div>
              <div v-if="canInvWrite" class="flex gap-2">
                <button v-if="x.status === 'DRAFT'" type="button" class="rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-bold text-white" :disabled="busy" @click="shipTransferRow(x.id)">
                  {{ t('admin.transfer.ship') }}
                </button>
                <button v-if="x.status === 'IN_TRANSIT'" type="button" class="rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-bold text-white" :disabled="busy" @click="receiveTransferRow(x.id)">
                  {{ t('admin.transfer.receive') }}
                </button>
                <button v-if="x.status === 'DRAFT' || x.status === 'IN_TRANSIT'" type="button" class="rounded-lg bg-slate-200 px-3 py-1.5 text-xs font-semibold" :disabled="busy" @click="cancelTransferRow(x.id)">
                  {{ t('admin.transfer.cancel') }}
                </button>
              </div>
            </div>
          </li>
          <li v-if="!transfers.length" class="text-slate-500">{{ t('admin.transfer.empty') }}</li>
        </ul>
      </UiPanel>

      <UiPanel v-else-if="tab === 'stockOpname'" dense :title="t('admin.tabs.stockOpname')">
        <p class="mb-2 text-sm text-slate-600">{{ t('admin.stockOpname.hint') }}</p>
        <div class="mb-2 flex flex-wrap items-end gap-2">
          <label class="text-sm font-medium text-slate-600">
            {{ t('admin.inventory.store') }}
            <select
              v-model="stockOpnameStoreId"
              class="mt-1 min-h-10 rounded-xl border px-3"
              @change="activeStockCount = null; loadStockCountsAdmin(stockOpnameStoreId)"
            >
              <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.code }} — {{ s.name }}</option>
            </select>
          </label>
          <button v-if="canInvWrite" type="button" class="min-h-10 rounded-xl bg-emerald-600 px-4 font-semibold text-white" :disabled="busy" @click="startStockOpname">
            {{ t('admin.stockOpname.start') }}
          </button>
          <button v-if="activeStockCount" type="button" class="min-h-10 rounded-xl bg-slate-200 px-4 font-semibold" @click="activeStockCount = null">
            {{ t('admin.stockOpname.backToList') }}
          </button>
        </div>
        <div v-if="activeStockCount" class="space-y-2">
          <p class="text-sm font-semibold text-slate-800">{{ activeStockCount.code }} · {{ activeStockCount.status }}</p>
          <div class="max-h-[28rem] overflow-auto rounded-xl border border-slate-200">
            <table class="min-w-full text-left text-sm">
              <thead class="sticky top-0 border-b bg-slate-50 text-slate-600">
                <tr>
                  <th class="px-3 py-2">{{ t('admin.sku') }}</th>
                  <th class="px-3 py-2">{{ t('admin.name') }}</th>
                  <th class="px-3 py-2">{{ t('admin.stockOpname.system') }}</th>
                  <th class="px-3 py-2">{{ t('admin.stockOpname.counted') }}</th>
                  <th class="px-3 py-2">{{ t('admin.stockOpname.variance') }}</th>
                  <th v-if="canInvWrite && activeStockCount.status === 'DRAFT'" class="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="line in activeStockCount.lines" :key="line.id" class="border-b border-slate-100">
                  <td class="px-3 py-2">{{ line.productSku }}</td>
                  <td class="px-3 py-2">{{ line.productName }}</td>
                  <td class="px-3 py-2 tabular-nums">{{ line.systemQty }}</td>
                  <td class="px-3 py-2">
                    <input v-if="activeStockCount.status === 'DRAFT'" v-model.number="countDraft[line.id]" class="w-20 rounded-lg border px-2 py-1 tabular-nums" type="number" min="0" step="1" />
                    <span v-else class="tabular-nums">{{ line.countedQty }}</span>
                  </td>
                  <td class="px-3 py-2 tabular-nums">
                    {{ activeStockCount.status === 'COMPLETED' ? line.varianceQty : (countDraft[line.id] ?? 0) - line.systemQty }}
                  </td>
                  <td v-if="canInvWrite && activeStockCount.status === 'DRAFT'" class="px-3 py-2">
                    <button type="button" class="text-xs font-semibold text-sky-700 underline" @click="saveStockOpnameLine(line.id)">{{ t('admin.save') }}</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div v-if="canInvWrite && activeStockCount.status === 'DRAFT'" class="flex gap-2">
            <button type="button" class="min-h-10 rounded-xl bg-emerald-600 px-4 font-semibold text-white" :disabled="busy" @click="finishStockOpname">{{ t('admin.stockOpname.complete') }}</button>
            <button type="button" class="min-h-10 rounded-xl bg-red-100 px-4 font-semibold text-red-900" :disabled="busy" @click="cancelStockOpnameSession">{{ t('admin.stockOpname.cancel') }}</button>
          </div>
        </div>
        <ul v-else class="divide-y divide-slate-100 overflow-hidden rounded-xl ring-1 ring-slate-200">
          <li v-for="sc in stockCounts" :key="sc.id" class="flex flex-wrap items-center justify-between gap-2 bg-white px-3 py-2">
            <div>
              <strong>{{ sc.code }}</strong> · {{ sc.store.code }} · {{ sc.status }} · {{ sc._count?.lines ?? sc.lines?.length ?? 0 }} SKU
            </div>
            <button type="button" class="text-sm font-semibold text-sky-800 underline" @click="openStockOpname(sc.id)">{{ t('admin.stockOpname.open') }}</button>
          </li>
          <li v-if="!stockCounts.length" class="text-slate-500">{{ t('admin.stockOpname.empty') }}</li>
        </ul>
      </UiPanel>

      <UiPanel v-else-if="tab === 'suppliers'" dense :title="t('admin.tabs.suppliers')">
        <p class="mb-2 text-sm text-slate-600">{{ t('admin.suppliers.hint') }}</p>
        <div v-if="canPurchase" class="mb-2 grid gap-2 rounded-xl bg-slate-50 p-2.5 sm:grid-cols-2 lg:grid-cols-3">
          <input v-model="newSupplier.code" class="min-h-10 rounded-xl border px-3" :placeholder="t('admin.suppliers.code')" />
          <input v-model="newSupplier.name" class="min-h-10 rounded-xl border px-3" :placeholder="t('admin.suppliers.name')" />
          <input v-model="newSupplier.phone" class="min-h-10 rounded-xl border px-3" :placeholder="t('admin.suppliers.phone')" />
          <input v-model="newSupplier.email" class="min-h-10 rounded-xl border px-3" :placeholder="t('admin.suppliers.email')" />
          <input v-model="newSupplier.address" class="min-h-10 rounded-xl border px-3 sm:col-span-2" :placeholder="t('admin.suppliers.address')" />
          <button class="min-h-10 rounded-xl bg-emerald-600 font-semibold text-white" type="button" :disabled="busy" @click="addSupplier">{{ t('admin.suppliers.add') }}</button>
        </div>
        <ul class="divide-y divide-slate-100 overflow-hidden rounded-xl ring-1 ring-slate-200">
          <li v-for="s in suppliers" :key="s.id" class="bg-white px-3 py-2">
            <div class="flex flex-wrap items-center justify-between gap-2">
              <div>
                <strong>{{ s.code }}</strong> · {{ s.name }}
                <span class="text-slate-500">· {{ s.isActive ? t('admin.active') : t('admin.inactive') }}</span>
              </div>
              <button v-if="canPurchase" type="button" class="min-h-10 rounded-xl bg-white px-3 text-sm font-semibold ring-1 ring-slate-200" :disabled="busy" @click="toggleSupplierActive(s)">
                {{ s.isActive ? t('admin.suppliers.deactivate') : t('admin.suppliers.activate') }}
              </button>
            </div>
            <div v-if="canPurchase && supplierDraft[s.id]" class="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <input v-model="supplierDraft[s.id]!.name" class="min-h-10 rounded-lg border px-2" :placeholder="t('admin.suppliers.name')" />
              <input v-model="supplierDraft[s.id]!.phone" class="min-h-10 rounded-lg border px-2" :placeholder="t('admin.suppliers.phone')" />
              <input v-model="supplierDraft[s.id]!.email" class="min-h-10 rounded-lg border px-2" :placeholder="t('admin.suppliers.email')" />
              <input v-model="supplierDraft[s.id]!.address" class="min-h-10 rounded-lg border px-2" :placeholder="t('admin.suppliers.address')" />
              <button type="button" class="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white sm:col-span-2 lg:col-span-4" :disabled="busy" @click="saveSupplier(s)">{{ t('admin.save') }}</button>
            </div>
          </li>
          <li v-if="!suppliers.length" class="text-slate-500">{{ t('admin.suppliers.empty') }}</li>
        </ul>
      </UiPanel>

      <UiPanel v-else-if="tab === 'purchasing'" dense :title="t('admin.tabs.purchasing')">
        <p class="mb-2 text-sm text-slate-600">{{ t('admin.purchasing.hint') }}</p>
        <div v-if="canPurchase" class="mb-3 space-y-2 rounded-xl bg-slate-50 p-2.5">
          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label class="text-sm font-medium text-slate-700">
              {{ t('admin.purchasing.supplier') }}
              <select v-model="poSupplierId" class="mt-1 min-h-10 w-full rounded-xl border px-3">
                <option v-for="s in suppliers.filter((x) => x.isActive)" :key="s.id" :value="s.id">{{ s.code }} — {{ s.name }}</option>
              </select>
            </label>
            <label class="text-sm font-medium text-slate-700">
              {{ t('admin.purchasing.store') }}
              <select v-model="poStoreId" class="mt-1 min-h-10 w-full rounded-xl border px-3">
                <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.code }} — {{ s.name }}</option>
              </select>
            </label>
            <label class="text-sm font-medium text-slate-700 sm:col-span-2">
              {{ t('admin.purchasing.note') }}
              <input v-model="poNote" class="mt-1 min-h-10 w-full rounded-xl border px-3" type="text" />
            </label>
          </div>
          <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
            <label class="text-sm font-medium text-slate-700 lg:col-span-2">
              {{ t('admin.purchasing.product') }}
              <select v-model="poProductId" class="mt-1 min-h-10 w-full rounded-xl border px-3">
                <option v-for="p in products" :key="p.id" :value="p.id">{{ p.sku }} — {{ p.name }}</option>
              </select>
            </label>
            <label class="text-sm font-medium text-slate-700">
              {{ t('admin.purchasing.qty') }}
              <input v-model.number="poQty" class="mt-1 min-h-10 w-full rounded-xl border px-3" type="number" step="1" min="1" />
            </label>
            <label class="text-sm font-medium text-slate-700">
              {{ t('admin.purchasing.unitCost') }}
              <MoneyIdrInput v-model="poUnitCost" />
            </label>
            <button type="button" class="min-h-10 self-end rounded-xl bg-slate-900 font-semibold text-white" @click="addPoLine">{{ t('admin.purchasing.addLine') }}</button>
          </div>
          <ul v-if="poLines.length" class="space-y-1 text-sm">
            <li v-for="(line, idx) in poLines" :key="`${line.productId}-${idx}`" class="flex items-center justify-between rounded-lg bg-white px-3 py-2">
              <span>{{ line.productName }} × {{ line.qtyOrdered }} @ {{ formatIdrFromCents(line.unitCostInCents) }}</span>
              <button type="button" class="text-red-600" @click="removePoLine(idx)">×</button>
            </li>
          </ul>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="min-h-10 rounded-xl bg-white px-4 font-semibold ring-1 ring-slate-300" :disabled="busy || !poLines.length" @click="submitPurchaseOrder(false)">{{ t('admin.purchasing.createDraft') }}</button>
            <button type="button" class="min-h-10 rounded-xl bg-emerald-600 px-4 font-semibold text-white" :disabled="busy || !poLines.length" @click="submitPurchaseOrder(true)">{{ t('admin.purchasing.createOrdered') }}</button>
          </div>
        </div>
        <ul class="divide-y divide-slate-100 overflow-hidden rounded-xl ring-1 ring-slate-200">
          <li v-for="o in purchaseOrders" :key="o.id" class="bg-white px-3 py-2">
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <strong>{{ o.code }}</strong> · {{ t(`admin.purchasing.status.${o.status}`) }} · {{ o.supplier.code }} → {{ o.store.code }}
                <p class="text-sm text-slate-600">{{ t('admin.purchasing.subtotal') }}: {{ formatIdrFromCents(o.subtotalInCents) }}</p>
              </div>
              <div v-if="canPurchase" class="flex flex-wrap gap-2">
                <button v-if="o.status === 'DRAFT'" type="button" class="min-h-10 rounded-xl bg-slate-900 px-3 text-sm font-semibold text-white" :disabled="busy" @click="confirmPo(o.id)">{{ t('admin.purchasing.confirm') }}</button>
                <button v-if="o.status === 'DRAFT' || o.status === 'ORDERED'" type="button" class="min-h-10 rounded-xl bg-white px-3 text-sm font-semibold text-red-700 ring-1 ring-red-200" :disabled="busy" @click="cancelPo(o.id)">{{ t('admin.purchasing.cancel') }}</button>
              </div>
            </div>
            <ul class="mt-2 space-y-1 text-sm">
              <li v-for="line in o.lines" :key="line.id" class="grid gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 sm:grid-cols-[1fr_auto]">
                <span>
                  {{ line.product.name }} · {{ line.qtyReceived }}/{{ line.qtyOrdered }} · {{ formatIdrFromCents(line.unitCostInCents) }}
                  <span class="text-slate-500">({{ t('admin.purchasing.remaining') }} {{ line.qtyOrdered - line.qtyReceived }})</span>
                </span>
                <input
                  v-if="canPurchase && (o.status === 'ORDERED' || o.status === 'PARTIAL')"
                  v-model.number="receiveQty[line.id]"
                  class="min-h-10 w-24 rounded-lg border px-2"
                  type="number"
                  step="1"
                  min="0"
                />
              </li>
            </ul>
            <div v-if="canPurchase && (o.status === 'ORDERED' || o.status === 'PARTIAL')" class="mt-2 flex flex-wrap items-end gap-2">
              <label class="text-sm font-medium text-slate-700">
                {{ t('admin.purchasing.store') }}
                <select v-model="receiveStoreId[o.id]" class="mt-1 min-h-10 rounded-xl border px-3">
                  <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.code }} — {{ s.name }}</option>
                </select>
              </label>
              <button type="button" class="min-h-10 rounded-xl bg-emerald-600 px-4 font-semibold text-white" :disabled="busy" @click="receivePo(o)">{{ t('admin.purchasing.receive') }}</button>
            </div>
          </li>
          <li v-if="!purchaseOrders.length" class="text-slate-500">{{ t('admin.purchasing.empty') }}</li>
        </ul>
      </UiPanel>

      <UiPanel v-else-if="tab === 'recipes'" dense :title="t('admin.tabs.recipes')">
        <p class="mb-2 text-sm text-slate-600">{{ t('admin.recipes.hint') }}</p>
        <label class="mb-3 block text-sm font-medium text-slate-700">
          {{ t('admin.recipes.menuProduct') }}
          <select v-model="recipeProductId" class="mt-1 min-h-10 w-full max-w-md rounded-xl border px-3" @change="loadRecipeEditor">
            <option v-for="p in products.filter((x) => x.productType !== 'INGREDIENT')" :key="p.id" :value="p.id">{{ p.sku }} — {{ p.name }}</option>
          </select>
        </label>
        <p v-if="recipeCogsPreview != null" class="mb-3 text-sm font-semibold text-emerald-800">
          {{ t('admin.recipes.hppPreview') }}: {{ formatIdrFromCents(recipeCogsPreview) }}
        </p>
        <div v-if="canInvWrite" class="space-y-2">
          <div v-for="(line, idx) in recipeLines" :key="idx" class="grid gap-2 rounded-lg bg-slate-50 p-2 sm:grid-cols-4">
            <select v-model="line.ingredientProductId" class="min-h-10 rounded-xl border px-3">
              <option value="">{{ t('admin.recipes.ingredient') }}</option>
              <option v-for="p in products.filter((x) => x.productType === 'INGREDIENT' || x.sku.startsWith('ING-'))" :key="p.id" :value="p.id">{{ p.sku }} — {{ p.name }}</option>
            </select>
            <input v-model.number="line.qty" type="number" min="1" class="min-h-10 rounded-xl border px-3" :placeholder="t('admin.recipes.qty')" />
            <MoneyIdrInput v-model="line.unitCostInCents" :placeholder="t('admin.recipes.unitCost')" />
          </div>
          <div class="flex gap-2">
            <button type="button" class="rounded-xl bg-slate-200 px-4 py-2 text-sm font-semibold" @click="recipeLines.push({ ingredientProductId: '', qty: 1, unitCostInCents: 0 })">{{ t('admin.recipes.addLine') }}</button>
            <button type="button" class="rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white" :disabled="busy" @click="saveRecipe">{{ t('admin.save') }}</button>
          </div>
        </div>
        <ul class="mt-3 divide-y divide-slate-100 overflow-hidden rounded-xl text-sm ring-1 ring-slate-200">
          <li v-for="r in recipes" :key="r.id" class="bg-white px-3 py-1.5">
            <strong>{{ r.product.sku }}</strong> · {{ r.lines.length }} {{ t('admin.recipes.ingredients') }}
          </li>
        </ul>
      </UiPanel>
    </template>
  </div>
</template>
