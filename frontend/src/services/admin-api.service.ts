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
  productType?: 'RETAIL' | 'MENU' | 'INGREDIENT';
  kitchenStationId?: string | null;
  category?: { id: string; name: string };
  modifierGroups?: AdminModifierGroup[];
  variants?: ProductVariant[];
};

export type AdminStaff = {
  id: string;
  email: string;
  displayName: string;
  role: string;
  isActive: boolean;
  hasPin?: boolean;
  kitchenStationIds?: string[];
  createdAt: string;
  updatedAt?: string;
};

export type AdminStore = {
  id: string;
  code: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  timezone?: string | null;
  receiptHeader?: string | null;
  receiptFooter?: string | null;
  isActive?: boolean;
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
  productType?: 'RETAIL' | 'MENU' | 'INGREDIENT';
  kitchenStationId?: string | null;
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
    productType: 'RETAIL' | 'MENU' | 'INGREDIENT';
    kitchenStationId: string | null;
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
  kitchenStationIds?: string[];
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
    kitchenStationIds?: string[];
  },
) {
  return apiPatch<AdminStaff>(`/admin/staff/${id}`, body);
}

export function fetchAdminStores() {
  return apiGet<AdminStore[]>('/admin/stores');
}

export function createAdminStore(body: {
  code: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  timezone?: string | null;
  receiptHeader?: string | null;
  receiptFooter?: string | null;
  qrisPayload?: string | null;
  isActive?: boolean;
}) {
  return apiPost<AdminStore>('/admin/stores', body);
}

export function updateAdminStore(
  id: string,
  body: Partial<{
    name: string;
    address: string | null;
    phone: string | null;
    timezone: string | null;
    receiptHeader: string | null;
    receiptFooter: string | null;
    qrisPayload: string | null;
    isActive: boolean;
  }>,
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
  status: 'DRAFT' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';
  fromStore: { id: string; code: string; name: string };
  toStore: { id: string; code: string; name: string };
  note: string | null;
  shippedAt?: string | null;
  receivedAt?: string | null;
  createdAt: string;
  lines: Array<{
    qty: number;
    product: { id: string; sku: string; name: string };
  }>;
  createdBy: { id: string; displayName: string };
};

export type ProductVariant = {
  id: string;
  productId: string;
  sku: string;
  name: string;
  barcode: string | null;
  unitPriceInCents: number;
  sortOrder: number;
  isActive: boolean;
  stockQty?: number;
};

export function fetchStockTransfers() {
  return apiGet<StockTransfer[]>('/admin/stock-transfers');
}

export function createStockTransfer(body: {
  fromStoreId: string;
  toStoreId: string;
  note?: string;
  mode?: 'draft' | 'in_transit' | 'immediate';
  lines: Array<{ productId: string; qty: number }>;
}) {
  return apiPost<StockTransfer>('/admin/stock-transfers', body);
}

export function shipStockTransfer(id: string) {
  return apiPost<StockTransfer>(`/admin/stock-transfers/${id}/ship`, {});
}

export function receiveStockTransfer(id: string) {
  return apiPost<StockTransfer>(`/admin/stock-transfers/${id}/receive`, {});
}

export function cancelStockTransfer(id: string) {
  return apiPost<StockTransfer>(`/admin/stock-transfers/${id}/cancel`, {});
}

export function createProductVariant(
  productId: string,
  body: {
    sku: string;
    name: string;
    barcode?: string | null;
    unitPriceInCents: number;
    sortOrder?: number;
    isActive?: boolean;
    initialQtyByStore?: Array<{ storeId: string; qty: number }>;
  },
) {
  return apiPost<ProductVariant>(`/admin/products/${productId}/variants`, body);
}

export function updateProductVariant(
  id: string,
  body: Partial<{
    name: string;
    barcode: string | null;
    unitPriceInCents: number;
    sortOrder: number;
    isActive: boolean;
  }>,
) {
  return apiPatch<ProductVariant>(`/admin/variants/${id}`, body);
}

export function fetchAuditLogs(limit = 50) {
  return apiGet<AuditLogRow[]>(`/audit/logs?limit=${limit}`);
}

export type GlAccount = {
  id: string;
  code: string;
  name: string;
  type: string;
  isActive?: boolean;
};

export type GlAccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'REVENUE' | 'EXPENSE';

export type JournalEntry = {
  id: string;
  sourceType: string;
  sourceId: string;
  memo: string | null;
  postedAt: string;
  lines: Array<{
    accountCode: string;
    debitInCents: number;
    creditInCents: number;
    memo: string | null;
  }>;
};

export function fetchGlAccounts(includeInactive = false) {
  const q = includeInactive ? '?includeInactive=1' : '';
  return apiGet<GlAccount[]>(`/gl/accounts${q}`);
}

export function createGlAccount(body: {
  code: string;
  name: string;
  type: GlAccountType;
}) {
  return apiPost<GlAccount>('/gl/accounts', body);
}

export function updateGlAccount(
  id: string,
  body: { code?: string; name?: string; type?: GlAccountType },
) {
  return apiPatch<GlAccount>(`/gl/accounts/${encodeURIComponent(id)}`, body);
}

export function deactivateGlAccount(id: string) {
  return apiPost<GlAccount>(`/gl/accounts/${encodeURIComponent(id)}/deactivate`);
}

export function activateGlAccount(id: string) {
  return apiPost<GlAccount>(`/gl/accounts/${encodeURIComponent(id)}/activate`);
}

export function fetchJournalEntries(limit = 50) {
  return apiGet<JournalEntry[]>(`/gl/entries?limit=${limit}`);
}

export type TenantBranding = {
  tenantId: string;
  slug: string;
  brandName: string;
  logoUrl: string | null;
  accentColor: string | null;
};

/** Public — used on login before JWT. */
export function fetchPublicBranding() {
  return apiGet<TenantBranding>('/tenants/branding', { silent: true });
}

export function fetchTenantBranding() {
  return apiGet<TenantBranding>('/tenants/current/branding');
}

export function updateTenantBranding(body: {
  brandName?: string | null;
  logoUrl?: string | null;
  accentColor?: string | null;
}) {
  return apiPatch<TenantBranding>('/tenants/current/branding', body);
}
