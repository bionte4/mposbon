-- Grant app role access to P1 tables (RLS still enforces tenant isolation).
DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'bonpos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      product_modifier_groups,
      product_modifier_options,
      customers
      TO bonpos_app;
  END IF;
END $$;
