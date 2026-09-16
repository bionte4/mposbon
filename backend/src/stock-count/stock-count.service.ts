import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityAction, StockCountStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuthContext } from '../auth/auth-context';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';

export type CreateStockCountInput = {
  storeId: string;
  note?: string;
};

export type UpdateStockCountLineInput = {
  lineId: string;
  countedQty: number;
};

@Injectable()
export class StockCountService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listSessions(storeId?: string, limit = 30) {
    const tenant = TenantContext.require();
    return this.prisma.db.stockCountSession.findMany({
      where: {
        tenantId: tenant.id,
        ...(storeId ? { storeId } : {}),
      },
      include: {
        store: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, displayName: true } },
        completedBy: { select: { id: true, displayName: true } },
        _count: { select: { lines: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
  }

  async getSession(id: string) {
    const tenant = TenantContext.require();
    const session = await this.prisma.db.stockCountSession.findFirst({
      where: { id, tenantId: tenant.id },
      include: {
        store: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, displayName: true } },
        completedBy: { select: { id: true, displayName: true } },
        lines: {
          orderBy: [{ productSku: 'asc' }],
        },
      },
    });
    if (!session) throw new NotFoundException('Stock count session not found');
    return session;
  }

  async createSession(input: CreateStockCountInput) {
    const tenant = TenantContext.require();
    const actor = AuthContext.require();
    const store = await this.prisma.db.store.findFirst({
      where: { id: input.storeId, tenantId: tenant.id },
    });
    if (!store) throw new NotFoundException('Store not found');

    const draftExists = await this.prisma.db.stockCountSession.findFirst({
      where: {
        tenantId: tenant.id,
        storeId: input.storeId,
        status: StockCountStatus.DRAFT,
      },
    });
    if (draftExists) {
      throw new BadRequestException(
        `Draft stock count ${draftExists.code} already open for this store`,
      );
    }

    const products = await this.prisma.db.product.findMany({
      where: { tenantId: tenant.id, isActive: true },
      orderBy: { sku: 'asc' },
    });

    const stocks = await this.prisma.db.storeStock.findMany({
      where: { tenantId: tenant.id, storeId: input.storeId },
    });
    const stockByProduct = new Map(stocks.map((s) => [s.productId, s.qty]));

    const code = await this.nextCode(tenant.id);
    const sessionId = randomUUID();

    await this.prisma.db.stockCountSession.create({
      data: {
        id: sessionId,
        tenantId: tenant.id,
        storeId: input.storeId,
        code,
        note: input.note?.trim() || null,
        createdByUserId: actor.id,
      },
    });

    if (products.length) {
      await this.prisma.db.stockCountLine.createMany({
        data: products.map((p) => ({
          id: randomUUID(),
          tenantId: tenant.id,
          sessionId,
          productId: p.id,
          productSku: p.sku,
          productName: p.name,
          systemQty: stockByProduct.get(p.id) ?? p.stockQty,
        })),
      });
    }

    return this.getSession(sessionId);
  }

  async updateLine(sessionId: string, input: UpdateStockCountLineInput) {
    const tenant = TenantContext.require();
    const session = await this.prisma.db.stockCountSession.findFirst({
      where: { id: sessionId, tenantId: tenant.id },
    });
    if (!session) throw new NotFoundException('Stock count session not found');
    if (session.status !== StockCountStatus.DRAFT) {
      throw new BadRequestException('Only draft sessions can be edited');
    }
    if (!Number.isInteger(input.countedQty) || input.countedQty < 0) {
      throw new BadRequestException('countedQty must be an integer >= 0');
    }

    const line = await this.prisma.db.stockCountLine.findFirst({
      where: { id: input.lineId, sessionId, tenantId: tenant.id },
    });
    if (!line) throw new NotFoundException('Line not found');

    await this.prisma.db.stockCountLine.update({
      where: { id: line.id },
      data: { countedQty: input.countedQty },
    });

    return this.getSession(sessionId);
  }

  async completeSession(sessionId: string) {
    const tenant = TenantContext.require();
    const actor = AuthContext.require();
    const session = await this.prisma.db.stockCountSession.findFirst({
      where: { id: sessionId, tenantId: tenant.id },
      include: { lines: true, store: true },
    });
    if (!session) throw new NotFoundException('Stock count session not found');
    if (session.status !== StockCountStatus.DRAFT) {
      throw new BadRequestException('Session is not in DRAFT status');
    }
    if (!session.lines.length) {
      throw new BadRequestException('Session has no product lines');
    }

    const uncounted = session.lines.filter((l) => l.countedQty === null);
    if (uncounted.length) {
      throw new BadRequestException(
        `${uncounted.length} product(s) not counted yet`,
      );
    }

    const variances = session.lines.filter((l) => l.countedQty !== l.systemQty);

    for (const line of session.lines) {
      const counted = line.countedQty!;
      const variance = counted - line.systemQty;
      await this.prisma.db.stockCountLine.update({
        where: { id: line.id },
        data: { varianceQty: variance },
      });

      if (variance === 0) continue;

      await this.prisma.db.$executeRaw`
        INSERT INTO store_stocks (tenant_id, store_id, product_id, qty, updated_at)
        VALUES (
          ${tenant.id}::uuid,
          ${session.storeId}::uuid,
          ${line.productId}::uuid,
          ${counted},
          CURRENT_TIMESTAMP
        )
        ON CONFLICT (tenant_id, store_id, product_id)
        DO UPDATE SET qty = ${counted}, updated_at = CURRENT_TIMESTAMP
      `;

      const agg = await this.prisma.db.storeStock.aggregate({
        where: { tenantId: tenant.id, productId: line.productId },
        _sum: { qty: true },
      });
      await this.prisma.db.product.update({
        where: { id: line.productId },
        data: { stockQty: Math.max(0, agg._sum.qty ?? counted) },
      });
    }

    await this.prisma.db.stockCountSession.update({
      where: { id: sessionId },
      data: {
        status: StockCountStatus.COMPLETED,
        completedByUserId: actor.id,
        completedAt: new Date(),
      },
    });

    await this.audit.log({
      action: ActivityAction.STOCK_COUNT,
      entityType: 'stock_count_session',
      entityId: sessionId,
      reason: session.note?.trim() || `stock_opname:${session.code}`,
      metadata: {
        storeId: session.storeId,
        storeCode: session.store.code,
        code: session.code,
        lineCount: session.lines.length,
        varianceCount: variances.length,
        variances: variances.map((l) => ({
          productId: l.productId,
          sku: l.productSku,
          systemQty: l.systemQty,
          countedQty: l.countedQty,
          varianceQty: (l.countedQty ?? 0) - l.systemQty,
        })),
      },
    });

    return this.getSession(sessionId);
  }

  async cancelSession(sessionId: string) {
    const tenant = TenantContext.require();
    const session = await this.prisma.db.stockCountSession.findFirst({
      where: { id: sessionId, tenantId: tenant.id },
    });
    if (!session) throw new NotFoundException('Stock count session not found');
    if (session.status !== StockCountStatus.DRAFT) {
      throw new BadRequestException('Only draft sessions can be cancelled');
    }
    await this.prisma.db.stockCountSession.update({
      where: { id: sessionId },
      data: { status: StockCountStatus.CANCELLED },
    });
    return this.getSession(sessionId);
  }

  private async nextCode(tenantId: string): Promise<string> {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const prefix = `SC-${y}${m}${d}-`;
    const latest = await this.prisma.db.stockCountSession.findFirst({
      where: { tenantId, code: { startsWith: prefix } },
      orderBy: { code: 'desc' },
    });
    let seq = 1;
    if (latest) {
      const tail = latest.code.slice(prefix.length);
      const n = Number.parseInt(tail, 10);
      if (Number.isFinite(n)) seq = n + 1;
    }
    return `${prefix}${String(seq).padStart(3, '0')}`;
  }
}
