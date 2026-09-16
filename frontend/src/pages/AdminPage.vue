<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import PageHeader from '../components/PageHeader.vue';
import UiPanel from '../components/UiPanel.vue';
import { useSwipe } from '../composables/useSwipe';
import { useI18n } from '../i18n';
import { formatIdrFromCents } from '../lib/money';
import {
  createAdminCategory,
  createAdminProduct,
  createAdminStaff,
  createModifierGroup,
  createModifierOption,
  createStockTransfer,
  deleteAdminCategory,
  deleteModifierGroup,
  deleteModifierOption,
  fetchAdminCategories,
  fetchAdminProducts,
  fetchAdminStaff,
  fetchAdminStores,
  fetchAuditLogs,
  fetchStockTransfers,
  fetchStoreInventory,
  patchStoreInventory,
  updateAdminCategory,
  updateAdminProduct,
  updateAdminStaff,
  updateAdminStore,
  updateModifierOption,
  type AdminCategory,
  type AdminModifierGroup,
  type AdminProduct,
  type AdminStaff,
  type AdminStore,
  type AuditLogRow,
  type StockTransfer,
  type StoreInventoryItem,
} from '../services/admin-api.service';
import { fetchEdgeSyncStatus, pushEdgeSync } from '../services/edge-sync-api.service';
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
} from '../services/purchasing-api.service';
import type { StaffRole } from '../auth/permissions';
import { useAuthStore } from '../stores/auth.store';
import { useCatalogStore } from '../stores/catalog.store';
import { useToastStore } from '../stores/toast.store';

type Tab =
  | 'products'
  | 'categories'
  | 'modifiers'
  | 'staff'
  | 'stores'
  | 'inventory'
  | 'transfer'
  | 'suppliers'
  | 'purchasing'
  | 'audit'
  | 'edge';

const STAFF_ROLES: StaffRole[] = [
  'CASHIER',
  'SUPERVISOR',
  'MANAGER',
  'TENANT_ADMIN',
  'SUPER_ADMIN',
];

const ROLE_RANK: Record<StaffRole, number> = {
  CASHIER: 1,
  SUPERVISOR: 2,
  MANAGER: 3,
  TENANT_ADMIN: 4,
  SUPER_ADMIN: 5,
};

const TAB_ORDER: Tab[] = [
  'products',
  'categories',
  'modifiers',
  'staff',
  'stores',
  'inventory',
  'transfer',
  'suppliers',
  'purchasing',
  'edge',
  'audit',
];

const { t } = useI18n();
const auth = useAuthStore();
const catalog = useCatalogStore();
const toast = useToastStore();

const tab = ref<Tab>('products');
const error = ref<string | null>(null);
const busy = ref(false);

const tabSwipe = useSwipe({
  threshold: 48,
  onSwipeLeft: () => {
    const i = TAB_ORDER.indexOf(tab.value);
    tab.value = TAB_ORDER[(i + 1) % TAB_ORDER.length]!;
  },
  onSwipeRight: () => {
    const i = TAB_ORDER.indexOf(tab.value);
    tab.value = TAB_ORDER[(i - 1 + TAB_ORDER.length) % TAB_ORDER.length]!;
  },
});

const categories = ref<AdminCategory[]>([]);
const products = ref<AdminProduct[]>([]);
const staff = ref<AdminStaff[]>([]);
const stores = ref<AdminStore[]>([]);
const transfers = ref<StockTransfer[]>([]);
const suppliers = ref<Supplier[]>([]);
const purchaseOrders = ref<PurchaseOrder[]>([]);
const audit = ref<AuditLogRow[]>([]);
const transferFrom = ref('');
const transferTo = ref('');
const transferProductId = ref('');
const transferQty = ref(1);
const transferNote = ref('');
const qrisDrafts = ref<Record<string, string>>({});
const inventoryStoreId = ref('');
const inventoryItems = ref<StoreInventoryItem[]>([]);
const invQty = ref<Record<string, number>>({});
const invPrice = ref<Record<string, number>>({});
const invClearPrice = ref<Record<string, boolean>>({});
const inventoryQuery = ref('');
const newSupplier = ref({ code: '', name: '', phone: '', email: '' });
const poSupplierId = ref('');
const poStoreId = ref('');
const poNote = ref('');
const poProductId = ref('');
const poQty = ref(1);
const poUnitCost = ref(0);
const poLines = ref<Array<{ productId: string; productName: string; qtyOrdered: number; unitCostInCents: number }>>(
  [],
);
const receiveQty = ref<Record<string, number>>({});
const receiveStoreId = ref<Record<string, string>>({});
const edgeStatus = ref<{
  enabled: boolean;
  featureFlag: boolean;
  pending: number;
  delivered: number;
  hubUrl: string | null;
  lastCursor: string | null;
} | null>(null);

const canWrite = computed(() => auth.has('admin.catalog.write'));
const canStaff = computed(() => auth.has('admin.staff.read'));
const canStaffWrite = computed(() => auth.has('admin.staff.write'));

const assignableRoles = computed(() => {
  const actorRank = ROLE_RANK[(auth.staff?.role as StaffRole) ?? 'CASHIER'] ?? 0;
  return STAFF_ROLES.filter((r) => ROLE_RANK[r] <= actorRank);
});

const newStaff = ref({
  email: '',
  displayName: '',
  role: 'CASHIER' as StaffRole,
  pin: '1234',
});

const staffDraftName = ref<Record<string, string>>({});
const staffDraftRole = ref<Record<string, string>>({});
const staffDraftActive = ref<Record<string, boolean>>({});
const staffDraftPin = ref<Record<string, string>>({});

const newCategoryName = ref('');
const catDraftName = ref<Record<string, string>>({});
const catDraftSort = ref<Record<string, number>>({});

const modifierProductId = ref('');
const newGroup = ref({ name: '', minSelect: 0, maxSelect: 1 });
const newOption = ref<Record<string, { name: string; priceDeltaInCents: number }>>({});

const newProduct = ref({
  name: '',
  sku: '',
  categoryId: '',
  unitPriceInCents: 0,
  taxBps: 1100,
  stockQty: 0,
});

const draftStock = ref<Record<string, number>>({});
const draftPrice = ref<Record<string, number>>({});
const draftActive = ref<Record<string, boolean>>({});

onMounted(async () => {
  if (!auth.has('admin.access')) {
    error.value = t('admin.denied');
    return;
  }
  await refresh();
});

async function refresh(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    const [cats, prods, storeRows, logs, edge, xfers, supplierRows, orders] = await Promise.all([
      fetchAdminCategories(),
      fetchAdminProducts(),
      fetchAdminStores(),
      fetchAuditLogs(40),
      fetchEdgeSyncStatus().catch(() => null),
      fetchStockTransfers().catch(() => [] as StockTransfer[]),
      fetchSuppliers().catch(() => [] as Supplier[]),
      fetchPurchaseOrders().catch(() => [] as PurchaseOrder[]),
    ]);
    categories.value = cats;
    for (const c of cats) {
      catDraftName.value[c.id] = c.name;
      catDraftSort.value[c.id] = c.sortOrder;
    }
    products.value = prods;
    if (!modifierProductId.value && prods[0]) {
      modifierProductId.value = prods[0].id;
    }
    stores.value = storeRows;
    const drafts: Record<string, string> = {};
    for (const s of storeRows) {
      drafts[s.id] = s.qrisPayload ?? '';
    }
    qrisDrafts.value = drafts;
    audit.value = logs;
    edgeStatus.value = edge;
    transfers.value = xfers;
    suppliers.value = supplierRows;
    purchaseOrders.value = orders;
    if (!transferFrom.value && storeRows[0]) transferFrom.value = storeRows[0].id;
    if (!transferTo.value && storeRows[1]) transferTo.value = storeRows[1].id;
    if (!transferProductId.value && prods[0]) transferProductId.value = prods[0].id;
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
    if (!inventoryStoreId.value && storeRows[0]) {
      inventoryStoreId.value = storeRows[0].id;
      await loadInventory(storeRows[0].id);
    } else if (inventoryStoreId.value) {
      await loadInventory(inventoryStoreId.value);
    }
    if (canStaff.value) {
      staff.value = await fetchAdminStaff();
      for (const u of staff.value) {
        staffDraftName.value[u.id] = u.displayName;
        staffDraftRole.value[u.id] = u.role;
        staffDraftActive.value[u.id] = u.isActive;
        staffDraftPin.value[u.id] = '';
      }
    }
    if (!newProduct.value.categoryId && cats[0]) {
      newProduct.value.categoryId = cats[0].id;
    }
    for (const p of prods) {
      draftStock.value[p.id] = p.stockQty;
      draftPrice.value[p.id] = p.unitPriceInCents;
      draftActive.value[p.id] = p.isActive;
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function addCategory(): Promise<void> {
  if (!canWrite.value || !newCategoryName.value.trim()) return;
  busy.value = true;
  try {
    await createAdminCategory({ name: newCategoryName.value.trim() });
    newCategoryName.value = '';
    toast.success(t('admin.saved'));
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function saveCategory(cat: AdminCategory): Promise<void> {
  if (!canWrite.value) return;
  const name = (catDraftName.value[cat.id] ?? '').trim();
  const sortOrder = catDraftSort.value[cat.id];
  if (!name || !Number.isInteger(sortOrder)) return;
  busy.value = true;
  error.value = null;
  try {
    await updateAdminCategory(cat.id, { name, sortOrder });
    toast.success(t('admin.saved'));
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function removeCategory(cat: AdminCategory): Promise<void> {
  if (!canWrite.value) return;
  if ((cat._count?.products ?? 0) > 0) {
    error.value = t('admin.categoryHasProducts');
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await deleteAdminCategory(cat.id);
    toast.success(t('admin.categoryDeleted'));
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

const selectedModifierProduct = computed(
  () => products.value.find((p) => p.id === modifierProductId.value) ?? null,
);

const selectedModifierGroups = computed(
  () => selectedModifierProduct.value?.modifierGroups ?? ([] as AdminModifierGroup[]),
);

async function addModifierGroup(): Promise<void> {
  if (!canWrite.value || !modifierProductId.value || !newGroup.value.name.trim()) return;
  busy.value = true;
  error.value = null;
  try {
    await createModifierGroup(modifierProductId.value, {
      name: newGroup.value.name.trim(),
      minSelect: newGroup.value.minSelect,
      maxSelect: newGroup.value.maxSelect,
    });
    toast.success(t('admin.modifiers.groupCreated'));
    newGroup.value = { name: '', minSelect: 0, maxSelect: 1 };
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function removeModifierGroup(groupId: string): Promise<void> {
  if (!canWrite.value) return;
  busy.value = true;
  error.value = null;
  try {
    await deleteModifierGroup(groupId);
    toast.success(t('admin.modifiers.groupDeleted'));
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function addModifierOption(groupId: string): Promise<void> {
  if (!canWrite.value) return;
  const draft = newOption.value[groupId] ?? { name: '', priceDeltaInCents: 0 };
  if (!draft.name.trim()) return;
  if (!Number.isInteger(draft.priceDeltaInCents)) {
    error.value = t('admin.modifiers.priceInvalid');
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await createModifierOption(groupId, {
      name: draft.name.trim(),
      priceDeltaInCents: draft.priceDeltaInCents,
    });
    toast.success(t('admin.modifiers.optionCreated'));
    newOption.value = {
      ...newOption.value,
      [groupId]: { name: '', priceDeltaInCents: 0 },
    };
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function toggleOptionActive(optionId: string, isActive: boolean): Promise<void> {
  if (!canWrite.value) return;
  busy.value = true;
  try {
    await updateModifierOption(optionId, { isActive });
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function removeModifierOptionRow(optionId: string): Promise<void> {
  if (!canWrite.value) return;
  busy.value = true;
  error.value = null;
  try {
    await deleteModifierOption(optionId);
    toast.success(t('admin.modifiers.optionDeleted'));
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function runTransfer(): Promise<void> {
  if (!canWrite.value) return;
  if (!transferFrom.value || !transferTo.value || !transferProductId.value) return;
  if (!Number.isInteger(transferQty.value) || transferQty.value < 1) return;
  busy.value = true;
  try {
    await createStockTransfer({
      fromStoreId: transferFrom.value,
      toStoreId: transferTo.value,
      note: transferNote.value.trim() || undefined,
      lines: [{ productId: transferProductId.value, qty: transferQty.value }],
    });
    toast.success(t('admin.transfer.ok'));
    transferNote.value = '';
    await refresh();
    await catalog.refreshFromApi();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

function addPoLine(): void {
  if (!poProductId.value) return;
  if (!Number.isInteger(poQty.value) || poQty.value < 1) {
    error.value = t('admin.purchasing.invalidLine');
    return;
  }
  if (!Number.isInteger(poUnitCost.value) || poUnitCost.value < 0) {
    error.value = t('admin.purchasing.invalidLine');
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
  if (!canWrite.value) return;
  if (!poSupplierId.value || !poStoreId.value || !poLines.value.length) return;
  busy.value = true;
  error.value = null;
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
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function addSupplier(): Promise<void> {
  if (!canWrite.value) return;
  if (!newSupplier.value.code.trim() || !newSupplier.value.name.trim()) return;
  busy.value = true;
  error.value = null;
  try {
    await createSupplier({
      code: newSupplier.value.code.trim(),
      name: newSupplier.value.name.trim(),
      phone: newSupplier.value.phone.trim() || undefined,
      email: newSupplier.value.email.trim() || undefined,
    });
    toast.success(t('admin.suppliers.created'));
    newSupplier.value = { code: '', name: '', phone: '', email: '' };
    await refresh();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function toggleSupplierActive(row: Supplier): Promise<void> {
  if (!canWrite.value) return;
  busy.value = true;
  error.value = null;
  try {
    await updateSupplier(row.id, { isActive: !row.isActive });
    toast.success(t('admin.suppliers.saved'));
    await refresh();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function confirmPo(id: string): Promise<void> {
  if (!canWrite.value) return;
  busy.value = true;
  error.value = null;
  try {
    await confirmPurchaseOrder(id);
    toast.success(t('admin.purchasing.confirmed'));
    await refresh();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function cancelPo(id: string): Promise<void> {
  if (!canWrite.value) return;
  busy.value = true;
  error.value = null;
  try {
    await cancelPurchaseOrder(id);
    toast.success(t('admin.purchasing.cancelled'));
    await refresh();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function receivePo(order: PurchaseOrder): Promise<void> {
  if (!canWrite.value) return;
  const lines = order.lines
    .map((line) => ({
      purchaseOrderLineId: line.id,
      qty: receiveQty.value[line.id] ?? 0,
    }))
    .filter((l) => Number.isInteger(l.qty) && l.qty > 0);
  if (!lines.length) return;
  busy.value = true;
  error.value = null;
  try {
    await receivePurchaseOrder(order.id, {
      storeId: receiveStoreId.value[order.id] || order.store.id,
      lines,
    });
    toast.success(t('admin.purchasing.receiveOk'));
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function runEdgePush(): Promise<void> {
  busy.value = true;
  try {
    const result = await pushEdgeSync();
    toast.success(
      t('admin.edge.pushOk'),
      result.dryRun
        ? `dry-run ${result.pushed}`
        : `pushed ${result.pushed}${result.error ? ` · ${result.error}` : ''}`,
    );
    edgeStatus.value = await fetchEdgeSyncStatus();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function addProduct(): Promise<void> {
  if (!canWrite.value) return;
  const body = newProduct.value;
  if (!body.name.trim() || !body.sku.trim() || !body.categoryId) return;
  if (!Number.isInteger(body.unitPriceInCents) || body.unitPriceInCents < 0) return;
  busy.value = true;
  try {
    await createAdminProduct({
      name: body.name.trim(),
      sku: body.sku.trim(),
      categoryId: body.categoryId,
      unitPriceInCents: body.unitPriceInCents,
      taxBps: body.taxBps,
      stockQty: body.stockQty,
      isActive: true,
    });
    newProduct.value = {
      name: '',
      sku: '',
      categoryId: categories.value[0]?.id ?? '',
      unitPriceInCents: 0,
      taxBps: 1100,
      stockQty: 0,
    };
    toast.success(t('admin.saved'));
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function saveProduct(product: AdminProduct): Promise<void> {
  if (!canWrite.value) return;
  const unitPriceInCents = draftPrice.value[product.id];
  const stockQty = draftStock.value[product.id];
  const isActive = draftActive.value[product.id];
  if (!Number.isInteger(unitPriceInCents) || unitPriceInCents < 0) return;
  if (!Number.isInteger(stockQty)) return;
  busy.value = true;
  try {
    await updateAdminProduct(product.id, { unitPriceInCents, stockQty, isActive });
    toast.success(t('admin.saved'));
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function saveStoreQris(store: AdminStore): Promise<void> {
  if (!canWrite.value) return;
  busy.value = true;
  error.value = null;
  try {
    const raw = (qrisDrafts.value[store.id] ?? '').trim();
    await updateAdminStore(store.id, { qrisPayload: raw.length ? raw : null });
    toast.success(t('admin.qrisSaved'));
    await refresh();
    void catalog.refreshFromApi();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function addStaff(): Promise<void> {
  if (!canStaffWrite.value) return;
  if (!newStaff.value.email.trim() || !newStaff.value.displayName.trim()) return;
  if (!/^\d{4,8}$/.test(newStaff.value.pin)) {
    error.value = t('admin.staffPinInvalid');
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await createAdminStaff({
      email: newStaff.value.email.trim(),
      displayName: newStaff.value.displayName.trim(),
      role: newStaff.value.role,
      pin: newStaff.value.pin,
    });
    toast.success(t('admin.staffCreated'));
    newStaff.value = { email: '', displayName: '', role: 'CASHIER', pin: '1234' };
    await refresh();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function saveStaff(user: AdminStaff): Promise<void> {
  if (!canStaffWrite.value) return;
  const pin = (staffDraftPin.value[user.id] ?? '').trim();
  if (pin && !/^\d{4,8}$/.test(pin)) {
    error.value = t('admin.staffPinInvalid');
    return;
  }
  busy.value = true;
  error.value = null;
  try {
    await updateAdminStaff(user.id, {
      displayName: staffDraftName.value[user.id]?.trim() || user.displayName,
      role: staffDraftRole.value[user.id] || user.role,
      isActive: staffDraftActive.value[user.id] ?? user.isActive,
      ...(pin ? { pin } : {}),
    });
    toast.success(t('admin.saved'));
    staffDraftPin.value[user.id] = '';
    await refresh();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

function canEditStaffRow(user: AdminStaff): boolean {
  if (!canStaffWrite.value) return false;
  const actorRank = ROLE_RANK[(auth.staff?.role as StaffRole) ?? 'CASHIER'] ?? 0;
  const targetRank = ROLE_RANK[user.role as StaffRole] ?? 99;
  return targetRank <= actorRank;
}

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
  busy.value = true;
  error.value = null;
  try {
    await loadInventory(inventoryStoreId.value);
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}

async function saveInventoryRow(item: StoreInventoryItem): Promise<void> {
  if (!canWrite.value || !inventoryStoreId.value) return;
  const qty = invQty.value[item.productId];
  if (!Number.isInteger(qty) || qty < 0) {
    error.value = t('admin.inventory.qtyInvalid');
    return;
  }
  const clearPrice = invClearPrice.value[item.productId];
  const price = invPrice.value[item.productId];
  if (!clearPrice && (!Number.isInteger(price) || price < 0)) {
    error.value = t('admin.inventory.priceInvalid');
    return;
  }

  const body: {
    qty?: number;
    unitPriceInCents?: number | null;
    note?: string;
  } = {};
  if (qty !== item.onHandQty) {
    body.qty = qty;
  }
  if (clearPrice) {
    if (item.storeUnitPriceInCents != null) {
      body.unitPriceInCents = null;
    }
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

  busy.value = true;
  error.value = null;
  try {
    await patchStoreInventory(inventoryStoreId.value, item.productId, {
      ...body,
      note: 'admin.inventory.ui',
    });
    toast.success(t('admin.inventory.saved'));
    await loadInventory(inventoryStoreId.value);
    void catalog.refreshFromApi();
  } catch (err) {
    error.value = err instanceof Error ? err.message : t('admin.loadFailed');
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="mx-auto max-w-6xl px-3 py-5 sm:px-4 sm:py-8">
    <PageHeader
      :eyebrow="t('admin.eyebrow')"
      :title="t('admin.title')"
      :subtitle="t('admin.subtitle')"
    >
      <template #actions>
        <button
          class="touch-target rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white"
          type="button"
          :disabled="busy"
          @click="refresh"
        >
          {{ t('common.reload') }}
        </button>
      </template>
    </PageHeader>

    <p v-if="error" class="mb-4 rounded-2xl bg-red-50 p-3 text-red-800">{{ error }}</p>

    <template v-if="auth.has('admin.access')">
      <div class="mb-5 flex gap-2 overflow-x-auto pb-1" v-on="tabSwipe.handlers">
        <button
          v-for="key in TAB_ORDER"
          :key="key"
          class="touch-target shrink-0 rounded-2xl px-4 text-sm font-semibold"
          :class="tab === key ? 'bg-slate-900 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200'"
          type="button"
          @click="tab = key"
        >
          {{ t(`admin.tabs.${key}`) }}
        </button>
      </div>

      <UiPanel v-if="tab === 'products'" :title="t('admin.tabs.products')">
        <div
          v-if="canWrite"
          class="mb-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          <input
            v-model="newProduct.name"
            class="min-h-12 rounded-xl border border-slate-300 px-3"
            :placeholder="t('admin.name')"
          />
          <input
            v-model="newProduct.sku"
            class="min-h-12 rounded-xl border border-slate-300 px-3"
            :placeholder="t('admin.sku')"
          />
          <select v-model="newProduct.categoryId" class="min-h-12 rounded-xl border border-slate-300 px-3">
            <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
          <input
            v-model.number="newProduct.unitPriceInCents"
            class="min-h-12 rounded-xl border border-slate-300 px-3"
            type="number"
            step="1"
            :placeholder="t('admin.price')"
          />
          <input
            v-model.number="newProduct.stockQty"
            class="min-h-12 rounded-xl border border-slate-300 px-3"
            type="number"
            step="1"
            :placeholder="t('admin.stock')"
          />
          <button
            class="touch-target rounded-xl bg-emerald-600 font-semibold text-white"
            type="button"
            :disabled="busy"
            @click="addProduct"
          >
            {{ t('admin.addProduct') }}
          </button>
        </div>

        <div class="overflow-x-auto">
          <table class="min-w-full text-left text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th class="px-3 py-2.5 font-medium">{{ t('admin.name') }}</th>
                <th class="px-3 py-2.5 font-medium">{{ t('admin.sku') }}</th>
                <th class="px-3 py-2.5 font-medium">{{ t('admin.category') }}</th>
                <th class="px-3 py-2.5 font-medium">{{ t('admin.price') }}</th>
                <th class="px-3 py-2.5 font-medium">{{ t('admin.stock') }}</th>
                <th class="px-3 py-2.5 font-medium">{{ t('admin.status') }}</th>
                <th v-if="canWrite" class="px-3 py-2.5 font-medium" />
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in products" :key="p.id" class="border-b border-slate-100 last:border-0">
                <td class="px-3 py-2.5 font-medium">{{ p.name }}</td>
                <td class="px-3 py-2.5 tabular-nums">{{ p.sku }}</td>
                <td class="px-3 py-2.5">{{ p.category?.name || t('common.empty') }}</td>
                <td class="px-3 py-2.5">
                  <template v-if="canWrite">
                    <input
                      v-model.number="draftPrice[p.id]"
                      class="min-h-10 w-28 rounded-lg border border-slate-300 px-2 tabular-nums"
                      type="number"
                      step="1"
                    />
                    <p class="mt-1 text-xs text-slate-500">
                      {{ formatIdrFromCents(draftPrice[p.id] ?? 0) }}
                    </p>
                  </template>
                  <span v-else class="tabular-nums">{{ formatIdrFromCents(p.unitPriceInCents) }}</span>
                </td>
                <td class="px-3 py-2.5">
                  <input
                    v-if="canWrite"
                    v-model.number="draftStock[p.id]"
                    class="min-h-10 w-20 rounded-lg border border-slate-300 px-2 tabular-nums"
                    type="number"
                    step="1"
                  />
                  <span v-else class="tabular-nums">{{ p.stockQty }}</span>
                </td>
                <td class="px-3 py-2.5">
                  <label v-if="canWrite" class="inline-flex items-center gap-2">
                    <input v-model="draftActive[p.id]" type="checkbox" class="h-4 w-4" />
                    <span>{{ draftActive[p.id] ? t('admin.active') : t('admin.inactive') }}</span>
                  </label>
                  <span v-else>{{ p.isActive ? t('admin.active') : t('admin.inactive') }}</span>
                </td>
                <td v-if="canWrite" class="px-3 py-2.5">
                  <button
                    class="touch-target rounded-xl bg-slate-900 px-3 text-xs font-semibold text-white"
                    type="button"
                    :disabled="busy"
                    @click="saveProduct(p)"
                  >
                    {{ t('admin.save') }}
                  </button>
                </td>
              </tr>
              <tr v-if="!products.length">
                <td class="px-3 py-8 text-slate-500" :colspan="canWrite ? 7 : 6">
                  {{ t('admin.emptyProducts') }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiPanel>

      <UiPanel v-else-if="tab === 'categories'" :title="t('admin.tabs.categories')">
        <div v-if="canWrite" class="mb-4 flex flex-wrap gap-2">
          <input
            v-model="newCategoryName"
            class="min-h-12 min-w-[12rem] flex-1 rounded-xl border border-slate-300 px-3"
            :placeholder="t('admin.name')"
          />
          <button
            class="touch-target rounded-xl bg-emerald-600 px-4 font-semibold text-white"
            type="button"
            :disabled="busy"
            @click="addCategory"
          >
            {{ t('admin.addCategory') }}
          </button>
        </div>
        <ul class="space-y-3">
          <li
            v-for="c in categories"
            :key="c.id"
            class="rounded-2xl bg-slate-50 px-4 py-3"
          >
            <div v-if="canWrite" class="grid gap-2 sm:grid-cols-[1fr_6rem_auto_auto]">
              <input
                v-model="catDraftName[c.id]"
                class="min-h-11 rounded-xl border px-3"
                type="text"
              />
              <input
                v-model.number="catDraftSort[c.id]"
                class="min-h-11 rounded-xl border px-3 tabular-nums"
                type="number"
                step="1"
              />
              <button
                type="button"
                class="min-h-11 rounded-xl bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-40"
                :disabled="busy"
                @click="saveCategory(c)"
              >
                {{ t('admin.save') }}
              </button>
              <button
                type="button"
                class="min-h-11 rounded-xl bg-red-100 px-3 text-sm font-semibold text-red-800 disabled:opacity-40"
                :disabled="busy || (c._count?.products ?? 0) > 0"
                @click="removeCategory(c)"
              >
                {{ t('common.delete') }}
              </button>
            </div>
            <div v-else class="flex items-center justify-between">
              <span class="font-medium">{{ c.name }}</span>
              <span class="text-sm text-slate-500">#{{ c.sortOrder }}</span>
            </div>
            <p class="mt-1 text-xs text-slate-500">
              {{ t('admin.categoryProductCount', { count: c._count?.products ?? 0 }) }}
            </p>
          </li>
          <li v-if="!categories.length" class="text-sm text-slate-500">
            {{ t('admin.emptyCategories') }}
          </li>
        </ul>
      </UiPanel>

      <UiPanel v-else-if="tab === 'modifiers'" :title="t('admin.tabs.modifiers')">
        <p class="mb-3 text-sm text-slate-600">{{ t('admin.modifiers.hint') }}</p>
        <label class="mb-4 block text-sm font-medium text-slate-600">
          {{ t('admin.modifiers.product') }}
          <select
            v-model="modifierProductId"
            class="mt-1 min-h-12 w-full max-w-md rounded-xl border px-3"
          >
            <option v-for="p in products" :key="p.id" :value="p.id">
              {{ p.name }} ({{ p.sku }})
            </option>
          </select>
        </label>

        <div
          v-if="canWrite && modifierProductId"
          class="mb-4 grid gap-2 rounded-2xl bg-slate-50 p-3 sm:grid-cols-4"
        >
          <input
            v-model="newGroup.name"
            class="min-h-11 rounded-xl border px-3 sm:col-span-2"
            type="text"
            :placeholder="t('admin.modifiers.groupName')"
          />
          <input
            v-model.number="newGroup.minSelect"
            class="min-h-11 rounded-xl border px-3 tabular-nums"
            type="number"
            min="0"
            step="1"
            :title="t('admin.modifiers.minSelect')"
          />
          <div class="flex gap-2">
            <input
              v-model.number="newGroup.maxSelect"
              class="min-h-11 w-full rounded-xl border px-3 tabular-nums"
              type="number"
              min="1"
              step="1"
              :title="t('admin.modifiers.maxSelect')"
            />
            <button
              type="button"
              class="touch-target shrink-0 rounded-xl bg-emerald-700 px-3 text-sm font-semibold text-white"
              :disabled="busy"
              @click="addModifierGroup"
            >
              {{ t('admin.modifiers.addGroup') }}
            </button>
          </div>
        </div>

        <div v-if="selectedModifierGroups.length" class="space-y-4">
          <section
            v-for="g in selectedModifierGroups"
            :key="g.id"
            class="rounded-2xl border border-slate-200 p-4"
          >
            <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 class="font-semibold text-slate-900">{{ g.name }}</h3>
                <p class="text-xs text-slate-500">
                  {{ t('admin.modifiers.bounds', { min: g.minSelect, max: g.maxSelect }) }}
                </p>
              </div>
              <button
                v-if="canWrite"
                type="button"
                class="rounded-xl bg-red-100 px-3 py-2 text-xs font-semibold text-red-800"
                :disabled="busy"
                @click="removeModifierGroup(g.id)"
              >
                {{ t('admin.modifiers.deleteGroup') }}
              </button>
            </div>

            <ul class="space-y-2">
              <li
                v-for="opt in g.options"
                :key="opt.id"
                class="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm"
              >
                <span :class="opt.isActive ? '' : 'text-slate-400 line-through'">
                  {{ opt.name }}
                  <span class="tabular-nums text-slate-500">
                    · {{ formatIdrFromCents(opt.priceDeltaInCents) }}
                  </span>
                </span>
                <div v-if="canWrite" class="flex items-center gap-2">
                  <label class="inline-flex items-center gap-1 text-xs">
                    <input
                      type="checkbox"
                      class="h-4 w-4"
                      :checked="opt.isActive"
                      @change="
                        toggleOptionActive(
                          opt.id,
                          ($event.target as HTMLInputElement).checked,
                        )
                      "
                    />
                    {{ t('admin.active') }}
                  </label>
                  <button
                    type="button"
                    class="rounded-lg bg-slate-200 px-2 py-1 text-xs font-semibold"
                    :disabled="busy"
                    @click="removeModifierOptionRow(opt.id)"
                  >
                    {{ t('common.delete') }}
                  </button>
                </div>
              </li>
            </ul>

            <div
              v-if="canWrite"
              class="mt-3 grid gap-2 sm:grid-cols-[1fr_8rem_auto]"
            >
              <input
                :value="(newOption[g.id] ?? { name: '' }).name"
                class="min-h-11 rounded-xl border px-3"
                type="text"
                :placeholder="t('admin.modifiers.optionName')"
                @input="
                  newOption = {
                    ...newOption,
                    [g.id]: {
                      name: ($event.target as HTMLInputElement).value,
                      priceDeltaInCents: newOption[g.id]?.priceDeltaInCents ?? 0,
                    },
                  }
                "
              />
              <input
                :value="(newOption[g.id] ?? { priceDeltaInCents: 0 }).priceDeltaInCents"
                class="min-h-11 rounded-xl border px-3 tabular-nums"
                type="number"
                step="1"
                :placeholder="t('admin.modifiers.priceDelta')"
                @input="
                  newOption = {
                    ...newOption,
                    [g.id]: {
                      name: newOption[g.id]?.name ?? '',
                      priceDeltaInCents: Number(($event.target as HTMLInputElement).value) || 0,
                    },
                  }
                "
              />
              <button
                type="button"
                class="min-h-11 rounded-xl bg-slate-900 px-3 text-sm font-semibold text-white"
                :disabled="busy"
                @click="addModifierOption(g.id)"
              >
                {{ t('admin.modifiers.addOption') }}
              </button>
            </div>
          </section>
        </div>
        <p v-else class="text-sm text-slate-500">{{ t('admin.modifiers.empty') }}</p>
      </UiPanel>

      <UiPanel v-else-if="tab === 'staff'" :title="t('admin.tabs.staff')" :padded="false">
        <div v-if="!canStaff" class="p-4 text-sm text-slate-500">{{ t('admin.denied') }}</div>
        <div v-else class="space-y-4 p-4">
          <div
            v-if="canStaffWrite"
            class="grid gap-2 rounded-2xl bg-slate-50 p-3 sm:grid-cols-2 lg:grid-cols-5"
          >
            <label class="text-sm font-medium text-slate-600">
              {{ t('admin.name') }}
              <input
                v-model="newStaff.displayName"
                class="mt-1 min-h-11 w-full rounded-xl border px-3"
                type="text"
              />
            </label>
            <label class="text-sm font-medium text-slate-600">
              {{ t('admin.email') }}
              <input
                v-model="newStaff.email"
                class="mt-1 min-h-11 w-full rounded-xl border px-3"
                type="email"
                autocomplete="off"
              />
            </label>
            <label class="text-sm font-medium text-slate-600">
              {{ t('admin.role') }}
              <select v-model="newStaff.role" class="mt-1 min-h-11 w-full rounded-xl border px-3">
                <option v-for="r in assignableRoles" :key="r" :value="r">{{ r }}</option>
              </select>
            </label>
            <label class="text-sm font-medium text-slate-600">
              {{ t('admin.staffPin') }}
              <input
                v-model="newStaff.pin"
                class="mt-1 min-h-11 w-full rounded-xl border px-3 tabular-nums"
                type="password"
                inputmode="numeric"
                maxlength="8"
                autocomplete="new-password"
              />
            </label>
            <button
              type="button"
              class="touch-target self-end rounded-2xl bg-slate-900 text-sm font-semibold text-white disabled:opacity-40"
              :disabled="busy"
              @click="addStaff"
            >
              {{ t('admin.addStaff') }}
            </button>
          </div>

          <div class="overflow-x-auto">
            <table class="min-w-full text-left text-sm">
              <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th class="px-3 py-2.5 font-medium">{{ t('admin.name') }}</th>
                  <th class="px-3 py-2.5 font-medium">{{ t('admin.email') }}</th>
                  <th class="px-3 py-2.5 font-medium">{{ t('admin.role') }}</th>
                  <th class="px-3 py-2.5 font-medium">{{ t('admin.status') }}</th>
                  <th v-if="canStaffWrite" class="px-3 py-2.5 font-medium">{{ t('admin.staffPin') }}</th>
                  <th v-if="canStaffWrite" class="px-3 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                <tr v-for="u in staff" :key="u.id" class="border-b border-slate-100 last:border-0">
                  <td class="px-3 py-2.5">
                    <input
                      v-if="canEditStaffRow(u)"
                      v-model="staffDraftName[u.id]"
                      class="min-h-10 w-full min-w-[8rem] rounded-lg border px-2"
                      type="text"
                    />
                    <span v-else class="font-medium">{{ u.displayName }}</span>
                  </td>
                  <td class="px-3 py-2.5">{{ u.email }}</td>
                  <td class="px-3 py-2.5">
                    <select
                      v-if="canEditStaffRow(u) && u.id !== auth.staff?.id"
                      v-model="staffDraftRole[u.id]"
                      class="min-h-10 rounded-lg border px-2"
                    >
                      <option v-for="r in assignableRoles" :key="r" :value="r">{{ r }}</option>
                    </select>
                    <span v-else>{{ u.role }}</span>
                  </td>
                  <td class="px-3 py-2.5">
                    <label
                      v-if="canEditStaffRow(u) && u.id !== auth.staff?.id"
                      class="inline-flex items-center gap-2"
                    >
                      <input v-model="staffDraftActive[u.id]" type="checkbox" class="h-4 w-4" />
                      {{ staffDraftActive[u.id] ? t('admin.active') : t('admin.inactive') }}
                    </label>
                    <span v-else>{{ u.isActive ? t('admin.active') : t('admin.inactive') }}</span>
                  </td>
                  <td v-if="canStaffWrite" class="px-3 py-2.5">
                    <input
                      v-if="canEditStaffRow(u)"
                      v-model="staffDraftPin[u.id]"
                      class="min-h-10 w-28 rounded-lg border px-2 tabular-nums"
                      type="password"
                      inputmode="numeric"
                      maxlength="8"
                      :placeholder="u.hasPin ? '••••' : t('admin.staffPinSet')"
                      autocomplete="new-password"
                    />
                    <span v-else class="text-slate-400">—</span>
                  </td>
                  <td v-if="canStaffWrite" class="px-3 py-2.5">
                    <button
                      v-if="canEditStaffRow(u)"
                      type="button"
                      class="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                      :disabled="busy"
                      @click="saveStaff(u)"
                    >
                      {{ t('admin.save') }}
                    </button>
                  </td>
                </tr>
                <tr v-if="!staff.length">
                  <td class="px-3 py-8 text-slate-500" :colspan="canStaffWrite ? 6 : 4">
                    {{ t('admin.emptyStaff') }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </UiPanel>

      <UiPanel v-else-if="tab === 'stores'" :title="t('admin.tabs.stores')">
        <p class="mb-3 text-sm text-slate-600">{{ t('admin.qrisHint') }}</p>
        <ul class="space-y-4">
          <li
            v-for="s in stores"
            :key="s.id"
            class="rounded-2xl bg-slate-50 px-4 py-4"
          >
            <p class="font-medium text-slate-900">{{ s.code }} — {{ s.name }}</p>
            <p class="mt-1 text-xs text-slate-500">
              {{ s.qrisPayload ? t('admin.qrisConfigured') : t('admin.qrisEmpty') }}
            </p>
            <label v-if="canWrite" class="mt-3 block text-sm font-medium text-slate-600">
              {{ t('admin.qrisPayload') }}
              <textarea
                v-model="qrisDrafts[s.id]"
                class="mt-1 min-h-24 w-full rounded-xl border border-slate-300 px-3 py-2 font-mono text-xs"
                rows="3"
                :placeholder="t('admin.qrisPlaceholder')"
                spellcheck="false"
              />
            </label>
            <button
              v-if="canWrite"
              type="button"
              class="touch-target mt-2 rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white disabled:opacity-40"
              :disabled="busy"
              @click="saveStoreQris(s)"
            >
              {{ t('admin.qrisSave') }}
            </button>
          </li>
          <li v-if="!stores.length" class="text-sm text-slate-500">
            {{ t('admin.emptyStores') }}
          </li>
        </ul>
      </UiPanel>

      <UiPanel v-else-if="tab === 'inventory'" :title="t('admin.tabs.inventory')" :padded="false">
        <div class="space-y-3 p-4">
          <p class="text-sm text-slate-600">{{ t('admin.inventory.hint') }}</p>
          <div class="grid gap-2 sm:grid-cols-2">
            <label class="text-sm font-medium text-slate-600">
              {{ t('admin.inventory.store') }}
              <select
                v-model="inventoryStoreId"
                class="mt-1 min-h-12 w-full rounded-xl border px-3"
                @change="onInventoryStoreChange"
              >
                <option v-for="s in stores" :key="s.id" :value="s.id">
                  {{ s.code }} · {{ s.name }}
                </option>
              </select>
            </label>
            <label class="text-sm font-medium text-slate-600">
              {{ t('admin.inventory.search') }}
              <input
                v-model="inventoryQuery"
                class="mt-1 min-h-12 w-full rounded-xl border px-3"
                type="search"
                :placeholder="t('admin.inventory.searchPlaceholder')"
              />
            </label>
          </div>

          <div class="overflow-x-auto rounded-2xl border border-slate-200">
            <table class="min-w-full text-left text-sm">
              <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
                <tr>
                  <th class="px-3 py-2.5 font-medium">{{ t('admin.name') }}</th>
                  <th class="px-3 py-2.5 font-medium">{{ t('admin.sku') }}</th>
                  <th class="px-3 py-2.5 font-medium">{{ t('admin.inventory.onHand') }}</th>
                  <th class="px-3 py-2.5 font-medium">{{ t('admin.inventory.storePrice') }}</th>
                  <th class="px-3 py-2.5 font-medium">{{ t('admin.inventory.catalogPrice') }}</th>
                  <th v-if="canWrite" class="px-3 py-2.5 font-medium" />
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="item in filteredInventory"
                  :key="item.productId"
                  class="border-b border-slate-100 last:border-0"
                  :class="item.isActive ? '' : 'opacity-50'"
                >
                  <td class="px-3 py-2.5 font-medium">
                    {{ item.name }}
                    <span
                      v-if="item.storeUnitPriceInCents != null"
                      class="ml-1 rounded bg-teal-50 px-1.5 py-0.5 text-[10px] font-semibold text-teal-800"
                    >
                      {{ t('admin.inventory.override') }}
                    </span>
                  </td>
                  <td class="px-3 py-2.5 tabular-nums text-slate-600">{{ item.sku }}</td>
                  <td class="px-3 py-2.5">
                    <input
                      v-if="canWrite"
                      v-model.number="invQty[item.productId]"
                      class="min-h-10 w-24 rounded-lg border px-2 tabular-nums"
                      type="number"
                      min="0"
                      step="1"
                      inputmode="numeric"
                    />
                    <span v-else class="tabular-nums">{{ item.onHandQty }}</span>
                  </td>
                  <td class="px-3 py-2.5">
                    <div v-if="canWrite" class="flex flex-col gap-1">
                      <input
                        v-model.number="invPrice[item.productId]"
                        class="min-h-10 w-28 rounded-lg border px-2 tabular-nums"
                        type="number"
                        min="0"
                        step="1"
                        inputmode="numeric"
                        :disabled="invClearPrice[item.productId]"
                      />
                      <label
                        v-if="item.storeUnitPriceInCents != null"
                        class="inline-flex items-center gap-1 text-xs text-slate-500"
                      >
                        <input v-model="invClearPrice[item.productId]" type="checkbox" class="h-3.5 w-3.5" />
                        {{ t('admin.inventory.clearOverride') }}
                      </label>
                    </div>
                    <span v-else class="tabular-nums">
                      {{ formatIdrFromCents(item.effectiveUnitPriceInCents) }}
                    </span>
                  </td>
                  <td class="px-3 py-2.5 tabular-nums text-slate-500">
                    {{ formatIdrFromCents(item.catalogUnitPriceInCents) }}
                  </td>
                  <td v-if="canWrite" class="px-3 py-2.5">
                    <button
                      type="button"
                      class="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
                      :disabled="busy"
                      @click="saveInventoryRow(item)"
                    >
                      {{ t('admin.save') }}
                    </button>
                  </td>
                </tr>
                <tr v-if="!filteredInventory.length">
                  <td class="px-3 py-8 text-slate-500" :colspan="canWrite ? 6 : 5">
                    {{ t('admin.inventory.empty') }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </UiPanel>

      <UiPanel v-else-if="tab === 'transfer'" :title="t('admin.tabs.transfer')">
        <div v-if="canWrite" class="mb-4 grid gap-2 sm:grid-cols-2">
          <label class="text-sm">
            {{ t('admin.transfer.from') }}
            <select v-model="transferFrom" class="mt-1 min-h-12 w-full rounded-xl border px-3">
              <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.code }} · {{ s.name }}</option>
            </select>
          </label>
          <label class="text-sm">
            {{ t('admin.transfer.to') }}
            <select v-model="transferTo" class="mt-1 min-h-12 w-full rounded-xl border px-3">
              <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.code }} · {{ s.name }}</option>
            </select>
          </label>
          <label class="text-sm sm:col-span-2">
            {{ t('admin.transfer.product') }}
            <select v-model="transferProductId" class="mt-1 min-h-12 w-full rounded-xl border px-3">
              <option v-for="p in products" :key="p.id" :value="p.id">{{ p.name }} ({{ p.sku }})</option>
            </select>
          </label>
          <label class="text-sm">
            {{ t('admin.transfer.qty') }}
            <input
              v-model.number="transferQty"
              class="mt-1 min-h-12 w-full rounded-xl border px-3 tabular-nums"
              type="number"
              min="1"
              step="1"
            />
          </label>
          <label class="text-sm">
            {{ t('admin.transfer.note') }}
            <input v-model="transferNote" class="mt-1 min-h-12 w-full rounded-xl border px-3" type="text" />
          </label>
          <button
            type="button"
            class="touch-target rounded-2xl bg-slate-900 text-sm font-semibold text-white sm:col-span-2"
            :disabled="busy"
            @click="runTransfer"
          >
            {{ t('admin.transfer.submit') }}
          </button>
        </div>
        <ul class="space-y-2 text-sm">
          <li v-for="x in transfers" :key="x.id" class="rounded-2xl bg-slate-50 px-4 py-3">
            <strong>{{ x.fromStore.code }} → {{ x.toStore.code }}</strong>
            · {{ x.lines.map((l) => `${l.product.name}×${l.qty}`).join(', ') }}
            <span class="text-slate-500">· {{ new Date(x.createdAt).toLocaleString() }}</span>
          </li>
          <li v-if="!transfers.length" class="text-slate-500">{{ t('admin.transfer.empty') }}</li>
        </ul>
      </UiPanel>

      <UiPanel v-else-if="tab === 'suppliers'" :title="t('admin.tabs.suppliers')">
        <p class="mb-4 text-sm text-slate-600">{{ t('admin.suppliers.hint') }}</p>
        <div
          v-if="canWrite"
          class="mb-4 grid gap-3 rounded-xl bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-5"
        >
          <input
            v-model="newSupplier.code"
            class="min-h-12 rounded-xl border border-slate-300 px-3"
            :placeholder="t('admin.suppliers.code')"
          />
          <input
            v-model="newSupplier.name"
            class="min-h-12 rounded-xl border border-slate-300 px-3"
            :placeholder="t('admin.suppliers.name')"
          />
          <input
            v-model="newSupplier.phone"
            class="min-h-12 rounded-xl border border-slate-300 px-3"
            :placeholder="t('admin.suppliers.phone')"
          />
          <input
            v-model="newSupplier.email"
            class="min-h-12 rounded-xl border border-slate-300 px-3"
            :placeholder="t('admin.suppliers.email')"
          />
          <button
            class="touch-target rounded-xl bg-emerald-600 font-semibold text-white"
            type="button"
            :disabled="busy"
            @click="addSupplier"
          >
            {{ t('admin.suppliers.add') }}
          </button>
        </div>
        <ul class="space-y-2">
          <li
            v-for="s in suppliers"
            :key="s.id"
            class="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-slate-50 px-4 py-3"
          >
            <div>
              <strong>{{ s.code }}</strong> · {{ s.name }}
              <span class="text-slate-500">
                · {{ s.isActive ? t('admin.active') : t('admin.inactive') }}
              </span>
              <p v-if="s.phone || s.email" class="text-xs text-slate-500">
                {{ [s.phone, s.email].filter(Boolean).join(' · ') }}
              </p>
            </div>
            <button
              v-if="canWrite"
              type="button"
              class="touch-target rounded-xl bg-white px-3 text-sm font-semibold ring-1 ring-slate-200"
              :disabled="busy"
              @click="toggleSupplierActive(s)"
            >
              {{ s.isActive ? t('admin.suppliers.deactivate') : t('admin.suppliers.activate') }}
            </button>
          </li>
          <li v-if="!suppliers.length" class="text-slate-500">{{ t('admin.suppliers.empty') }}</li>
        </ul>
      </UiPanel>

      <UiPanel v-else-if="tab === 'purchasing'" :title="t('admin.tabs.purchasing')">
        <p class="mb-4 text-sm text-slate-600">{{ t('admin.purchasing.hint') }}</p>

        <div
          v-if="canWrite"
          class="mb-6 space-y-3 rounded-xl bg-slate-50 p-4"
        >
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label class="text-sm font-medium text-slate-700">
              {{ t('admin.purchasing.supplier') }}
              <select v-model="poSupplierId" class="mt-1 min-h-12 w-full rounded-xl border px-3">
                <option
                  v-for="s in suppliers.filter((x) => x.isActive)"
                  :key="s.id"
                  :value="s.id"
                >
                  {{ s.code }} — {{ s.name }}
                </option>
              </select>
            </label>
            <label class="text-sm font-medium text-slate-700">
              {{ t('admin.purchasing.store') }}
              <select v-model="poStoreId" class="mt-1 min-h-12 w-full rounded-xl border px-3">
                <option v-for="s in stores" :key="s.id" :value="s.id">{{ s.code }} — {{ s.name }}</option>
              </select>
            </label>
            <label class="text-sm font-medium text-slate-700 sm:col-span-2">
              {{ t('admin.purchasing.note') }}
              <input v-model="poNote" class="mt-1 min-h-12 w-full rounded-xl border px-3" type="text" />
            </label>
          </div>
          <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <label class="text-sm font-medium text-slate-700 lg:col-span-2">
              {{ t('admin.purchasing.product') }}
              <select v-model="poProductId" class="mt-1 min-h-12 w-full rounded-xl border px-3">
                <option v-for="p in products" :key="p.id" :value="p.id">{{ p.sku }} — {{ p.name }}</option>
              </select>
            </label>
            <label class="text-sm font-medium text-slate-700">
              {{ t('admin.purchasing.qty') }}
              <input
                v-model.number="poQty"
                class="mt-1 min-h-12 w-full rounded-xl border px-3"
                type="number"
                step="1"
                min="1"
              />
            </label>
            <label class="text-sm font-medium text-slate-700">
              {{ t('admin.purchasing.unitCost') }}
              <input
                v-model.number="poUnitCost"
                class="mt-1 min-h-12 w-full rounded-xl border px-3"
                type="number"
                step="1"
                min="0"
              />
            </label>
            <button
              type="button"
              class="touch-target self-end rounded-xl bg-slate-900 font-semibold text-white"
              @click="addPoLine"
            >
              {{ t('admin.purchasing.addLine') }}
            </button>
          </div>
          <ul v-if="poLines.length" class="space-y-1 text-sm">
            <li
              v-for="(line, idx) in poLines"
              :key="`${line.productId}-${idx}`"
              class="flex items-center justify-between rounded-lg bg-white px-3 py-2"
            >
              <span>
                {{ line.productName }} × {{ line.qtyOrdered }} @
                {{ formatIdrFromCents(line.unitCostInCents) }}
              </span>
              <button type="button" class="text-red-600" @click="removePoLine(idx)">×</button>
            </li>
          </ul>
          <div class="flex flex-wrap gap-2">
            <button
              type="button"
              class="touch-target rounded-xl bg-white px-4 font-semibold ring-1 ring-slate-300"
              :disabled="busy || !poLines.length"
              @click="submitPurchaseOrder(false)"
            >
              {{ t('admin.purchasing.createDraft') }}
            </button>
            <button
              type="button"
              class="touch-target rounded-xl bg-emerald-600 px-4 font-semibold text-white"
              :disabled="busy || !poLines.length"
              @click="submitPurchaseOrder(true)"
            >
              {{ t('admin.purchasing.createOrdered') }}
            </button>
          </div>
        </div>

        <ul class="space-y-4">
          <li
            v-for="o in purchaseOrders"
            :key="o.id"
            class="rounded-2xl border border-slate-200 bg-white p-4"
          >
            <div class="flex flex-wrap items-start justify-between gap-2">
              <div>
                <strong>{{ o.code }}</strong>
                · {{ t(`admin.purchasing.status.${o.status}`) }}
                · {{ o.supplier.code }} → {{ o.store.code }}
                <p class="text-sm text-slate-600">
                  {{ t('admin.purchasing.subtotal') }}:
                  {{ formatIdrFromCents(o.subtotalInCents) }}
                  <span class="text-slate-400">· {{ new Date(o.createdAt).toLocaleString() }}</span>
                </p>
              </div>
              <div v-if="canWrite" class="flex flex-wrap gap-2">
                <button
                  v-if="o.status === 'DRAFT'"
                  type="button"
                  class="touch-target rounded-xl bg-slate-900 px-3 text-sm font-semibold text-white"
                  :disabled="busy"
                  @click="confirmPo(o.id)"
                >
                  {{ t('admin.purchasing.confirm') }}
                </button>
                <button
                  v-if="o.status === 'DRAFT' || o.status === 'ORDERED'"
                  type="button"
                  class="touch-target rounded-xl bg-white px-3 text-sm font-semibold text-red-700 ring-1 ring-red-200"
                  :disabled="busy"
                  @click="cancelPo(o.id)"
                >
                  {{ t('admin.purchasing.cancel') }}
                </button>
              </div>
            </div>

            <ul class="mt-3 space-y-2 text-sm">
              <li
                v-for="line in o.lines"
                :key="line.id"
                class="grid gap-2 rounded-xl bg-slate-50 px-3 py-2 sm:grid-cols-[1fr_auto_auto]"
              >
                <span>
                  {{ line.product.name }}
                  · {{ line.qtyReceived }}/{{ line.qtyOrdered }}
                  · {{ formatIdrFromCents(line.unitCostInCents) }}
                  <span class="text-slate-500">
                    ({{ t('admin.purchasing.remaining') }}
                    {{ line.qtyOrdered - line.qtyReceived }})
                  </span>
                </span>
                <template v-if="canWrite && (o.status === 'ORDERED' || o.status === 'PARTIAL')">
                  <input
                    v-model.number="receiveQty[line.id]"
                    class="min-h-10 w-24 rounded-lg border px-2"
                    type="number"
                    step="1"
                    min="0"
                    :max="line.qtyOrdered - line.qtyReceived"
                    :aria-label="t('admin.purchasing.receiveQty')"
                  />
                </template>
              </li>
            </ul>

            <div
              v-if="canWrite && (o.status === 'ORDERED' || o.status === 'PARTIAL')"
              class="mt-3 flex flex-wrap items-end gap-3"
            >
              <label class="text-sm font-medium text-slate-700">
                {{ t('admin.purchasing.store') }}
                <select
                  v-model="receiveStoreId[o.id]"
                  class="mt-1 min-h-12 rounded-xl border px-3"
                >
                  <option v-for="s in stores" :key="s.id" :value="s.id">
                    {{ s.code }} — {{ s.name }}
                  </option>
                </select>
              </label>
              <button
                type="button"
                class="touch-target rounded-xl bg-emerald-600 px-4 font-semibold text-white"
                :disabled="busy"
                @click="receivePo(o)"
              >
                {{ t('admin.purchasing.receive') }}
              </button>
            </div>

            <p v-if="o.receipts?.length" class="mt-3 text-xs text-slate-500">
              {{ t('admin.purchasing.receipts') }}:
              {{ o.receipts.map((r) => r.code).join(', ') }}
            </p>
          </li>
          <li v-if="!purchaseOrders.length" class="text-slate-500">
            {{ t('admin.purchasing.empty') }}
          </li>
        </ul>
      </UiPanel>

      <UiPanel v-else-if="tab === 'edge'" :title="t('admin.tabs.edge')">
        <div v-if="edgeStatus" class="space-y-3 text-sm">
          <p>
            {{ t('admin.edge.enabled') }}:
            <strong>{{ edgeStatus.enabled ? 'yes' : 'no' }}</strong>
            (flag {{ edgeStatus.featureFlag ? 'on' : 'off' }})
          </p>
          <p>{{ t('admin.edge.pending') }}: {{ edgeStatus.pending }}</p>
          <p>{{ t('admin.edge.delivered') }}: {{ edgeStatus.delivered }}</p>
          <p>{{ t('admin.edge.hub') }}: {{ edgeStatus.hubUrl || '—' }}</p>
          <button
            type="button"
            class="touch-target rounded-2xl bg-slate-900 px-4 font-semibold text-white"
            :disabled="busy"
            @click="runEdgePush"
          >
            {{ t('admin.edge.push') }}
          </button>
        </div>
        <p v-else class="text-sm text-slate-500">{{ t('admin.edge.unavailable') }}</p>
      </UiPanel>

      <UiPanel v-else :title="t('admin.tabs.audit')" :padded="false">
        <div class="overflow-x-auto">
          <table class="min-w-full text-left text-sm">
            <thead class="border-b border-slate-200 bg-slate-50 text-slate-600">
              <tr>
                <th class="px-4 py-3 font-medium">{{ t('admin.time') }}</th>
                <th class="px-4 py-3 font-medium">{{ t('admin.action') }}</th>
                <th class="px-4 py-3 font-medium">{{ t('admin.actor') }}</th>
                <th class="px-4 py-3 font-medium">{{ t('admin.reason') }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in audit" :key="row.id" class="border-b border-slate-100 last:border-0">
                <td class="px-4 py-3 tabular-nums text-slate-600">
                  {{ new Date(row.createdAt).toLocaleString() }}
                </td>
                <td class="px-4 py-3 font-medium">{{ row.action }}</td>
                <td class="px-4 py-3">
                  {{ row.actor?.displayName || t('common.empty') }}
                </td>
                <td class="px-4 py-3 text-slate-600">
                  {{ row.reason || t('common.empty') }}
                  <span v-if="row.amountInCents != null" class="ml-1 tabular-nums">
                    · {{ formatIdrFromCents(row.amountInCents) }}
                  </span>
                </td>
              </tr>
              <tr v-if="!audit.length">
                <td class="px-4 py-8 text-slate-500" colspan="4">{{ t('admin.emptyAudit') }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </UiPanel>
    </template>
  </main>
</template>
