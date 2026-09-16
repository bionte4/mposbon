export type PaymentMethod = 'CASH' | 'CARD' | 'QRIS' | 'OTHER' | 'SPLIT';

export type CachedCategory = {
  id: string;
  tenantId: string;
  name: string;
  sortOrder: number;
};

export type CachedModifierOption = {
  id: string;
  name: string;
  priceDeltaInCents: number;
  sortOrder: number;
};

export type CachedModifierGroup = {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  sortOrder: number;
  options: CachedModifierOption[];
};

export type CachedProduct = {
  id: string;
  tenantId: string;
  categoryId: string;
  sku: string;
  barcode: string | null;
  name: string;
  unitPriceInCents: number;
  taxBps: number;
  stockQty: number;
  isActive: boolean;
  modifierGroups: CachedModifierGroup[];
};

export type ModifierSnapshot = {
  optionId: string;
  name: string;
  priceDeltaInCents: number;
};

export type LocalCartItem = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceInCents: number;
  taxBps: number;
  taxInCents: number;
  lineSubtotalInCents: number;
  lineTotalInCents: number;
  modifiers: ModifierSnapshot[];
  /** 1-based guest/seat for bill split. */
  guestIndex: number;
};

export type LocalCart = {
  clientUuid: string;
  tenantId: string;
  storeId: string;
  cashierUserId: string | null;
  customerId: string | null;
  customerName: string | null;
  label: string | null;
  parkedAt: string | null;
  status: 'OPEN' | 'CHECKED_OUT' | 'ABANDONED';
  items: LocalCartItem[];
  subtotalInCents: number;
  taxInCents: number;
  totalInCents: number;
  updatedAt: string;
};

export type LocalSale = {
  id: string;
  tenantId: string;
  storeId: string;
  cashierUserId: string | null;
  shiftId: string | null;
  cartClientUuid: string;
  customerId: string | null;
  paymentMethod: PaymentMethod;
  clientCreatedAt: string;
  subtotalInCents: number;
  taxInCents: number;
  discountInCents: number;
  tipInCents: number;
  totalInCents: number;
  syncStatus: 'pending' | 'synced' | 'error';
  lines: LocalCartItem[];
};

export type SyncJobType = 'cart.upsert' | 'sale.sync';

/**
 * IndexedDB sync queue entry.
 * - `id`: unique job UUID (dedupe / delete)
 * - `entityId`: business UUID (sale id or cart clientUuid) — prevents duplicate entities
 * - `clientTimestamp`: wall-clock on device when the event happened
 * - `createdAt`: when the job entered the queue (FIFO ordering)
 */
export type SyncJob = {
  id: string;
  type: SyncJobType;
  entityId: string;
  clientTimestamp: string;
  createdAt: string;
  attempts: number;
  lastError: string | null;
  payload: unknown;
};

export type PosSession = {
  id: 'current';
  tenantId: string;
  tenantSlug: string;
  storeId: string;
  storeName: string;
  /** Static QRIS EMVCo payload for merchant-presented QR at checkout. */
  qrisPayload: string | null;
  cashierUserId: string | null;
  cashierName: string | null;
  shiftId: string | null;
};

export type PosCustomer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  loyaltyPoints: number;
};
