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
import { IntegrationService } from './integration.service';

/** Default CoA seeded per tenant — codes match soft export for finance mapping. */
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
    private readonly integration: IntegrationService,
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

  listAccounts(includeInactive = false) {
    const tenant = TenantContext.require();
    return this.prisma.db.glAccount.findMany({
      where: {
        tenantId: tenant.id,
        ...(includeInactive ? {} : { isActive: true }),
      },
      orderBy: { code: 'asc' },
    });
  }

  async createAccount(input: {
    code: string;
    name: string;
    type: GlAccountType;
  }) {
    const tenant = TenantContext.require();
    const code = this.normalizeCode(input.code);
    const name = this.normalizeName(input.name);
    const type = input.type;

    const existing = await this.prisma.db.glAccount.findUnique({
      where: { tenantId_code: { tenantId: tenant.id, code } },
    });
    if (existing?.isActive) {
      throw new BadRequestException(`GL account ${code} already exists`);
    }

    const account = existing
      ? await this.prisma.db.glAccount.update({
          where: { id: existing.id },
          data: { name, type, isActive: true },
        })
      : await this.prisma.db.glAccount.create({
          data: {
            id: randomUUID(),
            tenantId: tenant.id,
            code,
            name,
            type,
          },
        });

    await this.audit.log({
      action: ActivityAction.GL_ACCOUNT_CHANGE,
      entityType: 'gl_account',
      entityId: account.id,
      reason: existing ? `reactivate ${code}` : `create ${code}`,
      metadata: { code, name, type, op: existing ? 'reactivate' : 'create' },
    });
    void this.integration.dispatchEvent('account.updated', { account }).catch(() => undefined);
    return account;
  }

  async updateAccount(
    id: string,
    input: { code?: string; name?: string; type?: GlAccountType },
  ) {
    const tenant = TenantContext.require();
    const account = await this.prisma.db.glAccount.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!account) throw new NotFoundException('GL account not found');

    const data: { code?: string; name?: string; type?: GlAccountType } = {};
    if (input.name !== undefined) data.name = this.normalizeName(input.name);
    if (input.type !== undefined) data.type = input.type;

    if (input.code !== undefined) {
      const nextCode = this.normalizeCode(input.code);
      if (nextCode !== account.code) {
        const lineCount = await this.prisma.db.journalEntryLine.count({
          where: { tenantId: tenant.id, accountId: account.id },
        });
        if (lineCount > 0) {
          throw new BadRequestException(
            'Cannot change account code after journal lines exist',
          );
        }
        const clash = await this.prisma.db.glAccount.findUnique({
          where: { tenantId_code: { tenantId: tenant.id, code: nextCode } },
        });
        if (clash && clash.id !== account.id) {
          throw new BadRequestException(`GL account ${nextCode} already exists`);
        }
        data.code = nextCode;
      }
    }

    const updated = await this.prisma.db.glAccount.update({
      where: { id: account.id },
      data,
    });
    await this.audit.log({
      action: ActivityAction.GL_ACCOUNT_CHANGE,
      entityType: 'gl_account',
      entityId: updated.id,
      reason: `update ${updated.code}`,
      metadata: { ...data, op: 'update' },
    });
    void this.integration.dispatchEvent('account.updated', { account: updated }).catch(() => undefined);
    return updated;
  }

  async setAccountActive(id: string, isActive: boolean) {
    const tenant = TenantContext.require();
    const account = await this.prisma.db.glAccount.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!account) throw new NotFoundException('GL account not found');

    const updated = await this.prisma.db.glAccount.update({
      where: { id: account.id },
      data: { isActive },
    });
    await this.audit.log({
      action: ActivityAction.GL_ACCOUNT_CHANGE,
      entityType: 'gl_account',
      entityId: updated.id,
      reason: isActive ? `activate ${updated.code}` : `deactivate ${updated.code}`,
      metadata: { code: updated.code, op: isActive ? 'activate' : 'deactivate' },
    });
    void this.integration.dispatchEvent('account.updated', { account: updated }).catch(() => undefined);
    return updated;
  }

  private normalizeCode(raw: string): string {
    const code = (raw ?? '').trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9._-]{0,15}$/.test(code)) {
      throw new BadRequestException(
        'Account code must be 1–16 chars (letters, digits, . _ -)',
      );
    }
    return code;
  }

  private normalizeName(raw: string): string {
    const name = (raw ?? '').trim();
    if (name.length < 2 || name.length > 120) {
      throw new BadRequestException('Account name must be 2–120 characters');
    }
    return name;
  }

  listEntries(limit = 50) {
    const tenant = TenantContext.require();
    return this.prisma.db.journalEntry.findMany({
      where: { tenantId: tenant.id },
      orderBy: { postedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
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
   * Integration / admin journal query.
   * Cursor = previous page's last `postedAt|id` (ISO|uuid).
   */
  async queryEntries(input: {
    limit?: number;
    from?: string;
    to?: string;
    sourceType?: JournalSourceType;
    cursor?: string;
  }) {
    const tenant = TenantContext.require();
    const limit = Math.min(Math.max(input.limit ?? 50, 1), 200);

    const and: object[] = [{ tenantId: tenant.id }];
    if (input.sourceType) {
      and.push({ sourceType: input.sourceType });
    }

    const from = input.from ? this.parseDateBound(input.from, false) : null;
    const to = input.to ? this.parseDateBound(input.to, true) : null;
    if (from || to) {
      and.push({
        postedAt: {
          ...(from ? { gte: from } : {}),
          ...(to ? { lte: to } : {}),
        },
      });
    }

    if (input.cursor) {
      const [iso, id] = input.cursor.split('|');
      const cursorAt = iso ? new Date(iso) : null;
      if (cursorAt && !Number.isNaN(cursorAt.getTime()) && id) {
        and.push({
          OR: [
            { postedAt: { lt: cursorAt } },
            { postedAt: cursorAt, id: { lt: id } },
          ],
        });
      }
    }

    const items = await this.prisma.db.journalEntry.findMany({
      where: { AND: and },
      orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      include: {
        lines: {
          orderBy: { accountCode: 'asc' },
          select: {
            id: true,
            accountId: true,
            accountCode: true,
            debitInCents: true,
            creditInCents: true,
            memo: true,
          },
        },
      },
    });

    const hasMore = items.length > limit;
    const page = hasMore ? items.slice(0, limit) : items;
    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last
        ? `${last.postedAt.toISOString()}|${last.id}`
        : null;

    return {
      items: page.map((e) => this.serializeEntry(e)),
      nextCursor,
      limit,
    };
  }

  async getAccount(idOrCode: string) {
    const tenant = TenantContext.require();
    const key = idOrCode.trim();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        key,
      );
    const account = await this.prisma.db.glAccount.findFirst({
      where: isUuid
        ? { tenantId: tenant.id, id: key }
        : { tenantId: tenant.id, code: key.toUpperCase() },
    });
    if (!account) throw new NotFoundException('GL account not found');
    return account;
  }

  async getEntry(id: string) {
    const tenant = TenantContext.require();
    const entry = await this.prisma.db.journalEntry.findFirst({
      where: { id, tenantId: tenant.id },
      include: {
        lines: {
          orderBy: { accountCode: 'asc' },
          select: {
            id: true,
            accountId: true,
            accountCode: true,
            debitInCents: true,
            creditInCents: true,
            memo: true,
          },
        },
      },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    return this.serializeEntry(entry);
  }

  async getEntryBySource(sourceType: JournalSourceType, sourceId: string) {
    const tenant = TenantContext.require();
    const entry = await this.prisma.db.journalEntry.findFirst({
      where: { tenantId: tenant.id, sourceType, sourceId },
      include: {
        lines: {
          orderBy: { accountCode: 'asc' },
          select: {
            id: true,
            accountId: true,
            accountCode: true,
            debitInCents: true,
            creditInCents: true,
            memo: true,
          },
        },
      },
    });
    if (!entry) throw new NotFoundException('Journal entry not found');
    return this.serializeEntry(entry);
  }

  /** Stable code map for external finance systems (Accurate, Jurnal, Xero, …). */
  accountCodeMap() {
    return {
      currency: 'IDR',
      amountUnit: 'sen',
      accounts: Object.fromEntries(
        DEFAULT_GL_ACCOUNTS.map((a) => [
          a.code,
          { code: a.code, name: a.name, type: a.type },
        ]),
      ),
    };
  }

  /**
   * Partner / manual adjusting entry. Provide unique sourceId (or Idempotency-Key).
   * Idempotent on (tenant, MANUAL, sourceId).
   */
  async postManualEntry(input: {
    sourceId: string;
    memo?: string | null;
    lines: Array<{
      accountCode: string;
      debitInCents: number;
      creditInCents: number;
      memo?: string | null;
    }>;
  }) {
    const sourceId = (input.sourceId ?? '').trim();
    if (!sourceId || sourceId.length > 120) {
      throw new BadRequestException('sourceId required (1–120 chars)');
    }
    return this.postEntry({
      sourceType: 'MANUAL',
      sourceId,
      memo: input.memo ?? null,
      lines: input.lines.map((l) => ({
        accountCode: l.accountCode,
        accountName: l.accountCode,
        debitInCents: l.debitInCents,
        creditInCents: l.creditInCents,
        memo: l.memo ?? '',
      })),
    }).then((e) => this.getEntry(e.id));
  }

  private serializeEntry(entry: {
    id: string;
    sourceType: JournalSourceType;
    sourceId: string;
    memo: string | null;
    postedAt: Date;
    createdAt?: Date;
    lines: Array<{
      id: string;
      accountId?: string;
      accountCode: string;
      debitInCents: number;
      creditInCents: number;
      memo: string | null;
    }>;
  }) {
    const debitInCents = entry.lines.reduce((s, l) => s + l.debitInCents, 0);
    const creditInCents = entry.lines.reduce((s, l) => s + l.creditInCents, 0);
    return {
      id: entry.id,
      sourceType: entry.sourceType,
      sourceId: entry.sourceId,
      memo: entry.memo,
      postedAt: entry.postedAt.toISOString(),
      createdAt: entry.createdAt?.toISOString?.() ?? undefined,
      debitInCents,
      creditInCents,
      currency: 'IDR',
      amountUnit: 'sen',
      lines: entry.lines,
    };
  }

  private parseDateBound(raw: string, endOfDay: boolean): Date {
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
      throw new BadRequestException(`Invalid date: ${raw}`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
      if (endOfDay) {
        d.setUTCHours(23, 59, 59, 999);
      } else {
        d.setUTCHours(0, 0, 0, 0);
      }
    }
    return d;
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

    void this.integration
      .dispatchEvent('journal.posted', {
        entry: this.serializeEntry(entry),
      })
      .catch(() => undefined);

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
