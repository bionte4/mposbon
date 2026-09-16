import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PayrollSlipStatus } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { PayrollService } from './payroll/payroll.service';

@Injectable()
export class HrisPayrollFacade {
  constructor(
    private readonly prisma: PrismaService,
    private readonly payroll: PayrollService,
  ) {}

  listSlips(year?: number, month?: number) {
    const tenant = TenantContext.require();
    return this.prisma.db.payrollSlip.findMany({
      where: {
        tenantId: tenant.id,
        ...(year ? { periodYear: year } : {}),
        ...(month ? { periodMonth: month } : {}),
      },
      include: { employee: true },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
    });
  }

  /**
   * Aggregates attendance overtime for the period, runs PayrollService,
   * and upserts a DRAFT slip. Finalization is a separate explicit step.
   */
  async calculateForEmployee(input: {
    employeeId: string;
    periodYear: number;
    periodMonth: number;
  }) {
    const tenant = TenantContext.require();
    this.assertPeriod(input.periodYear, input.periodMonth);

    const employee = await this.prisma.db.employee.findFirst({
      where: { id: input.employeeId, tenantId: tenant.id },
    });
    if (!employee) {
      throw new NotFoundException('Employee not found');
    }

    const { from, to } = monthRange(input.periodYear, input.periodMonth);
    const attendances = await this.prisma.db.attendance.findMany({
      where: {
        tenantId: tenant.id,
        employeeId: employee.id,
        workDate: { gte: from, lte: to },
        status: { in: ['PRESENT', 'LATE', 'HALF_DAY'] },
      },
    });

    const overtimeMinutes = attendances.reduce((sum, row) => sum + row.overtimeMinutes, 0);
    const presentDays = attendances.length;

    const calc = this.payroll.calculate({
      baseSalaryInCents: employee.baseSalaryInCents,
      overtimeMinutes,
      ptkpStatus: employee.ptkpStatus,
      presentDays,
    });

    const breakdown = calc.breakdown as unknown as Prisma.InputJsonValue;

    return this.prisma.db.payrollSlip.upsert({
      where: {
        tenantId_employeeId_periodYear_periodMonth: {
          tenantId: tenant.id,
          employeeId: employee.id,
          periodYear: input.periodYear,
          periodMonth: input.periodMonth,
        },
      },
      create: {
        tenantId: tenant.id,
        employeeId: employee.id,
        periodYear: input.periodYear,
        periodMonth: input.periodMonth,
        status: PayrollSlipStatus.DRAFT,
        baseSalaryInCents: calc.baseSalaryInCents,
        overtimePayInCents: calc.overtimePayInCents,
        grossInCents: calc.grossInCents,
        pph21InCents: calc.pph21InCents,
        netInCents: calc.netInCents,
        overtimeMinutes: calc.overtimeMinutes,
        presentDays: calc.presentDays,
        breakdown,
        calculatedAt: new Date(),
      },
      update: {
        status: PayrollSlipStatus.DRAFT,
        baseSalaryInCents: calc.baseSalaryInCents,
        overtimePayInCents: calc.overtimePayInCents,
        grossInCents: calc.grossInCents,
        pph21InCents: calc.pph21InCents,
        netInCents: calc.netInCents,
        overtimeMinutes: calc.overtimeMinutes,
        presentDays: calc.presentDays,
        breakdown,
        calculatedAt: new Date(),
      },
      include: { employee: true },
    });
  }

  async finalize(slipId: string) {
    const tenant = TenantContext.require();
    const slip = await this.prisma.db.payrollSlip.findFirst({
      where: { id: slipId, tenantId: tenant.id },
    });
    if (!slip) {
      throw new NotFoundException('Payroll slip not found');
    }
    return this.prisma.db.payrollSlip.update({
      where: { id: slip.id },
      data: { status: PayrollSlipStatus.FINALIZED },
      include: { employee: true },
    });
  }

  private assertPeriod(year: number, month: number): void {
    if (!Number.isInteger(year) || year < 2000) {
      throw new BadRequestException('Invalid periodYear');
    }
    if (!Number.isInteger(month) || month < 1 || month > 12) {
      throw new BadRequestException('Invalid periodMonth');
    }
  }
}

function monthRange(year: number, month: number): { from: Date; to: Date } {
  const from = new Date(Date.UTC(year, month - 1, 1));
  const to = new Date(Date.UTC(year, month, 0));
  return { from, to };
}
