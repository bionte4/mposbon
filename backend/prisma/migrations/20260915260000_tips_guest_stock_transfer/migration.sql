-- P5: tips, guest bill split, inter-store stock transfer

ALTER TABLE "cashier_shifts"
  ADD COLUMN IF NOT EXISTS "tips_in_cents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "sales"
  ADD COLUMN IF NOT EXISTS "tip_in_cents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "cart_items"
  ADD COLUMN IF NOT EXISTS "guest_index" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "sale_lines"
  ADD COLUMN IF NOT EXISTS "guest_index" INTEGER NOT NULL DEFAULT 1;

ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'STOCK_TRANSFER';

CREATE TYPE "StockTransferStatus" AS ENUM ('COMPLETED', 'CANCELLED');

CREATE TABLE "stock_transfers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "from_store_id" UUID NOT NULL,
    "to_store_id" UUID NOT NULL,
    "status" "StockTransferStatus" NOT NULL DEFAULT 'COMPLETED',
    "note" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_transfers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_transfers_distinct_stores" CHECK ("from_store_id" <> "to_store_id")
);

CREATE INDEX "stock_transfers_tenant_id_created_at_idx" ON "stock_transfers"("tenant_id", "created_at");
CREATE INDEX "stock_transfers_tenant_id_from_store_id_idx" ON "stock_transfers"("tenant_id", "from_store_id");
CREATE INDEX "stock_transfers_tenant_id_to_store_id_idx" ON "stock_transfers"("tenant_id", "to_store_id");

ALTER TABLE "stock_transfers"
  ADD CONSTRAINT "stock_transfers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_transfers"
  ADD CONSTRAINT "stock_transfers_from_store_id_fkey"
  FOREIGN KEY ("from_store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers"
  ADD CONSTRAINT "stock_transfers_to_store_id_fkey"
  FOREIGN KEY ("to_store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_transfers"
  ADD CONSTRAINT "stock_transfers_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "stock_transfer_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "transfer_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "stock_transfer_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_transfer_lines_qty_positive" CHECK ("qty" > 0)
);

CREATE INDEX "stock_transfer_lines_tenant_id_transfer_id_idx"
  ON "stock_transfer_lines"("tenant_id", "transfer_id");

ALTER TABLE "stock_transfer_lines"
  ADD CONSTRAINT "stock_transfer_lines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_transfer_lines"
  ADD CONSTRAINT "stock_transfer_lines_transfer_id_fkey"
  FOREIGN KEY ("transfer_id") REFERENCES "stock_transfers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_transfer_lines"
  ADD CONSTRAINT "stock_transfer_lines_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_transfers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_transfers" FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_transfers_isolation ON "stock_transfers"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "stock_transfer_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_transfer_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_transfer_lines_isolation ON "stock_transfer_lines"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'bonpos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      stock_transfers, stock_transfer_lines
      TO bonpos_app;
  END IF;
END $$;
