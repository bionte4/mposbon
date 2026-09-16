-- Shared-schema multi-tenancy with PostgreSQL Row-Level Security.
-- App connections MUST use bonpos_app (NOBYPASSRLS). Migrations use the superuser.

CREATE TYPE "DeploymentMode" AS ENUM ('CLOUD', 'ONPREM');
CREATE TYPE "TenantStatus" AS ENUM ('PROVISIONING', 'ACTIVE', 'SUSPENDED');

CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "deployment_mode" "DeploymentMode" NOT NULL DEFAULT 'CLOUD',
    "license_key_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");

CREATE TABLE "tenant_settings" (
    "tenant_id" UUID NOT NULL,
    "currency_code" TEXT NOT NULL DEFAULT 'IDR',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Jakarta',
    "edge_sync_enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_settings_pkey" PRIMARY KEY ("tenant_id")
);

ALTER TABLE "tenant_settings"
  ADD CONSTRAINT "tenant_settings_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'cashier',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_tenant_id_email_key" ON "users"("tenant_id", "email");
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

ALTER TABLE "users"
  ADD CONSTRAINT "users_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "stores" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stores_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stores_tenant_id_code_key" ON "stores"("tenant_id", "code");
CREATE INDEX "stores_tenant_id_idx" ON "stores"("tenant_id");

ALTER TABLE "stores"
  ADD CONSTRAINT "stores_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SECURITY DEFINER lookup: tenant slug/domain resolution happens BEFORE RLS GUC is set.
CREATE OR REPLACE FUNCTION resolve_tenant_by_slug(p_slug text)
RETURNS TABLE (
  id uuid,
  slug text,
  name text,
  status "TenantStatus",
  deployment_mode "DeploymentMode",
  domain text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT t.id, t.slug, t.name, t.status, t.deployment_mode, t.domain
  FROM tenants t
  WHERE t.slug = p_slug
  LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION resolve_tenant_by_domain(p_domain text)
RETURNS TABLE (
  id uuid,
  slug text,
  name text,
  status "TenantStatus",
  deployment_mode "DeploymentMode",
  domain text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT t.id, t.slug, t.name, t.status, t.deployment_mode, t.domain
  FROM tenants t
  WHERE t.domain = p_domain
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION resolve_tenant_by_slug(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION resolve_tenant_by_domain(text) FROM PUBLIC;

-- Runtime GUC used by RLS: set_config('app.current_tenant_id', uuid, true) per request.
CREATE OR REPLACE FUNCTION app_current_tenant_id() RETURNS uuid AS $$
DECLARE
  raw text;
BEGIN
  raw := current_setting('app.current_tenant_id', true);
  IF raw IS NULL OR raw = '' THEN
    RETURN NULL;
  END IF;
  RETURN raw::uuid;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN NULL;
END;
$$ LANGUAGE plpgsql STABLE;

-- Tenant catalog: on-prem locks visibility to the session tenant; cloud can list
-- the current tenant. Superuser (migrations) bypasses RLS automatically.
ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenants" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenants_isolation ON "tenants"
  USING (id = app_current_tenant_id())
  WITH CHECK (id = app_current_tenant_id());

ALTER TABLE "tenant_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_settings_isolation ON "tenant_settings"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "users" FORCE ROW LEVEL SECURITY;
CREATE POLICY users_isolation ON "users"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stores" FORCE ROW LEVEL SECURITY;
CREATE POLICY stores_isolation ON "stores"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

-- Privileges for the non-bypass application role.
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'bonpos_app') THEN
    GRANT USAGE ON SCHEMA public TO bonpos_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO bonpos_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO bonpos_app;
    GRANT EXECUTE ON FUNCTION resolve_tenant_by_slug(text) TO bonpos_app;
    GRANT EXECUTE ON FUNCTION resolve_tenant_by_domain(text) TO bonpos_app;
    GRANT EXECUTE ON FUNCTION app_current_tenant_id() TO bonpos_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO bonpos_app;
  END IF;
END
$$;
