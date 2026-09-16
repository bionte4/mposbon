-- Purchasing / Receiving: suppliers, purchase orders, goods receipts

ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'PURCHASE_ORDER';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'GOODS_RECEIPT';

CREATE TYPE "PurchaseOrderStatus" AS ENUM (
  'DRAFT',
  'ORDERED',
  'PARTIAL',
  'RECEIVED',
  'CANCELLED'
);

CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "suppliers_tenant_id_code_key" ON "suppliers"("tenant_id", "code");
CREATE INDEX "suppliers_tenant_id_is_active_idx" ON "suppliers"("tenant_id", "is_active");

ALTER TABLE "suppliers"
  ADD CONSTRAINT "suppliers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "purchase_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "supplier_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "subtotal_in_cents" INTEGER NOT NULL DEFAULT 0,
    "ordered_at" TIMESTAMP(3),
    "received_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_orders_subtotal_non_negative" CHECK ("subtotal_in_cents" >= 0)
);

CREATE UNIQUE INDEX "purchase_orders_tenant_id_code_key" ON "purchase_orders"("tenant_id", "code");
CREATE INDEX "purchase_orders_tenant_id_status_created_at_idx"
  ON "purchase_orders"("tenant_id", "status", "created_at");
CREATE INDEX "purchase_orders_tenant_id_supplier_id_idx"
  ON "purchase_orders"("tenant_id", "supplier_id");
CREATE INDEX "purchase_orders_tenant_id_store_id_idx"
  ON "purchase_orders"("tenant_id", "store_id");

ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_supplier_id_fkey"
  FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_orders"
  ADD CONSTRAINT "purchase_orders_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "purchase_order_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty_ordered" INTEGER NOT NULL,
    "qty_received" INTEGER NOT NULL DEFAULT 0,
    "unit_cost_in_cents" INTEGER NOT NULL,
    "line_total_in_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "purchase_order_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "purchase_order_lines_qty_ordered_positive" CHECK ("qty_ordered" > 0),
    CONSTRAINT "purchase_order_lines_qty_received_non_negative" CHECK ("qty_received" >= 0),
    CONSTRAINT "purchase_order_lines_unit_cost_non_negative" CHECK ("unit_cost_in_cents" >= 0),
    CONSTRAINT "purchase_order_lines_line_total_non_negative" CHECK ("line_total_in_cents" >= 0),
    CONSTRAINT "purchase_order_lines_received_lte_ordered" CHECK ("qty_received" <= "qty_ordered")
);

CREATE INDEX "purchase_order_lines_tenant_id_purchase_order_id_idx"
  ON "purchase_order_lines"("tenant_id", "purchase_order_id");
CREATE INDEX "purchase_order_lines_tenant_id_product_id_idx"
  ON "purchase_order_lines"("tenant_id", "product_id");

ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_order_lines"
  ADD CONSTRAINT "purchase_order_lines_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "goods_receipts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "purchase_order_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "note" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "goods_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "goods_receipts_tenant_id_code_key" ON "goods_receipts"("tenant_id", "code");
CREATE INDEX "goods_receipts_tenant_id_purchase_order_id_idx"
  ON "goods_receipts"("tenant_id", "purchase_order_id");
CREATE INDEX "goods_receipts_tenant_id_store_id_created_at_idx"
  ON "goods_receipts"("tenant_id", "store_id", "created_at");

ALTER TABLE "goods_receipts"
  ADD CONSTRAINT "goods_receipts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipts"
  ADD CONSTRAINT "goods_receipts_purchase_order_id_fkey"
  FOREIGN KEY ("purchase_order_id") REFERENCES "purchase_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts"
  ADD CONSTRAINT "goods_receipts_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipts"
  ADD CONSTRAINT "goods_receipts_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "goods_receipt_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "goods_receipt_id" UUID NOT NULL,
    "purchase_order_line_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_cost_in_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "goods_receipt_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "goods_receipt_lines_qty_positive" CHECK ("qty" > 0),
    CONSTRAINT "goods_receipt_lines_unit_cost_non_negative" CHECK ("unit_cost_in_cents" >= 0)
);

CREATE INDEX "goods_receipt_lines_tenant_id_goods_receipt_id_idx"
  ON "goods_receipt_lines"("tenant_id", "goods_receipt_id");
CREATE INDEX "goods_receipt_lines_tenant_id_purchase_order_line_id_idx"
  ON "goods_receipt_lines"("tenant_id", "purchase_order_line_id");

ALTER TABLE "goods_receipt_lines"
  ADD CONSTRAINT "goods_receipt_lines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines"
  ADD CONSTRAINT "goods_receipt_lines_goods_receipt_id_fkey"
  FOREIGN KEY ("goods_receipt_id") REFERENCES "goods_receipts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines"
  ADD CONSTRAINT "goods_receipt_lines_purchase_order_line_id_fkey"
  FOREIGN KEY ("purchase_order_line_id") REFERENCES "purchase_order_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "goods_receipt_lines"
  ADD CONSTRAINT "goods_receipt_lines_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "suppliers" FORCE ROW LEVEL SECURITY;
CREATE POLICY suppliers_isolation ON "suppliers"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_orders_isolation ON "purchase_orders"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "purchase_order_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "purchase_order_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY purchase_order_lines_isolation ON "purchase_order_lines"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "goods_receipts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goods_receipts" FORCE ROW LEVEL SECURITY;
CREATE POLICY goods_receipts_isolation ON "goods_receipts"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "goods_receipt_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "goods_receipt_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY goods_receipt_lines_isolation ON "goods_receipt_lines"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'bonpos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      suppliers, purchase_orders, purchase_order_lines, goods_receipts, goods_receipt_lines
      TO bonpos_app;
  END IF;
END $$;
