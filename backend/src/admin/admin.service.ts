import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityAction, StaffRole } from '@prisma/client';
import { AuthContext } from '../auth/auth-context';
import { hashPin } from '../auth/pin';
import type { StaffRole as AppStaffRole } from '../auth/permissions';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';

export type UpsertCategoryInput = {
  name: string;
  sortOrder?: number;
};

export type PatchCategoryInput = {
  name?: string;
  sortOrder?: number;
};

export type UpsertProductInput = {
  categoryId: string;
  sku: string;
  barcode?: string | null;
  name: string;
  unitPriceInCents: number;
  taxBps?: number;
  stockQty?: number;
  isActive?: boolean;
  productType?: 'RETAIL' | 'MENU' | 'INGREDIENT';
  kitchenStationId?: string | null;
};

export type PatchProductInput = Partial<UpsertProductInput>;

export type CreateStaffInput = {
  email: string;
  displayName: string;
  role: StaffRole;
  pin: string;
  isActive?: boolean;
  /** Station IDs for KITCHEN role (BAR / KITCHEN / …). */
  kitchenStationIds?: string[];
};

export type PatchStaffInput = {
  email?: string;
  displayName?: string;
  role?: StaffRole;
  pin?: string | null;
  isActive?: boolean;
  kitchenStationIds?: string[];
};

const ROLE_RANK: Record<StaffRole, number> = {
  CASHIER: 1,
  KITCHEN: 1,
  SUPERVISOR: 2,
  MANAGER: 3,
  TENANT_ADMIN: 4,
  SUPER_ADMIN: 5,
};

const ASSIGNABLE_ROLES: StaffRole[] = [
  StaffRole.CASHIER,
  StaffRole.KITCHEN,
  StaffRole.SUPERVISOR,
  StaffRole.MANAGER,
  StaffRole.TENANT_ADMIN,
  StaffRole.SUPER_ADMIN,
];

@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  listCategories() {
    const tenant = TenantContext.require();
    return this.prisma.db.category.findMany({
      where: { tenantId: tenant.id },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { products: true } } },
    });
  }

  async createCategory(input: UpsertCategoryInput) {
    const tenant = TenantContext.require();
    const name = input.name?.trim();
    if (!name) {
      throw new BadRequestException('Category name is required');
    }
    const sortOrder = input.sortOrder ?? 0;
    if (!Number.isInteger(sortOrder)) {
      throw new BadRequestException('sortOrder must be an integer');
    }
    const category = await this.prisma.db.category.create({
      data: { tenantId: tenant.id, name, sortOrder },
    });
    await this.audit.log({
      action: ActivityAction.ADMIN_CATALOG_CHANGE,
      entityType: 'category',
      entityId: category.id,
      reason: 'admin.create_category',
      metadata: { name },
    });
    return category;
  }

  async updateCategory(id: string, input: PatchCategoryInput) {
    const tenant = TenantContext.require();
    const existing = await this.prisma.db.category.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!existing) {
      throw new NotFoundException('Category not found');
    }
    const name = input.name !== undefined ? input.name.trim() : undefined;
    if (name !== undefined && !name) {
      throw new BadRequestException('Category name is required');
    }
    if (input.sortOrder !== undefined && !Number.isInteger(input.sortOrder)) {
      throw new BadRequestException('sortOrder must be an integer');
    }
    const category = await this.prisma.db.category.update({
      where: { id },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
    });
    await this.audit.log({
      action: ActivityAction.ADMIN_CATALOG_CHANGE,
      entityType: 'category',
      entityId: category.id,
      reason: 'admin.update_category',
      metadata: { name: category.name, sortOrder: category.sortOrder },
    });
    return category;
  }

  async deleteCategory(id: string) {
    const tenant = TenantContext.require();
    const existing = await this.prisma.db.category.findFirst({
      where: { id, tenantId: tenant.id },
      include: { _count: { select: { products: true } } },
    });
    if (!existing) {
      throw new NotFoundException('Category not found');
    }
    if (existing._count.products > 0) {
      throw new BadRequestException(
        `Category still has ${existing._count.products} product(s); reassign them first`,
      );
    }
    await this.prisma.db.category.delete({ where: { id } });
    await this.audit.log({
      action: ActivityAction.ADMIN_CATALOG_CHANGE,
      entityType: 'category',
      entityId: id,
      reason: 'admin.delete_category',
      metadata: { name: existing.name },
    });
    return { id, deleted: true };
  }

  listProducts() {
    const tenant = TenantContext.require();
    return this.prisma.db.product.findMany({
      where: { tenantId: tenant.id },
      orderBy: { name: 'asc' },
      include: {
        category: { select: { id: true, name: true } },
        modifierGroups: {
          orderBy: { sortOrder: 'asc' },
          include: {
            options: { orderBy: { sortOrder: 'asc' } },
          },
        },
        variants: {
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        },
      },
    });
  }

  async createProduct(input: UpsertProductInput) {
    const tenant = TenantContext.require();
    this.assertProductInput(input);
    await this.assertCategory(tenant.id, input.categoryId);

    const product = await this.prisma.db.product.create({
      data: {
        tenantId: tenant.id,
        categoryId: input.categoryId,
        sku: input.sku.trim(),
        barcode: input.barcode?.trim() || null,
        name: input.name.trim(),
        unitPriceInCents: input.unitPriceInCents,
        taxBps: input.taxBps ?? 0,
        stockQty: input.stockQty ?? 0,
        isActive: input.isActive ?? true,
        productType: input.productType ?? 'RETAIL',
        kitchenStationId: input.kitchenStationId ?? null,
      },
      include: { category: { select: { id: true, name: true } } },
    });

    await this.audit.log({
      action: ActivityAction.ADMIN_CATALOG_CHANGE,
      entityType: 'product',
      entityId: product.id,
      amountInCents: product.unitPriceInCents,
      reason: 'admin.create_product',
      metadata: { sku: product.sku, name: product.name },
    });
    return product;
  }

  async updateProduct(productId: string, input: PatchProductInput) {
    const tenant = TenantContext.require();
    const existing = await this.prisma.db.product.findFirst({
      where: { id: productId, tenantId: tenant.id },
    });
    if (!existing) {
      throw new NotFoundException('Product not found');
    }

    if (input.categoryId) {
      await this.assertCategory(tenant.id, input.categoryId);
    }
    if (input.unitPriceInCents !== undefined) {
      this.assertMoney(input.unitPriceInCents, 'unitPriceInCents');
    }
    if (input.taxBps !== undefined && (!Number.isInteger(input.taxBps) || input.taxBps < 0)) {
      throw new BadRequestException('taxBps must be a non-negative integer');
    }
    if (input.stockQty !== undefined && !Number.isInteger(input.stockQty)) {
      throw new BadRequestException('stockQty must be an integer');
    }

    const product = await this.prisma.db.product.update({
      where: { id: existing.id },
      data: {
        categoryId: input.categoryId,
        sku: input.sku?.trim(),
        barcode:
          input.barcode === undefined
            ? undefined
            : input.barcode?.trim() || null,
        name: input.name?.trim(),
        unitPriceInCents: input.unitPriceInCents,
        taxBps: input.taxBps,
        stockQty: input.stockQty,
        isActive: input.isActive,
        productType: input.productType,
        kitchenStationId:
          input.kitchenStationId === undefined
            ? undefined
            : input.kitchenStationId,
      },
      include: { category: { select: { id: true, name: true } } },
    });

    await this.audit.log({
      action: ActivityAction.ADMIN_CATALOG_CHANGE,
      entityType: 'product',
      entityId: product.id,
      amountInCents: product.unitPriceInCents,
      reason: 'admin.update_product',
      metadata: {
        before: {
          unitPriceInCents: existing.unitPriceInCents,
          stockQty: existing.stockQty,
          isActive: existing.isActive,
        },
        after: {
          unitPriceInCents: product.unitPriceInCents,
          stockQty: product.stockQty,
          isActive: product.isActive,
        },
      },
    });
    return product;
  }

  async createModifierGroup(
    productId: string,
    input: {
      name: string;
      minSelect?: number;
      maxSelect?: number;
      sortOrder?: number;
    },
  ) {
    const tenant = TenantContext.require();
    const product = await this.prisma.db.product.findFirst({
      where: { id: productId, tenantId: tenant.id },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    const name = input.name?.trim();
    if (!name) {
      throw new BadRequestException('Modifier group name is required');
    }
    const minSelect = input.minSelect ?? 0;
    const maxSelect = input.maxSelect ?? 1;
    const sortOrder = input.sortOrder ?? 0;
    this.assertModifierBounds(minSelect, maxSelect);
    if (!Number.isInteger(sortOrder)) {
      throw new BadRequestException('sortOrder must be an integer');
    }

    const group = await this.prisma.db.productModifierGroup.create({
      data: {
        tenantId: tenant.id,
        productId,
        name,
        minSelect,
        maxSelect,
        sortOrder,
      },
      include: { options: { orderBy: { sortOrder: 'asc' } } },
    });
    await this.audit.log({
      action: ActivityAction.ADMIN_CATALOG_CHANGE,
      entityType: 'modifier_group',
      entityId: group.id,
      reason: 'admin.create_modifier_group',
      metadata: { productId, name },
    });
    return group;
  }

  async updateModifierGroup(
    groupId: string,
    input: {
      name?: string;
      minSelect?: number;
      maxSelect?: number;
      sortOrder?: number;
    },
  ) {
    const tenant = TenantContext.require();
    const existing = await this.prisma.db.productModifierGroup.findFirst({
      where: { id: groupId, tenantId: tenant.id },
    });
    if (!existing) {
      throw new NotFoundException('Modifier group not found');
    }
    const name = input.name !== undefined ? input.name.trim() : undefined;
    if (name !== undefined && !name) {
      throw new BadRequestException('modifier group name is required');
    }
    const minSelect = input.minSelect ?? existing.minSelect;
    const maxSelect = input.maxSelect ?? existing.maxSelect;
    this.assertModifierBounds(minSelect, maxSelect);
    if (input.sortOrder !== undefined && !Number.isInteger(input.sortOrder)) {
      throw new BadRequestException('sortOrder must be an integer');
    }

    const group = await this.prisma.db.productModifierGroup.update({
      where: { id: groupId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(input.minSelect !== undefined ? { minSelect: input.minSelect } : {}),
        ...(input.maxSelect !== undefined ? { maxSelect: input.maxSelect } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      },
      include: { options: { orderBy: { sortOrder: 'asc' } } },
    });
    await this.audit.log({
      action: ActivityAction.ADMIN_CATALOG_CHANGE,
      entityType: 'modifier_group',
      entityId: group.id,
      reason: 'admin.update_modifier_group',
      metadata: { name: group.name },
    });
    return group;
  }

  async deleteModifierGroup(groupId: string) {
    const tenant = TenantContext.require();
    const existing = await this.prisma.db.productModifierGroup.findFirst({
      where: { id: groupId, tenantId: tenant.id },
    });
    if (!existing) {
      throw new NotFoundException('Modifier group not found');
    }
    await this.prisma.db.productModifierGroup.delete({ where: { id: groupId } });
    await this.audit.log({
      action: ActivityAction.ADMIN_CATALOG_CHANGE,
      entityType: 'modifier_group',
      entityId: groupId,
      reason: 'admin.delete_modifier_group',
      metadata: { name: existing.name, productId: existing.productId },
    });
    return { id: groupId, deleted: true };
  }

  async createModifierOption(
    groupId: string,
    input: {
      name: string;
      priceDeltaInCents?: number;
      sortOrder?: number;
      isActive?: boolean;
    },
  ) {
    const tenant = TenantContext.require();
    const group = await this.prisma.db.productModifierGroup.findFirst({
      where: { id: groupId, tenantId: tenant.id },
    });
    if (!group) {
      throw new NotFoundException('Modifier group not found');
    }
    const name = input.name?.trim();
    if (!name) {
      throw new BadRequestException('option name is required');
    }
    const priceDeltaInCents = input.priceDeltaInCents ?? 0;
    if (!Number.isInteger(priceDeltaInCents)) {
      throw new BadRequestException('priceDeltaInCents must be an integer');
    }
    const sortOrder = input.sortOrder ?? 0;
    if (!Number.isInteger(sortOrder)) {
      throw new BadRequestException('sortOrder must be an integer');
    }

    const option = await this.prisma.db.productModifierOption.create({
      data: {
        tenantId: tenant.id,
        groupId,
        name,
        priceDeltaInCents,
        sortOrder,
        isActive: input.isActive !== false,
      },
    });
    await this.audit.log({
      action: ActivityAction.ADMIN_CATALOG_CHANGE,
      entityType: 'modifier_option',
      entityId: option.id,
      amountInCents: option.priceDeltaInCents,
      reason: 'admin.create_modifier_option',
      metadata: { groupId, name },
    });
    return option;
  }

  async updateModifierOption(
    optionId: string,
    input: {
      name?: string;
      priceDeltaInCents?: number;
      sortOrder?: number;
      isActive?: boolean;
    },
  ) {
    const tenant = TenantContext.require();
    const existing = await this.prisma.db.productModifierOption.findFirst({
      where: { id: optionId, tenantId: tenant.id },
    });
    if (!existing) {
      throw new NotFoundException('modifier option not found');
    }
    const name = input.name !== undefined ? input.name.trim() : undefined;
    if (name !== undefined && !name) {
      throw new BadRequestException('option name is required');
    }
    if (input.priceDeltaInCents !== undefined && !Number.isInteger(input.priceDeltaInCents)) {
      throw new BadRequestException('priceDeltaInCents must be an integer');
    }
    if (input.sortOrder !== undefined && !Number.isInteger(input.sortOrder)) {
      throw new BadRequestException('sortOrder must be an integer');
    }

    const option = await this.prisma.db.productModifierOption.update({
      where: { id: optionId },
      data: {
        ...(name !== undefined ? { name } : {}),
        ...(input.priceDeltaInCents !== undefined
          ? { priceDeltaInCents: input.priceDeltaInCents }
          : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
    await this.audit.log({
      action: ActivityAction.ADMIN_CATALOG_CHANGE,
      entityType: 'modifier_option',
      entityId: option.id,
      amountInCents: option.priceDeltaInCents,
      reason: 'admin.update_modifier_option',
      metadata: { name: option.name, isActive: option.isActive },
    });
    return option;
  }

  async deleteModifierOption(optionId: string) {
    const tenant = TenantContext.require();
    const existing = await this.prisma.db.productModifierOption.findFirst({
      where: { id: optionId, tenantId: tenant.id },
    });
    if (!existing) {
      throw new NotFoundException('modifier option not found');
    }
    await this.prisma.db.productModifierOption.delete({ where: { id: optionId } });
    await this.audit.log({
      action: ActivityAction.ADMIN_CATALOG_CHANGE,
      entityType: 'modifier_option',
      entityId: optionId,
      reason: 'admin.delete_modifier_option',
      metadata: { name: existing.name, groupId: existing.groupId },
    });
    return { id: optionId, deleted: true };
  }

  private assertModifierBounds(minSelect: number, maxSelect: number): void {
    if (!Number.isInteger(minSelect) || minSelect < 0) {
      throw new BadRequestException('minSelect must be an integer >= 0');
    }
    if (!Number.isInteger(maxSelect) || maxSelect < 1) {
      throw new BadRequestException('maxSelect must be an integer >= 1');
    }
    if (minSelect > maxSelect) {
      throw new BadRequestException('minSelect cannot exceed maxSelect');
    }
  }

  listStaff() {
    const tenant = TenantContext.require();
    return this.prisma.db.user
      .findMany({
        where: { tenantId: tenant.id },
        orderBy: [{ role: 'asc' }, { displayName: 'asc' }],
        select: {
          id: true,
          email: true,
          displayName: true,
          role: true,
          isActive: true,
          pinHash: true,
          createdAt: true,
          updatedAt: true,
          kitchenStations: { select: { stationId: true } },
        },
      })
      .then((rows) =>
        rows.map(({ pinHash, kitchenStations, ...rest }) => ({
          ...rest,
          hasPin: Boolean(pinHash),
          kitchenStationIds: kitchenStations.map((s) => s.stationId),
        })),
      );
  }

  async createStaff(input: CreateStaffInput) {
    const tenant = TenantContext.require();
    const actor = AuthContext.require();
    const email = this.normalizeEmail(input.email);
    const displayName = input.displayName?.trim();
    if (!displayName) {
      throw new BadRequestException('displayName is required');
    }
    this.assertCanAssignRole(actor.role as AppStaffRole, input.role);
    this.assertPin(input.pin);

    const existing = await this.prisma.db.user.findFirst({
      where: { tenantId: tenant.id, email },
    });
    if (existing) {
      throw new BadRequestException('Email already registered for this tenant');
    }

    const stationIds = await this.normalizeKitchenStationIds(
      tenant.id,
      input.role,
      input.kitchenStationIds,
    );

    const user = await this.prisma.db.user.create({
      data: {
        tenantId: tenant.id,
        email,
        displayName,
        role: input.role,
        pinHash: hashPin(input.pin),
        isActive: input.isActive !== false,
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (stationIds.length) {
      await this.prisma.db.userKitchenStation.createMany({
        data: stationIds.map((stationId) => ({
          tenantId: tenant.id,
          userId: user.id,
          stationId,
        })),
      });
    }

    await this.audit.log({
      action: ActivityAction.ADMIN_CATALOG_CHANGE,
      entityType: 'user',
      entityId: user.id,
      reason: 'admin.create_staff',
      metadata: { email: user.email, role: user.role, kitchenStationIds: stationIds },
    });

    return { ...user, hasPin: true, kitchenStationIds: stationIds };
  }

  async updateStaff(id: string, input: PatchStaffInput) {
    const tenant = TenantContext.require();
    const actor = AuthContext.require();
    const existing = await this.prisma.db.user.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!existing) {
      throw new NotFoundException('Staff not found');
    }

    // Cannot edit a peer/superior beyond own rank.
    this.assertCanManageTarget(actor.role as AppStaffRole, existing.role);

    if (input.role != null) {
      this.assertCanAssignRole(actor.role as AppStaffRole, input.role);
    }

    if (actor.id === id) {
      if (input.role != null && input.role !== existing.role) {
        throw new BadRequestException('Cannot change your own role');
      }
      if (input.isActive === false) {
        throw new BadRequestException('Cannot deactivate your own account');
      }
    }

    let email: string | undefined;
    if (input.email !== undefined) {
      email = this.normalizeEmail(input.email);
      if (email !== existing.email) {
        const clash = await this.prisma.db.user.findFirst({
          where: { tenantId: tenant.id, email, NOT: { id } },
        });
        if (clash) {
          throw new BadRequestException('Email already registered for this tenant');
        }
      }
    }

    let displayName: string | undefined;
    if (input.displayName !== undefined) {
      displayName = input.displayName.trim();
      if (!displayName) {
        throw new BadRequestException('displayName is required');
      }
    }

    let pinHash: string | null | undefined = undefined;
    if (input.pin !== undefined) {
      if (input.pin === null || input.pin === '') {
        pinHash = null;
      } else {
        this.assertPin(input.pin);
        pinHash = hashPin(input.pin);
      }
    }

    // Keep at least one active tenant admin.
    const nextRole = input.role ?? existing.role;
    const nextActive = input.isActive ?? existing.isActive;
    if (
      existing.role === StaffRole.TENANT_ADMIN &&
      existing.isActive &&
      (nextRole !== StaffRole.TENANT_ADMIN || !nextActive)
    ) {
      const otherAdmins = await this.prisma.db.user.count({
        where: {
          tenantId: tenant.id,
          role: StaffRole.TENANT_ADMIN,
          isActive: true,
          NOT: { id },
        },
      });
      if (otherAdmins === 0) {
        throw new BadRequestException('Tenant must keep at least one active admin');
      }
    }

    const updated = await this.prisma.db.user.update({
      where: { id },
      data: {
        ...(email !== undefined ? { email } : {}),
        ...(displayName !== undefined ? { displayName } : {}),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(pinHash !== undefined ? { pinHash } : {}),
      },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        isActive: true,
        pinHash: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    let kitchenStationIds: string[];
    if (input.kitchenStationIds !== undefined || input.role !== undefined) {
      const roleForStations = (input.role ?? existing.role) as StaffRole;
      const existingStations = await this.prisma.db.userKitchenStation.findMany({
        where: { userId: id },
        select: { stationId: true },
      });
      kitchenStationIds = await this.normalizeKitchenStationIds(
        tenant.id,
        roleForStations,
        input.kitchenStationIds ?? existingStations.map((r: { stationId: string }) => r.stationId),
      );
      await this.prisma.db.userKitchenStation.deleteMany({
        where: { userId: id, tenantId: tenant.id },
      });
      if (kitchenStationIds.length) {
        await this.prisma.db.userKitchenStation.createMany({
          data: kitchenStationIds.map((stationId) => ({
            tenantId: tenant.id,
            userId: id,
            stationId,
          })),
        });
      }
    } else {
      kitchenStationIds = (
        await this.prisma.db.userKitchenStation.findMany({
          where: { userId: id },
          select: { stationId: true },
        })
      ).map((r: { stationId: string }) => r.stationId);
    }

    await this.audit.log({
      action: ActivityAction.ADMIN_CATALOG_CHANGE,
      entityType: 'user',
      entityId: updated.id,
      reason: 'admin.update_staff',
      metadata: {
        email: updated.email,
        role: updated.role,
        isActive: updated.isActive,
        pinChanged: pinHash !== undefined,
        kitchenStationIds,
      },
    });

    const { pinHash: storedPin, ...rest } = updated;
    return {
      ...rest,
      hasPin: Boolean(storedPin),
      kitchenStationIds,
    };
  }

  private async normalizeKitchenStationIds(
    tenantId: string,
    role: StaffRole,
    raw: string[] | undefined,
  ): Promise<string[]> {
    const ids = [...new Set((raw ?? []).filter(Boolean))];
    if (role !== StaffRole.KITCHEN) {
      return [];
    }
    if (!ids.length) return [];
    const found = await this.prisma.db.kitchenStation.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true },
    });
    if (found.length !== ids.length) {
      throw new BadRequestException('One or more kitchen stations are invalid');
    }
    return found.map((s) => s.id);
  }

  private normalizeEmail(email: string): string {
    const value = email?.trim().toLowerCase();
    if (!value || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      throw new BadRequestException('Valid email is required');
    }
    return value;
  }

  private assertPin(pin: string): void {
    if (!/^\d{4,8}$/.test(pin)) {
      throw new BadRequestException('PIN must be 4–8 digits');
    }
  }

  private assertCanAssignRole(actorRole: AppStaffRole, targetRole: StaffRole): void {
    if (!ASSIGNABLE_ROLES.includes(targetRole)) {
      throw new BadRequestException('Invalid role');
    }
    if (ROLE_RANK[targetRole] > ROLE_RANK[actorRole as StaffRole]) {
      throw new ForbiddenException('Cannot assign a role above your own');
    }
  }

  private assertCanManageTarget(actorRole: AppStaffRole, targetRole: StaffRole): void {
    if (ROLE_RANK[targetRole] > ROLE_RANK[actorRole as StaffRole]) {
      throw new ForbiddenException('Cannot manage a user with a higher role');
    }
  }

  private storeSelect = {
    id: true,
    code: true,
    name: true,
    address: true,
    phone: true,
    timezone: true,
    receiptHeader: true,
    receiptFooter: true,
    isActive: true,
    qrisPayload: true,
    updatedAt: true,
  } as const;

  listStores() {
    const tenant = TenantContext.require();
    return this.prisma.db.store.findMany({
      where: { tenantId: tenant.id },
      orderBy: { code: 'asc' },
      select: this.storeSelect,
    });
  }

  async createStore(input: {
    code: string;
    name: string;
    address?: string | null;
    phone?: string | null;
    timezone?: string;
    receiptHeader?: string | null;
    receiptFooter?: string | null;
    qrisPayload?: string | null;
    isActive?: boolean;
  }) {
    const tenant = TenantContext.require();
    const code = input.code?.trim().toUpperCase();
    const name = input.name?.trim();
    if (!code || !name) {
      throw new BadRequestException('code and name are required');
    }
    const qrisPayload = this.normalizeQris(input.qrisPayload);
    const store = await this.prisma.db.store.create({
      data: {
        tenantId: tenant.id,
        code,
        name,
        address: input.address?.trim() || null,
        phone: input.phone?.trim() || null,
        timezone: input.timezone?.trim() || 'Asia/Jakarta',
        receiptHeader: input.receiptHeader?.trim() || null,
        receiptFooter: input.receiptFooter?.trim() || null,
        qrisPayload,
        isActive: input.isActive ?? true,
      },
      select: this.storeSelect,
    });
    await this.audit.log({
      action: ActivityAction.ADMIN_CATALOG_CHANGE,
      entityType: 'store',
      entityId: store.id,
      reason: `Created store ${store.code}`,
      metadata: { name: store.name },
    });
    return store;
  }

  async updateStore(
    id: string,
    input: {
      name?: string;
      address?: string | null;
      phone?: string | null;
      timezone?: string;
      receiptHeader?: string | null;
      receiptFooter?: string | null;
      isActive?: boolean;
      qrisPayload?: string | null;
    },
  ) {
    const tenant = TenantContext.require();
    const existing = await this.prisma.db.store.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!existing) {
      throw new NotFoundException('Store not found');
    }

    const qrisPayload =
      input.qrisPayload !== undefined ? this.normalizeQris(input.qrisPayload) : undefined;
    if (input.name !== undefined && !input.name.trim()) {
      throw new BadRequestException('name cannot be empty');
    }
    if (input.timezone !== undefined && !input.timezone.trim()) {
      throw new BadRequestException('timezone cannot be empty');
    }

    const updated = await this.prisma.db.store.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.address !== undefined
          ? { address: input.address?.trim() || null }
          : {}),
        ...(input.phone !== undefined ? { phone: input.phone?.trim() || null } : {}),
        ...(input.timezone !== undefined ? { timezone: input.timezone.trim() } : {}),
        ...(input.receiptHeader !== undefined
          ? { receiptHeader: input.receiptHeader?.trim() || null }
          : {}),
        ...(input.receiptFooter !== undefined
          ? { receiptFooter: input.receiptFooter?.trim() || null }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(qrisPayload !== undefined ? { qrisPayload } : {}),
      },
      select: this.storeSelect,
    });

    await this.audit.log({
      action: ActivityAction.ADMIN_CATALOG_CHANGE,
      entityType: 'store',
      entityId: id,
      reason: `Updated store settings (${updated.code})`,
      metadata: {
        hasQris: Boolean(updated.qrisPayload),
        timezone: updated.timezone,
        isActive: updated.isActive,
      },
    });

    return updated;
  }

  private normalizeQris(value: string | null | undefined): string | null {
    const raw = value?.trim() ?? '';
    if (!raw.length) return null;
    // EMVCo QRIS MPM strings are typically 50–500+ chars; reject nonsense short values.
    if (raw.length < 20) {
      throw new BadRequestException('qrisPayload looks too short for a QRIS EMV string');
    }
    return raw;
  }

  async listStoreInventory(storeId: string) {
    const tenant = TenantContext.require();
    const store = await this.prisma.db.store.findFirst({
      where: { id: storeId, tenantId: tenant.id },
      select: { id: true, code: true, name: true },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const [products, stocks, prices] = await Promise.all([
      this.prisma.db.product.findMany({
        where: { tenantId: tenant.id },
        orderBy: { name: 'asc' },
        select: {
          id: true,
          sku: true,
          name: true,
          barcode: true,
          isActive: true,
          unitPriceInCents: true,
          stockQty: true,
          category: { select: { id: true, name: true } },
        },
      }),
      this.prisma.db.storeStock.findMany({
        where: { tenantId: tenant.id, storeId },
        select: { productId: true, qty: true, updatedAt: true },
      }),
      this.prisma.db.storePrice.findMany({
        where: { tenantId: tenant.id, storeId },
        select: { productId: true, unitPriceInCents: true, updatedAt: true },
      }),
    ]);

    const stockMap = new Map(stocks.map((s) => [s.productId, s]));
    const priceMap = new Map(prices.map((p) => [p.productId, p]));

    return {
      store,
      items: products.map((p) => {
        const stock = stockMap.get(p.id);
        const price = priceMap.get(p.id);
        const onHandQty = stock ? stock.qty : p.stockQty;
        return {
          productId: p.id,
          sku: p.sku,
          name: p.name,
          barcode: p.barcode,
          isActive: p.isActive,
          category: p.category,
          catalogStockQty: p.stockQty,
          onHandQty,
          hasStoreStockRow: Boolean(stock),
          catalogUnitPriceInCents: p.unitPriceInCents,
          storeUnitPriceInCents: price?.unitPriceInCents ?? null,
          effectiveUnitPriceInCents: price?.unitPriceInCents ?? p.unitPriceInCents,
          stockUpdatedAt: stock?.updatedAt ?? null,
          priceUpdatedAt: price?.updatedAt ?? null,
        };
      }),
    };
  }

  /**
   * Set absolute on-hand qty (stock count) and/or per-store price override.
   * qtyDelta applies a relative adjustment when qty is not provided.
   */
  async patchStoreInventory(
    storeId: string,
    productId: string,
    input: {
      qty?: number;
      qtyDelta?: number;
      unitPriceInCents?: number | null;
      note?: string;
    },
  ) {
    const tenant = TenantContext.require();
    const store = await this.prisma.db.store.findFirst({
      where: { id: storeId, tenantId: tenant.id },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }
    const product = await this.prisma.db.product.findFirst({
      where: { id: productId, tenantId: tenant.id },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }

    if (input.qty === undefined && input.qtyDelta === undefined && input.unitPriceInCents === undefined) {
      throw new BadRequestException('Provide qty, qtyDelta, and/or unitPriceInCents');
    }
    if (input.qty !== undefined && input.qtyDelta !== undefined) {
      throw new BadRequestException('Use either qty or qtyDelta, not both');
    }
    if (input.qty !== undefined && (!Number.isInteger(input.qty) || input.qty < 0)) {
      throw new BadRequestException('qty must be an integer >= 0');
    }
    if (input.qtyDelta !== undefined && !Number.isInteger(input.qtyDelta)) {
      throw new BadRequestException('qtyDelta must be an integer');
    }
    if (
      input.unitPriceInCents !== undefined &&
      input.unitPriceInCents !== null &&
      (!Number.isInteger(input.unitPriceInCents) || input.unitPriceInCents < 0)
    ) {
      throw new BadRequestException('unitPriceInCents must be a non-negative integer');
    }

    // Ensure store stock row exists (seed from catalog fallback when missing).
    await this.prisma.db.$executeRaw`
      INSERT INTO store_stocks (tenant_id, store_id, product_id, qty, updated_at)
      VALUES (
        ${tenant.id}::uuid,
        ${storeId}::uuid,
        ${productId}::uuid,
        ${product.stockQty},
        CURRENT_TIMESTAMP
      )
      ON CONFLICT (tenant_id, store_id, product_id) DO NOTHING
    `;

    const before = await this.prisma.db.storeStock.findUnique({
      where: {
        tenantId_storeId_productId: {
          tenantId: tenant.id,
          storeId,
          productId,
        },
      },
    });
    const beforeQty = before?.qty ?? product.stockQty;

    let afterQty = beforeQty;
    if (input.qty !== undefined) {
      afterQty = input.qty;
      await this.prisma.db.storeStock.update({
        where: {
          tenantId_storeId_productId: {
            tenantId: tenant.id,
            storeId,
            productId,
          },
        },
        data: { qty: afterQty },
      });
    } else if (input.qtyDelta !== undefined) {
      afterQty = beforeQty + input.qtyDelta;
      if (afterQty < 0) {
        throw new BadRequestException(
          `Adjustment would make on-hand negative (${beforeQty} + ${input.qtyDelta})`,
        );
      }
      await this.prisma.db.storeStock.update({
        where: {
          tenantId_storeId_productId: {
            tenantId: tenant.id,
            storeId,
            productId,
          },
        },
        data: { qty: afterQty },
      });
    }

    let storeUnitPriceInCents: number | null | undefined = undefined;
    if (input.unitPriceInCents !== undefined) {
      if (input.unitPriceInCents === null) {
        await this.prisma.db.storePrice.deleteMany({
          where: { tenantId: tenant.id, storeId, productId },
        });
        storeUnitPriceInCents = null;
      } else {
        const row = await this.prisma.db.storePrice.upsert({
          where: {
            tenantId_storeId_productId: {
              tenantId: tenant.id,
              storeId,
              productId,
            },
          },
          create: {
            tenantId: tenant.id,
            storeId,
            productId,
            unitPriceInCents: input.unitPriceInCents,
          },
          update: { unitPriceInCents: input.unitPriceInCents },
        });
        storeUnitPriceInCents = row.unitPriceInCents;
      }
    } else {
      const price = await this.prisma.db.storePrice.findUnique({
        where: {
          tenantId_storeId_productId: {
            tenantId: tenant.id,
            storeId,
            productId,
          },
        },
      });
      storeUnitPriceInCents = price?.unitPriceInCents ?? null;
    }

    // Keep catalog Product.stockQty ≈ sum of store stocks for this SKU (admin visibility).
    if (input.qty !== undefined || input.qtyDelta !== undefined) {
      const agg = await this.prisma.db.storeStock.aggregate({
        where: { tenantId: tenant.id, productId },
        _sum: { qty: true },
      });
      await this.prisma.db.product.update({
        where: { id: productId },
        data: { stockQty: Math.max(0, agg._sum.qty ?? afterQty) },
      });
    }

    await this.audit.log({
      action: ActivityAction.STOCK_ADJUST,
      entityType: 'store_stock',
      entityId: productId,
      amountInCents: storeUnitPriceInCents ?? undefined,
      reason: input.note?.trim() || 'admin.store_inventory_patch',
      metadata: {
        storeId,
        storeCode: store.code,
        productSku: product.sku,
        beforeQty,
        afterQty,
        unitPriceInCents: storeUnitPriceInCents,
      },
    });

    return {
      storeId,
      productId,
      sku: product.sku,
      name: product.name,
      onHandQty: afterQty,
      catalogUnitPriceInCents: product.unitPriceInCents,
      storeUnitPriceInCents,
      effectiveUnitPriceInCents: storeUnitPriceInCents ?? product.unitPriceInCents,
    };
  }

  listTransfers(limit = 50) {
    const tenant = TenantContext.require();
    return this.prisma.db.stockTransfer.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 100),
      include: {
        fromStore: { select: { id: true, code: true, name: true } },
        toStore: { select: { id: true, code: true, name: true } },
        lines: {
          include: { product: { select: { id: true, sku: true, name: true } } },
        },
        createdBy: { select: { id: true, displayName: true } },
      },
    });
  }

  /**
   * Create inter-store transfer.
   * - mode `in_transit` (default): DRAFT then auto-ship → IN_TRANSIT (source decremented)
   * - mode `immediate`: ship+receive in one step → COMPLETED (legacy)
   * - mode `draft`: DRAFT only (no stock movement)
   */
  async createTransfer(input: {
    fromStoreId: string;
    toStoreId: string;
    note?: string;
    mode?: 'draft' | 'in_transit' | 'immediate';
    lines: Array<{ productId: string; qty: number }>;
  }) {
    const tenant = TenantContext.require();
    const actor = AuthContext.require();
    const mode = input.mode ?? 'in_transit';
    if (input.fromStoreId === input.toStoreId) {
      throw new BadRequestException('fromStoreId and toStoreId must differ');
    }
    if (!input.lines?.length) {
      throw new BadRequestException('At least one transfer line is required');
    }

    const stores = await this.prisma.db.store.findMany({
      where: {
        tenantId: tenant.id,
        id: { in: [input.fromStoreId, input.toStoreId] },
      },
    });
    if (stores.length !== 2) {
      throw new BadRequestException('Store not found for this tenant');
    }

    for (const line of input.lines) {
      if (!Number.isInteger(line.qty) || line.qty < 1) {
        throw new BadRequestException('Each line qty must be an integer >= 1');
      }
      const product = await this.prisma.db.product.findFirst({
        where: { id: line.productId, tenantId: tenant.id },
      });
      if (!product) {
        throw new BadRequestException(`Product ${line.productId} not found`);
      }
    }

    const transfer = await this.prisma.db.stockTransfer.create({
      data: {
        tenantId: tenant.id,
        fromStoreId: input.fromStoreId,
        toStoreId: input.toStoreId,
        status: 'DRAFT',
        note: input.note ?? null,
        createdByUserId: actor.id,
        lines: {
          create: input.lines.map((l) => ({
            tenantId: tenant.id,
            productId: l.productId,
            qty: l.qty,
          })),
        },
      },
    });

    if (mode === 'draft') {
      return this.getTransfer(transfer.id);
    }
    if (mode === 'immediate') {
      await this.shipTransfer(transfer.id);
      return this.receiveTransfer(transfer.id);
    }
    return this.shipTransfer(transfer.id);
  }

  async shipTransfer(id: string) {
    const tenant = TenantContext.require();
    const transfer = await this.prisma.db.stockTransfer.findFirst({
      where: { id, tenantId: tenant.id },
      include: { lines: { include: { product: true } } },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (transfer.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot ship transfer in status ${transfer.status}`);
    }

    for (const line of transfer.lines) {
      await this.ensureStoreStockRows(
        tenant.id,
        transfer.fromStoreId,
        transfer.toStoreId,
        line.productId,
      );
      const moved = await this.prisma.db.$executeRaw`
        UPDATE store_stocks
        SET qty = qty - ${line.qty}, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${tenant.id}::uuid
          AND store_id = ${transfer.fromStoreId}::uuid
          AND product_id = ${line.productId}::uuid
          AND qty >= ${line.qty}
      `;
      if (Number(moved) === 0) {
        throw new BadRequestException(
          `Insufficient stock at source for ${line.product.name} (need ${line.qty})`,
        );
      }
    }

    const updated = await this.prisma.db.stockTransfer.update({
      where: { id },
      data: { status: 'IN_TRANSIT', shippedAt: new Date() },
      include: {
        fromStore: { select: { id: true, code: true, name: true } },
        toStore: { select: { id: true, code: true, name: true } },
        lines: {
          include: { product: { select: { id: true, sku: true, name: true } } },
        },
        createdBy: { select: { id: true, displayName: true } },
      },
    });

    await this.audit.log({
      action: ActivityAction.STOCK_TRANSFER,
      entityType: 'stock_transfer',
      entityId: id,
      reason: 'ship',
      metadata: { status: 'IN_TRANSIT' },
    });

    return updated;
  }

  async receiveTransfer(id: string) {
    const tenant = TenantContext.require();
    const transfer = await this.prisma.db.stockTransfer.findFirst({
      where: { id, tenantId: tenant.id },
      include: { lines: { include: { product: true } } },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (transfer.status !== 'IN_TRANSIT') {
      throw new BadRequestException(`Cannot receive transfer in status ${transfer.status}`);
    }

    for (const line of transfer.lines) {
      await this.ensureStoreStockRows(
        tenant.id,
        transfer.fromStoreId,
        transfer.toStoreId,
        line.productId,
      );
      await this.prisma.db.$executeRaw`
        UPDATE store_stocks
        SET qty = qty + ${line.qty}, updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${tenant.id}::uuid
          AND store_id = ${transfer.toStoreId}::uuid
          AND product_id = ${line.productId}::uuid
      `;
    }

    const updated = await this.prisma.db.stockTransfer.update({
      where: { id },
      data: { status: 'COMPLETED', receivedAt: new Date() },
      include: {
        fromStore: { select: { id: true, code: true, name: true } },
        toStore: { select: { id: true, code: true, name: true } },
        lines: {
          include: { product: { select: { id: true, sku: true, name: true } } },
        },
        createdBy: { select: { id: true, displayName: true } },
      },
    });

    await this.audit.log({
      action: ActivityAction.STOCK_TRANSFER,
      entityType: 'stock_transfer',
      entityId: id,
      reason: 'receive',
      metadata: { status: 'COMPLETED' },
    });

    return updated;
  }

  async cancelTransfer(id: string) {
    const tenant = TenantContext.require();
    const transfer = await this.prisma.db.stockTransfer.findFirst({
      where: { id, tenantId: tenant.id },
      include: { lines: { include: { product: true } } },
    });
    if (!transfer) throw new NotFoundException('Transfer not found');
    if (transfer.status === 'COMPLETED' || transfer.status === 'CANCELLED') {
      throw new BadRequestException(`Cannot cancel transfer in status ${transfer.status}`);
    }

    // Restore source if already shipped.
    if (transfer.status === 'IN_TRANSIT') {
      for (const line of transfer.lines) {
        await this.prisma.db.$executeRaw`
          UPDATE store_stocks
          SET qty = qty + ${line.qty}, updated_at = CURRENT_TIMESTAMP
          WHERE tenant_id = ${tenant.id}::uuid
            AND store_id = ${transfer.fromStoreId}::uuid
            AND product_id = ${line.productId}::uuid
        `;
      }
    }

    const updated = await this.prisma.db.stockTransfer.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
      include: {
        fromStore: { select: { id: true, code: true, name: true } },
        toStore: { select: { id: true, code: true, name: true } },
        lines: {
          include: { product: { select: { id: true, sku: true, name: true } } },
        },
        createdBy: { select: { id: true, displayName: true } },
      },
    });

    await this.audit.log({
      action: ActivityAction.STOCK_TRANSFER,
      entityType: 'stock_transfer',
      entityId: id,
      reason: 'cancel',
      metadata: { fromStatus: transfer.status },
    });

    return updated;
  }

  private async getTransfer(id: string) {
    const tenant = TenantContext.require();
    const row = await this.prisma.db.stockTransfer.findFirst({
      where: { id, tenantId: tenant.id },
      include: {
        fromStore: { select: { id: true, code: true, name: true } },
        toStore: { select: { id: true, code: true, name: true } },
        lines: {
          include: { product: { select: { id: true, sku: true, name: true } } },
        },
        createdBy: { select: { id: true, displayName: true } },
      },
    });
    if (!row) throw new NotFoundException('Transfer not found');
    return row;
  }

  private async ensureStoreStockRows(
    tenantId: string,
    fromStoreId: string,
    toStoreId: string,
    productId: string,
  ): Promise<void> {
    await this.prisma.db.$executeRaw`
      INSERT INTO store_stocks (tenant_id, store_id, product_id, qty, updated_at)
      SELECT ${tenantId}::uuid, ${fromStoreId}::uuid, ${productId}::uuid, p.stock_qty, CURRENT_TIMESTAMP
      FROM products p
      WHERE p.id = ${productId}::uuid AND p.tenant_id = ${tenantId}::uuid
      ON CONFLICT (tenant_id, store_id, product_id) DO NOTHING
    `;
    await this.prisma.db.$executeRaw`
      INSERT INTO store_stocks (tenant_id, store_id, product_id, qty, updated_at)
      VALUES (${tenantId}::uuid, ${toStoreId}::uuid, ${productId}::uuid, 0, CURRENT_TIMESTAMP)
      ON CONFLICT (tenant_id, store_id, product_id) DO NOTHING
    `;
  }

  // ---------------------------------------------------------------------------
  // Product variants (stock-tracked SKUs under a parent product)
  // ---------------------------------------------------------------------------

  listVariants(productId: string) {
    const tenant = TenantContext.require();
    return this.prisma.db.productVariant.findMany({
      where: { tenantId: tenant.id, productId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async createVariant(input: {
    productId: string;
    sku: string;
    name: string;
    barcode?: string | null;
    unitPriceInCents: number;
    sortOrder?: number;
    isActive?: boolean;
    initialQtyByStore?: Array<{ storeId: string; qty: number }>;
  }) {
    const tenant = TenantContext.require();
    const product = await this.prisma.db.product.findFirst({
      where: { id: input.productId, tenantId: tenant.id },
    });
    if (!product) throw new NotFoundException('Product not found');
    const sku = input.sku.trim().toUpperCase();
    if (!sku || !input.name.trim()) {
      throw new BadRequestException('sku and name are required');
    }
    this.assertMoney(input.unitPriceInCents, 'unitPriceInCents');

    const variant = await this.prisma.db.productVariant.create({
      data: {
        tenantId: tenant.id,
        productId: input.productId,
        sku,
        name: input.name.trim(),
        barcode: input.barcode?.trim() || null,
        unitPriceInCents: input.unitPriceInCents,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive !== false,
      },
    });

    for (const row of input.initialQtyByStore ?? []) {
      if (!Number.isInteger(row.qty) || row.qty < 0) continue;
      await this.prisma.db.storeVariantStock.upsert({
        where: {
          tenantId_storeId_variantId: {
            tenantId: tenant.id,
            storeId: row.storeId,
            variantId: variant.id,
          },
        },
        update: { qty: row.qty },
        create: {
          tenantId: tenant.id,
          storeId: row.storeId,
          variantId: variant.id,
          qty: row.qty,
        },
      });
    }

    await this.audit.log({
      action: ActivityAction.ADMIN_CATALOG_CHANGE,
      entityType: 'product_variant',
      entityId: variant.id,
      reason: 'admin.create_variant',
      metadata: { sku, productId: input.productId },
    });

    return variant;
  }

  async updateVariant(
    id: string,
    input: Partial<{
      name: string;
      barcode: string | null;
      unitPriceInCents: number;
      sortOrder: number;
      isActive: boolean;
    }>,
  ) {
    const tenant = TenantContext.require();
    const existing = await this.prisma.db.productVariant.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!existing) throw new NotFoundException('Variant not found');
    if (input.unitPriceInCents !== undefined) {
      this.assertMoney(input.unitPriceInCents, 'unitPriceInCents');
    }
    return this.prisma.db.productVariant.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.barcode !== undefined
          ? { barcode: input.barcode?.trim() || null }
          : {}),
        ...(input.unitPriceInCents !== undefined
          ? { unitPriceInCents: input.unitPriceInCents }
          : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });
  }

  private assertProductInput(input: UpsertProductInput): void {
    if (!input.categoryId || !input.sku?.trim() || !input.name?.trim()) {
      throw new BadRequestException('categoryId, sku, and name are required');
    }
    this.assertMoney(input.unitPriceInCents, 'unitPriceInCents');
    if (input.taxBps !== undefined && (!Number.isInteger(input.taxBps) || input.taxBps < 0)) {
      throw new BadRequestException('taxBps must be a non-negative integer');
    }
    if (input.stockQty !== undefined && !Number.isInteger(input.stockQty)) {
      throw new BadRequestException('stockQty must be an integer');
    }
  }

  private assertMoney(value: number, label: string): void {
    if (!Number.isInteger(value) || value < 0) {
      throw new BadRequestException(`${label} must be a non-negative integer`);
    }
  }

  private async assertCategory(tenantId: string, categoryId: string): Promise<void> {
    const category = await this.prisma.db.category.findFirst({
      where: { id: categoryId, tenantId },
    });
    if (!category) {
      throw new BadRequestException('Category not found for this tenant');
    }
  }
}
