import { Injectable } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';

export type SaleSummaryDelta = {
  tenantId: string;
  storeId: string;
  /** ISO date or Date — normalized to UTC calendar date. */
  at: Date | string;
  grossInCents: number;
  discountInCents: number;
  netInCents: number;
  paymentMethod: PaymentMethod;
  lines: Array<{ productId: string; productName: string; quantity: number; revenueInCents: number }>;
};

/**
 * Incremental rollup writer. Runs inside the same tenant transaction as checkout
 * so dashboard never needs to scan operational sales during peak hours.
 */
@Injectable()
export class AnalyticsSummaryService {
  constructor(private readonly prisma: PrismaService) {}

  async applySale(delta: SaleSummaryDelta): Promise<void> {
    const summaryDate = toDateOnly(delta.at);
    const paymentField = paymentColumn(delta.paymentMethod);

    const existing = await this.prisma.db.dailySalesSummary.findUnique({
      where: {
        tenantId_storeId_summaryDate: {
          tenantId: delta.tenantId,
          storeId: delta.storeId,
          summaryDate,
        },
      },
    });

    if (existing) {
      await this.prisma.db.dailySalesSummary.update({
        where: { id: existing.id },
        data: {
          grossSalesInCents: { increment: delta.grossInCents },
          discountInCents: { increment: delta.discountInCents },
          netSalesInCents: { increment: delta.netInCents },
          transactionCount: { increment: 1 },
          [paymentField]: { increment: delta.netInCents },
        },
      });
    } else {
      await this.prisma.db.dailySalesSummary.create({
        data: {
          tenantId: delta.tenantId,
          storeId: delta.storeId,
          summaryDate,
          grossSalesInCents: delta.grossInCents,
          discountInCents: delta.discountInCents,
          voidInCents: 0,
          netSalesInCents: delta.netInCents,
          transactionCount: 1,
          cashInCents: paymentField === 'cashInCents' ? delta.netInCents : 0,
          cardInCents: paymentField === 'cardInCents' ? delta.netInCents : 0,
          qrisInCents: paymentField === 'qrisInCents' ? delta.netInCents : 0,
          otherInCents: paymentField === 'otherInCents' ? delta.netInCents : 0,
        },
      });
    }

    for (const line of delta.lines) {
      const productRow = await this.prisma.db.dailyProductSummary.findUnique({
        where: {
          tenantId_storeId_productId_summaryDate: {
            tenantId: delta.tenantId,
            storeId: delta.storeId,
            productId: line.productId,
            summaryDate,
          },
        },
      });
      if (productRow) {
        await this.prisma.db.dailyProductSummary.update({
          where: { id: productRow.id },
          data: {
            quantitySold: { increment: line.quantity },
            revenueInCents: { increment: line.revenueInCents },
            productName: line.productName,
          },
        });
      } else {
        await this.prisma.db.dailyProductSummary.create({
          data: {
            tenantId: delta.tenantId,
            storeId: delta.storeId,
            productId: line.productId,
            productName: line.productName,
            summaryDate,
            quantitySold: line.quantity,
            revenueInCents: line.revenueInCents,
          },
        });
      }
    }
  }

  async applyVoid(input: {
    tenantId: string;
    storeId: string;
    at: Date | string;
    voidTotalInCents: number;
  }): Promise<void> {
    const summaryDate = toDateOnly(input.at);
    const existing = await this.prisma.db.dailySalesSummary.findUnique({
      where: {
        tenantId_storeId_summaryDate: {
          tenantId: input.tenantId,
          storeId: input.storeId,
          summaryDate,
        },
      },
    });
    if (!existing) {
      return;
    }
    await this.prisma.db.dailySalesSummary.update({
      where: { id: existing.id },
      data: {
        voidInCents: { increment: input.voidTotalInCents },
        netSalesInCents: { decrement: input.voidTotalInCents },
        transactionCount: { decrement: 1 },
      },
    });
  }
}

function toDateOnly(value: Date | string): Date {
  const d = typeof value === 'string' ? new Date(value) : value;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function paymentColumn(
  method: PaymentMethod,
): 'cashInCents' | 'cardInCents' | 'qrisInCents' | 'otherInCents' {
  if (method === 'CASH') return 'cashInCents';
  if (method === 'CARD') return 'cardInCents';
  if (method === 'QRIS') return 'qrisInCents';
  return 'otherInCents';
}
