import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AttendanceStatus, EmployeeStatus, PtkpStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';

export type CreateEmployeeInput = {
  employeeCode: string;
  fullName: string;
  email?: string;
  phone?: string;
  hireDate: string;
  storeId?: string | null;
  userId?: string | null;
  workShiftId?: string | null;
  baseSalaryInCents: number;
  ptkpStatus?: PtkpStatus;
};

export type UpdateEmployeeInput = Partial<CreateEmployeeInput> & {
  status?: EmployeeStatus;
};

export type CreateWorkShiftInput = {
  code: string;
  name: string;
  startMinutes: number;
  endMinutes: number;
  breakMinutes?: number;
};

export type UpdateWorkShiftInput = Partial<CreateWorkShiftInput> & {
  isActive?: boolean;
};

export type UpsertAttendanceInput = {
  employeeId: string;
  workDate: string;
  clockInAt?: string | null;
  clockOutAt?: string | null;
  status?: AttendanceStatus;
  workShiftId?: string | null;
  notes?: string | null;
};

@Injectable()
export class HrisService {
  constructor(private readonly prisma: PrismaService) {}

  listEmployees() {
    const tenant = TenantContext.require();
    return this.prisma.db.employee.findMany({
      where: { tenantId: tenant.id },
      include: { workShift: true, store: true },
      orderBy: { employeeCode: 'asc' },
    });
  }

  async createEmployee(input: CreateEmployeeInput) {
    const tenant = TenantContext.require();
    if (!Number.isInteger(input.baseSalaryInCents) || input.baseSalaryInCents < 0) {
      throw new BadRequestException('baseSalaryInCents must be a non-negative integer');
    }
    if (!input.employeeCode?.trim() || !input.fullName?.trim()) {
      throw new BadRequestException('employeeCode and fullName are required');
    }

    return this.prisma.db.employee.create({
      data: {
        tenantId: tenant.id,
        employeeCode: input.employeeCode.trim(),
        fullName: input.fullName.trim(),
        email: input.email ?? null,
        phone: input.phone ?? null,
        hireDate: new Date(input.hireDate),
        storeId: input.storeId ?? null,
        userId: input.userId ?? null,
        workShiftId: input.workShiftId ?? null,
        baseSalaryInCents: input.baseSalaryInCents,
        ptkpStatus: input.ptkpStatus ?? PtkpStatus.TK0,
        status: EmployeeStatus.ACTIVE,
      },
      include: { workShift: true, store: true },
    });
  }

  async updateEmployee(id: string, input: UpdateEmployeeInput) {
    const tenant = TenantContext.require();
    const existing = await this.prisma.db.employee.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!existing) {
      throw new NotFoundException('Employee not found');
    }
    if (
      input.baseSalaryInCents !== undefined &&
      (!Number.isInteger(input.baseSalaryInCents) || input.baseSalaryInCents < 0)
    ) {
      throw new BadRequestException('baseSalaryInCents must be a non-negative integer');
    }

    return this.prisma.db.employee.update({
      where: { id },
      data: {
        ...(input.employeeCode !== undefined
          ? { employeeCode: input.employeeCode.trim() }
          : {}),
        ...(input.fullName !== undefined ? { fullName: input.fullName.trim() } : {}),
        ...(input.email !== undefined ? { email: input.email || null } : {}),
        ...(input.phone !== undefined ? { phone: input.phone || null } : {}),
        ...(input.hireDate !== undefined ? { hireDate: new Date(input.hireDate) } : {}),
        ...(input.storeId !== undefined ? { storeId: input.storeId || null } : {}),
        ...(input.userId !== undefined ? { userId: input.userId || null } : {}),
        ...(input.workShiftId !== undefined
          ? { workShiftId: input.workShiftId || null }
          : {}),
        ...(input.baseSalaryInCents !== undefined
          ? { baseSalaryInCents: input.baseSalaryInCents }
          : {}),
        ...(input.ptkpStatus !== undefined ? { ptkpStatus: input.ptkpStatus } : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
      },
      include: { workShift: true, store: true },
    });
  }

  listWorkShifts() {
    const tenant = TenantContext.require();
    return this.prisma.db.workShift.findMany({
      where: { tenantId: tenant.id },
      orderBy: [{ isActive: 'desc' }, { startMinutes: 'asc' }],
    });
  }

  async createWorkShift(input: CreateWorkShiftInput) {
    const tenant = TenantContext.require();
    this.assertShiftMinutes(input.startMinutes, input.endMinutes, input.breakMinutes ?? 60);
    const breakMinutes = input.breakMinutes ?? 60;
    const span =
      input.endMinutes > input.startMinutes
        ? input.endMinutes - input.startMinutes
        : input.endMinutes + 1440 - input.startMinutes;
    const standardMinutes = Math.max(1, span - breakMinutes);

    return this.prisma.db.workShift.create({
      data: {
        tenantId: tenant.id,
        code: input.code.trim(),
        name: input.name.trim(),
        startMinutes: input.startMinutes,
        endMinutes: input.endMinutes,
        breakMinutes,
        standardMinutes,
      },
    });
  }

  async updateWorkShift(id: string, input: UpdateWorkShiftInput) {
    const tenant = TenantContext.require();
    const existing = await this.prisma.db.workShift.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!existing) {
      throw new NotFoundException('Work shift not found');
    }

    const startMinutes = input.startMinutes ?? existing.startMinutes;
    const endMinutes = input.endMinutes ?? existing.endMinutes;
    const breakMinutes = input.breakMinutes ?? existing.breakMinutes;
    this.assertShiftMinutes(startMinutes, endMinutes, breakMinutes);
    const span =
      endMinutes > startMinutes
        ? endMinutes - startMinutes
        : endMinutes + 1440 - startMinutes;
    const standardMinutes = Math.max(1, span - breakMinutes);

    return this.prisma.db.workShift.update({
      where: { id },
      data: {
        ...(input.code !== undefined ? { code: input.code.trim() } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        startMinutes,
        endMinutes,
        breakMinutes,
        standardMinutes,
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
  }

  listAttendances(from?: string, to?: string) {
    const tenant = TenantContext.require();
    const where: {
      tenantId: string;
      workDate?: { gte?: Date; lte?: Date };
    } = { tenantId: tenant.id };
    if (from || to) {
      where.workDate = {};
      if (from) where.workDate.gte = new Date(from);
      if (to) where.workDate.lte = new Date(to);
    }
    return this.prisma.db.attendance.findMany({
      where,
      include: { employee: true, workShift: true },
      orderBy: [{ workDate: 'desc' }, { clockInAt: 'desc' }],
    });
  }

  async upsertAttendance(input: UpsertAttendanceInput) {
    const tenant = TenantContext.require();
    const employee = await this.prisma.db.employee.findFirst({
      where: { id: input.employeeId, tenantId: tenant.id },
      include: { workShift: true },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const workShiftId = input.workShiftId ?? employee.workShiftId;
    const workShift = workShiftId
      ? await this.prisma.db.workShift.findFirst({
          where: { id: workShiftId, tenantId: tenant.id },
        })
      : null;

    const scheduledMinutes = workShift?.standardMinutes ?? 0;
    const clockInAt = input.clockInAt ? new Date(input.clockInAt) : null;
    const clockOutAt = input.clockOutAt ? new Date(input.clockOutAt) : null;

    let workedMinutes = 0;
    if (clockInAt && clockOutAt && clockOutAt > clockInAt) {
      workedMinutes = Math.floor((clockOutAt.getTime() - clockInAt.getTime()) / 60_000);
    }
    const overtimeMinutes = Math.max(0, workedMinutes - scheduledMinutes);

    const workDate = new Date(input.workDate);

    return this.prisma.db.attendance.upsert({
      where: {
        tenantId_employeeId_workDate: {
          tenantId: tenant.id,
          employeeId: employee.id,
          workDate,
        },
      },
      create: {
        tenantId: tenant.id,
        employeeId: employee.id,
        workShiftId,
        workDate,
        clockInAt,
        clockOutAt,
        status: input.status ?? AttendanceStatus.PRESENT,
        scheduledMinutes,
        workedMinutes,
        overtimeMinutes,
        notes: input.notes ?? null,
      },
      update: {
        workShiftId,
        clockInAt,
        clockOutAt,
        status: input.status ?? AttendanceStatus.PRESENT,
        scheduledMinutes,
        workedMinutes,
        overtimeMinutes,
        notes: input.notes ?? null,
      },
    });
  }

  private assertShiftMinutes(start: number, end: number, breakMinutes: number): void {
    for (const [label, value] of [
      ['startMinutes', start],
      ['endMinutes', end],
      ['breakMinutes', breakMinutes],
    ] as const) {
      if (!Number.isInteger(value) || value < 0) {
        throw new BadRequestException(`${label} must be a non-negative integer`);
      }
    }
    if (start >= 1440 || end > 1440) {
      throw new BadRequestException('Shift minutes must be within a day (0–1440)');
    }
  }
}
