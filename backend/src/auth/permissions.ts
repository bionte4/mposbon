export type StaffRole =
  | 'CASHIER'
  | 'SUPERVISOR'
  | 'MANAGER'
  | 'TENANT_ADMIN'
  | 'SUPER_ADMIN';

/** Fine-grained permissions. Cashiers must NEVER receive hris.* */
export type Permission =
  | 'pos.sale.create'
  | 'pos.void'
  | 'pos.discount.manual'
  | 'pos.drawer.open_force'
  | 'shift.clock'
  | 'shift.z_report'
  | 'shift.view_all'
  | 'hris.employee.read'
  | 'hris.employee.write'
  | 'hris.attendance.read'
  | 'hris.attendance.write'
  | 'hris.work_shift.read'
  | 'hris.work_shift.write'
  | 'hris.payroll.read'
  | 'hris.payroll.calculate'
  | 'dashboard.read'
  | 'dashboard.read_store'
  | 'admin.access'
  | 'admin.catalog.write'
  | 'admin.staff.read'
  | 'admin.staff.write';

const POS_BASE: Permission[] = [
  'pos.sale.create',
  'pos.void',
  'pos.discount.manual',
  'pos.drawer.open_force',
  'shift.clock',
  'shift.z_report',
  'dashboard.read',
];

const HRIS_ALL: Permission[] = [
  'hris.employee.read',
  'hris.employee.write',
  'hris.attendance.read',
  'hris.attendance.write',
  'hris.work_shift.read',
  'hris.work_shift.write',
  'hris.payroll.read',
  'hris.payroll.calculate',
];

const ADMIN_ALL: Permission[] = [
  'admin.access',
  'admin.catalog.write',
  'admin.staff.read',
  'admin.staff.write',
];

const ROLE_PERMISSIONS: Record<StaffRole, ReadonlySet<Permission>> = {
  /** Cashiers: own drawer metrics only (dashboard.read without read_store). */
  CASHIER: new Set(POS_BASE),
  SUPERVISOR: new Set([...POS_BASE, 'shift.view_all', 'dashboard.read_store']),
  MANAGER: new Set([
    ...POS_BASE,
    'shift.view_all',
    'dashboard.read_store',
    ...HRIS_ALL,
    ...ADMIN_ALL,
  ]),
  TENANT_ADMIN: new Set([
    ...POS_BASE,
    'shift.view_all',
    'dashboard.read_store',
    ...HRIS_ALL,
    ...ADMIN_ALL,
  ]),
  SUPER_ADMIN: new Set([
    ...POS_BASE,
    'shift.view_all',
    'dashboard.read_store',
    ...HRIS_ALL,
    ...ADMIN_ALL,
  ]),
};

export const PIN_REQUIRED_PERMISSIONS: ReadonlySet<Permission> = new Set([
  'pos.void',
  'pos.discount.manual',
  'pos.drawer.open_force',
]);

export function roleHasPermission(role: StaffRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

export function permissionsForRole(role: StaffRole): Permission[] {
  return [...(ROLE_PERMISSIONS[role] ?? [])];
}

export function isSupervisorCapable(role: StaffRole): boolean {
  return role === 'SUPERVISOR' || role === 'MANAGER' || role === 'TENANT_ADMIN' || role === 'SUPER_ADMIN';
}
