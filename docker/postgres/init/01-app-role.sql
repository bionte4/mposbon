-- Runs only on first Postgres data volume init.
-- Superuser (POSTGRES_USER) owns DDL/migrations.
-- bonpos_app is the runtime role: NOBYPASSRLS so tenant policies cannot be skipped.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = current_setting('POSTGRES_APP_USER', true)) THEN
    NULL;
  END IF;
END
$$;

-- docker-entrypoint cannot interpolate custom env into SQL easily; use defaults
-- matching docker-compose (override via matching passwords in .env).
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bonpos_app') THEN
    CREATE ROLE bonpos_app LOGIN PASSWORD 'bonpos_app' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE bonpos TO bonpos_app;
