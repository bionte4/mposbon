import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PaymentMethod, SaleStatus } from '@prisma/client';
import { AuthContext } from '../auth/auth-context';
import { roleHasPermission } from '../auth/permissions';
import { toCsv } from '../common/csv/to-csv';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';

/**
 * Soft chart-of-accounts labels for external import (Jurnal.id / Accurate / Xero).
 * Not a full GL — codes are stable strings so accountants can map once.
 */
export const ACCOUNT_CODES = {
  cash: { code: '1100', name: 'Cash on hand' },
  card: { code: '1120', name: 'Card clearing' },
  qris: { code: '1130', name: 'QRIS clearing' },
  otherTender: { code: '1190', name: 'Other tender clearing' },
  sales: { code: '4000', name: 'POS sales revenue' },
  taxPayable: { code: '2100', name: 'Output tax payable' },
  discounts: { code: '4900', name: 'Sales discounts' },
  tips: { code: '2200', name: 'Tips payable' },
} as const;

export type ExportQuery = {
  from?: string;
  to?: string;
  storeId?: string;
};

export type JournalLineHook = {
  accountCode: string;
  accountName: string;
  debitInCents: number;
  creditInCents: number;
  memo: string;
};

@Injectable()
export class SalesExportService {
  constructor(private readonly prisma: PrismaService) {}

  /** Build balanced journal lines for one completed sale (integer cents). */
  static journalLinesForSale(input: {
    saleId: string;
    paymentMethod: PaymentMethod | string;
    payments?: Array<{ paymentMethod: string; amountInCents: number }>;
    subtotalInCents: number;
    taxInCents: number;
    discountInCents: number;
    tipInCents?: number;
    totalInCents: number;
    status: SaleStatus | string;
  }): JournalLineHook[] {
    const tipInCents = input.tipInCents ?? 0;
    const tenderLines =
      input.payments?.length
        ? input.payments
        : [
            {
              paymentMethod: input.paymentMethod === 'SPLIT' ? 'OTHER' : input.paymentMethod,
              amountInCents: input.totalInCents,
            },
          ];

    const lines: JournalLineHook[] = tenderLines.map((p) => {
      const tender = tenderAccount(p.paymentMethod);
      return {
        accountCode: tender.code,
        accountName: tender.name,
        debitInCents: p.amountInCents,
        creditInCents: 0,
        memo: `Sale ${input.saleId} tender ${p.paymentMethod}`,
      };
    });
    lines.push({
      accountCode: ACCOUNT_CODES.sales.code,
      accountName: ACCOUNT_CODES.sales.name,
      debitInCents: 0,
      creditInCents: input.subtotalInCents,
      memo: `Sale ${input.saleId} revenue`,
    });
    if (input.taxInCents > 0) {
      lines.push({
        accountCode: ACCOUNT_CODES.taxPayable.code,
        accountName: ACCOUNT_CODES.taxPayable.name,
        debitInCents: 0,
        creditInCents: input.taxInCents,
        memo: `Sale ${input.saleId} tax`,
      });
    }
    if (tipInCents > 0) {
      lines.push({
        accountCode: ACCOUNT_CODES.tips.code,
        accountName: ACCOUNT_CODES.tips.name,
        debitInCents: 0,
        creditInCents: tipInCents,
        memo: `Sale ${input.saleId} tip`,
      });
    }
    if (input.discountInCents > 0) {
      lines.push({
        accountCode: ACCOUNT_CODES.discounts.code,
        accountName: ACCOUNT_CODES.discounts.name,
        debitInCents: input.discountInCents,
        creditInCents: 0,
        memo: `Sale ${input.saleId} discount`,
      });
    }

    if (input.status === 'VOIDED' || input.status === 'REFUNDED') {
      return lines.map((l) => ({
        ...l,
        debitInCents: l.creditInCents,
        creditInCents: l.debitInCents,
        memo: `${input.status} reverse · ${l.memo}`,
      }));
    }
    return lines;
  }
  async assertStoreScope(): Promise<void> {
    const actor = AuthContext.require();
    if (!roleHasPermission(actor.role, 'dashboard.read_store')) {
      throw new ForbiddenException('Accounting export requires store-level dashboard access');
    }
  }

  async salesDetailCsv(query: ExportQuery): Promise<string> {
    await this.assertStoreScope();
    const sales = await this.loadSales(query);
    const headers = [
      'sale_id',
      'status',
      'store_id',
      'store_code',
      'payment_method',
      'client_created_at',
      'subtotal_cents',
      'tax_cents',
      'discount_cents',
      'total_cents',
      'line_id',
      'product_id',
      'product_name',
      'quantity',
      'unit_price_cents',
      'line_tax_bps',
      'line_tax_cents',
      'line_subtotal_cents',
      'line_total_cents',
    ];
    const rows: Array<Array<string | number | null>> = [];
    for (const sale of sales) {
      for (const line of sale.lines) {
        rows.push([
          sale.id,
          sale.status,
          sale.storeId,
          sale.store.code,
          sale.paymentMethod,
          sale.clientCreatedAt.toISOString(),
          sale.subtotalInCents,
          sale.taxInCents,
          sale.discountInCents,
          sale.totalInCents,
          line.id,
          line.productId,
          line.productName,
          line.quantity,
          line.unitPriceInCents,
          line.taxBps,
          line.taxInCents,
          line.lineSubtotalInCents,
          line.lineTotalInCents,
        ]);
      }
      if (!sale.lines.length) {
        rows.push([
          sale.id,
          sale.status,
          sale.storeId,
          sale.store.code,
          sale.paymentMethod,
          sale.clientCreatedAt.toISOString(),
          sale.subtotalInCents,
          sale.taxInCents,
          sale.discountInCents,
          sale.totalInCents,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
          null,
        ]);
      }
    }
    return toCsv(headers, rows);
  }

  async journalCsv(query: ExportQuery): Promise<string> {
    await this.assertStoreScope();
    const sales = await this.loadSales(query);
    const headers = [
      'entry_id',
      'sale_id',
      'status',
      'store_code',
      'posted_at',
      'account_code',
      'account_name',
      'debit_cents',
      'credit_cents',
      'memo',
      'payment_method',
    ];
    const rows: Array<Array<string | number>> = [];
    for (const sale of sales) {
      const journal = SalesExportService.journalLinesForSale({
        saleId: sale.id,
        paymentMethod: sale.paymentMethod,
        payments: sale.payments.map((p) => ({
          paymentMethod: p.paymentMethod,
          amountInCents: p.amountInCents,
        })),
        subtotalInCents: sale.subtotalInCents,
        taxInCents: sale.taxInCents,
        discountInCents: sale.discountInCents,
        totalInCents: sale.totalInCents,
        tipInCents: sale.tipInCents,
        status: sale.status,
      });
      journal.forEach((jl, idx) => {
        rows.push([
          `${sale.id}:${idx + 1}`,
          sale.id,
          sale.status,
          sale.store.code,
          sale.clientCreatedAt.toISOString(),
          jl.accountCode,
          jl.accountName,
          jl.debitInCents,
          jl.creditInCents,
          jl.memo,
          sale.paymentMethod,
        ]);
      });
    }
    return toCsv(headers, rows);
  }

  async journalJson(query: ExportQuery) {
    await this.assertStoreScope();
    const sales = await this.loadSales(query);
    return {
      currency: 'IDR',
      unit: 'cents',
      accountMap: ACCOUNT_CODES,
      entries: sales.map((sale) => ({
        saleId: sale.id,
        status: sale.status,
        storeCode: sale.store.code,
        postedAt: sale.clientCreatedAt.toISOString(),
        paymentMethod: sale.paymentMethod,
        totals: {
          subtotalInCents: sale.subtotalInCents,
          taxInCents: sale.taxInCents,
          discountInCents: sale.discountInCents,
          tipInCents: sale.tipInCents,
          totalInCents: sale.totalInCents,
        },
        lines: SalesExportService.journalLinesForSale({
          saleId: sale.id,
          paymentMethod: sale.paymentMethod,
          payments: sale.payments.map((p) => ({
            paymentMethod: p.paymentMethod,
            amountInCents: p.amountInCents,
          })),
          subtotalInCents: sale.subtotalInCents,
          taxInCents: sale.taxInCents,
          discountInCents: sale.discountInCents,
          tipInCents: sale.tipInCents,
          totalInCents: sale.totalInCents,
          status: sale.status,
        }),
      })),
    };
  }

  private async loadSales(query: ExportQuery) {
    const tenant = TenantContext.require();
    const { from, to } = resolveRange(query.from, query.to);
    return this.prisma.db.sale.findMany({
      where: {
        tenantId: tenant.id,
        clientCreatedAt: { gte: from, lte: to },
        ...(query.storeId ? { storeId: query.storeId } : {}),
      },
      include: {
        store: { select: { id: true, code: true, name: true } },
        lines: { orderBy: { createdAt: 'asc' } },
        payments: { orderBy: { createdAt: 'asc' } },
      },
      orderBy: { clientCreatedAt: 'asc' },
      take: 10_000,
    });
  }
}

function tenderAccount(method: PaymentMethod | string) {
  switch (method) {
    case 'CASH':
      return ACCOUNT_CODES.cash;
    case 'CARD':
      return ACCOUNT_CODES.card;
    case 'QRIS':
      return ACCOUNT_CODES.qris;
    default:
      return ACCOUNT_CODES.otherTender;
  }
}

function resolveRange(from?: string, to?: string): { from: Date; to: Date } {
  const end = to ? new Date(to) : new Date();
  if (Number.isNaN(end.getTime())) {
    throw new BadRequestException('Invalid to date');
  }
  const start = from
    ? new Date(from)
    : new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  if (Number.isNaN(start.getTime())) {
    throw new BadRequestException('Invalid from date');
  }
  // Inclusive end-of-day when date-only ISO (YYYY-MM-DD)
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
    end.setHours(23, 59, 59, 999);
  }
  if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
    start.setHours(0, 0, 0, 0);
  }
  return { from: start, to: end };
}
