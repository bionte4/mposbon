export type ModifierSnapshot = {
  optionId: string;
  name: string;
  priceDeltaInCents: number;
};

export type SyncSaleLineInput = {
  id?: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPriceInCents: number;
  taxBps: number;
  modifierOptionIds?: string[];
  guestIndex?: number;
};

export type SyncSalePaymentInput = {
  paymentMethod: 'CASH' | 'CARD' | 'QRIS' | 'OTHER';
  amountInCents: number;
  amountTenderedInCents?: number;
};

export type SyncSaleInput = {
  id: string;
  storeId: string;
  cashierUserId?: string | null;
  shiftId?: string | null;
  cartClientUuid: string;
  customerId?: string | null;
  paymentMethod: 'CASH' | 'CARD' | 'QRIS' | 'OTHER' | 'SPLIT';
  /** Split tender lines; when omitted, a single payment for total is inferred from paymentMethod. */
  payments?: SyncSalePaymentInput[];
  /** Cashier-device wall clock — used for ordering / audit of offline sales. */
  clientCreatedAt: string;
  lines: SyncSaleLineInput[];
  subtotalInCents: number;
  taxInCents: number;
  discountInCents?: number;
  tipInCents?: number;
  totalInCents: number;
};

export type UpsertCartInput = {
  clientUuid: string;
  storeId: string;
  cashierUserId?: string | null;
  customerId?: string | null;
  label?: string | null;
  parkedAt?: string | null;
  status?: 'OPEN' | 'CHECKED_OUT' | 'ABANDONED';
  /**
   * Device timestamp of this cart snapshot. Compared to server `updatedAt`
   * for last-write-wins when two devices (or offline replays) race.
   */
  clientUpdatedAt?: string;
  lines: Array<{
    productId: string;
    quantity: number;
    modifierOptionIds?: string[];
    guestIndex?: number;
  }>;
};
