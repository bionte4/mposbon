export type StaffRole =
  | 'CASHIER'
  | 'KITCHEN'
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
  | 'kitchen.display'
  | 'kitchen.bump'
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
  | 'admin.inventory.read'
  | 'admin.inventory.write'
  | 'admin.purchasing.write'
  | 'admin.outlet.write'
  | 'admin.staff.read'
  | 'admin.staff.write'
  | 'admin.finance.read'
  | 'admin.finance.write';

const POS_BASE: Permission[] = [
  'pos.sale.create',
  'pos.void',
  'pos.discount.manual',
  'pos.drawer.open_force',
  'shift.clock',
  'shift.z_report',
  'dashboard.read',
];

/** KDS view + bump — kitchen/bar staff; also granted to supervisors+ for oversight. */
const KITCHEN_BASE: Permission[] = ['kitchen.display', 'kitchen.bump'];

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

/** Full admin surface for Manager+. */
const ADMIN_ALL: Permission[] = [
  'admin.access',
  'admin.catalog.write',
  'admin.inventory.read',
  'admin.inventory.write',
  'admin.purchasing.write',
  'admin.outlet.write',
  'admin.staff.read',
  'admin.staff.write',
  'admin.finance.read',
  'admin.finance.write',
];

/** Floor ops: opname, transfer, meja — no staff/GL/catalog master. */
const ADMIN_SUPERVISOR: Permission[] = [
  'admin.access',
  'admin.inventory.read',
  'admin.inventory.write',
  'admin.outlet.write',
];

const ROLE_PERMISSIONS: Record<StaffRole, ReadonlySet<Permission>> = {
  /** Cashiers: POS only — fire to kitchen via sale flow, no KDS bump board. */
  CASHIER: new Set(POS_BASE),
  /** Kitchen/bar: KDS only; station scope via UserKitchenStation. */
  KITCHEN: new Set(KITCHEN_BASE),
  SUPERVISOR: new Set([
    ...POS_BASE,
    ...KITCHEN_BASE,
    'shift.view_all',
    'dashboard.read_store',
    ...ADMIN_SUPERVISOR,
  ]),
  MANAGER: new Set([
    ...POS_BASE,
    ...KITCHEN_BASE,
    'shift.view_all',
    'dashboard.read_store',
    ...HRIS_ALL,
    ...ADMIN_ALL,
  ]),
  TENANT_ADMIN: new Set([
    ...POS_BASE,
    ...KITCHEN_BASE,
    'shift.view_all',
    'dashboard.read_store',
    ...HRIS_ALL,
    ...ADMIN_ALL,
  ]),
  SUPER_ADMIN: new Set([
    ...POS_BASE,
    ...KITCHEN_BASE,
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
