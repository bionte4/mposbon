-- Promos + payment charges (Midtrans/Xendit QRIS) + loyalty redeem fields

ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'PROMO_APPLY';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'LOYALTY_REDEEM';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'PAYMENT_CHARGE';

CREATE TYPE "PromoType" AS ENUM ('PERCENT', 'FIXED');
CREATE TYPE "PromoScope" AS ENUM ('ALL', 'CATEGORY', 'PRODUCT');
CREATE TYPE "PaymentProvider" AS ENUM ('LOCAL_QRIS', 'MIDTRANS', 'XENDIT');
CREATE TYPE "PaymentChargeStatus" AS ENUM ('PENDING', 'PAID', 'EXPIRED', 'FAILED', 'CANCELLED');

CREATE TABLE "promos" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "PromoType" NOT NULL,
    "scope" "PromoScope" NOT NULL DEFAULT 'ALL',
    "percent_bps" INTEGER,
    "amount_in_cents" INTEGER,
    "max_discount_in_cents" INTEGER,
    "min_subtotal_in_cents" INTEGER NOT NULL DEFAULT 0,
    "category_id" UUID,
    "product_id" UUID,
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "usage_limit" INTEGER,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "stack_with_loyalty" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "promos_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "promos_percent_bps_non_negative" CHECK ("percent_bps" IS NULL OR "percent_bps" >= 0),
    CONSTRAINT "promos_amount_non_negative" CHECK ("amount_in_cents" IS NULL OR "amount_in_cents" >= 0),
    CONSTRAINT "promos_max_discount_non_negative" CHECK ("max_discount_in_cents" IS NULL OR "max_discount_in_cents" >= 0),
    CONSTRAINT "promos_min_subtotal_non_negative" CHECK ("min_subtotal_in_cents" >= 0)
);

CREATE UNIQUE INDEX "promos_tenant_id_code_key" ON "promos"("tenant_id", "code");
CREATE INDEX "promos_tenant_id_is_active_starts_at_ends_at_idx"
  ON "promos"("tenant_id", "is_active", "starts_at", "ends_at");

ALTER TABLE "promos"
  ADD CONSTRAINT "promos_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "promos"
  ADD CONSTRAINT "promos_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "promos"
  ADD CONSTRAINT "promos_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sales"
  ADD COLUMN IF NOT EXISTS "loyalty_points_redeemed" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "promo_id" UUID,
  ADD COLUMN IF NOT EXISTS "promo_code" TEXT;

CREATE INDEX IF NOT EXISTS "sales_tenant_id_promo_id_idx" ON "sales"("tenant_id", "promo_id");

ALTER TABLE "sales"
  ADD CONSTRAINT "sales_promo_id_fkey"
  FOREIGN KEY ("promo_id") REFERENCES "promos"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "payment_charges" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "sale_id" UUID,
    "client_uuid" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "PaymentChargeStatus" NOT NULL DEFAULT 'PENDING',
    "amount_in_cents" INTEGER NOT NULL,
    "provider_ref" TEXT,
    "qr_string" TEXT,
    "deeplink_url" TEXT,
    "expires_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "raw_webhook" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "payment_charges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payment_charges_amount_positive" CHECK ("amount_in_cents" > 0)
);

CREATE UNIQUE INDEX "payment_charges_tenant_id_provider_ref_key"
  ON "payment_charges"("tenant_id", "provider_ref");
CREATE INDEX "payment_charges_tenant_id_client_uuid_status_idx"
  ON "payment_charges"("tenant_id", "client_uuid", "status");
CREATE INDEX "payment_charges_tenant_id_store_id_created_at_idx"
  ON "payment_charges"("tenant_id", "store_id", "created_at");
CREATE INDEX "payment_charges_tenant_id_sale_id_idx"
  ON "payment_charges"("tenant_id", "sale_id");

ALTER TABLE "payment_charges"
  ADD CONSTRAINT "payment_charges_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payment_charges"
  ADD CONSTRAINT "payment_charges_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "payment_charges"
  ADD CONSTRAINT "payment_charges_sale_id_fkey"
  FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "promos" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "promos" FORCE ROW LEVEL SECURITY;
CREATE POLICY promos_isolation ON "promos"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "payment_charges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payment_charges" FORCE ROW LEVEL SECURITY;
CREATE POLICY payment_charges_isolation ON "payment_charges"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'bonpos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE promos, payment_charges TO bonpos_app;
  END IF;
END $$;
