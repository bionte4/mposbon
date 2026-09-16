import { apiGet, apiPatch, apiPost } from '../api/client';

export type Promo = {
  id: string;
  code: string;
  name: string;
  type: 'PERCENT' | 'FIXED';
  scope: 'ALL' | 'CATEGORY' | 'PRODUCT';
  percentBps: number | null;
  amountInCents: number | null;
  maxDiscountInCents: number | null;
  minSubtotalInCents: number;
  categoryId: string | null;
  productId: string | null;
  startsAt: string | null;
  endsAt: string | null;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
  stackWithLoyalty: boolean;
  category?: { id: string; name: string } | null;
  product?: { id: string; sku: string; name: string } | null;
};

export function fetchPromos(activeOnly = false) {
  const q = activeOnly ? '?activeOnly=1' : '';
  return apiGet<Promo[]>(`/promos${q}`);
}

export function createPromo(body: Record<string, unknown>) {
  return apiPost<Promo>('/promos', body);
}

export function updatePromo(id: string, body: Record<string, unknown>) {
  return apiPatch<Promo>(`/promos/${id}`, body);
}

export function previewPromo(body: {
  code?: string;
  promoId?: string;
  lines: Array<{
    productId: string;
    categoryId?: string | null;
    quantity: number;
    lineSubtotalInCents: number;
    taxInCents: number;
  }>;
}) {
  return apiPost<{
    promo: {
      id: string;
      code: string;
      name: string;
      type: string;
      scope: string;
      stackWithLoyalty: boolean;
    } | null;
    discountInCents: number;
    eligibleBaseInCents: number;
    stackWithLoyalty: boolean;
  }>('/promos/preview', body);
}
