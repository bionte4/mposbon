import { apiDownload, apiGet } from '../api/client';

export type DashboardOverview = {
  scope: 'store' | 'cashier';
  from?: string;
  to?: string;
  metrics: {
    grossSalesInCents: number;
    netSalesInCents: number;
    discountInCents: number;
    voidInCents: number;
    transactionCount: number;
    aovInCents: number;
  };
  series: Array<{
    date: string;
    storeId?: string;
    grossSalesInCents: number;
    netSalesInCents: number;
    transactionCount: number;
  }>;
  drawer?: {
    shiftId: string;
    status: string;
    openingFloatInCents: number;
    expectedCashInCents: number;
    countedCashInCents: number | null;
    discrepancyInCents: number | null;
  } | null;
  source: string;
};

export type TopProductsResponse = {
  scope: string;
  items: Array<{
    productId: string;
    productName: string;
    quantitySold: number;
    revenueInCents: number;
  }>;
  source?: string;
};

export type ShiftWidgets = {
  openShifts: Array<{
    shiftId: string;
    clockInAt: string;
    cashier: { id: string; displayName: string; email: string };
    store: { id: string; code: string; name: string };
    saleCount: number;
    cashSalesInCents: number;
    openingFloatInCents: number;
    expectedCashInCents: number;
  }>;
  zReports: Array<{
    shiftId: string;
    status: string;
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
  }>;
  discrepancyAlertCount: number;
};

export function fetchDashboardOverview(opts?: {
  from?: string;
  to?: string;
  storeId?: string;
}) {
  const q = new URLSearchParams();
  if (opts?.from) q.set('from', opts.from);
  if (opts?.to) q.set('to', opts.to);
  if (opts?.storeId) q.set('storeId', opts.storeId);
  const suffix = q.toString() ? `?${q}` : '';
  return apiGet<DashboardOverview>(`/analytics/overview${suffix}`);
}

export function fetchTopProducts(opts?: {
  from?: string;
  to?: string;
  storeId?: string;
  limit?: number;
}) {
  const q = new URLSearchParams();
  if (opts?.from) q.set('from', opts.from);
  if (opts?.to) q.set('to', opts.to);
  if (opts?.storeId) q.set('storeId', opts.storeId);
  q.set('limit', String(opts?.limit ?? 5));
  return apiGet<TopProductsResponse>(`/analytics/top-products?${q}`);
}

export function fetchShiftWidgets() {
  return apiGet<ShiftWidgets>('/analytics/shifts');
}

export function downloadJournalCsv(opts?: {
  from?: string;
  to?: string;
  storeId?: string;
}) {
  const q = new URLSearchParams();
  if (opts?.from) q.set('from', opts.from);
  if (opts?.to) q.set('to', opts.to);
  if (opts?.storeId) q.set('storeId', opts.storeId);
  const suffix = q.toString() ? `?${q}` : '';
  const stamp = new Date().toISOString().slice(0, 10);
  return apiDownload(`/analytics/export/journal.csv${suffix}`, `bonpos-journal-${stamp}.csv`);
}

export function downloadSalesCsv(opts?: {
  from?: string;
  to?: string;
  storeId?: string;
}) {
  const q = new URLSearchParams();
  if (opts?.from) q.set('from', opts.from);
  if (opts?.to) q.set('to', opts.to);
  if (opts?.storeId) q.set('storeId', opts.storeId);
  const suffix = q.toString() ? `?${q}` : '';
  const stamp = new Date().toISOString().slice(0, 10);
  return apiDownload(`/analytics/export/sales.csv${suffix}`, `bonpos-sales-${stamp}.csv`);
}
