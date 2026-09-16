import { Injectable } from '@nestjs/common';
import { AuthContext } from '../auth/auth-context';
import { roleHasPermission } from '../auth/permissions';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';

export type DashboardQuery = {
  from?: string;
  to?: string;
  storeId?: string;
};

@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Overview metrics from daily_sales_summaries (not live sales table).
   * Cashiers are limited to their own open/closed shift drawer stats.
   */
  async overview(query: DashboardQuery) {
    const tenant = TenantContext.require();
    const actor = AuthContext.require();
    const { from, to } = resolveRange(query.from, query.to);
    const canStore = roleHasPermission(actor.role, 'dashboard.read_store');

    if (!canStore) {
      return this.cashierOverview(tenant.id, actor.id);
    }

    const storeFilter = query.storeId ? { storeId: query.storeId } : {};
    const rows = await this.prisma.db.dailySalesSummary.findMany({
      where: {
        tenantId: tenant.id,
        summaryDate: { gte: from, lte: to },
        ...storeFilter,
      },
      orderBy: { summaryDate: 'asc' },
    });

    const grossSalesInCents = rows.reduce((s, r) => s + r.grossSalesInCents, 0);
    const netSalesInCents = rows.reduce((s, r) => s + r.netSalesInCents, 0);
    const discountInCents = rows.reduce((s, r) => s + r.discountInCents, 0);
    const voidInCents = rows.reduce((s, r) => s + r.voidInCents, 0);
    const transactionCount = rows.reduce((s, r) => s + r.transactionCount, 0);
    const aovInCents =
      transactionCount > 0 ? Math.floor(netSalesInCents / transactionCount) : 0;

    const series = rows.map((r) => ({
      date: r.summaryDate.toISOString().slice(0, 10),
      storeId: r.storeId,
      grossSalesInCents: r.grossSalesInCents,
      netSalesInCents: r.netSalesInCents,
      transactionCount: r.transactionCount,
    }));

    return {
      scope: 'store' as const,
      from: from.toISOString().slice(0, 10),
      to: to.toISOString().slice(0, 10),
      metrics: {
        grossSalesInCents,
        netSalesInCents,
        discountInCents,
        voidInCents,
        transactionCount,
        aovInCents,
      },
      series,
      source: 'daily_sales_summaries',
    };
  }

  async topProducts(query: DashboardQuery & { limit?: number }) {
    const tenant = TenantContext.require();
    const actor = AuthContext.require();
    if (!roleHasPermission(actor.role, 'dashboard.read_store')) {
      return { items: [], scope: 'cashier' as const };
    }
    const { from, to } = resolveRange(query.from, query.to);
    const limit = Math.min(Math.max(query.limit ?? 5, 1), 20);

    // Aggregate from summary table — indexed by (tenant, date, qty).
    const rows = await this.prisma.db.dailyProductSummary.groupBy({
      by: ['productId', 'productName'],
      where: {
        tenantId: tenant.id,
        summaryDate: { gte: from, lte: to },
        ...(query.storeId ? { storeId: query.storeId } : {}),
      },
      _sum: { quantitySold: true, revenueInCents: true },
      orderBy: { _sum: { quantitySold: 'desc' } },
      take: limit,
    });

    return {
      scope: 'store' as const,
      items: rows.map((r) => ({
        productId: r.productId,
        productName: r.productName,
        quantitySold: r._sum.quantitySold ?? 0,
        revenueInCents: r._sum.revenueInCents ?? 0,
      })),
      source: 'daily_product_summaries',
    };
  }

  /**
   * Active shifts + recent closed Z-Reports with cash discrepancy.
   * Cashiers only see their own shifts.
   */
  async shiftWidgets() {
    const tenant = TenantContext.require();
    const actor = AuthContext.require();
    const canViewAll = roleHasPermission(actor.role, 'shift.view_all');

    const cashierFilter = canViewAll ? {} : { cashierUserId: actor.id };

    const openShifts = await this.prisma.db.cashierShift.findMany({
      where: { tenantId: tenant.id, status: 'OPEN', ...cashierFilter },
      include: {
        cashier: { select: { id: true, displayName: true, email: true } },
        store: { select: { id: true, code: true, name: true } },
      },
      orderBy: { clockInAt: 'desc' },
      take: 10,
    });

    const recentClosed = await this.prisma.db.cashierShift.findMany({
      where: { tenantId: tenant.id, status: 'CLOSED', ...cashierFilter },
      include: {
        cashier: { select: { id: true, displayName: true, email: true } },
        store: { select: { id: true, code: true, name: true } },
      },
      orderBy: { clockOutAt: 'desc' },
      take: 8,
    });

    const zReports = recentClosed.map((s) => {
      const expected =
        s.expectedCashInCents ?? s.openingFloatInCents + s.cashSalesInCents;
      const counted = s.countedCashInCents;
      const discrepancy =
        s.discrepancyInCents ??
        (counted != null ? counted - expected : null);
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
        countedCashInCents: counted,
        discrepancyInCents: discrepancy,
      };
    });

    return {
      openShifts: openShifts.map((s) => ({
        shiftId: s.id,
        clockInAt: s.clockInAt,
        cashier: s.cashier,
        store: s.store,
        saleCount: s.saleCount,
        cashSalesInCents: s.cashSalesInCents,
        openingFloatInCents: s.openingFloatInCents,
        expectedCashInCents: s.openingFloatInCents + s.cashSalesInCents,
      })),
      zReports,
      discrepancyAlertCount: zReports.filter(
        (z) => z.discrepancyInCents != null && z.discrepancyInCents !== 0,
      ).length,
    };
  }

  private async cashierOverview(tenantId: string, cashierUserId: string) {
    const open = await this.prisma.db.cashierShift.findFirst({
      where: { tenantId, cashierUserId, status: 'OPEN' },
    });
    const lastClosed = await this.prisma.db.cashierShift.findFirst({
      where: { tenantId, cashierUserId, status: 'CLOSED' },
      orderBy: { clockOutAt: 'desc' },
    });

    const shift = open ?? lastClosed;
    if (!shift) {
      return {
        scope: 'cashier' as const,
        metrics: {
          grossSalesInCents: 0,
          netSalesInCents: 0,
          discountInCents: 0,
          voidInCents: 0,
          transactionCount: 0,
          aovInCents: 0,
        },
        series: [],
        drawer: null,
        source: 'cashier_shifts',
      };
    }

    const gross =
      shift.cashSalesInCents +
      shift.cardSalesInCents +
      shift.qrisSalesInCents +
      shift.otherSalesInCents;
    const net = gross - shift.voidTotalInCents - shift.discountTotalInCents;
    const aov = shift.saleCount > 0 ? Math.floor(net / shift.saleCount) : 0;
    const expected = shift.openingFloatInCents + shift.cashSalesInCents;

    return {
      scope: 'cashier' as const,
      metrics: {
        grossSalesInCents: gross,
        netSalesInCents: net,
        discountInCents: shift.discountTotalInCents,
        voidInCents: shift.voidTotalInCents,
        transactionCount: shift.saleCount,
        aovInCents: aov,
      },
      series: [],
      drawer: {
        shiftId: shift.id,
        status: shift.status,
        openingFloatInCents: shift.openingFloatInCents,
        expectedCashInCents: shift.expectedCashInCents ?? expected,
        countedCashInCents: shift.countedCashInCents,
        discrepancyInCents:
          shift.discrepancyInCents ??
          (shift.countedCashInCents != null
            ? shift.countedCashInCents - expected
            : null),
      },
      source: 'cashier_shifts',
    };
  }
}

function resolveRange(from?: string, to?: string): { from: Date; to: Date } {
  const end = to ? new Date(to) : new Date();
  const start = from
    ? new Date(from)
    : new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() - 6));
  const fromDate = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
  const toDate = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()));
  return { from: fromDate, to: toDate };
}
