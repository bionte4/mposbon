-- POS catalog, carts, and sales. All money columns are INTEGER smallest units.

CREATE TYPE "CartStatus" AS ENUM ('OPEN', 'CHECKED_OUT', 'ABANDONED');
CREATE TYPE "SaleStatus" AS ENUM ('COMPLETED', 'VOIDED');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'QRIS', 'OTHER');

CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "categories_tenant_id_name_key" ON "categories"("tenant_id", "name");
CREATE INDEX "categories_tenant_id_idx" ON "categories"("tenant_id");

ALTER TABLE "categories"
  ADD CONSTRAINT "categories_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "sku" TEXT NOT NULL,
    "barcode" TEXT,
    "name" TEXT NOT NULL,
    "unit_price_in_cents" INTEGER NOT NULL,
    "tax_bps" INTEGER NOT NULL DEFAULT 0,
    "stock_qty" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "products_unit_price_non_negative" CHECK ("unit_price_in_cents" >= 0),
    CONSTRAINT "products_tax_bps_non_negative" CHECK ("tax_bps" >= 0)
);

CREATE UNIQUE INDEX "products_tenant_id_sku_key" ON "products"("tenant_id", "sku");
CREATE INDEX "products_tenant_id_idx" ON "products"("tenant_id");
CREATE INDEX "products_tenant_id_category_id_idx" ON "products"("tenant_id", "category_id");

ALTER TABLE "products"
  ADD CONSTRAINT "products_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "products"
  ADD CONSTRAINT "products_category_id_fkey"
  FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "carts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "cashier_user_id" UUID,
    "status" "CartStatus" NOT NULL DEFAULT 'OPEN',
    "client_uuid" TEXT NOT NULL,
    "subtotal_in_cents" INTEGER NOT NULL DEFAULT 0,
    "tax_in_cents" INTEGER NOT NULL DEFAULT 0,
    "total_in_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "carts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "carts_money_non_negative" CHECK (
      "subtotal_in_cents" >= 0 AND "tax_in_cents" >= 0 AND "total_in_cents" >= 0
    )
);

CREATE UNIQUE INDEX "carts_tenant_id_client_uuid_key" ON "carts"("tenant_id", "client_uuid");
CREATE INDEX "carts_tenant_id_store_id_status_idx" ON "carts"("tenant_id", "store_id", "status");

ALTER TABLE "carts"
  ADD CONSTRAINT "carts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "carts"
  ADD CONSTRAINT "carts_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "carts"
  ADD CONSTRAINT "carts_cashier_user_id_fkey"
  FOREIGN KEY ("cashier_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "cart_items" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "cart_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_in_cents" INTEGER NOT NULL,
    "tax_bps" INTEGER NOT NULL,
    "tax_in_cents" INTEGER NOT NULL,
    "line_subtotal_in_cents" INTEGER NOT NULL,
    "line_total_in_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cart_items_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "cart_items_qty_positive" CHECK ("quantity" > 0),
    CONSTRAINT "cart_items_money_non_negative" CHECK (
      "unit_price_in_cents" >= 0 AND "tax_in_cents" >= 0
      AND "line_subtotal_in_cents" >= 0 AND "line_total_in_cents" >= 0
    )
);

CREATE INDEX "cart_items_tenant_id_cart_id_idx" ON "cart_items"("tenant_id", "cart_id");

ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_cart_id_fkey"
  FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "cart_items"
  ADD CONSTRAINT "cart_items_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "sales" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "cashier_user_id" UUID,
    "cart_id" UUID,
    "status" "SaleStatus" NOT NULL DEFAULT 'COMPLETED',
    "payment_method" "PaymentMethod" NOT NULL,
    "subtotal_in_cents" INTEGER NOT NULL,
    "tax_in_cents" INTEGER NOT NULL,
    "total_in_cents" INTEGER NOT NULL,
    "client_created_at" TIMESTAMP(3) NOT NULL,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sales_money_non_negative" CHECK (
      "subtotal_in_cents" >= 0 AND "tax_in_cents" >= 0 AND "total_in_cents" >= 0
    ),
    CONSTRAINT "sales_total_matches" CHECK ("total_in_cents" = "subtotal_in_cents" + "tax_in_cents")
);

CREATE UNIQUE INDEX "sales_cart_id_key" ON "sales"("cart_id");
CREATE INDEX "sales_tenant_id_store_id_client_created_at_idx" ON "sales"("tenant_id", "store_id", "client_created_at");

ALTER TABLE "sales"
  ADD CONSTRAINT "sales_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_cashier_user_id_fkey"
  FOREIGN KEY ("cashier_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "sales"
  ADD CONSTRAINT "sales_cart_id_fkey"
  FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "sale_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price_in_cents" INTEGER NOT NULL,
    "tax_bps" INTEGER NOT NULL,
    "tax_in_cents" INTEGER NOT NULL,
    "line_subtotal_in_cents" INTEGER NOT NULL,
    "line_total_in_cents" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sale_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "sale_lines_qty_positive" CHECK ("quantity" > 0),
    CONSTRAINT "sale_lines_money_non_negative" CHECK (
      "unit_price_in_cents" >= 0 AND "tax_in_cents" >= 0
      AND "line_subtotal_in_cents" >= 0 AND "line_total_in_cents" >= 0
    ),
    CONSTRAINT "sale_lines_total_matches" CHECK (
      "line_total_in_cents" = "line_subtotal_in_cents" + "tax_in_cents"
    )
);

CREATE INDEX "sale_lines_tenant_id_sale_id_idx" ON "sale_lines"("tenant_id", "sale_id");

ALTER TABLE "sale_lines"
  ADD CONSTRAINT "sale_lines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_lines"
  ADD CONSTRAINT "sale_lines_sale_id_fkey"
  FOREIGN KEY ("sale_id") REFERENCES "sales"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_lines"
  ADD CONSTRAINT "sale_lines_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "categories" FORCE ROW LEVEL SECURITY;
CREATE POLICY categories_isolation ON "categories"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "products" FORCE ROW LEVEL SECURITY;
CREATE POLICY products_isolation ON "products"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "carts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "carts" FORCE ROW LEVEL SECURITY;
CREATE POLICY carts_isolation ON "carts"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "cart_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "cart_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY cart_items_isolation ON "cart_items"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sales" FORCE ROW LEVEL SECURITY;
CREATE POLICY sales_isolation ON "sales"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "sale_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sale_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY sale_lines_isolation ON "sale_lines"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'bonpos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      categories, products, carts, cart_items, sales, sale_lines TO bonpos_app;
  END IF;
END
$$;
