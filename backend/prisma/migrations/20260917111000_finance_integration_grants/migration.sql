-- Ensure app role can use finance integration tables
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'bonpos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      integration_api_keys,
      gl_account_mappings,
      integration_webhooks,
      integration_webhook_deliveries
      TO bonpos_app;
  END IF;
END $$;
