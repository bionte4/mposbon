-- HRIS: employees, work shift templates, attendance, payroll slips + RLS

CREATE TYPE "EmployeeStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'TERMINATED');
CREATE TYPE "PtkpStatus" AS ENUM ('TK0', 'TK1', 'TK2', 'TK3', 'K0', 'K1', 'K2', 'K3');
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'HALF_DAY');
CREATE TYPE "PayrollSlipStatus" AS ENUM ('DRAFT', 'FINALIZED');

CREATE TABLE "work_shifts" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_minutes" INTEGER NOT NULL,
    "end_minutes" INTEGER NOT NULL,
    "break_minutes" INTEGER NOT NULL DEFAULT 60,
    "standard_minutes" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_shifts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "work_shifts_minutes_valid" CHECK (
      "start_minutes" >= 0 AND "start_minutes" < 1440
      AND "end_minutes" >= 0 AND "end_minutes" <= 1440
      AND "break_minutes" >= 0
      AND "standard_minutes" > 0
    )
);

CREATE UNIQUE INDEX "work_shifts_tenant_id_code_key" ON "work_shifts"("tenant_id", "code");
CREATE INDEX "work_shifts_tenant_id_idx" ON "work_shifts"("tenant_id");

ALTER TABLE "work_shifts"
  ADD CONSTRAINT "work_shifts_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "employees" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "user_id" UUID,
    "store_id" UUID,
    "employee_code" TEXT NOT NULL,
    "full_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "hire_date" DATE NOT NULL,
    "status" "EmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
    "base_salary_in_cents" INTEGER NOT NULL,
    "ptkp_status" "PtkpStatus" NOT NULL DEFAULT 'TK0',
    "work_shift_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "employees_salary_non_negative" CHECK ("base_salary_in_cents" >= 0)
);

CREATE UNIQUE INDEX "employees_user_id_key" ON "employees"("user_id");
CREATE UNIQUE INDEX "employees_tenant_id_employee_code_key" ON "employees"("tenant_id", "employee_code");
CREATE INDEX "employees_tenant_id_status_idx" ON "employees"("tenant_id", "status");

ALTER TABLE "employees"
  ADD CONSTRAINT "employees_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employees"
  ADD CONSTRAINT "employees_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees"
  ADD CONSTRAINT "employees_store_id_fkey"
  FOREIGN KEY ("store_id") REFERENCES "stores"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "employees"
  ADD CONSTRAINT "employees_work_shift_id_fkey"
  FOREIGN KEY ("work_shift_id") REFERENCES "work_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "attendances" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "work_shift_id" UUID,
    "cashier_shift_id" UUID,
    "work_date" DATE NOT NULL,
    "clock_in_at" TIMESTAMP(3),
    "clock_out_at" TIMESTAMP(3),
    "status" "AttendanceStatus" NOT NULL DEFAULT 'PRESENT',
    "scheduled_minutes" INTEGER NOT NULL DEFAULT 0,
    "worked_minutes" INTEGER NOT NULL DEFAULT 0,
    "overtime_minutes" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendances_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "attendances_minutes_non_negative" CHECK (
      "scheduled_minutes" >= 0 AND "worked_minutes" >= 0 AND "overtime_minutes" >= 0
    )
);

CREATE UNIQUE INDEX "attendances_tenant_id_employee_id_work_date_key"
  ON "attendances"("tenant_id", "employee_id", "work_date");
CREATE INDEX "attendances_tenant_id_work_date_idx" ON "attendances"("tenant_id", "work_date");

ALTER TABLE "attendances"
  ADD CONSTRAINT "attendances_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendances"
  ADD CONSTRAINT "attendances_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "attendances"
  ADD CONSTRAINT "attendances_work_shift_id_fkey"
  FOREIGN KEY ("work_shift_id") REFERENCES "work_shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "payroll_slips" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "employee_id" UUID NOT NULL,
    "period_year" INTEGER NOT NULL,
    "period_month" INTEGER NOT NULL,
    "status" "PayrollSlipStatus" NOT NULL DEFAULT 'DRAFT',
    "base_salary_in_cents" INTEGER NOT NULL,
    "overtime_pay_in_cents" INTEGER NOT NULL DEFAULT 0,
    "gross_in_cents" INTEGER NOT NULL,
    "pph21_in_cents" INTEGER NOT NULL DEFAULT 0,
    "net_in_cents" INTEGER NOT NULL,
    "overtime_minutes" INTEGER NOT NULL DEFAULT 0,
    "present_days" INTEGER NOT NULL DEFAULT 0,
    "breakdown" JSONB,
    "calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_slips_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "payroll_slips_period_valid" CHECK (
      "period_month" >= 1 AND "period_month" <= 12 AND "period_year" >= 2000
    ),
    CONSTRAINT "payroll_slips_money_non_negative" CHECK (
      "base_salary_in_cents" >= 0
      AND "overtime_pay_in_cents" >= 0
      AND "gross_in_cents" >= 0
      AND "pph21_in_cents" >= 0
      AND "net_in_cents" >= 0
    )
);

CREATE UNIQUE INDEX "payroll_slips_tenant_id_employee_id_period_year_period_month_key"
  ON "payroll_slips"("tenant_id", "employee_id", "period_year", "period_month");
CREATE INDEX "payroll_slips_tenant_id_period_year_period_month_idx"
  ON "payroll_slips"("tenant_id", "period_year", "period_month");

ALTER TABLE "payroll_slips"
  ADD CONSTRAINT "payroll_slips_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "payroll_slips"
  ADD CONSTRAINT "payroll_slips_employee_id_fkey"
  FOREIGN KEY ("employee_id") REFERENCES "employees"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_shifts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "work_shifts" FORCE ROW LEVEL SECURITY;
CREATE POLICY work_shifts_isolation ON "work_shifts"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "employees" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "employees" FORCE ROW LEVEL SECURITY;
CREATE POLICY employees_isolation ON "employees"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "attendances" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "attendances" FORCE ROW LEVEL SECURITY;
CREATE POLICY attendances_isolation ON "attendances"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

ALTER TABLE "payroll_slips" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payroll_slips" FORCE ROW LEVEL SECURITY;
CREATE POLICY payroll_slips_isolation ON "payroll_slips"
  USING (tenant_id = app_current_tenant_id())
  WITH CHECK (tenant_id = app_current_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'bonpos_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      work_shifts, employees, attendances, payroll_slips TO bonpos_app;
  END IF;
END
$$;
