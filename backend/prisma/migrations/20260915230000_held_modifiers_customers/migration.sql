-- P1: held carts, modifiers, customers/loyalty
CREATE TABLE "product_modifier_groups" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "min_select" INTEGER NOT NULL DEFAULT 0,
    "max_select" INTEGER NOT NULL DEFAULT 1,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_modifier_groups_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "product_modifier_groups_tenant_id_product_id_idx"
  ON "product_modifier_groups"("tenant_id", "product_id");

ALTER TABLE "product_modifier_groups"
  ADD CONSTRAINT "product_modifier_groups_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_modifier_groups"
  ADD CONSTRAINT "product_modifier_groups_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "product_modifier_options" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "group_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_delta_in_cents" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "product_modifier_options_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "product_modifier_options_delta_check" CHECK ("price_delta_in_cents" >= 0)
);

CREATE INDEX "product_modifier_options_tenant_id_group_id_idx"
  ON "product_modifier_options"("tenant_id", "group_id");

ALTER TABLE "product_modifier_options"
  ADD CONSTRAINT "product_modifier_options_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "product_modifier_options"
  ADD CONSTRAINT "product_modifier_options_group_id_fkey"
  FOREIGN KEY ("group_id") REFERENCES "product_modifier_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "loyalty_points" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "customers_loyalty_non_negative" CHECK ("loyalty_points" >= 0)
);

CREATE UNIQUE INDEX "customers_tenant_id_phone_key" ON "customers"("tenant_id", "phone");
CREATE INDEX "customers_tenant_id_name_idx" ON "customers"("tenant_id", "name");

ALTER TABLE "customers"
  ADD CONSTRAINT "customers_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "carts"
  ADD COLUMN "customer_id" UUID,
  ADD COLUMN "label" TEXT,
  ADD COLUMN "parked_at" TIMESTAMP(3);

ALTER TABLE "carts"
  ADD CONSTRAINT "carts_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "cart_items" ADD COLUMN "modifiers_json" JSONB;

ALTER TABLE "sales"
  ADD COLUMN "customer_id" UUID,
  ADD COLUMN "loyalty_points_earned" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "sales_tenant_id_customer_id_idx" ON "sales"("tenant_id", "customer_id");

ALTER TABLE "sales"
  ADD CONSTRAINT "sales_customer_id_fkey"
  FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sale_lines" ADD COLUMN "modifiers_json" JSONB;

-- RLS
ALTER TABLE "product_modifier_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_modifier_groups" FORCE ROW LEVEL SECURITY;
CREATE POLICY product_modifier_groups_isolation ON "product_modifier_groups"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "product_modifier_options" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "product_modifier_options" FORCE ROW LEVEL SECURITY;
CREATE POLICY product_modifier_options_isolation ON "product_modifier_options"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customers" FORCE ROW LEVEL SECURITY;
CREATE POLICY customers_isolation ON "customers"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
