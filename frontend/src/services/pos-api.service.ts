import { apiGet, apiPost } from '../api/client';
import type { Permission, StaffRole } from '../auth/permissions';
import type { CachedCategory, CachedProduct, PaymentMethod } from '../db/pos-types';

export type ActiveShift = {
  id: string;
  storeId: string;
  cashierUserId: string;
  status: 'OPEN' | 'CLOSED';
  clockInAt: string;
  openingFloatInCents: number;
  cashSalesInCents: number;
  saleCount: number;
};

export type PosBootstrap = {
  tenant: { id: string; slug: string; name: string };
  store: { id: string; code: string; name: string; qrisPayload?: string | null } | null;
  stores?: Array<{ id: string; code: string; name: string }>;
  cashier: {
    id: string;
    displayName: string;
    role: StaffRole;
    email: string;
    permissions: Permission[];
  } | null;
  activeShift: ActiveShift | null;
  categories: CachedCategory[];
  products: CachedProduct[];
};

export type SyncSalePayload = {
  id: string;
  storeId: string;
  cashierUserId?: string | null;
  shiftId?: string | null;
  cartClientUuid: string;
  customerId?: string | null;
  paymentMethod: PaymentMethod;
  tipInCents?: number;
  payments?: Array<{
    paymentMethod: Exclude<PaymentMethod, 'SPLIT'>;
    amountInCents: number;
    amountTenderedInCents?: number;
  }>;
  clientCreatedAt: string;
  lines: Array<{ productId: string; quantity: number; modifierOptionIds?: string[] }>;
  subtotalInCents: number;
  taxInCents: number;
  discountInCents?: number;
  totalInCents: number;
};

export type UpsertCartPayload = {
  clientUuid: string;
  storeId: string;
  cashierUserId?: string | null;
  customerId?: string | null;
  label?: string | null;
  parkedAt?: string | null;
  status?: 'OPEN' | 'CHECKED_OUT' | 'ABANDONED';
  /** Device wall-clock for last-write-wins on the server. */
  clientUpdatedAt?: string;
  lines: Array<{ productId: string; quantity: number; modifierOptionIds?: string[] }>;
};

export type ZReport = {
  reportType?: 'X' | 'Z';
  shift: {
    id: string;
    status: string;
    clockInAt: string;
    clockOutAt: string | null;
    cashier: { id: string; displayName: string; email: string; role: string };
    store: { id: string; code: string; name: string };
  };
  sales: {
    count: number;
    cashInCents: number;
    cardInCents: number;
    qrisInCents: number;
    otherInCents: number;
    grossInCents: number;
    voidInCents: number;
    discountInCents: number;
    netInCents: number;
    cashRefundsInCents?: number;
    tipsInCents?: number;
  };
  drawer: {
    openingFloatInCents: number;
    cashDropsInCents?: number;
    expectedCashInCents: number;
    countedCashInCents: number | null;
    discrepancyInCents: number | null;
  };
};

export type ShiftArchiveItem = {
  shiftId: string;
  status: 'OPEN' | 'CLOSED';
  clockInAt: string;
  clockOutAt: string | null;
  cashier: { id: string; displayName: string; email: string };
  store: { id: string; code: string; name: string };
  saleCount: number;
  grossSalesInCents: number;
  openingFloatInCents: number;
  expectedCashInCents: number;
  countedCashInCents: number | null;
  discrepancyInCents: number | null;
};

export type ShiftArchiveResponse = {
  from: string;
  to: string;
  scope: string;
  items: ShiftArchiveItem[];
};

export function fetchBootstrap(storeId?: string | null): Promise<PosBootstrap> {
  const q = storeId ? `?storeId=${encodeURIComponent(storeId)}` : '';
  return apiGet<PosBootstrap>(`/pos/bootstrap${q}`);
}

export function postCart(payload: UpsertCartPayload) {
  return apiPost('/pos/carts', payload);
}

export function postSaleSync(payload: SyncSalePayload) {
  return apiPost<{ duplicate: boolean }>('/pos/sales/sync', payload);
}

export function clockIn(storeId: string, openingFloatInCents: number) {
  return apiPost<ActiveShift>('/shifts/clock-in', { storeId, openingFloatInCents });
}

export function clockOut(shiftId: string, countedCashInCents: number) {
  return apiPost<ActiveShift>('/shifts/clock-out', { shiftId, countedCashInCents });
}

export function fetchActiveShift() {
  return apiGet<ActiveShift | null>('/shifts/active');
}

export function fetchZReport(shiftId: string) {
  return apiGet<ZReport>(`/shifts/${shiftId}/z-report`);
}

export function fetchXReport(shiftId: string) {
  return apiGet<ZReport>(`/shifts/${shiftId}/x-report`);
}

export function fetchShiftArchive(opts?: {
  from?: string;
  to?: string;
  storeId?: string;
  status?: 'OPEN' | 'CLOSED' | 'ALL';
}) {
  const q = new URLSearchParams();
  if (opts?.from) q.set('from', opts.from);
  if (opts?.to) q.set('to', opts.to);
  if (opts?.storeId) q.set('storeId', opts.storeId);
  if (opts?.status) q.set('status', opts.status);
  const suffix = q.toString() ? `?${q}` : '';
  return apiGet<ShiftArchiveResponse>(`/shifts/archive${suffix}`);
}

export function postCashDrop(shiftId: string, amountInCents: number, note?: string) {
  return apiPost<{
    expectedCashInCents: number;
    movement: { id: string; amountInCents: number };
  }>(`/shifts/${shiftId}/cash-drop`, { amountInCents, note });
}

export function postMidCount(shiftId: string, countedCashInCents: number, note?: string) {
  return apiPost<{
    expectedCashInCents: number;
    countedCashInCents: number;
    varianceInCents: number;
  }>(`/shifts/${shiftId}/mid-count`, { countedCashInCents, note });
}

export function voidSale(saleId: string, supervisorPin: string, reason?: string) {
  return apiPost('/pos/sales/void', { saleId, supervisorPin, reason });
}

export function refundSale(saleId: string, supervisorPin: string, reason?: string) {
  return apiPost('/pos/sales/refund', { saleId, supervisorPin, reason });
}

export function applyDiscount(
  saleId: string,
  discountInCents: number,
  supervisorPin: string,
  reason?: string,
) {
  return apiPost('/pos/sales/discount', {
    saleId,
    discountInCents,
    supervisorPin,
    reason,
  });
}

export function forceOpenDrawer(supervisorPin: string, reason?: string) {
  return apiPost<{ authorized: boolean; escPosKickHex: string }>('/pos/drawer/force-open', {
    supervisorPin,
    reason,
  });
}

export function removeCartItemAuthorized(body: {
  cartClientUuid: string;
  productId: string;
  productName?: string;
  quantity?: number;
  unitPriceInCents?: number;
  supervisorPin: string;
  reason?: string;
}) {
  return apiPost('/pos/cart/remove-item', body);
}

export function overrideCartPriceAuthorized(body: {
  cartClientUuid: string;
  productId: string;
  productName?: string;
  originalPriceInCents: number;
  newPriceInCents: number;
  supervisorPin: string;
  reason?: string;
}) {
  return apiPost('/pos/cart/price-override', body);
}
