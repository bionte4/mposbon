import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PaymentMethod, ShiftStatus, ActivityAction } from '@prisma/client';
import { AuthContext } from '../auth/auth-context';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { assertInt } from '../pos/money';

export type ClockInInput = {
  storeId: string;
  openingFloatInCents: number;
};

export type ClockOutInput = {
  shiftId: string;
  countedCashInCents: number;
};

@Injectable()
export class ShiftService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async getActiveForActor() {
    const tenant = TenantContext.require();
    const actor = AuthContext.require();
    return this.prisma.db.cashierShift.findFirst({
      where: {
        tenantId: tenant.id,
        cashierUserId: actor.id,
        status: ShiftStatus.OPEN,
      },
    });
  }

  async clockIn(input: ClockInInput) {
    const tenant = TenantContext.require();
    const actor = AuthContext.require();
    assertInt(input.openingFloatInCents, 'openingFloatInCents');
    if (input.openingFloatInCents < 0) {
      throw new BadRequestException('openingFloatInCents must be >= 0');
    }

    const store = await this.prisma.db.store.findFirst({
      where: { id: input.storeId, tenantId: tenant.id },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const existing = await this.getActiveForActor();
    if (existing) {
      throw new ConflictException('Cashier already has an open shift');
    }

    const shift = await this.prisma.db.cashierShift.create({
      data: {
        tenantId: tenant.id,
        storeId: input.storeId,
        cashierUserId: actor.id,
        status: ShiftStatus.OPEN,
        clockInAt: new Date(),
        openingFloatInCents: input.openingFloatInCents,
      },
    });

    await this.syncAttendanceFromShift({
      tenantId: tenant.id,
      cashierUserId: actor.id,
      cashierShiftId: shift.id,
      clockInAt: shift.clockInAt,
    });

    await this.audit.log({
      action: ActivityAction.SHIFT_CLOCK_IN,
      entityType: 'cashier_shift',
      entityId: shift.id,
      amountInCents: input.openingFloatInCents,
      metadata: { storeId: input.storeId },
    });

    return shift;
  }

  /**
   * Clock-out closes the shift and materializes Z-Report / cash drawer reconciliation.
   * expectedCash = openingFloat + cashSales - cashRefunds - cashDrops (integer sen).
   */
  async clockOut(input: ClockOutInput) {
    const tenant = TenantContext.require();
    const actor = AuthContext.require();
    assertInt(input.countedCashInCents, 'countedCashInCents');
    if (input.countedCashInCents < 0) {
      throw new BadRequestException('countedCashInCents must be >= 0');
    }

    const shift = await this.prisma.db.cashierShift.findFirst({
      where: { id: input.shiftId, tenantId: tenant.id },
    });
    if (!shift) {
      throw new NotFoundException('Shift not found');
    }
    if (shift.status !== ShiftStatus.OPEN) {
      throw new ConflictException('Shift is already closed');
    }
    if (shift.cashierUserId !== actor.id && !actor.permissions.includes('shift.view_all')) {
      throw new ForbiddenException('Cannot close another cashier shift');
    }

    const expectedCashInCents = this.computeExpectedCash(shift);
    const discrepancyInCents = input.countedCashInCents - expectedCashInCents;

    const closed = await this.prisma.db.cashierShift.update({
      where: { id: shift.id },
      data: {
        status: ShiftStatus.CLOSED,
        clockOutAt: new Date(),
        expectedCashInCents,
        countedCashInCents: input.countedCashInCents,
        discrepancyInCents,
      },
    });

    await this.syncAttendanceFromShift({
      tenantId: tenant.id,
      cashierUserId: shift.cashierUserId,
      cashierShiftId: closed.id,
      clockInAt: shift.clockInAt,
      clockOutAt: closed.clockOutAt,
    });

    await this.audit.log({
      action: ActivityAction.SHIFT_CLOCK_OUT,
      entityType: 'cashier_shift',
      entityId: closed.id,
      amountInCents: discrepancyInCents,
      metadata: {
        expectedCashInCents,
        countedCashInCents: input.countedCashInCents,
        discrepancyInCents,
        cashRefundsInCents: shift.cashRefundsInCents,
        cashDropsInCents: shift.cashDropsInCents,
      },
    });

    return closed;
  }

  /**
   * Remove cash from drawer mid-shift (safe drop to back office).
   * Blind to expected: cashier only enters amount removed.
   */
  async cashDrop(input: { shiftId: string; amountInCents: number; note?: string }) {
    const tenant = TenantContext.require();
    const actor = AuthContext.require();
    assertInt(input.amountInCents, 'amountInCents');
    if (input.amountInCents < 1) {
      throw new BadRequestException('amountInCents must be >= 1');
    }

    const shift = await this.requireOpenOwnShift(input.shiftId);
    const expectedAtInCents = this.computeExpectedCash(shift);
    if (input.amountInCents > expectedAtInCents) {
      throw new BadRequestException('Cash drop exceeds expected drawer cash');
    }

    const movement = await this.prisma.db.cashDrawerMovement.create({
      data: {
        tenantId: tenant.id,
        shiftId: shift.id,
        type: 'DROP',
        amountInCents: input.amountInCents,
        expectedAtInCents,
        varianceInCents: null,
        note: input.note ?? null,
        createdByUserId: actor.id,
      },
    });

    const updated = await this.prisma.db.cashierShift.update({
      where: { id: shift.id },
      data: { cashDropsInCents: { increment: input.amountInCents } },
    });

    await this.audit.log({
      action: ActivityAction.CASH_DROP,
      entityType: 'cashier_shift',
      entityId: shift.id,
      amountInCents: input.amountInCents,
      metadata: {
        movementId: movement.id,
        expectedAtInCents,
        note: input.note ?? null,
      },
    });

    return {
      movement,
      shift: updated,
      expectedCashInCents: this.computeExpectedCash(updated),
    };
  }

  /**
   * Blind mid-shift count: cashier submits counted cash without seeing expected.
   * Response reveals expected + variance after commit.
   */
  async midCount(input: { shiftId: string; countedCashInCents: number; note?: string }) {
    const tenant = TenantContext.require();
    const actor = AuthContext.require();
    assertInt(input.countedCashInCents, 'countedCashInCents');
    if (input.countedCashInCents < 0) {
      throw new BadRequestException('countedCashInCents must be >= 0');
    }

    const shift = await this.requireOpenOwnShift(input.shiftId);
    const expectedAtInCents = this.computeExpectedCash(shift);
    const varianceInCents = input.countedCashInCents - expectedAtInCents;

    const movement = await this.prisma.db.cashDrawerMovement.create({
      data: {
        tenantId: tenant.id,
        shiftId: shift.id,
        type: 'MID_COUNT',
        amountInCents: input.countedCashInCents,
        expectedAtInCents,
        varianceInCents,
        note: input.note ?? null,
        createdByUserId: actor.id,
      },
    });

    await this.audit.log({
      action: ActivityAction.MID_COUNT,
      entityType: 'cashier_shift',
      entityId: shift.id,
      amountInCents: varianceInCents,
      metadata: {
        movementId: movement.id,
        countedCashInCents: input.countedCashInCents,
        expectedAtInCents,
        varianceInCents,
      },
    });

    return {
      movement,
      // Reveal expected only after blind submit (Square-style).
      expectedCashInCents: expectedAtInCents,
      countedCashInCents: input.countedCashInCents,
      varianceInCents,
    };
  }

  async listMovements(shiftId: string) {
    const tenant = TenantContext.require();
    const actor = AuthContext.require();
    const shift = await this.prisma.db.cashierShift.findFirst({
      where: { id: shiftId, tenantId: tenant.id },
    });
    if (!shift) {
      throw new NotFoundException('Shift not found');
    }
    if (shift.cashierUserId !== actor.id && !actor.permissions.includes('shift.view_all')) {
      throw new ForbiddenException('Cannot view another cashier drawer movements');
    }
    return this.prisma.db.cashDrawerMovement.findMany({
      where: { tenantId: tenant.id, shiftId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async getZReport(shiftId: string) {
    return this.getShiftReport(shiftId, 'Z');
  }

  /**
   * X = mid-shift snapshot (OPEN only). Z = closing / archive report (any status).
   */
  async getShiftReport(shiftId: string, kind: 'X' | 'Z') {
    const tenant = TenantContext.require();
    const actor = AuthContext.require();
    const shift = await this.prisma.db.cashierShift.findFirst({
      where: { id: shiftId, tenantId: tenant.id },
      include: {
        cashier: { select: { id: true, displayName: true, email: true, role: true } },
        store: { select: { id: true, code: true, name: true } },
      },
    });
    if (!shift) {
      throw new NotFoundException('Shift not found');
    }
    if (shift.cashierUserId !== actor.id && !actor.permissions.includes('shift.view_all')) {
      throw new ForbiddenException('Cannot view another cashier report');
    }
    if (kind === 'X' && shift.status !== ShiftStatus.OPEN) {
      throw new BadRequestException('X-Report is only available for open shifts');
    }

    const grossSalesInCents =
      shift.cashSalesInCents +
      shift.cardSalesInCents +
      shift.qrisSalesInCents +
      shift.otherSalesInCents;

    const expectedCashInCents =
      shift.expectedCashInCents ?? this.computeExpectedCash(shift);

    return {
      reportType: kind,
      shift: {
        id: shift.id,
        status: shift.status,
        clockInAt: shift.clockInAt,
        clockOutAt: shift.clockOutAt,
        cashier: shift.cashier,
        store: shift.store,
      },
      sales: {
        count: shift.saleCount,
        cashInCents: shift.cashSalesInCents,
        cardInCents: shift.cardSalesInCents,
        qrisInCents: shift.qrisSalesInCents,
        otherInCents: shift.otherSalesInCents,
        grossInCents: grossSalesInCents,
        voidInCents: shift.voidTotalInCents,
        cashRefundsInCents: shift.cashRefundsInCents,
        discountInCents: shift.discountTotalInCents,
        tipsInCents: shift.tipsInCents,
        netInCents: grossSalesInCents - shift.voidTotalInCents - shift.discountTotalInCents,
      },
      drawer: {
        openingFloatInCents: shift.openingFloatInCents,
        cashDropsInCents: shift.cashDropsInCents,
        expectedCashInCents,
        countedCashInCents: shift.countedCashInCents,
        discrepancyInCents:
          shift.discrepancyInCents ??
          (shift.countedCashInCents != null
            ? shift.countedCashInCents - expectedCashInCents
            : null),
      },
    };
  }

  /** Paginated/filterable archive of shifts for management reopen of X/Z reports. */
  async listArchive(query: {
    from?: string;
    to?: string;
    storeId?: string;
    status?: 'OPEN' | 'CLOSED' | 'ALL';
  }) {
    const tenant = TenantContext.require();
    const actor = AuthContext.require();
    const canViewAll = actor.permissions.includes('shift.view_all');
    const { from, to } = resolveArchiveRange(query.from, query.to);
    const statusFilter =
      query.status === 'OPEN'
        ? ShiftStatus.OPEN
        : query.status === 'CLOSED'
          ? ShiftStatus.CLOSED
          : query.status === 'ALL'
            ? undefined
            : ShiftStatus.CLOSED;

    const rows = await this.prisma.db.cashierShift.findMany({
      where: {
        tenantId: tenant.id,
        ...(canViewAll ? {} : { cashierUserId: actor.id }),
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(query.storeId ? { storeId: query.storeId } : {}),
        OR: [
          { clockOutAt: { gte: from, lte: to } },
          {
            clockOutAt: null,
            clockInAt: { gte: from, lte: to },
          },
        ],
      },
      include: {
        cashier: { select: { id: true, displayName: true, email: true } },
        store: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ clockOutAt: 'desc' }, { clockInAt: 'desc' }],
      take: 200,
    });

    return {
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      scope: canViewAll ? 'store' : 'cashier',
      items: rows.map((s) => {
        const expected = s.expectedCashInCents ?? this.computeExpectedCash(s);
        const gross =
          s.cashSalesInCents + s.cardSalesInCents + s.qrisSalesInCents + s.otherSalesInCents;
        return {
          shiftId: s.id,
          status: s.status,
          clockInAt: s.clockInAt,
          clockOutAt: s.clockOutAt,
          cashier: s.cashier,
          store: s.store,
          saleCount: s.saleCount,
          grossSalesInCents: gross,
          openingFloatInCents: s.openingFloatInCents,
          expectedCashInCents: expected,
          countedCashInCents: s.countedCashInCents,
          discrepancyInCents:
            s.discrepancyInCents ??
            (s.countedCashInCents != null ? s.countedCashInCents - expected : null),
        };
      }),
    };
  }

  /** Called inside the same tenant transaction as sale sync. Supports split tender. */
  async attachSalePayments(
    shiftId: string,
    payments: Array<{ paymentMethod: PaymentMethod; amountInCents: number }>,
    discountInCents: number,
    tipInCents = 0,
  ): Promise<void> {
    assertInt(discountInCents, 'discountInCents');
    assertInt(tipInCents, 'tipInCents');
    let cash = 0;
    let card = 0;
    let qris = 0;
    let other = 0;
    for (const p of payments) {
      assertInt(p.amountInCents, 'amountInCents');
      if (p.paymentMethod === 'CASH') cash += p.amountInCents;
      else if (p.paymentMethod === 'CARD') card += p.amountInCents;
      else if (p.paymentMethod === 'QRIS') qris += p.amountInCents;
      else if (p.paymentMethod !== 'SPLIT') other += p.amountInCents;
    }
    await this.prisma.db.cashierShift.update({
      where: { id: shiftId },
      data: {
        saleCount: { increment: 1 },
        discountTotalInCents: { increment: discountInCents },
        ...(tipInCents ? { tipsInCents: { increment: tipInCents } } : {}),
        ...(cash ? { cashSalesInCents: { increment: cash } } : {}),
        ...(card ? { cardSalesInCents: { increment: card } } : {}),
        ...(qris ? { qrisSalesInCents: { increment: qris } } : {}),
        ...(other ? { otherSalesInCents: { increment: other } } : {}),
      },
    });
  }

  /** @deprecated Prefer attachSalePayments for split tender. */
  async attachSaleTotals(
    shiftId: string,
    paymentMethod: PaymentMethod,
    totalInCents: number,
    discountInCents: number,
  ): Promise<void> {
    await this.attachSalePayments(
      shiftId,
      [{ paymentMethod, amountInCents: totalInCents }],
      discountInCents,
    );
  }

  /**
   * Reverse tender buckets after void/refund. Keeps saleCount (historical) but
   * moves cash out of expected drawer via cashRefundsInCents for CASH tenders.
   */
  async reverseSalePayments(
    shiftId: string,
    payments: Array<{ paymentMethod: PaymentMethod; amountInCents: number }>,
  ): Promise<void> {
    let cash = 0;
    let card = 0;
    let qris = 0;
    let other = 0;
    let voidTotal = 0;
    for (const p of payments) {
      assertInt(p.amountInCents, 'amountInCents');
      voidTotal += p.amountInCents;
      if (p.paymentMethod === 'CASH') cash += p.amountInCents;
      else if (p.paymentMethod === 'CARD') card += p.amountInCents;
      else if (p.paymentMethod === 'QRIS') qris += p.amountInCents;
      else if (p.paymentMethod !== 'SPLIT') other += p.amountInCents;
    }
    await this.prisma.db.cashierShift.update({
      where: { id: shiftId },
      data: {
        voidTotalInCents: { increment: voidTotal },
        ...(cash ? { cashRefundsInCents: { increment: cash } } : {}),
        ...(card ? { cardSalesInCents: { decrement: card } } : {}),
        ...(qris ? { qrisSalesInCents: { decrement: qris } } : {}),
        ...(other ? { otherSalesInCents: { decrement: other } } : {}),
      },
    });
  }

  async reverseSaleTotals(
    shiftId: string,
    paymentMethod: PaymentMethod,
    totalInCents: number,
  ): Promise<void> {
    await this.reverseSalePayments(shiftId, [
      { paymentMethod, amountInCents: totalInCents },
    ]);
  }

  computeExpectedCash(shift: {
    openingFloatInCents: number;
    cashSalesInCents: number;
    cashRefundsInCents: number;
    cashDropsInCents: number;
  }): number {
    return (
      shift.openingFloatInCents +
      shift.cashSalesInCents -
      shift.cashRefundsInCents -
      shift.cashDropsInCents
    );
  }

  private async requireOpenOwnShift(shiftId: string) {
    const tenant = TenantContext.require();
    const actor = AuthContext.require();
    const shift = await this.prisma.db.cashierShift.findFirst({
      where: { id: shiftId, tenantId: tenant.id },
    });
    if (!shift) {
      throw new NotFoundException('Shift not found');
    }
    if (shift.status !== ShiftStatus.OPEN) {
      throw new ConflictException('Shift is not open');
    }
    if (shift.cashierUserId !== actor.id && !actor.permissions.includes('shift.view_all')) {
      throw new ForbiddenException('Cannot modify another cashier shift');
    }
    return shift;
  }

  /**
   * When the POS actor has a linked Employee profile, upsert Attendance and
   * bind cashierShiftId so payroll / OT can correlate with the drawer session.
   */
  private async syncAttendanceFromShift(input: {
    tenantId: string;
    cashierUserId: string;
    cashierShiftId: string;
    clockInAt: Date;
    clockOutAt?: Date | null;
  }): Promise<void> {
    const employee = await this.prisma.db.employee.findFirst({
      where: {
        tenantId: input.tenantId,
        userId: input.cashierUserId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (!employee) {
      return;
    }

    const workDate = new Date(
      Date.UTC(
        input.clockInAt.getUTCFullYear(),
        input.clockInAt.getUTCMonth(),
        input.clockInAt.getUTCDate(),
      ),
    );

    const existing = await this.prisma.db.attendance.findUnique({
      where: {
        tenantId_employeeId_workDate: {
          tenantId: input.tenantId,
          employeeId: employee.id,
          workDate,
        },
      },
    });

    if (!existing) {
      await this.prisma.db.attendance.create({
        data: {
          tenantId: input.tenantId,
          employeeId: employee.id,
          cashierShiftId: input.cashierShiftId,
          workDate,
          clockInAt: input.clockInAt,
          clockOutAt: input.clockOutAt ?? null,
          status: 'PRESENT',
        },
      });
      return;
    }

    const workedMinutes =
      input.clockOutAt != null
        ? Math.max(
            0,
            Math.round(
              (input.clockOutAt.getTime() - (existing.clockInAt ?? input.clockInAt).getTime()) /
                60_000,
            ),
          )
        : existing.workedMinutes;

    await this.prisma.db.attendance.update({
      where: { id: existing.id },
      data: {
        cashierShiftId: input.cashierShiftId,
        clockInAt: existing.clockInAt ?? input.clockInAt,
        clockOutAt: input.clockOutAt ?? existing.clockOutAt,
        workedMinutes,
        status: 'PRESENT',
      },
    });
  }
}

function resolveArchiveRange(from?: string, to?: string): { from: Date; to: Date } {
  const end = to ? new Date(to) : new Date();
  if (Number.isNaN(end.getTime())) {
    throw new BadRequestException('Invalid to date');
  }
  const start = from
    ? new Date(from)
    : new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 29));
  if (Number.isNaN(start.getTime())) {
    throw new BadRequestException('Invalid from date');
  }
  const fromDate = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );
  let toDate = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  // Inclusive end-of-day for date-only filters.
  if (!to || /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    toDate = new Date(toDate.getTime() + 24 * 60 * 60 * 1000 - 1);
  }
  return { from: fromDate, to: toDate };
}
