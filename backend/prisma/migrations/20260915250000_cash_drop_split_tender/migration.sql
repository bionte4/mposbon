-- P4: cash drawer movements (drop / mid-count) + split tender sale_payments

ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'CASH_DROP';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'MID_COUNT';

ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'SPLIT';

ALTER TABLE "cashier_shifts"
  ADD COLUMN IF NOT EXISTS "cash_drops_in_cents" INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN "cashier_shifts"."expected_cash_in_cents" IS
  'Expected drawer = openingFloat + cashSales - cashRefunds - cashDrops';

CREATE TYPE "CashDrawerMovementType" AS ENUM ('DROP', 'MID_COUNT');

CREATE TABLE "cash_drawer_movements" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "shift_id" UUID NOT NULL,
    "type" "CashDrawerMovementType" NOT NULL,
    "amount_in_cents" INTEGER NOT NULL,
    "expected_at_in_cents" INTEGER NOT NULL,
    "variance_in_cents" INTEGER,
    "note" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "cash_drawer_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cash_drawer_movements_amount_non_negative" CHECK ("amount_in_cents" >= 0)
);

CREATE INDEX "cash_drawer_movements_tenant_id_shift_id_created_at_idx"
  ON "cash_drawer_movements"("tenant_id", "shift_id", "created_at");

ALTER TABLE "cash_drawer_movements"
  ADD CONSTRAINT "cash_drawer_movements_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cash_drawer_movements"
  ADD CONSTRAINT "cash_drawer_movements_shift_id_fkey"
  FOREIGN KEY ("shift_id") REFERENCES "cashier_shifts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cash_drawer_movements"
  ADD CONSTRAINT "cash_drawer_movements_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "sale_payments" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "payment_method" "PaymentMethod" NOT NULL,
    "amount_in_cents" INTEGER NOT NULL,
    "amount_tendered_in_cents" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sale_payments_amount_positive" CHECK ("amount_in_cents" > 0)
);

CREATE INDEX "sale_payments_tenant_id_sale_id_idx" ON "sale_payments"("tenant_id", "sale_id");

ALTER TABLE "sale_payments"
  ADD CONSTRAINT "sale_payments_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_payments"
  ADD CONSTRAINT "sale_payments_sale_id_fkey"
  FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cash_drawer_movements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cash_drawer_movements" FORCE ROW LEVEL SECURITY;
CREATE POLICY cash_drawer_movements_isolation ON "cash_drawer_movements"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "sale_payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sale_payments" FORCE ROW LEVEL SECURITY;
CREATE POLICY sale_payments_isolation ON "sale_payments"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'bonpos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      cash_drawer_movements, sale_payments
      TO bonpos_app;
  END IF;
END $$;
