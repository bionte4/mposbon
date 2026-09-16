-- Recipe/BOM + HPP (COGS) + Kitchen Display System (KDS)

ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'KITCHEN_FIRE';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'RECIPE_CONSUME';

CREATE TYPE "ProductType" AS ENUM ('RETAIL', 'MENU', 'INGREDIENT');
CREATE TYPE "KitchenOrderStatus" AS ENUM ('OPEN', 'DONE', 'CANCELLED');
CREATE TYPE "KitchenLineStatus" AS ENUM ('PENDING', 'PREPARING', 'READY', 'DONE', 'CANCELLED');

ALTER TABLE "products"
  ADD COLUMN "product_type" "ProductType" NOT NULL DEFAULT 'RETAIL',
  ADD COLUMN "kitchen_station_id" UUID;

ALTER TABLE "sale_lines"
  ADD COLUMN "cogs_in_cents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "sale_lines"
  ADD CONSTRAINT "sale_lines_cogs_non_negative" CHECK ("cogs_in_cents" >= 0);

CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "yield_qty" INTEGER NOT NULL DEFAULT 1,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recipes_yield_qty_positive" CHECK ("yield_qty" > 0)
);

CREATE UNIQUE INDEX "recipes_product_id_key" ON "recipes"("product_id");
CREATE INDEX "recipes_tenant_id_idx" ON "recipes"("tenant_id");

ALTER TABLE "recipes"
  ADD CONSTRAINT "recipes_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recipes"
  ADD CONSTRAINT "recipes_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "recipe_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "recipe_id" UUID NOT NULL,
    "ingredient_product_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL,
    "unit_cost_in_cents" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "recipe_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "recipe_lines_qty_positive" CHECK ("qty" > 0),
    CONSTRAINT "recipe_lines_unit_cost_non_negative" CHECK ("unit_cost_in_cents" >= 0)
);

CREATE UNIQUE INDEX "recipe_lines_tenant_id_recipe_id_ingredient_product_id_key"
  ON "recipe_lines"("tenant_id", "recipe_id", "ingredient_product_id");
CREATE INDEX "recipe_lines_tenant_id_recipe_id_idx" ON "recipe_lines"("tenant_id", "recipe_id");

ALTER TABLE "recipe_lines"
  ADD CONSTRAINT "recipe_lines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recipe_lines"
  ADD CONSTRAINT "recipe_lines_recipe_id_fkey"
  FOREIGN KEY ("recipe_id") REFERENCES "recipes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "recipe_lines"
  ADD CONSTRAINT "recipe_lines_ingredient_product_id_fkey"
  FOREIGN KEY ("ingredient_product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "kitchen_stations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "kitchen_stations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "kitchen_stations_tenant_id_store_id_code_key"
  ON "kitchen_stations"("tenant_id", "store_id", "code");
CREATE INDEX "kitchen_stations_tenant_id_store_id_sort_order_idx"
  ON "kitchen_stations"("tenant_id", "store_id", "sort_order");

ALTER TABLE "kitchen_stations"
  ADD CONSTRAINT "kitchen_stations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kitchen_stations"
  ADD CONSTRAINT "kitchen_stations_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "products"
  ADD CONSTRAINT "products_kitchen_station_id_fkey"
  FOREIGN KEY ("kitchen_station_id") REFERENCES "kitchen_stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "kitchen_orders" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "cart_client_uuid" TEXT NOT NULL,
    "table_label" TEXT,
    "status" "KitchenOrderStatus" NOT NULL DEFAULT 'OPEN',
    "sale_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "kitchen_orders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "kitchen_orders_tenant_id_store_id_status_created_at_idx"
  ON "kitchen_orders"("tenant_id", "store_id", "status", "created_at");
CREATE INDEX "kitchen_orders_tenant_id_cart_client_uuid_status_idx"
  ON "kitchen_orders"("tenant_id", "cart_client_uuid", "status");

ALTER TABLE "kitchen_orders"
  ADD CONSTRAINT "kitchen_orders_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kitchen_orders"
  ADD CONSTRAINT "kitchen_orders_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "kitchen_order_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "modifiers_json" JSONB,
    "guest_index" INTEGER NOT NULL DEFAULT 1,
    "client_line_id" TEXT NOT NULL,
    "status" "KitchenLineStatus" NOT NULL DEFAULT 'PENDING',
    "fired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ready_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "kitchen_order_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "kitchen_order_lines_qty_positive" CHECK ("quantity" > 0)
);

CREATE UNIQUE INDEX "kitchen_order_lines_tenant_id_order_id_client_line_id_key"
  ON "kitchen_order_lines"("tenant_id", "order_id", "client_line_id");
CREATE INDEX "kitchen_order_lines_tenant_id_station_id_status_fired_at_idx"
  ON "kitchen_order_lines"("tenant_id", "station_id", "status", "fired_at");

ALTER TABLE "kitchen_order_lines"
  ADD CONSTRAINT "kitchen_order_lines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kitchen_order_lines"
  ADD CONSTRAINT "kitchen_order_lines_order_id_fkey"
  FOREIGN KEY ("order_id") REFERENCES "kitchen_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "kitchen_order_lines"
  ADD CONSTRAINT "kitchen_order_lines_station_id_fkey"
  FOREIGN KEY ("station_id") REFERENCES "kitchen_stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "kitchen_order_lines"
  ADD CONSTRAINT "kitchen_order_lines_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS
ALTER TABLE "recipes" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recipes" FORCE ROW LEVEL SECURITY;
CREATE POLICY recipes_isolation ON "recipes"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "recipe_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "recipe_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY recipe_lines_isolation ON "recipe_lines"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "kitchen_stations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kitchen_stations" FORCE ROW LEVEL SECURITY;
CREATE POLICY kitchen_stations_isolation ON "kitchen_stations"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "kitchen_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kitchen_orders" FORCE ROW LEVEL SECURITY;
CREATE POLICY kitchen_orders_isolation ON "kitchen_orders"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "kitchen_order_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "kitchen_order_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY kitchen_order_lines_isolation ON "kitchen_order_lines"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'bonpos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      recipes, recipe_lines, kitchen_stations, kitchen_orders, kitchen_order_lines
      TO bonpos_app;
  END IF;
END $$;
