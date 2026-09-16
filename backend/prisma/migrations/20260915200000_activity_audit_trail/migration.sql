-- Immutable audit / activity trail for sensitive POS & supervisor actions.

CREATE TYPE "ActivityAction" AS ENUM (
  'VOID_SALE',
  'VOID_ITEM',
  'MANUAL_DISCOUNT',
  'MANUAL_PRICE_OVERRIDE',
  'REMOVE_CART_ITEM',
  'FORCE_OPEN_DRAWER',
  'SUPERVISOR_PIN_OK',
  'SUPERVISOR_PIN_FAIL',
  'SHIFT_CLOCK_IN',
  'SHIFT_CLOCK_OUT'
);

CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "action" "ActivityAction" NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "amount_in_cents" INTEGER,
    "reason" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "activity_logs_tenant_id_created_at_idx" ON "activity_logs"("tenant_id", "created_at");
CREATE INDEX "activity_logs_tenant_id_action_created_at_idx" ON "activity_logs"("tenant_id", "action", "created_at");
CREATE INDEX "activity_logs_tenant_id_actor_user_id_created_at_idx" ON "activity_logs"("tenant_id", "actor_user_id", "created_at");

ALTER TABLE "activity_logs"
  ADD CONSTRAINT "activity_logs_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "activity_logs"
  ADD CONSTRAINT "activity_logs_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "activity_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "activity_logs" FORCE ROW LEVEL SECURITY;
CREATE POLICY activity_logs_isolation ON "activity_logs"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'bonpos_app') THEN
    GRANT SELECT, INSERT ON TABLE activity_logs TO bonpos_app;
    -- No UPDATE/DELETE for app role: audit rows are append-only.
  END IF;
END
$$;
