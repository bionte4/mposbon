import { apiGet, apiPatch, apiPost } from '../api/client';

export type Supplier = {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PurchaseOrderLine = {
  id: string;
  qtyOrdered: number;
  qtyReceived: number;
  unitCostInCents: number;
  lineTotalInCents: number;
  product: { id: string; sku: string; name: string };
};

export type GoodsReceipt = {
  id: string;
  code: string;
  note: string | null;
  createdAt: string;
  store: { id: string; code: string; name: string };
  createdBy: { id: string; displayName: string };
  lines: Array<{
    qty: number;
    unitCostInCents: number;
    product: { id: string; sku: string; name: string };
  }>;
};

export type PurchaseOrder = {
  id: string;
  code: string;
  status: 'DRAFT' | 'ORDERED' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED';
  note: string | null;
  subtotalInCents: number;
  orderedAt: string | null;
  receivedAt: string | null;
  cancelledAt: string | null;
  createdAt: string;
  supplier: { id: string; code: string; name: string };
  store: { id: string; code: string; name: string };
  createdBy: { id: string; displayName: string };
  lines: PurchaseOrderLine[];
  receipts: GoodsReceipt[];
};

export function fetchSuppliers(activeOnly = false) {
  const q = activeOnly ? '?activeOnly=1' : '';
  return apiGet<Supplier[]>(`/purchasing/suppliers${q}`);
}

export function createSupplier(body: {
  code: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  notes?: string;
  isActive?: boolean;
}) {
  return apiPost<Supplier>('/purchasing/suppliers', body);
}

export function updateSupplier(
  id: string,
  body: Partial<{
    code: string;
    name: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    notes: string | null;
    isActive: boolean;
  }>,
) {
  return apiPatch<Supplier>(`/purchasing/suppliers/${id}`, body);
}

export function fetchPurchaseOrders(limit = 50) {
  return apiGet<PurchaseOrder[]>(`/purchasing/orders?limit=${limit}`);
}

export function createPurchaseOrder(body: {
  supplierId: string;
  storeId: string;
  note?: string;
  confirm?: boolean;
  lines: Array<{ productId: string; qtyOrdered: number; unitCostInCents: number }>;
}) {
  return apiPost<PurchaseOrder>('/purchasing/orders', body);
}

export function confirmPurchaseOrder(id: string) {
  return apiPost<PurchaseOrder>(`/purchasing/orders/${id}/confirm`, {});
}

export function cancelPurchaseOrder(id: string) {
  return apiPost<PurchaseOrder>(`/purchasing/orders/${id}/cancel`, {});
}

export function receivePurchaseOrder(
  id: string,
  body: {
    storeId?: string;
    note?: string;
    lines: Array<{ purchaseOrderLineId: string; qty: number }>;
  },
) {
  return apiPost<{ receipt: GoodsReceipt; purchaseOrder: PurchaseOrder }>(
    `/purchasing/orders/${id}/receive`,
    body,
  );
}
