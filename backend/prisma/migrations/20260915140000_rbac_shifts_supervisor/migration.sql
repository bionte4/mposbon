-- RBAC roles/PIN, cashier shifts, Z-report fields, supervisor action audit.

CREATE TYPE "StaffRole" AS ENUM ('CASHIER', 'SUPERVISOR', 'MANAGER', 'TENANT_ADMIN', 'SUPER_ADMIN');
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "SupervisorActionType" AS ENUM ('VOID_ITEM', 'VOID_SALE', 'MANUAL_DISCOUNT', 'FORCE_OPEN_DRAWER');

-- Migrate users.role TEXT → StaffRole enum
ALTER TABLE "users" ADD COLUMN "role_new" "StaffRole" NOT NULL DEFAULT 'CASHIER';
UPDATE "users"
SET "role_new" = CASE lower("role")
  WHEN 'supervisor' THEN 'SUPERVISOR'::"StaffRole"
  WHEN 'manager' THEN 'MANAGER'::"StaffRole"
  WHEN 'tenant_admin' THEN 'TENANT_ADMIN'::"StaffRole"
  WHEN 'super_admin' THEN 'SUPER_ADMIN'::"StaffRole"
  ELSE 'CASHIER'::"StaffRole"
END;
ALTER TABLE "users" DROP COLUMN "role";
ALTER TABLE "users" RENAME COLUMN "role_new" TO "role";

ALTER TABLE "users" ADD COLUMN "pin_hash" TEXT;
ALTER TABLE "users" ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "cashier_shifts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "cashier_user_id" UUID NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',
    "clock_in_at" TIMESTAMP(3) NOT NULL,
    "clock_out_at" TIMESTAMP(3),
    "opening_float_in_cents" INTEGER NOT NULL DEFAULT 0,
    "cash_sales_in_cents" INTEGER NOT NULL DEFAULT 0,
    "card_sales_in_cents" INTEGER NOT NULL DEFAULT 0,
    "qris_sales_in_cents" INTEGER NOT NULL DEFAULT 0,
    "other_sales_in_cents" INTEGER NOT NULL DEFAULT 0,
    "void_total_in_cents" INTEGER NOT NULL DEFAULT 0,
    "discount_total_in_cents" INTEGER NOT NULL DEFAULT 0,
    "sale_count" INTEGER NOT NULL DEFAULT 0,
    "expected_cash_in_cents" INTEGER,
    "counted_cash_in_cents" INTEGER,
    "discrepancy_in_cents" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cashier_shifts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cashier_shifts_money_non_negative" CHECK (
      "opening_float_in_cents" >= 0
      AND "cash_sales_in_cents" >= 0
      AND "card_sales_in_cents" >= 0
      AND "qris_sales_in_cents" >= 0
      AND "other_sales_in_cents" >= 0
      AND "void_total_in_cents" >= 0
      AND "discount_total_in_cents" >= 0
      AND "sale_count" >= 0
    )
);

CREATE INDEX "cashier_shifts_tenant_id_store_id_status_idx" ON "cashier_shifts"("tenant_id", "store_id", "status");
CREATE INDEX "cashier_shifts_tenant_id_cashier_user_id_status_idx" ON "cashier_shifts"("tenant_id", "cashier_user_id", "status");

-- At most one OPEN shift per cashier per tenant (partial unique).
CREATE UNIQUE INDEX "cashier_shifts_one_open_per_cashier"
  ON "cashier_shifts"("tenant_id", "cashier_user_id")
  WHERE "status" = 'OPEN';

ALTER TABLE "cashier_shifts"
  ADD CONSTRAINT "cashier_shifts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cashier_shifts"
  ADD CONSTRAINT "cashier_shifts_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "cashier_shifts"
  ADD CONSTRAINT "cashier_shifts_cashier_user_id_fkey"
  FOREIGN KEY ("cashier_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "supervisor_actions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "shift_id" UUID,
    "action_type" "SupervisorActionType" NOT NULL,
    "requester_user_id" UUID NOT NULL,
    "supervisor_user_id" UUID NOT NULL,
    "sale_id" UUID,
    "amount_in_cents" INTEGER,
    "reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supervisor_actions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "supervisor_actions_tenant_id_created_at_idx" ON "supervisor_actions"("tenant_id", "created_at");

ALTER TABLE "supervisor_actions"
  ADD CONSTRAINT "supervisor_actions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "supervisor_actions"
  ADD CONSTRAINT "supervisor_actions_shift_id_fkey"
  FOREIGN KEY ("shift_id") REFERENCES "cashier_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supervisor_actions"
  ADD CONSTRAINT "supervisor_actions_requester_user_id_fkey"
  FOREIGN KEY ("requester_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supervisor_actions"
  ADD CONSTRAINT "supervisor_actions_supervisor_user_id_fkey"
  FOREIGN KEY ("supervisor_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales" ADD COLUMN "shift_id" UUID;
ALTER TABLE "sales" ADD COLUMN "discount_in_cents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_discount_non_negative" CHECK ("discount_in_cents" >= 0);
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_shift_id_fkey"
  FOREIGN KEY ("shift_id") REFERENCES "cashier_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "sales_tenant_id_shift_id_idx" ON "sales"("tenant_id", "shift_id");

-- Fix total check: total = subtotal + tax - discount
ALTER TABLE "sales" DROP CONSTRAINT IF EXISTS "sales_total_matches";
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_total_matches"
  CHECK ("total_in_cents" = "subtotal_in_cents" + "tax_in_cents" - "discount_in_cents");

ALTER TABLE "cashier_shifts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cashier_shifts" FORCE ROW LEVEL SECURITY;
CREATE POLICY cashier_shifts_isolation ON "cashier_shifts"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "supervisor_actions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "supervisor_actions" FORCE ROW LEVEL SECURITY;
CREATE POLICY supervisor_actions_isolation ON "supervisor_actions"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'bonpos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE cashier_shifts, supervisor_actions TO bonpos_app;
  END IF;
END
$$;
