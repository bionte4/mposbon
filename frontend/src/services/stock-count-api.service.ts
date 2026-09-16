import { apiGet, apiPatch, apiPost } from '../api/client';

export type StockCountLine = {
  id: string;
  productId: string;
  productSku: string;
  productName: string;
  systemQty: number;
  countedQty: number | null;
  varianceQty: number | null;
};

export type StockCountSession = {
  id: string;
  code: string;
  status: 'DRAFT' | 'COMPLETED' | 'CANCELLED';
  note: string | null;
  createdAt: string;
  completedAt: string | null;
  store: { id: string; code: string; name: string };
  createdBy: { id: string; displayName: string };
  completedBy: { id: string; displayName: string } | null;
  lines?: StockCountLine[];
  _count?: { lines: number };
};

export function fetchStockCounts(storeId?: string): Promise<StockCountSession[]> {
  const q = storeId ? `?storeId=${encodeURIComponent(storeId)}` : '';
  return apiGet(`/stock-counts${q}`);
}

export function fetchStockCount(id: string): Promise<StockCountSession> {
  return apiGet(`/stock-counts/${id}`);
}

export function createStockCount(body: {
  storeId: string;
  note?: string;
}): Promise<StockCountSession> {
  return apiPost('/stock-counts', body);
}

export function updateStockCountLine(
  sessionId: string,
  body: { lineId: string; countedQty: number },
): Promise<StockCountSession> {
  return apiPatch(`/stock-counts/${sessionId}/lines`, body);
}

export function completeStockCount(sessionId: string): Promise<StockCountSession> {
  return apiPost(`/stock-counts/${sessionId}/complete`, {});
}

export function cancelStockCount(sessionId: string): Promise<StockCountSession> {
  return apiPost(`/stock-counts/${sessionId}/cancel`, {});
}
