import { apiGet, apiPost } from '../api/client';

export type PaymentCharge = {
  id: string;
  provider: 'LOCAL_QRIS' | 'MIDTRANS' | 'XENDIT';
  status: 'PENDING' | 'PAID' | 'EXPIRED' | 'FAILED' | 'CANCELLED';
  amountInCents: number;
  providerRef: string | null;
  qrString: string | null;
  deeplinkUrl: string | null;
  expiresAt: string | null;
  paidAt: string | null;
  clientUuid: string;
};

export function fetchPaymentProvider() {
  return apiGet<{ provider: PaymentCharge['provider'] }>('/payments/provider');
}

export function createQrisCharge(body: {
  storeId: string;
  clientUuid: string;
  amountInCents: number;
  localQrString?: string | null;
  billNumber?: string | null;
}) {
  return apiPost<PaymentCharge>('/payments/qris/charges', body);
}

export function refreshQrisCharge(id: string) {
  return apiPost<PaymentCharge>(`/payments/qris/charges/${id}/refresh`, {});
}

export function confirmLocalQrisCharge(id: string) {
  return apiPost<PaymentCharge>(`/payments/qris/charges/${id}/confirm-local`, {});
}
