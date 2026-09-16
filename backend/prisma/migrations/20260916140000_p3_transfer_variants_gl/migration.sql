-- P3: transfer in-transit, product variants, light GL

-- Stock transfer workflow statuses (existing COMPLETED/CANCELLED kept)
ALTER TYPE "StockTransferStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "StockTransferStatus" ADD VALUE IF NOT EXISTS 'IN_TRANSIT';

ALTER TABLE "stock_transfers"
  ADD COLUMN IF NOT EXISTS "shipped_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "received_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelled_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "stock_transfers_tenant_id_status_created_at_idx"
  ON "stock_transfers"("tenant_id", "status", "created_at");

ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'JOURNAL_POST';

-- Product variants + per-store variant stock
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "barcode" TEXT,
    "unit_price_in_cents" INTEGER NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_variants_price_non_negative" CHECK ("unit_price_in_cents" >= 0)
);

CREATE UNIQUE INDEX "product_variants_tenant_id_sku_key" ON "product_variants"("tenant_id", "sku");
CREATE INDEX "product_variants_tenant_id_product_id_sort_order_idx"
  ON "product_variants"("tenant_id", "product_id", "sort_order");

ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_variants"
  ADD CONSTRAINT "product_variants_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "store_variant_stocks" (
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "variant_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "store_variant_stocks_pkey" PRIMARY KEY ("tenant_id","store_id","variant_id")
);

CREATE INDEX "store_variant_stocks_tenant_id_store_id_idx"
  ON "store_variant_stocks"("tenant_id", "store_id");

ALTER TABLE "store_variant_stocks"
  ADD CONSTRAINT "store_variant_stocks_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_variant_stocks"
  ADD CONSTRAINT "store_variant_stocks_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_variant_stocks"
  ADD CONSTRAINT "store_variant_stocks_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "cart_items" ADD COLUMN IF NOT EXISTS "variant_id" UUID;
ALTER TABLE "sale_lines" ADD COLUMN IF NOT EXISTS "variant_id" UUID;

CREATE INDEX IF NOT EXISTS "cart_items_tenant_id_variant_id_idx" ON "cart_items"("tenant_id", "variant_id");
CREATE INDEX IF NOT EXISTS "sale_lines_tenant_id_variant_id_idx" ON "sale_lines"("tenant_id", "variant_id");

ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_lines"
  ADD CONSTRAINT "sale_lines_variant_id_fkey"
  FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Light GL
CREATE TYPE "GlAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
CREATE TYPE "JournalSourceType" AS ENUM ('SALE', 'TRANSFER', 'STOCK_COUNT', 'GOODS_RECEIPT', 'MANUAL');

CREATE TABLE "gl_accounts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GlAccountType" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gl_accounts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gl_accounts_tenant_id_code_key" ON "gl_accounts"("tenant_id", "code");
CREATE INDEX "gl_accounts_tenant_id_type_idx" ON "gl_accounts"("tenant_id", "type");

ALTER TABLE "gl_accounts"
  ADD CONSTRAINT "gl_accounts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "journal_entries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "source_type" "JournalSourceType" NOT NULL,
    "source_id" TEXT NOT NULL,
    "memo" TEXT,
    "posted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "journal_entries_tenant_id_source_type_source_id_key"
  ON "journal_entries"("tenant_id", "source_type", "source_id");
CREATE INDEX "journal_entries_tenant_id_posted_at_idx"
  ON "journal_entries"("tenant_id", "posted_at");

ALTER TABLE "journal_entries"
  ADD CONSTRAINT "journal_entries_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "journal_entry_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "entry_id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "account_code" TEXT NOT NULL,
    "debit_in_cents" INTEGER NOT NULL DEFAULT 0,
    "credit_in_cents" INTEGER NOT NULL DEFAULT 0,
    "memo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "journal_entry_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "journal_entry_lines_amounts_non_negative" CHECK ("debit_in_cents" >= 0 AND "credit_in_cents" >= 0)
);

CREATE INDEX "journal_entry_lines_tenant_id_entry_id_idx" ON "journal_entry_lines"("tenant_id", "entry_id");
CREATE INDEX "journal_entry_lines_tenant_id_account_code_idx" ON "journal_entry_lines"("tenant_id", "account_code");

ALTER TABLE "journal_entry_lines"
  ADD CONSTRAINT "journal_entry_lines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "journal_entry_lines"
  ADD CONSTRAINT "journal_entry_lines_entry_id_fkey"
  FOREIGN KEY ("entry_id") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "journal_entry_lines"
  ADD CONSTRAINT "journal_entry_lines_account_id_fkey"
  FOREIGN KEY ("account_id") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS
ALTER TABLE "product_variants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_variants" FORCE ROW LEVEL SECURITY;
CREATE POLICY product_variants_isolation ON "product_variants"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "store_variant_stocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "store_variant_stocks" FORCE ROW LEVEL SECURITY;
CREATE POLICY store_variant_stocks_isolation ON "store_variant_stocks"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "gl_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gl_accounts" FORCE ROW LEVEL SECURITY;
CREATE POLICY gl_accounts_isolation ON "gl_accounts"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "journal_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_entries" FORCE ROW LEVEL SECURITY;
CREATE POLICY journal_entries_isolation ON "journal_entries"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "journal_entry_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "journal_entry_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY journal_entry_lines_isolation ON "journal_entry_lines"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'bonpos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      product_variants, store_variant_stocks, gl_accounts, journal_entries, journal_entry_lines
      TO bonpos_app;
  END IF;
END $$;
