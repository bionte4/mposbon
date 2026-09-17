-- Finance integration: API keys, GL account mappings, outbound webhooks

CREATE TYPE "GlExternalProvider" AS ENUM ('ACCURATE', 'JURNAL', 'XERO', 'QUICKBOOKS', 'CUSTOM');

CREATE TABLE "integration_api_keys" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL,
    "created_by_user_id" UUID,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_api_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_api_keys_tenant_id_key_prefix_key"
  ON "integration_api_keys"("tenant_id", "key_prefix");
CREATE INDEX "integration_api_keys_tenant_id_revoked_at_idx"
  ON "integration_api_keys"("tenant_id", "revoked_at");

ALTER TABLE "integration_api_keys"
  ADD CONSTRAINT "integration_api_keys_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_api_keys"
  ADD CONSTRAINT "integration_api_keys_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "gl_account_mappings" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" "GlExternalProvider" NOT NULL,
    "gl_account_id" UUID NOT NULL,
    "account_code" TEXT NOT NULL,
    "external_account_id" TEXT NOT NULL,
    "external_account_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "gl_account_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "gl_account_mappings_tenant_id_provider_gl_account_id_key"
  ON "gl_account_mappings"("tenant_id", "provider", "gl_account_id");
CREATE UNIQUE INDEX "gl_account_mappings_tenant_id_provider_account_code_key"
  ON "gl_account_mappings"("tenant_id", "provider", "account_code");
CREATE INDEX "gl_account_mappings_tenant_id_provider_idx"
  ON "gl_account_mappings"("tenant_id", "provider");

ALTER TABLE "gl_account_mappings"
  ADD CONSTRAINT "gl_account_mappings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "gl_account_mappings"
  ADD CONSTRAINT "gl_account_mappings_gl_account_id_fkey"
  FOREIGN KEY ("gl_account_id") REFERENCES "gl_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "integration_webhooks" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "events" TEXT[] NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_webhooks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "integration_webhooks_tenant_id_is_active_idx"
  ON "integration_webhooks"("tenant_id", "is_active");

ALTER TABLE "integration_webhooks"
  ADD CONSTRAINT "integration_webhooks_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "integration_webhook_deliveries" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "webhook_id" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "payload_json" JSONB NOT NULL,
    "status_code" INTEGER,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "error_message" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "integration_webhook_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "integration_webhook_deliveries_tenant_id_webhook_id_created_at_idx"
  ON "integration_webhook_deliveries"("tenant_id", "webhook_id", "created_at");
CREATE INDEX "integration_webhook_deliveries_tenant_id_success_created_at_idx"
  ON "integration_webhook_deliveries"("tenant_id", "success", "created_at");

ALTER TABLE "integration_webhook_deliveries"
  ADD CONSTRAINT "integration_webhook_deliveries_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_webhook_deliveries"
  ADD CONSTRAINT "integration_webhook_deliveries_webhook_id_fkey"
  FOREIGN KEY ("webhook_id") REFERENCES "integration_webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RLS
ALTER TABLE "integration_api_keys" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_api_keys" FORCE ROW LEVEL SECURITY;
CREATE POLICY integration_api_keys_isolation ON "integration_api_keys"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "gl_account_mappings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "gl_account_mappings" FORCE ROW LEVEL SECURITY;
CREATE POLICY gl_account_mappings_isolation ON "gl_account_mappings"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "integration_webhooks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_webhooks" FORCE ROW LEVEL SECURITY;
CREATE POLICY integration_webhooks_isolation ON "integration_webhooks"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "integration_webhook_deliveries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "integration_webhook_deliveries" FORCE ROW LEVEL SECURITY;
CREATE POLICY integration_webhook_deliveries_isolation ON "integration_webhook_deliveries"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());
