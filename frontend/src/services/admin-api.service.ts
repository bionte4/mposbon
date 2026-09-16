import { apiDelete, apiGet, apiPatch, apiPost } from '../api/client';

export type AdminCategory = {
  id: string;
  name: string;
  sortOrder: number;
  _count?: { products: number };
};

export type AdminModifierOption = {
  id: string;
  groupId: string;
  name: string;
  priceDeltaInCents: number;
  isActive: boolean;
  sortOrder: number;
};

export type AdminModifierGroup = {
  id: string;
  productId: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  options: AdminModifierOption[];
};

export type AdminProduct = {
  id: string;
  categoryId: string;
  sku: string;
  barcode: string | null;
  name: string;
  unitPriceInCents: number;
  taxBps: number;
  stockQty: number;
  isActive: boolean;
  category?: { id: string; name: string };
  modifierGroups?: AdminModifierGroup[];
};

export type AdminStaff = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  isActive: boolean;
  hasPin?: boolean;
  createdAt: string;
  updatedAt?: string;
};

export type AdminStore = {
  id: string;
  code: string;
  name: string;
  qrisPayload: string | null;
  updatedAt?: string;
};

export type AuditLogRow = {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  amountInCents: number | null;
  reason: string | null;
  createdAt: string;
  actor: {
    id: string;
    displayName: string;
    email: string;
    role: string;
  } | null;
};

export function fetchAdminCategories() {
  return apiGet<AdminCategory[]>('/admin/categories');
}

export function createAdminCategory(body: { name: string; sortOrder?: number }) {
  return apiPost<AdminCategory>('/admin/categories', body);
}

export function updateAdminCategory(
  id: string,
  body: { name?: string; sortOrder?: number },
) {
  return apiPatch<AdminCategory>(`/admin/categories/${id}`, body);
}

export function deleteAdminCategory(id: string) {
  return apiDelete<{ id: string; deleted: boolean }>(`/admin/categories/${id}`);
}

export function fetchAdminProducts() {
  return apiGet<AdminProduct[]>('/admin/products');
}

export function createAdminProduct(body: {
  categoryId: string;
  sku: string;
  barcode?: string | null;
  name: string;
  unitPriceInCents: number;
  taxBps?: number;
  stockQty?: number;
  isActive?: boolean;
}) {
  return apiPost<AdminProduct>('/admin/products', body);
}

export function updateAdminProduct(
  id: string,
  body: Partial<{
    categoryId: string;
    sku: string;
    barcode: string | null;
    name: string;
    unitPriceInCents: number;
    taxBps: number;
    stockQty: number;
    isActive: boolean;
  }>,
) {
  return apiPatch<AdminProduct>(`/admin/products/${id}`, body);
}

export function createModifierGroup(
  productId: string,
  body: {
    name: string;
    minSelect?: number;
    maxSelect?: number;
    sortOrder?: number;
  },
) {
  return apiPost<AdminModifierGroup>(`/admin/products/${productId}/modifier-groups`, body);
}

export function updateModifierGroup(
  id: string,
  body: {
    name?: string;
    minSelect?: number;
    maxSelect?: number;
    sortOrder?: number;
  },
) {
  return apiPatch<AdminModifierGroup>(`/admin/modifier-groups/${id}`, body);
}

export function deleteModifierGroup(id: string) {
  return apiDelete<{ id: string; deleted: boolean }>(`/admin/modifier-groups/${id}`);
}

export function createModifierOption(
  groupId: string,
  body: {
    name: string;
    priceDeltaInCents?: number;
    sortOrder?: number;
    isActive?: boolean;
  },
) {
  return apiPost<AdminModifierOption>(`/admin/modifier-groups/${groupId}/options`, body);
}

export function updateModifierOption(
  id: string,
  body: {
    name?: string;
    priceDeltaInCents?: number;
    sortOrder?: number;
    isActive?: boolean;
  },
) {
  return apiPatch<AdminModifierOption>(`/admin/modifier-options/${id}`, body);
}

export function deleteModifierOption(id: string) {
  return apiDelete<{ id: string; deleted: boolean }>(`/admin/modifier-options/${id}`);
}

export function fetchAdminStaff() {
  return apiGet<AdminStaff[]>('/admin/staff');
}

export function createAdminStaff(body: {
  email: string;
  displayName: string;
  role: string;
  pin: string;
  isActive?: boolean;
}) {
  return apiPost<AdminStaff>('/admin/staff', body);
}

export function updateAdminStaff(
  id: string,
  body: {
    email?: string;
    displayName?: string;
    role?: string;
    pin?: string | null;
    isActive?: boolean;
  },
) {
  return apiPatch<AdminStaff>(`/admin/staff/${id}`, body);
}

export function fetchAdminStores() {
  return apiGet<AdminStore[]>('/admin/stores');
}

export function updateAdminStore(
  id: string,
  body: { qrisPayload?: string | null },
) {
  return apiPatch<AdminStore>(`/admin/stores/${id}`, body);
}

export type StoreInventoryItem = {
  productId: string;
  sku: string;
  name: string;
  barcode: string | null;
  isActive: boolean;
  category: { id: string; name: string } | null;
  catalogStockQty: number;
  onHandQty: number;
  hasStoreStockRow: boolean;
  catalogUnitPriceInCents: number;
  storeUnitPriceInCents: number | null;
  effectiveUnitPriceInCents: number;
  stockUpdatedAt: string | null;
  priceUpdatedAt: string | null;
};

export type StoreInventoryResponse = {
  store: { id: string; code: string; name: string };
  items: StoreInventoryItem[];
};

export function fetchStoreInventory(storeId: string) {
  return apiGet<StoreInventoryResponse>(`/admin/stores/${storeId}/inventory`);
}

export function patchStoreInventory(
  storeId: string,
  productId: string,
  body: {
    qty?: number;
    qtyDelta?: number;
    unitPriceInCents?: number | null;
    note?: string;
  },
) {
  return apiPatch<{
    storeId: string;
    productId: string;
    sku: string;
    name: string;
    onHandQty: number;
    catalogUnitPriceInCents: number;
    storeUnitPriceInCents: number | null;
    effectiveUnitPriceInCents: number;
  }>(`/admin/stores/${storeId}/inventory/${productId}`, body);
}

export type StockTransfer = {
  id: string;
  fromStore: { id: string; code: string; name: string };
  toStore: { id: string; code: string; name: string };
  note: string | null;
  createdAt: string;
  lines: Array<{
    qty: number;
    product: { id: string; sku: string; name: string };
  }>;
  createdBy: { id: string; displayName: string };
};

export function fetchStockTransfers() {
  return apiGet<StockTransfer[]>('/admin/stock-transfers');
}

export function createStockTransfer(body: {
  fromStoreId: string;
  toStoreId: string;
  note?: string;
  lines: Array<{ productId: string; qty: number }>;
}) {
  return apiPost<StockTransfer>('/admin/stock-transfers', body);
}

export function fetchAuditLogs(limit = 50) {
  return apiGet<AuditLogRow[]>(`/audit/logs?limit=${limit}`);
}
