-- P2: per-store stock/price + edge sync outbox
CREATE TABLE "store_stocks" (
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "store_stocks_pkey" PRIMARY KEY ("tenant_id","store_id","product_id"),
    CONSTRAINT "store_stocks_qty_non_negative" CHECK ("qty" >= 0)
);

CREATE INDEX "store_stocks_tenant_id_store_id_idx" ON "store_stocks"("tenant_id", "store_id");

ALTER TABLE "store_stocks"
  ADD CONSTRAINT "store_stocks_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_stocks"
  ADD CONSTRAINT "store_stocks_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_stocks"
  ADD CONSTRAINT "store_stocks_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "store_prices" (
    "tenant_id" UUID NOT NULL,
    "store_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "unit_price_in_cents" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "store_prices_pkey" PRIMARY KEY ("tenant_id","store_id","product_id"),
    CONSTRAINT "store_prices_price_non_negative" CHECK ("unit_price_in_cents" >= 0)
);

CREATE INDEX "store_prices_tenant_id_store_id_idx" ON "store_prices"("tenant_id", "store_id");

ALTER TABLE "store_prices"
  ADD CONSTRAINT "store_prices_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_prices"
  ADD CONSTRAINT "store_prices_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "store_prices"
  ADD CONSTRAINT "store_prices_product_id_fkey"
  FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "edge_sync_outbox" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "store_id" UUID,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "edge_sync_outbox_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "edge_sync_outbox_tenant_id_available_at_idx" ON "edge_sync_outbox"("tenant_id", "available_at");
CREATE INDEX "edge_sync_outbox_tenant_id_delivered_at_idx" ON "edge_sync_outbox"("tenant_id", "delivered_at");

ALTER TABLE "edge_sync_outbox"
  ADD CONSTRAINT "edge_sync_outbox_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "edge_sync_outbox"
  ADD CONSTRAINT "edge_sync_outbox_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "edge_sync_cursors" (
    "tenant_id" UUID NOT NULL,
    "stream" TEXT NOT NULL,
    "cursor" TEXT NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "edge_sync_cursors_pkey" PRIMARY KEY ("tenant_id","stream")
);

ALTER TABLE "edge_sync_cursors"
  ADD CONSTRAINT "edge_sync_cursors_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill store stock from global product qty for every existing store.
INSERT INTO "store_stocks" ("tenant_id", "store_id", "product_id", "qty", "updated_at")
SELECT p.tenant_id, s.id, p.id, p.stock_qty, CURRENT_TIMESTAMP
FROM products p
JOIN stores s ON s.tenant_id = p.tenant_id
ON CONFLICT DO NOTHING;

-- RLS
ALTER TABLE "store_stocks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "store_stocks" FORCE ROW LEVEL SECURITY;
CREATE POLICY store_stocks_isolation ON "store_stocks"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "store_prices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "store_prices" FORCE ROW LEVEL SECURITY;
CREATE POLICY store_prices_isolation ON "store_prices"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "edge_sync_outbox" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "edge_sync_outbox" FORCE ROW LEVEL SECURITY;
CREATE POLICY edge_sync_outbox_isolation ON "edge_sync_outbox"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "edge_sync_cursors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "edge_sync_cursors" FORCE ROW LEVEL SECURITY;
CREATE POLICY edge_sync_cursors_isolation ON "edge_sync_cursors"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'bonpos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      store_stocks, store_prices, edge_sync_outbox, edge_sync_cursors
      TO bonpos_app;
  END IF;
END $$;
