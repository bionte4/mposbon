import { apiGet, apiPatch, apiPost, apiPut } from '../api/client';

export type Employee = {
  id: string;
  employeeCode: string;
  fullName: string;
  email: string | null;
  phone?: string | null;
  hireDate?: string;
  baseSalaryInCents: number;
  ptkpStatus: string;
  status: string;
  workShiftId?: string | null;
  workShift?: { id: string; code: string; name: string } | null;
};

export type WorkShift = {
  id: string;
  code: string;
  name: string;
  startMinutes: number;
  endMinutes: number;
  breakMinutes?: number;
  standardMinutes: number;
  isActive?: boolean;
};

export type Attendance = {
  id: string;
  workDate: string;
  clockInAt: string | null;
  clockOutAt: string | null;
  status: string;
  workedMinutes: number;
  overtimeMinutes: number;
  notes?: string | null;
  employee: { id: string; fullName: string; employeeCode: string };
  workShift?: { id: string; code: string; name: string } | null;
};

export type PayrollSlip = {
  id: string;
  periodYear: number;
  periodMonth: number;
  status: string;
  baseSalaryInCents: number;
  overtimePayInCents: number;
  grossInCents: number;
  pph21InCents: number;
  netInCents: number;
  overtimeMinutes: number;
  presentDays: number;
  employee: { id: string; fullName: string; employeeCode: string };
};

export type EmployeeInput = {
  employeeCode: string;
  fullName: string;
  hireDate: string;
  baseSalaryInCents: number;
  email?: string;
  phone?: string;
  ptkpStatus?: string;
  workShiftId?: string | null;
  status?: string;
};

export type WorkShiftInput = {
  code: string;
  name: string;
  startMinutes: number;
  endMinutes: number;
  breakMinutes?: number;
  isActive?: boolean;
};

export function listEmployees() {
  return apiGet<Employee[]>('/hris/employees');
}

export function createEmployee(body: EmployeeInput) {
  return apiPost<Employee>('/hris/employees', body);
}

export function updateEmployee(id: string, body: Partial<EmployeeInput>) {
  return apiPatch<Employee>(`/hris/employees/${id}`, body);
}

export function listWorkShifts() {
  return apiGet<WorkShift[]>('/hris/work-shifts');
}

export function createWorkShift(body: WorkShiftInput) {
  return apiPost<WorkShift>('/hris/work-shifts', body);
}

export function updateWorkShift(id: string, body: Partial<WorkShiftInput>) {
  return apiPatch<WorkShift>(`/hris/work-shifts/${id}`, body);
}

export function listAttendances(from?: string, to?: string) {
  const q = new URLSearchParams();
  if (from) q.set('from', from);
  if (to) q.set('to', to);
  const suffix = q.toString() ? `?${q}` : '';
  return apiGet<Attendance[]>(`/hris/attendances${suffix}`);
}

export function upsertAttendance(body: {
  employeeId: string;
  workDate: string;
  clockInAt?: string | null;
  clockOutAt?: string | null;
  status?: string;
  workShiftId?: string | null;
  notes?: string | null;
}) {
  return apiPut<Attendance>('/hris/attendances', body);
}

export function listPayrollSlips(year?: number, month?: number) {
  const q = new URLSearchParams();
  if (year) q.set('year', String(year));
  if (month) q.set('month', String(month));
  const suffix = q.toString() ? `?${q}` : '';
  return apiGet<PayrollSlip[]>(`/hris/payroll/slips${suffix}`);
}

export function calculatePayroll(employeeId: string, periodYear: number, periodMonth: number) {
  return apiPost<PayrollSlip>('/hris/payroll/calculate', {
    employeeId,
    periodYear,
    periodMonth,
  });
}

export function finalizePayrollSlip(id: string) {
  return apiPost<PayrollSlip>(`/hris/payroll/slips/${id}/finalize`);
}
