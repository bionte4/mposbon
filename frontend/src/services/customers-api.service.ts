import { apiGet, apiPost } from '../api/client';
import type { PosCustomer } from '../db/pos-types';

export function searchCustomers(q: string) {
  const query = encodeURIComponent(q);
  return apiGet<PosCustomer[]>(`/customers?q=${query}&limit=20`);
}

export function createCustomer(body: { name: string; phone?: string; email?: string }) {
  return apiPost<PosCustomer>('/customers', body);
}
