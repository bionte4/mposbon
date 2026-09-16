import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityAction, KitchenLineStatus, KitchenOrderStatus } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuthContext } from '../auth/auth-context';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';

export type UpsertKitchenStationInput = {
  storeId: string;
  code: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
};

export type FireKitchenInput = {
  storeId: string;
  cartClientUuid: string;
  tableLabel?: string | null;
  lines: Array<{
    clientLineId: string;
    productId: string;
    productName: string;
    quantity: number;
    guestIndex?: number;
    modifiers?: Array<{ optionId: string; name: string; priceDeltaInCents: number }>;
  }>;
};

@Injectable()
export class KitchenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listStations(storeId: string) {
    const tenant = TenantContext.require();
    return this.prisma.db.kitchenStation.findMany({
      where: {
        tenantId: tenant.id,
        storeId,
        ...this.stationScopeWhere(),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createStation(input: UpsertKitchenStationInput) {
    const tenant = TenantContext.require();
    await this.assertStore(input.storeId);
    const code = input.code.trim().toUpperCase();
    if (!code || !input.name.trim()) {
      throw new BadRequestException('code and name are required');
    }
    const clash = await this.prisma.db.kitchenStation.findFirst({
      where: { tenantId: tenant.id, storeId: input.storeId, code },
    });
    if (clash) throw new BadRequestException(`Station code ${code} already exists`);
    return this.prisma.db.kitchenStation.create({
      data: {
        tenantId: tenant.id,
        storeId: input.storeId,
        code,
        name: input.name.trim(),
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
      },
    });
  }

  async updateStation(id: string, input: Partial<UpsertKitchenStationInput>) {
    const tenant = TenantContext.require();
    const row = await this.prisma.db.kitchenStation.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!row) throw new NotFoundException('Kitchen station not found');
    return this.prisma.db.kitchenStation.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
  }

  /** Active KDS tickets grouped by order (Moka-style bump bar). */
  async listActiveTickets(storeId: string, stationId?: string) {
    const tenant = TenantContext.require();
    const allowed = this.allowedStationIds();
    if (stationId && allowed && !allowed.includes(stationId)) {
      throw new ForbiddenException('Station not assigned to this user');
    }
    const scopedStationId =
      stationId ?? (allowed?.length === 1 ? allowed[0] : undefined);
    const stationFilter = scopedStationId
      ? { stationId: scopedStationId }
      : allowed
        ? { stationId: { in: allowed } }
        : {};

    const lines = await this.prisma.db.kitchenOrderLine.findMany({
      where: {
        tenantId: tenant.id,
        order: { storeId, status: KitchenOrderStatus.OPEN },
        status: {
          in: [
            KitchenLineStatus.PENDING,
            KitchenLineStatus.PREPARING,
            KitchenLineStatus.READY,
          ],
        },
        ...stationFilter,
      },
      include: {
        station: { select: { id: true, code: true, name: true } },
        order: true,
      },
      orderBy: { firedAt: 'asc' },
    });

    const byOrder = new Map<
      string,
      {
        orderId: string;
        cartClientUuid: string;
        tableLabel: string | null;
        createdAt: Date;
        lines: typeof lines;
      }
    >();

    for (const line of lines) {
      const bucket = byOrder.get(line.orderId) ?? {
        orderId: line.orderId,
        cartClientUuid: line.order.cartClientUuid,
        tableLabel: line.order.tableLabel,
        createdAt: line.order.createdAt,
        lines: [] as typeof lines,
      };
      bucket.lines.push(line);
      byOrder.set(line.orderId, bucket);
    }

    return [...byOrder.values()];
  }

  async fireToKitchen(input: FireKitchenInput) {
    const tenant = TenantContext.require();
    await this.assertStore(input.storeId);
    if (!input.cartClientUuid?.trim()) {
      throw new BadRequestException('cartClientUuid is required');
    }
    if (!input.lines?.length) {
      throw new BadRequestException('lines are required');
    }

    let order = await this.prisma.db.kitchenOrder.findFirst({
      where: {
        tenantId: tenant.id,
        cartClientUuid: input.cartClientUuid,
        status: KitchenOrderStatus.OPEN,
      },
    });

    if (!order) {
      order = await this.prisma.db.kitchenOrder.create({
        data: {
          id: randomUUID(),
          tenantId: tenant.id,
          storeId: input.storeId,
          cartClientUuid: input.cartClientUuid,
          tableLabel: input.tableLabel?.trim() || null,
        },
      });
    } else if (input.tableLabel !== undefined) {
      await this.prisma.db.kitchenOrder.update({
        where: { id: order.id },
        data: { tableLabel: input.tableLabel?.trim() || null },
      });
    }

    const created: string[] = [];
    for (const line of input.lines) {
      if (!line.clientLineId || !line.productId || line.quantity < 1) {
        throw new BadRequestException('Invalid kitchen line');
      }
      const product = await this.prisma.db.product.findFirst({
        where: { id: line.productId, tenantId: tenant.id },
        select: { kitchenStationId: true },
      });
      if (!product?.kitchenStationId) continue;

      const existing = await this.prisma.db.kitchenOrderLine.findFirst({
        where: {
          tenantId: tenant.id,
          orderId: order.id,
          clientLineId: line.clientLineId,
        },
      });
      if (existing) continue;

      const row = await this.prisma.db.kitchenOrderLine.create({
        data: {
          id: randomUUID(),
          tenantId: tenant.id,
          orderId: order.id,
          stationId: product.kitchenStationId,
          productId: line.productId,
          productName: line.productName,
          quantity: line.quantity,
          guestIndex: line.guestIndex ?? 1,
          clientLineId: line.clientLineId,
          modifiersJson: line.modifiers?.length ? line.modifiers : undefined,
        },
      });
      created.push(row.id);
    }

    if (created.length) {
      await this.audit.log({
        action: ActivityAction.KITCHEN_FIRE,
        entityType: 'kitchen_order',
        entityId: order.id,
        metadata: {
          storeId: input.storeId,
          cartClientUuid: input.cartClientUuid,
          lineIds: created,
        },
      });
    }

    // Fire is cashier-side; skip KDS station ACL by listing without actor scope.
    return this.listActiveTicketsUnscoped(input.storeId);
  }

  async bumpLine(lineId: string, status: KitchenLineStatus) {
    const tenant = TenantContext.require();
    const line = await this.prisma.db.kitchenOrderLine.findFirst({
      where: { id: lineId, tenantId: tenant.id },
      include: { order: true },
    });
    if (!line) throw new NotFoundException('Kitchen line not found');
    if (line.order.status !== KitchenOrderStatus.OPEN) {
      throw new BadRequestException('Kitchen order is closed');
    }
    this.assertStationAllowed(line.stationId);

    const allowed: Record<KitchenLineStatus, KitchenLineStatus[]> = {
      PENDING: [KitchenLineStatus.PREPARING, KitchenLineStatus.CANCELLED],
      PREPARING: [KitchenLineStatus.READY, KitchenLineStatus.CANCELLED],
      READY: [KitchenLineStatus.DONE, KitchenLineStatus.CANCELLED],
      DONE: [],
      CANCELLED: [],
    };
    if (!allowed[line.status]?.includes(status)) {
      throw new BadRequestException(`Cannot transition ${line.status} → ${status}`);
    }

    await this.prisma.db.kitchenOrderLine.update({
      where: { id: lineId },
      data: {
        status,
        readyAt: status === KitchenLineStatus.READY ? new Date() : line.readyAt,
      },
    });

    await this.maybeCloseOrder(line.orderId);
    return this.prisma.db.kitchenOrderLine.findFirst({
      where: { id: lineId },
      include: { station: true, order: true },
    });
  }

  async completeForSale(cartClientUuid: string, saleId: string): Promise<void> {
    const tenant = TenantContext.require();
    const orders = await this.prisma.db.kitchenOrder.findMany({
      where: {
        tenantId: tenant.id,
        cartClientUuid,
        status: KitchenOrderStatus.OPEN,
      },
    });
    for (const order of orders) {
      await this.prisma.db.kitchenOrderLine.updateMany({
        where: {
          orderId: order.id,
          status: {
            in: [
              KitchenLineStatus.PENDING,
              KitchenLineStatus.PREPARING,
              KitchenLineStatus.READY,
            ],
          },
        },
        data: { status: KitchenLineStatus.DONE },
      });
      await this.prisma.db.kitchenOrder.update({
        where: { id: order.id },
        data: { status: KitchenOrderStatus.DONE, saleId },
      });
    }
  }

  /**
   * null = unrestricted (non-KITCHEN roles, or KITCHEN without assignments).
   * string[] = only these station IDs.
   */
  private allowedStationIds(): string[] | null {
    const user = AuthContext.current();
    if (!user) return null;
    if (user.role !== 'KITCHEN') return null;
    const ids = user.kitchenStationIds;
    if (!ids?.length) return null;
    return ids;
  }

  private stationScopeWhere(): { id?: { in: string[] } } {
    const allowed = this.allowedStationIds();
    return allowed ? { id: { in: allowed } } : {};
  }

  private assertStationAllowed(stationId: string): void {
    const allowed = this.allowedStationIds();
    if (allowed && !allowed.includes(stationId)) {
      throw new ForbiddenException('Station not assigned to this user');
    }
  }

  private async listActiveTicketsUnscoped(storeId: string) {
    const tenant = TenantContext.require();
    const lines = await this.prisma.db.kitchenOrderLine.findMany({
      where: {
        tenantId: tenant.id,
        order: { storeId, status: KitchenOrderStatus.OPEN },
        status: {
          in: [
            KitchenLineStatus.PENDING,
            KitchenLineStatus.PREPARING,
            KitchenLineStatus.READY,
          ],
        },
      },
      include: {
        station: { select: { id: true, code: true, name: true } },
        order: true,
      },
      orderBy: { firedAt: 'asc' },
    });
    const byOrder = new Map<string, {
      orderId: string;
      cartClientUuid: string;
      tableLabel: string | null;
      createdAt: Date;
      lines: typeof lines;
    }>();
    for (const line of lines) {
      const bucket = byOrder.get(line.orderId) ?? {
        orderId: line.orderId,
        cartClientUuid: line.order.cartClientUuid,
        tableLabel: line.order.tableLabel,
        createdAt: line.order.createdAt,
        lines: [] as typeof lines,
      };
      bucket.lines.push(line);
      byOrder.set(line.orderId, bucket);
    }
    return [...byOrder.values()];
  }

  private async maybeCloseOrder(orderId: string): Promise<void> {
    const openLines = await this.prisma.db.kitchenOrderLine.count({
      where: {
        orderId,
        status: {
          in: [
            KitchenLineStatus.PENDING,
            KitchenLineStatus.PREPARING,
            KitchenLineStatus.READY,
          ],
        },
      },
    });
    if (openLines === 0) {
      await this.prisma.db.kitchenOrder.update({
        where: { id: orderId },
        data: { status: KitchenOrderStatus.DONE },
      });
    }
  }

  private async assertStore(storeId: string) {
    const tenant = TenantContext.require();
    const store = await this.prisma.db.store.findFirst({
      where: { id: storeId, tenantId: tenant.id },
    });
    if (!store) throw new NotFoundException('Store not found');
  }
}
