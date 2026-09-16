-- F&B table management + formal stock opname sessions

ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'STOCK_COUNT';

CREATE TYPE "StockCountStatus" AS ENUM ('DRAFT', 'COMPLETED', 'CANCELLED');

CREATE TABLE "table_areas" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "table_areas_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "table_areas_tenant_id_store_id_sort_order_idx"
  ON "table_areas"("tenant_id", "store_id", "sort_order");

ALTER TABLE "table_areas"
  ADD CONSTRAINT "table_areas_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "table_areas"
  ADD CONSTRAINT "table_areas_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "dining_tables" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "area_id" UUID,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL DEFAULT 4,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "dining_tables_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dining_tables_capacity_positive" CHECK ("capacity" > 0)
);

CREATE UNIQUE INDEX "dining_tables_tenant_id_store_id_code_key"
  ON "dining_tables"("tenant_id", "store_id", "code");
CREATE INDEX "dining_tables_tenant_id_store_id_area_id_sort_order_idx"
  ON "dining_tables"("tenant_id", "store_id", "area_id", "sort_order");

ALTER TABLE "dining_tables"
  ADD CONSTRAINT "dining_tables_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dining_tables"
  ADD CONSTRAINT "dining_tables_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dining_tables"
  ADD CONSTRAINT "dining_tables_area_id_fkey"
  FOREIGN KEY ("area_id") REFERENCES "table_areas"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "carts" ADD COLUMN "table_id" UUID;

CREATE INDEX "carts_tenant_id_table_id_status_idx" ON "carts"("tenant_id", "table_id", "status");

ALTER TABLE "carts"
  ADD CONSTRAINT "carts_table_id_fkey"
  FOREIGN KEY ("table_id") REFERENCES "dining_tables"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "stock_count_sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'DRAFT',
    "note" TEXT,
    "created_by_user_id" UUID NOT NULL,
    "completed_by_user_id" UUID,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stock_count_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stock_count_sessions_tenant_id_code_key"
  ON "stock_count_sessions"("tenant_id", "code");
CREATE INDEX "stock_count_sessions_tenant_id_store_id_status_created_at_idx"
  ON "stock_count_sessions"("tenant_id", "store_id", "status", "created_at");

ALTER TABLE "stock_count_sessions"
  ADD CONSTRAINT "stock_count_sessions_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_count_sessions"
  ADD CONSTRAINT "stock_count_sessions_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_sessions"
  ADD CONSTRAINT "stock_count_sessions_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_count_sessions"
  ADD CONSTRAINT "stock_count_sessions_completed_by_user_id_fkey"
  FOREIGN KEY ("completed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "stock_count_lines" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_sku" TEXT NOT NULL,
    "product_name" TEXT NOT NULL,
    "system_qty" INTEGER NOT NULL,
    "counted_qty" INTEGER,
    "variance_qty" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "stock_count_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_count_lines_system_qty_non_negative" CHECK ("system_qty" >= 0),
    CONSTRAINT "stock_count_lines_counted_qty_non_negative" CHECK ("counted_qty" IS NULL OR "counted_qty" >= 0)
);

CREATE UNIQUE INDEX "stock_count_lines_tenant_id_session_id_product_id_key"
  ON "stock_count_lines"("tenant_id", "session_id", "product_id");
CREATE INDEX "stock_count_lines_tenant_id_session_id_idx"
  ON "stock_count_lines"("tenant_id", "session_id");

ALTER TABLE "stock_count_lines"
  ADD CONSTRAINT "stock_count_lines_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_count_lines"
  ADD CONSTRAINT "stock_count_lines_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "stock_count_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stock_count_lines"
  ADD CONSTRAINT "stock_count_lines_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS
ALTER TABLE "table_areas" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "table_areas" FORCE ROW LEVEL SECURITY;
CREATE POLICY table_areas_isolation ON "table_areas"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "dining_tables" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "dining_tables" FORCE ROW LEVEL SECURITY;
CREATE POLICY dining_tables_isolation ON "dining_tables"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "stock_count_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_count_sessions" FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_count_sessions_isolation ON "stock_count_sessions"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "stock_count_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_count_lines" FORCE ROW LEVEL SECURITY;
CREATE POLICY stock_count_lines_isolation ON "stock_count_lines"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'bonpos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      table_areas, dining_tables, stock_count_sessions, stock_count_lines
      TO bonpos_app;
  END IF;
END $$;
