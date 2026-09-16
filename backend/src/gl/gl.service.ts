import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ActivityAction,
  GlAccountType,
  JournalSourceType,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import {
  ACCOUNT_CODES,
  JournalLineHook,
  SalesExportService,
} from '../analytics/sales-export.service';

/** Default CoA seeded per tenant — codes match soft export for Accurate/Jurnal mapping. */
export const DEFAULT_GL_ACCOUNTS: Array<{
  code: string;
  name: string;
  type: GlAccountType;
}> = [
  { code: ACCOUNT_CODES.cash.code, name: ACCOUNT_CODES.cash.name, type: 'ASSET' },
  { code: ACCOUNT_CODES.card.code, name: ACCOUNT_CODES.card.name, type: 'ASSET' },
  { code: ACCOUNT_CODES.qris.code, name: ACCOUNT_CODES.qris.name, type: 'ASSET' },
  { code: ACCOUNT_CODES.otherTender.code, name: ACCOUNT_CODES.otherTender.name, type: 'ASSET' },
  { code: '1300', name: 'Inventory on hand', type: 'ASSET' },
  { code: '1310', name: 'Inventory in transit', type: 'ASSET' },
  { code: ACCOUNT_CODES.taxPayable.code, name: ACCOUNT_CODES.taxPayable.name, type: 'LIABILITY' },
  { code: ACCOUNT_CODES.tips.code, name: ACCOUNT_CODES.tips.name, type: 'LIABILITY' },
  { code: ACCOUNT_CODES.sales.code, name: ACCOUNT_CODES.sales.name, type: 'REVENUE' },
  { code: ACCOUNT_CODES.discounts.code, name: ACCOUNT_CODES.discounts.name, type: 'EXPENSE' },
  { code: '5000', name: 'Cost of goods sold', type: 'EXPENSE' },
];

@Injectable()
export class GlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async ensureDefaultAccounts(tenantId?: string): Promise<void> {
    const tid = tenantId ?? TenantContext.require().id;
    for (const acc of DEFAULT_GL_ACCOUNTS) {
      await this.prisma.db.glAccount.upsert({
        where: { tenantId_code: { tenantId: tid, code: acc.code } },
        update: { name: acc.name, type: acc.type, isActive: true },
        create: {
          id: randomUUID(),
          tenantId: tid,
          code: acc.code,
          name: acc.name,
          type: acc.type,
        },
      });
    }
  }

  listAccounts() {
    const tenant = TenantContext.require();
    return this.prisma.db.glAccount.findMany({
      where: { tenantId: tenant.id, isActive: true },
      orderBy: { code: 'asc' },
    });
  }

  listEntries(limit = 50) {
    const tenant = TenantContext.require();
    return this.prisma.db.journalEntry.findMany({
      where: { tenantId: tenant.id },
      orderBy: { postedAt: 'desc' },
      take: Math.min(limit, 200),
      include: {
        lines: {
          orderBy: { accountCode: 'asc' },
          select: {
            id: true,
            accountCode: true,
            debitInCents: true,
            creditInCents: true,
            memo: true,
          },
        },
      },
    });
  }

  /**
   * Idempotent post: unique on (tenant, sourceType, sourceId).
   * Lines must balance in integer sen.
   */
  async postEntry(input: {
    sourceType: JournalSourceType;
    sourceId: string;
    memo?: string | null;
    lines: JournalLineHook[];
  }) {
    const tenant = TenantContext.require();
    await this.ensureDefaultAccounts(tenant.id);

    const existing = await this.prisma.db.journalEntry.findFirst({
      where: {
        tenantId: tenant.id,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
      },
      include: { lines: true },
    });
    if (existing) return existing;

    if (!input.lines?.length) {
      throw new BadRequestException('Journal lines required');
    }
    let debit = 0;
    let credit = 0;
    for (const line of input.lines) {
      if (
        !Number.isInteger(line.debitInCents) ||
        !Number.isInteger(line.creditInCents) ||
        line.debitInCents < 0 ||
        line.creditInCents < 0
      ) {
        throw new BadRequestException('Journal amounts must be non-negative integers');
      }
      debit += line.debitInCents;
      credit += line.creditInCents;
    }
    if (debit !== credit) {
      throw new BadRequestException(
        `Unbalanced journal: debit ${debit} ≠ credit ${credit}`,
      );
    }

    const codes = [...new Set(input.lines.map((l) => l.accountCode))];
    const accounts = await this.prisma.db.glAccount.findMany({
      where: { tenantId: tenant.id, code: { in: codes } },
    });
    const byCode = new Map(accounts.map((a) => [a.code, a]));
    for (const code of codes) {
      if (!byCode.has(code)) {
        throw new NotFoundException(`GL account ${code} not found`);
      }
    }

    const entry = await this.prisma.db.journalEntry.create({
      data: {
        id: randomUUID(),
        tenantId: tenant.id,
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        memo: input.memo ?? null,
        lines: {
          create: input.lines.map((l) => ({
            id: randomUUID(),
            tenantId: tenant.id,
            accountId: byCode.get(l.accountCode)!.id,
            accountCode: l.accountCode,
            debitInCents: l.debitInCents,
            creditInCents: l.creditInCents,
            memo: l.memo,
          })),
        },
      },
      include: { lines: true },
    });

    await this.audit.log({
      action: ActivityAction.JOURNAL_POST,
      entityType: 'journal_entry',
      entityId: entry.id,
      metadata: {
        sourceType: input.sourceType,
        sourceId: input.sourceId,
        debit,
        credit,
      },
    });

    return entry;
  }

  async postSaleJournal(sale: {
    id: string;
    paymentMethod: string;
    payments?: Array<{ paymentMethod: string; amountInCents: number }>;
    subtotalInCents: number;
    taxInCents: number;
    discountInCents: number;
    tipInCents?: number;
    totalInCents: number;
    status: string;
    cogsInCents?: number;
  }) {
    const lines = SalesExportService.journalLinesForSale({
      saleId: sale.id,
      paymentMethod: sale.paymentMethod as 'CASH',
      payments: sale.payments,
      subtotalInCents: sale.subtotalInCents,
      taxInCents: sale.taxInCents,
      discountInCents: sale.discountInCents,
      tipInCents: sale.tipInCents,
      totalInCents: sale.totalInCents,
      status: sale.status as 'COMPLETED',
    });

    // Inventory → COGS when HPP known (integer sen).
    const cogs = sale.cogsInCents ?? 0;
    if (cogs > 0 && sale.status === 'COMPLETED') {
      lines.push(
        {
          accountCode: '5000',
          accountName: 'Cost of goods sold',
          debitInCents: cogs,
          creditInCents: 0,
          memo: `Sale ${sale.id} COGS`,
        },
        {
          accountCode: '1300',
          accountName: 'Inventory on hand',
          debitInCents: 0,
          creditInCents: cogs,
          memo: `Sale ${sale.id} inventory out`,
        },
      );
    }

    return this.postEntry({
      sourceType: 'SALE',
      sourceId: sale.id,
      memo: `POS sale ${sale.id}`,
      lines,
    });
  }

  /** Transfer ship: Inventory → In-transit (value placeholder = qty * 0 until costing exists). */
  async postTransferShip(transferId: string, valueInCents: number) {
    if (valueInCents <= 0) return null;
    return this.postEntry({
      sourceType: 'TRANSFER',
      sourceId: `${transferId}:ship`,
      memo: `Transfer ship ${transferId}`,
      lines: [
        {
          accountCode: '1310',
          accountName: 'Inventory in transit',
          debitInCents: valueInCents,
          creditInCents: 0,
          memo: `Ship ${transferId}`,
        },
        {
          accountCode: '1300',
          accountName: 'Inventory on hand',
          debitInCents: 0,
          creditInCents: valueInCents,
          memo: `Ship ${transferId}`,
        },
      ],
    });
  }

  async postTransferReceive(transferId: string, valueInCents: number) {
    if (valueInCents <= 0) return null;
    return this.postEntry({
      sourceType: 'TRANSFER',
      sourceId: `${transferId}:receive`,
      memo: `Transfer receive ${transferId}`,
      lines: [
        {
          accountCode: '1300',
          accountName: 'Inventory on hand',
          debitInCents: valueInCents,
          creditInCents: 0,
          memo: `Receive ${transferId}`,
        },
        {
          accountCode: '1310',
          accountName: 'Inventory in transit',
          debitInCents: 0,
          creditInCents: valueInCents,
          memo: `Receive ${transferId}`,
        },
      ],
    });
  }
}
