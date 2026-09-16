-- Analytics summary tables + supporting indexes for peak-hour safety.

CREATE INDEX IF NOT EXISTS "sales_tenant_id_status_client_created_at_idx"
  ON "sales"("tenant_id", "status", "client_created_at");

CREATE INDEX IF NOT EXISTS "sale_lines_tenant_id_product_id_idx"
  ON "sale_lines"("tenant_id", "product_id");

CREATE TABLE "daily_sales_summaries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "summary_date" DATE NOT NULL,
    "gross_sales_in_cents" INTEGER NOT NULL DEFAULT 0,
    "discount_in_cents" INTEGER NOT NULL DEFAULT 0,
    "void_in_cents" INTEGER NOT NULL DEFAULT 0,
    "net_sales_in_cents" INTEGER NOT NULL DEFAULT 0,
    "transaction_count" INTEGER NOT NULL DEFAULT 0,
    "cash_in_cents" INTEGER NOT NULL DEFAULT 0,
    "card_in_cents" INTEGER NOT NULL DEFAULT 0,
    "qris_in_cents" INTEGER NOT NULL DEFAULT 0,
    "other_in_cents" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_sales_summaries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "daily_sales_summaries_money_non_negative" CHECK (
      "gross_sales_in_cents" >= 0
      AND "discount_in_cents" >= 0
      AND "void_in_cents" >= 0
      AND "net_sales_in_cents" >= 0
      AND "transaction_count" >= 0
    )
);

CREATE UNIQUE INDEX "daily_sales_summaries_tenant_id_store_id_summary_date_key"
  ON "daily_sales_summaries"("tenant_id", "store_id", "summary_date");
CREATE INDEX "daily_sales_summaries_tenant_id_summary_date_idx"
  ON "daily_sales_summaries"("tenant_id", "summary_date");

ALTER TABLE "daily_sales_summaries"
  ADD CONSTRAINT "daily_sales_summaries_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_sales_summaries"
  ADD CONSTRAINT "daily_sales_summaries_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "daily_product_summaries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "product_name" TEXT NOT NULL,
    "summary_date" DATE NOT NULL,
    "quantity_sold" INTEGER NOT NULL DEFAULT 0,
    "revenue_in_cents" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_product_summaries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "daily_product_summaries_non_negative" CHECK (
      "quantity_sold" >= 0 AND "revenue_in_cents" >= 0
    )
);

CREATE UNIQUE INDEX "daily_product_summaries_tenant_store_product_date_key"
  ON "daily_product_summaries"("tenant_id", "store_id", "product_id", "summary_date");
CREATE INDEX "daily_product_summaries_tenant_id_summary_date_quantity_sold_idx"
  ON "daily_product_summaries"("tenant_id", "summary_date", "quantity_sold");

ALTER TABLE "daily_product_summaries"
  ADD CONSTRAINT "daily_product_summaries_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "daily_product_summaries"
  ADD CONSTRAINT "daily_product_summaries_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "daily_sales_summaries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_sales_summaries" FORCE ROW LEVEL SECURITY;
CREATE POLICY daily_sales_summaries_isolation ON "daily_sales_summaries"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "daily_product_summaries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "daily_product_summaries" FORCE ROW LEVEL SECURITY;
CREATE POLICY daily_product_summaries_isolation ON "daily_product_summaries"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'bonpos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      daily_sales_summaries, daily_product_summaries TO bonpos_app;
  END IF;
END
$$;
