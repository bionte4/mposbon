import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CartStatus } from '@prisma/client';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';

export type UpsertTableAreaInput = {
  storeId: string;
  name: string;
  sortOrder?: number;
  isActive?: boolean;
};

export type UpsertDiningTableInput = {
  storeId: string;
  areaId?: string | null;
  code: string;
  name: string;
  capacity?: number;
  sortOrder?: number;
  isActive?: boolean;
};

export type TableFloorStatus = 'AVAILABLE' | 'OCCUPIED' | 'BILLING';

export type FloorTable = {
  id: string;
  code: string;
  name: string;
  capacity: number;
  sortOrder: number;
  isActive: boolean;
  areaId: string | null;
  status: TableFloorStatus;
  activeCart: {
    clientUuid: string;
    label: string | null;
    totalInCents: number;
    itemCount: number;
    parkedAt: string | null;
    updatedAt: string;
  } | null;
};

@Injectable()
export class TablesService {
  constructor(private readonly prisma: PrismaService) {}

  listAreas(storeId: string) {
    const tenant = TenantContext.require();
    return this.prisma.db.tableArea.findMany({
      where: { tenantId: tenant.id, storeId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createArea(input: UpsertTableAreaInput) {
    const tenant = TenantContext.require();
    const storeId = input.storeId;
    await this.assertStore(storeId);
    const name = input.name?.trim();
    if (!name) throw new BadRequestException('name is required');
    return this.prisma.db.tableArea.create({
      data: {
        tenantId: tenant.id,
        storeId,
        name,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
      },
    });
  }

  async updateArea(id: string, input: Partial<UpsertTableAreaInput>) {
    const tenant = TenantContext.require();
    const row = await this.prisma.db.tableArea.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!row) throw new NotFoundException('Table area not found');
    if (input.storeId && input.storeId !== row.storeId) {
      throw new BadRequestException('Cannot move area to another store');
    }
    return this.prisma.db.tableArea.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
  }

  listTables(storeId: string, activeOnly = false) {
    const tenant = TenantContext.require();
    return this.prisma.db.diningTable.findMany({
      where: {
        tenantId: tenant.id,
        storeId,
        ...(activeOnly ? { isActive: true } : {}),
      },
      include: { area: { select: { id: true, name: true } } },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });
  }

  async createTable(input: UpsertDiningTableInput) {
    const tenant = TenantContext.require();
    const storeId = input.storeId;
    await this.assertStore(storeId);
    const code = input.code.trim().toUpperCase();
    const name = input.name.trim();
    if (!code || !name) throw new BadRequestException('code and name are required');
    const capacity = input.capacity ?? 4;
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new BadRequestException('capacity must be an integer >= 1');
    }
    if (input.areaId) {
      await this.assertArea(input.areaId, storeId);
    }
    const clash = await this.prisma.db.diningTable.findFirst({
      where: { tenantId: tenant.id, storeId, code },
    });
    if (clash) throw new BadRequestException(`Table code ${code} already exists`);
    return this.prisma.db.diningTable.create({
      data: {
        tenantId: tenant.id,
        storeId,
        areaId: input.areaId ?? null,
        code,
        name,
        capacity,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
      },
      include: { area: { select: { id: true, name: true } } },
    });
  }

  async updateTable(id: string, input: Partial<UpsertDiningTableInput>) {
    const tenant = TenantContext.require();
    const row = await this.prisma.db.diningTable.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!row) throw new NotFoundException('Table not found');
    if (input.storeId && input.storeId !== row.storeId) {
      throw new BadRequestException('Cannot move table to another store');
    }
    if (input.areaId) {
      await this.assertArea(input.areaId, row.storeId);
    }
    let code = row.code;
    if (input.code !== undefined) {
      code = input.code.trim().toUpperCase();
      if (!code) throw new BadRequestException('code is required');
      const clash = await this.prisma.db.diningTable.findFirst({
        where: { tenantId: tenant.id, storeId: row.storeId, code, NOT: { id } },
      });
      if (clash) throw new BadRequestException(`Table code ${code} already exists`);
    }
    if (input.capacity !== undefined) {
      if (!Number.isInteger(input.capacity) || input.capacity < 1) {
        throw new BadRequestException('capacity must be an integer >= 1');
      }
    }
    return this.prisma.db.diningTable.update({
      where: { id },
      data: {
        ...(input.areaId !== undefined ? { areaId: input.areaId } : {}),
        ...(input.code !== undefined ? { code } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      include: { area: { select: { id: true, name: true } } },
    });
  }

  /** Floor plan with live status from OPEN carts (Moka-style). */
  async getFloor(storeId: string) {
    const tenant = TenantContext.require();
    await this.assertStore(storeId);

    const [areas, tables, openCarts] = await Promise.all([
      this.prisma.db.tableArea.findMany({
        where: { tenantId: tenant.id, storeId, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.db.diningTable.findMany({
        where: { tenantId: tenant.id, storeId, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      }),
      this.prisma.db.cart.findMany({
        where: {
          tenantId: tenant.id,
          storeId,
          status: CartStatus.OPEN,
          tableId: { not: null },
        },
        include: { items: true, table: { select: { id: true, code: true, name: true } } },
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    const cartByTable = new Map<string, (typeof openCarts)[number]>();
    for (const cart of openCarts) {
      if (!cart.tableId || cartByTable.has(cart.tableId)) continue;
      if (cart.items.length === 0 && !cart.parkedAt) continue;
      cartByTable.set(cart.tableId, cart);
    }

    const mapTable = (table: (typeof tables)[number]): FloorTable => {
      const cart = cartByTable.get(table.id);
      let status: TableFloorStatus = 'AVAILABLE';
      let activeCart: FloorTable['activeCart'] = null;
      if (cart) {
        status = cart.parkedAt ? 'BILLING' : 'OCCUPIED';
        activeCart = {
          clientUuid: cart.clientUuid,
          label: cart.label,
          totalInCents: cart.totalInCents,
          itemCount: cart.items.length,
          parkedAt: cart.parkedAt?.toISOString() ?? null,
          updatedAt: cart.updatedAt.toISOString(),
        };
      }
      return {
        id: table.id,
        code: table.code,
        name: table.name,
        capacity: table.capacity,
        sortOrder: table.sortOrder,
        isActive: table.isActive,
        areaId: table.areaId,
        status,
        activeCart,
      };
    };

    const ungrouped = tables.filter((t) => !t.areaId).map(mapTable);
    const grouped = areas.map((area) => ({
      id: area.id,
      name: area.name,
      sortOrder: area.sortOrder,
      tables: tables.filter((t) => t.areaId === area.id).map(mapTable),
    }));

    return {
      storeId,
      areas: grouped,
      ungrouped,
    };
  }

  async getTable(id: string) {
    const tenant = TenantContext.require();
    const table = await this.prisma.db.diningTable.findFirst({
      where: { id, tenantId: tenant.id },
      include: { area: { select: { id: true, name: true } } },
    });
    if (!table) throw new NotFoundException('Table not found');
    return table;
  }

  private async assertStore(storeId: string) {
    const tenant = TenantContext.require();
    const store = await this.prisma.db.store.findFirst({
      where: { id: storeId, tenantId: tenant.id },
    });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  private async assertArea(areaId: string, storeId: string) {
    const tenant = TenantContext.require();
    const area = await this.prisma.db.tableArea.findFirst({
      where: { id: areaId, tenantId: tenant.id, storeId },
    });
    if (!area) throw new NotFoundException('Table area not found for this store');
    return area;
  }
}
