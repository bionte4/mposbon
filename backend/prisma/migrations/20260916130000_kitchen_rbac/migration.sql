-- Kitchen RBAC: KITCHEN staff role + per-station assignment

ALTER TYPE "StaffRole" ADD VALUE IF NOT EXISTS 'KITCHEN';

CREATE TABLE "user_kitchen_stations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "user_kitchen_stations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "user_kitchen_stations_user_id_station_id_key"
  ON "user_kitchen_stations"("user_id", "station_id");
CREATE INDEX "user_kitchen_stations_tenant_id_user_id_idx"
  ON "user_kitchen_stations"("tenant_id", "user_id");
CREATE INDEX "user_kitchen_stations_tenant_id_station_id_idx"
  ON "user_kitchen_stations"("tenant_id", "station_id");

ALTER TABLE "user_kitchen_stations"
  ADD CONSTRAINT "user_kitchen_stations_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_kitchen_stations"
  ADD CONSTRAINT "user_kitchen_stations_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_kitchen_stations"
  ADD CONSTRAINT "user_kitchen_stations_station_id_fkey"
  FOREIGN KEY ("station_id") REFERENCES "kitchen_stations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "user_kitchen_stations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "user_kitchen_stations" FORCE ROW LEVEL SECURITY;
CREATE POLICY user_kitchen_stations_isolation ON "user_kitchen_stations"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'bonpos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE user_kitchen_stations TO bonpos_app;
  END IF;
END $$;
