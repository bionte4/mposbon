import { apiGet, apiPatch, apiPost } from '../api/client';

export type KitchenStation = {
  id: string;
  storeId: string;
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
};

export type KitchenTicketLine = {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  guestIndex: number;
  status: 'PENDING' | 'PREPARING' | 'READY' | 'DONE' | 'CANCELLED';
  modifiersJson: Array<{ name: string }> | null;
  station: { id: string; code: string; name: string };
  firedAt: string;
};

export type KitchenTicket = {
  orderId: string;
  storeId?: string;
  cartClientUuid: string;
  tableLabel: string | null;
  createdAt: string;
  lines: KitchenTicketLine[];
};

export function fetchKitchenStations(storeId: string): Promise<KitchenStation[]> {
  return apiGet(`/kitchen/stations?storeId=${encodeURIComponent(storeId)}`);
}

export function createKitchenStation(body: {
  storeId: string;
  code: string;
  name: string;
  sortOrder?: number;
}): Promise<KitchenStation> {
  return apiPost('/kitchen/stations', body);
}

export function updateKitchenStation(
  id: string,
  body: Partial<{ name: string; sortOrder: number; isActive: boolean }>,
): Promise<KitchenStation> {
  return apiPatch(`/kitchen/stations/${id}`, body);
}

export function fetchKitchenTickets(
  storeId: string,
  stationId?: string,
): Promise<KitchenTicket[]> {
  const q = stationId
    ? `?storeId=${encodeURIComponent(storeId)}&stationId=${encodeURIComponent(stationId)}`
    : `?storeId=${encodeURIComponent(storeId)}`;
  return apiGet(`/kitchen/tickets${q}`);
}

export function fireToKitchen(body: {
  storeId: string;
  cartClientUuid: string;
  tableLabel?: string | null;
  lines: Array<{
    clientLineId: string;
    productId: string;
    productName: string;
    quantity: number;
    guestIndex?: number;
    modifiers?: Array<{ optionId: string; name: string; priceDeltaInCents: number }>;
  }>;
}): Promise<KitchenTicket[]> {
  return apiPost('/kitchen/fire', body);
}

export function bumpKitchenLine(
  lineId: string,
  status: 'PREPARING' | 'READY' | 'DONE' | 'CANCELLED',
): Promise<KitchenTicketLine> {
  return apiPatch(`/kitchen/lines/${lineId}/status`, { status });
}
