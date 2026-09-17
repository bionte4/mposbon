-- Tenant login/chrome branding (multi-tenant logo without a separate admin product).
ALTER TABLE "tenant_settings"
  ADD COLUMN IF NOT EXISTS "brand_name" TEXT,
  ADD COLUMN IF NOT EXISTS "logo_url" TEXT,
  ADD COLUMN IF NOT EXISTS "accent_color" TEXT;
