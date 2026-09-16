-- Refund / void restock support: new statuses + cash refunds bucket on shifts.
ALTER TYPE "SupervisorActionType" ADD VALUE 'REFUND_SALE';
ALTER TYPE "ActivityAction" ADD VALUE 'REFUND_SALE';
ALTER TYPE "SaleStatus" ADD VALUE 'REFUNDED';

ALTER TABLE "cashier_shifts"
  ADD COLUMN "cash_refunds_in_cents" INTEGER NOT NULL DEFAULT 0;
