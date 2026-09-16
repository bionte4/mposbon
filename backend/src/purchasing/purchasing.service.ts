import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityAction, PurchaseOrderStatus } from '@prisma/client';
import { AuthContext } from '../auth/auth-context';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';

export type UpsertSupplierInput = {
  code: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  isActive?: boolean;
};

export type CreatePurchaseOrderInput = {
  supplierId: string;
  storeId: string;
  note?: string;
  /** When true, PO starts as ORDERED (ready to receive). Default DRAFT. */
  confirm?: boolean;
  lines: Array<{
    productId: string;
    qtyOrdered: number;
    unitCostInCents: number;
  }>;
};

export type ReceiveGoodsInput = {
  storeId?: string;
  note?: string;
  lines: Array<{
    purchaseOrderLineId: string;
    qty: number;
  }>;
};

const PO_INCLUDE = {
  supplier: { select: { id: true, code: true, name: true } },
  store: { select: { id: true, code: true, name: true } },
  createdBy: { select: { id: true, displayName: true } },
  lines: {
    include: {
      product: { select: { id: true, sku: true, name: true } },
    },
    orderBy: { createdAt: 'asc' as const },
  },
  receipts: {
    include: {
      store: { select: { id: true, code: true, name: true } },
      createdBy: { select: { id: true, displayName: true } },
      lines: {
        include: {
          product: { select: { id: true, sku: true, name: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' as const },
  },
} as const;

@Injectable()
export class PurchasingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listSuppliers(activeOnly = false) {
    const tenant = TenantContext.require();
    return this.prisma.db.supplier.findMany({
      where: {
        tenantId: tenant.id,
        ...(activeOnly ? { isActive: true } : {}),
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
  }

  async createSupplier(input: UpsertSupplierInput) {
    const tenant = TenantContext.require();
    this.assertSupplierInput(input);
    const code = input.code.trim().toUpperCase();
    const existing = await this.prisma.db.supplier.findFirst({
      where: { tenantId: tenant.id, code },
    });
    if (existing) {
      throw new BadRequestException(`Supplier code ${code} already exists`);
    }
    return this.prisma.db.supplier.create({
      data: {
        tenantId: tenant.id,
        code,
        name: input.name.trim(),
        phone: input.phone?.trim() || null,
        email: input.email?.trim() || null,
        address: input.address?.trim() || null,
        notes: input.notes?.trim() || null,
        isActive: input.isActive ?? true,
      },
    });
  }

  async updateSupplier(id: string, input: Partial<UpsertSupplierInput>) {
    const tenant = TenantContext.require();
    const row = await this.prisma.db.supplier.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!row) throw new NotFoundException('Supplier not found');

    if (input.code !== undefined) {
      const code = input.code.trim().toUpperCase();
      if (!code) throw new BadRequestException('code is required');
      const clash = await this.prisma.db.supplier.findFirst({
        where: { tenantId: tenant.id, code, NOT: { id } },
      });
      if (clash) throw new BadRequestException(`Supplier code ${code} already exists`);
    }
    if (input.name !== undefined && !input.name.trim()) {
      throw new BadRequestException('name is required');
    }

    return this.prisma.db.supplier.update({
      where: { id },
      data: {
        ...(input.code !== undefined ? { code: input.code.trim().toUpperCase() } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
        ...(input.email !== undefined ? { email: input.email?.trim() || null } : {}),
        ...(input.address !== undefined ? { address: input.address?.trim() || null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes?.trim() || null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
  }

  listOrders(limit = 50) {
    const tenant = TenantContext.require();
    return this.prisma.db.purchaseOrder.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      include: PO_INCLUDE,
    });
  }

  async getOrder(id: string) {
    const tenant = TenantContext.require();
    const order = await this.prisma.db.purchaseOrder.findFirst({
      where: { id, tenantId: tenant.id },
      include: PO_INCLUDE,
    });
    if (!order) throw new NotFoundException('Purchase order not found');
    return order;
  }

  /**
   * Create PO + lines. Costs are integer sen.
   * confirm=true → ORDERED (ready for receiving); else DRAFT.
   */
  async createOrder(input: CreatePurchaseOrderInput) {
    const tenant = TenantContext.require();
    const actor = AuthContext.require();
    if (!input.lines?.length) {
      throw new BadRequestException('At least one purchase line is required');
    }

    const supplier = await this.prisma.db.supplier.findFirst({
      where: { id: input.supplierId, tenantId: tenant.id, isActive: true },
    });
    if (!supplier) throw new BadRequestException('Active supplier not found');

    const store = await this.prisma.db.store.findFirst({
      where: { id: input.storeId, tenantId: tenant.id },
    });
    if (!store) throw new BadRequestException('Store not found for this tenant');

    const normalized: Array<{
      productId: string;
      qtyOrdered: number;
      unitCostInCents: number;
      lineTotalInCents: number;
    }> = [];

    for (const line of input.lines) {
      if (!Number.isInteger(line.qtyOrdered) || line.qtyOrdered < 1) {
        throw new BadRequestException('Each qtyOrdered must be an integer >= 1');
      }
      if (!Number.isInteger(line.unitCostInCents) || line.unitCostInCents < 0) {
        throw new BadRequestException('Each unitCostInCents must be a non-negative integer');
      }
      const product = await this.prisma.db.product.findFirst({
        where: { id: line.productId, tenantId: tenant.id },
      });
      if (!product) {
        throw new BadRequestException(`Product ${line.productId} not found`);
      }
      normalized.push({
        productId: line.productId,
        qtyOrdered: line.qtyOrdered,
        unitCostInCents: line.unitCostInCents,
        lineTotalInCents: line.qtyOrdered * line.unitCostInCents,
      });
    }

    const subtotalInCents = normalized.reduce((s, l) => s + l.lineTotalInCents, 0);
    const confirm = Boolean(input.confirm);
    const code = await this.nextDocCode('PO');

    const order = await this.prisma.db.purchaseOrder.create({
      data: {
        tenantId: tenant.id,
        supplierId: supplier.id,
        storeId: store.id,
        code,
        status: confirm ? PurchaseOrderStatus.ORDERED : PurchaseOrderStatus.DRAFT,
        note: input.note?.trim() || null,
        subtotalInCents,
        orderedAt: confirm ? new Date() : null,
        createdByUserId: actor.id,
        lines: {
          create: normalized.map((l) => ({
            tenantId: tenant.id,
            productId: l.productId,
            qtyOrdered: l.qtyOrdered,
            qtyReceived: 0,
            unitCostInCents: l.unitCostInCents,
            lineTotalInCents: l.lineTotalInCents,
          })),
        },
      },
      include: PO_INCLUDE,
    });

    await this.audit.log({
      action: ActivityAction.PURCHASE_ORDER,
      entityType: 'purchase_order',
      entityId: order.id,
      amountInCents: subtotalInCents,
      reason: input.note?.trim() || null,
      metadata: {
        code: order.code,
        status: order.status,
        supplierId: supplier.id,
        storeId: store.id,
        lineCount: normalized.length,
      },
    });

    return order;
  }

  async confirmOrder(id: string) {
    const tenant = TenantContext.require();
    const order = await this.prisma.db.purchaseOrder.findFirst({
      where: { id, tenantId: tenant.id },
      include: { lines: true },
    });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (order.status !== PurchaseOrderStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT orders can be confirmed');
    }
    if (!order.lines.length) {
      throw new BadRequestException('Cannot confirm an empty purchase order');
    }

    const updated = await this.prisma.db.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.ORDERED,
        orderedAt: new Date(),
      },
      include: PO_INCLUDE,
    });

    await this.audit.log({
      action: ActivityAction.PURCHASE_ORDER,
      entityType: 'purchase_order',
      entityId: id,
      amountInCents: order.subtotalInCents,
      reason: 'confirm',
      metadata: { code: order.code, from: 'DRAFT', to: 'ORDERED' },
    });

    return updated;
  }

  async cancelOrder(id: string) {
    const tenant = TenantContext.require();
    const order = await this.prisma.db.purchaseOrder.findFirst({
      where: { id, tenantId: tenant.id },
      include: { lines: true },
    });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (
      order.status !== PurchaseOrderStatus.DRAFT &&
      order.status !== PurchaseOrderStatus.ORDERED
    ) {
      throw new BadRequestException('Only DRAFT or ORDERED (unreceived) orders can be cancelled');
    }
    const anyReceived = order.lines.some((l) => l.qtyReceived > 0);
    if (anyReceived) {
      throw new BadRequestException('Cannot cancel: some lines already received');
    }

    const updated = await this.prisma.db.purchaseOrder.update({
      where: { id },
      data: {
        status: PurchaseOrderStatus.CANCELLED,
        cancelledAt: new Date(),
      },
      include: PO_INCLUDE,
    });

    await this.audit.log({
      action: ActivityAction.PURCHASE_ORDER,
      entityType: 'purchase_order',
      entityId: id,
      reason: 'cancel',
      metadata: { code: order.code, from: order.status, to: 'CANCELLED' },
    });

    return updated;
  }

  /**
   * Partial or full goods receipt against ORDERED/PARTIAL PO.
   * Concurrency: each line update uses qty_received + qty <= qty_ordered guard
   * so two cashiers cannot over-receive the same PO line.
   */
  async receive(orderId: string, input: ReceiveGoodsInput) {
    const tenant = TenantContext.require();
    const actor = AuthContext.require();
    if (!input.lines?.length) {
      throw new BadRequestException('At least one receive line is required');
    }

    const order = await this.prisma.db.purchaseOrder.findFirst({
      where: { id: orderId, tenantId: tenant.id },
      include: { lines: true },
    });
    if (!order) throw new NotFoundException('Purchase order not found');
    if (
      order.status !== PurchaseOrderStatus.ORDERED &&
      order.status !== PurchaseOrderStatus.PARTIAL
    ) {
      throw new BadRequestException('PO must be ORDERED or PARTIAL to receive');
    }

    const storeId = input.storeId?.trim() || order.storeId;
    const store = await this.prisma.db.store.findFirst({
      where: { id: storeId, tenantId: tenant.id },
    });
    if (!store) throw new BadRequestException('Receive store not found');

    const lineById = new Map(order.lines.map((l) => [l.id, l]));
    const receiveLines: Array<{
      purchaseOrderLineId: string;
      productId: string;
      qty: number;
      unitCostInCents: number;
    }> = [];

    for (const row of input.lines) {
      if (!Number.isInteger(row.qty) || row.qty < 1) {
        throw new BadRequestException('Each receive qty must be an integer >= 1');
      }
      const poLine = lineById.get(row.purchaseOrderLineId);
      if (!poLine) {
        throw new BadRequestException(`PO line ${row.purchaseOrderLineId} not on this order`);
      }
      const remaining = poLine.qtyOrdered - poLine.qtyReceived;
      if (row.qty > remaining) {
        throw new BadRequestException(
          `Cannot receive ${row.qty}: only ${remaining} remaining on line ${poLine.id}`,
        );
      }
      receiveLines.push({
        purchaseOrderLineId: poLine.id,
        productId: poLine.productId,
        qty: row.qty,
        unitCostInCents: poLine.unitCostInCents,
      });
    }

    const grCode = await this.nextDocCode('GR');

    // Apply stock + qtyReceived updates atomically in the request-scoped TX.
    for (const line of receiveLines) {
      await this.prisma.db.$executeRaw`
        INSERT INTO store_stocks (tenant_id, store_id, product_id, qty, updated_at)
        VALUES (${tenant.id}::uuid, ${storeId}::uuid, ${line.productId}::uuid, 0, CURRENT_TIMESTAMP)
        ON CONFLICT (tenant_id, store_id, product_id) DO NOTHING
      `;

      await this.prisma.db.$executeRaw`
        UPDATE store_stocks
        SET qty = qty + ${line.qty}, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${tenant.id}::uuid
          AND store_id = ${storeId}::uuid
          AND product_id = ${line.productId}::uuid
      `;

      const bumped = await this.prisma.db.$executeRaw`
        UPDATE purchase_order_lines
        SET qty_received = qty_received + ${line.qty}
        WHERE id = ${line.purchaseOrderLineId}::uuid
          AND tenant_id = ${tenant.id}::uuid
          AND qty_received + ${line.qty} <= qty_ordered
      `;
      if (Number(bumped) === 0) {
        throw new BadRequestException(
          `Concurrent over-receive blocked on line ${line.purchaseOrderLineId}`,
        );
      }

      // Keep catalog Product.stockQty ≈ sum of store stocks for admin visibility.
      const agg = await this.prisma.db.storeStock.aggregate({
        where: { tenantId: tenant.id, productId: line.productId },
        _sum: { qty: true },
      });
      await this.prisma.db.product.update({
        where: { id: line.productId },
        data: { stockQty: Math.max(0, agg._sum.qty ?? 0) },
      });
    }

    const receipt = await this.prisma.db.goodsReceipt.create({
      data: {
        tenantId: tenant.id,
        purchaseOrderId: order.id,
        storeId,
        code: grCode,
        note: input.note?.trim() || null,
        createdByUserId: actor.id,
        lines: {
          create: receiveLines.map((l) => ({
            tenantId: tenant.id,
            purchaseOrderLineId: l.purchaseOrderLineId,
            productId: l.productId,
            qty: l.qty,
            unitCostInCents: l.unitCostInCents,
          })),
        },
      },
      include: {
        store: { select: { id: true, code: true, name: true } },
        createdBy: { select: { id: true, displayName: true } },
        lines: {
          include: { product: { select: { id: true, sku: true, name: true } } },
        },
      },
    });

    const freshLines = await this.prisma.db.purchaseOrderLine.findMany({
      where: { tenantId: tenant.id, purchaseOrderId: order.id },
    });
    const allReceived = freshLines.every((l) => l.qtyReceived >= l.qtyOrdered);
    const anyReceived = freshLines.some((l) => l.qtyReceived > 0);
    const nextStatus = allReceived
      ? PurchaseOrderStatus.RECEIVED
      : anyReceived
        ? PurchaseOrderStatus.PARTIAL
        : order.status;

    await this.prisma.db.purchaseOrder.update({
      where: { id: order.id },
      data: {
        status: nextStatus,
        ...(allReceived ? { receivedAt: new Date() } : {}),
      },
    });

    const totalCost = receiveLines.reduce((s, l) => s + l.qty * l.unitCostInCents, 0);
    await this.audit.log({
      action: ActivityAction.GOODS_RECEIPT,
      entityType: 'goods_receipt',
      entityId: receipt.id,
      amountInCents: totalCost,
      reason: input.note?.trim() || null,
      metadata: {
        code: receipt.code,
        purchaseOrderId: order.id,
        purchaseOrderCode: order.code,
        storeId,
        lines: receiveLines.map((l) => ({
          purchaseOrderLineId: l.purchaseOrderLineId,
          productId: l.productId,
          qty: l.qty,
        })),
        poStatus: nextStatus,
      },
    });

    return {
      receipt,
      purchaseOrder: await this.getOrder(order.id),
    };
  }

  private assertSupplierInput(input: UpsertSupplierInput): void {
    if (!input.code?.trim() || !input.name?.trim()) {
      throw new BadRequestException('code and name are required');
    }
  }

  /** Doc codes: PO-YYYYMMDD-XXXX / GR-YYYYMMDD-XXXX (tenant-scoped uniqueness). */
  private async nextDocCode(prefix: 'PO' | 'GR'): Promise<string> {
    const tenant = TenantContext.require();
    const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    if (prefix === 'PO') {
      const last = await this.prisma.db.purchaseOrder.findFirst({
        where: { tenantId: tenant.id, code: { startsWith: `${prefix}-${day}-` } },
        orderBy: { code: 'desc' },
        select: { code: true },
      });
      const seq = last ? Number.parseInt(last.code.slice(-4), 10) + 1 : 1;
      if (!Number.isFinite(seq) || seq < 1) {
        return `${prefix}-${day}-${String(Date.now()).slice(-4)}`;
      }
      return `${prefix}-${day}-${String(seq).padStart(4, '0')}`;
    }

    const last = await this.prisma.db.goodsReceipt.findFirst({
      where: { tenantId: tenant.id, code: { startsWith: `${prefix}-${day}-` } },
      orderBy: { code: 'desc' },
      select: { code: true },
    });
    const seq = last ? Number.parseInt(last.code.slice(-4), 10) + 1 : 1;
    if (!Number.isFinite(seq) || seq < 1) {
      return `${prefix}-${day}-${String(Date.now()).slice(-4)}`;
    }
    return `${prefix}-${day}-${String(seq).padStart(4, '0')}`;
  }
}
