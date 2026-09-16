import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityAction, PromoScope, PromoType } from '@prisma/client';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';

export type UpsertPromoInput = {
  code: string;
  name: string;
  type: PromoType;
  scope?: PromoScope;
  percentBps?: number | null;
  amountInCents?: number | null;
  maxDiscountInCents?: number | null;
  minSubtotalInCents?: number;
  categoryId?: string | null;
  productId?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  usageLimit?: number | null;
  isActive?: boolean;
  stackWithLoyalty?: boolean;
};

export type PromoLineInput = {
  productId: string;
  categoryId?: string | null;
  quantity: number;
  lineSubtotalInCents: number;
  taxInCents: number;
};

@Injectable()
export class PromoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  list(activeOnly = false) {
    const tenant = TenantContext.require();
    return this.prisma.db.promo.findMany({
      where: {
        tenantId: tenant.id,
        ...(activeOnly ? { isActive: true } : {}),
      },
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
      include: {
        category: { select: { id: true, name: true } },
        product: { select: { id: true, sku: true, name: true } },
      },
    });
  }

  async create(input: UpsertPromoInput) {
    const tenant = TenantContext.require();
    const data = this.normalize(input);
    const clash = await this.prisma.db.promo.findFirst({
      where: { tenantId: tenant.id, code: data.code },
    });
    if (clash) throw new BadRequestException(`Promo code ${data.code} already exists`);

    return this.prisma.db.promo.create({
      data: { tenantId: tenant.id, ...data },
      include: {
        category: { select: { id: true, name: true } },
        product: { select: { id: true, sku: true, name: true } },
      },
    });
  }

  async update(id: string, input: Partial<UpsertPromoInput>) {
    const tenant = TenantContext.require();
    const row = await this.prisma.db.promo.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!row) throw new NotFoundException('Promo not found');

    const merged: UpsertPromoInput = {
      code: input.code ?? row.code,
      name: input.name ?? row.name,
      type: input.type ?? row.type,
      scope: input.scope ?? row.scope,
      percentBps: input.percentBps !== undefined ? input.percentBps : row.percentBps,
      amountInCents:
        input.amountInCents !== undefined ? input.amountInCents : row.amountInCents,
      maxDiscountInCents:
        input.maxDiscountInCents !== undefined
          ? input.maxDiscountInCents
          : row.maxDiscountInCents,
      minSubtotalInCents:
        input.minSubtotalInCents !== undefined
          ? input.minSubtotalInCents
          : row.minSubtotalInCents,
      categoryId: input.categoryId !== undefined ? input.categoryId : row.categoryId,
      productId: input.productId !== undefined ? input.productId : row.productId,
      startsAt:
        input.startsAt !== undefined
          ? input.startsAt
          : row.startsAt?.toISOString() ?? null,
      endsAt:
        input.endsAt !== undefined ? input.endsAt : row.endsAt?.toISOString() ?? null,
      usageLimit: input.usageLimit !== undefined ? input.usageLimit : row.usageLimit,
      isActive: input.isActive !== undefined ? input.isActive : row.isActive,
      stackWithLoyalty:
        input.stackWithLoyalty !== undefined
          ? input.stackWithLoyalty
          : row.stackWithLoyalty,
    };

    const data = this.normalize(merged);
    if (data.code !== row.code) {
      const clash = await this.prisma.db.promo.findFirst({
        where: { tenantId: tenant.id, code: data.code, NOT: { id } },
      });
      if (clash) throw new BadRequestException(`Promo code ${data.code} already exists`);
    }

    return this.prisma.db.promo.update({
      where: { id },
      data,
      include: {
        category: { select: { id: true, name: true } },
        product: { select: { id: true, sku: true, name: true } },
      },
    });
  }

  /**
   * Compute integer discount for a cart snapshot.
   * Eligible base = sum(lineSubtotal+tax) for lines matching scope.
   */
  async preview(input: {
    code?: string;
    promoId?: string;
    lines: PromoLineInput[];
    now?: Date;
  }) {
    const promo = await this.resolveActivePromo(input);
    if (!promo) {
      return {
        promo: null,
        discountInCents: 0,
        eligibleBaseInCents: 0,
        stackWithLoyalty: true,
      };
    }

    const { discountInCents, eligibleBaseInCents } = this.computeDiscount(promo, input.lines);
    return {
      promo: {
        id: promo.id,
        code: promo.code,
        name: promo.name,
        type: promo.type,
        scope: promo.scope,
        stackWithLoyalty: promo.stackWithLoyalty,
      },
      discountInCents,
      eligibleBaseInCents,
      stackWithLoyalty: promo.stackWithLoyalty,
    };
  }

  /** Validate + bump usage when a sale commits a promo. */
  async consumeOnSale(input: {
    promoId?: string | null;
    promoCode?: string | null;
    lines: PromoLineInput[];
    expectedDiscountInCents: number;
  }) {
    if (!input.promoId && !input.promoCode) {
      if (input.expectedDiscountInCents !== 0) {
        // Manual discount without promo is allowed (supervisor path separately).
        return { promoId: null as string | null, promoCode: null as string | null };
      }
      return { promoId: null, promoCode: null };
    }

    const preview = await this.preview({
      promoId: input.promoId ?? undefined,
      code: input.promoCode ?? undefined,
      lines: input.lines,
    });
    if (!preview.promo) {
      throw new BadRequestException('Promo is not valid or expired');
    }
    if (preview.discountInCents !== input.expectedDiscountInCents) {
      throw new BadRequestException(
        `Promo discount mismatch (expected ${preview.discountInCents}, got ${input.expectedDiscountInCents})`,
      );
    }

    const bumped = await this.prisma.db.$executeRaw`
      UPDATE promos
      SET used_count = used_count + 1, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${preview.promo.id}::uuid
        AND is_active = true
        AND (usage_limit IS NULL OR used_count < usage_limit)
    `;
    if (Number(bumped) === 0) {
      throw new BadRequestException('Promo usage limit reached');
    }

    await this.audit.log({
      action: ActivityAction.PROMO_APPLY,
      entityType: 'promo',
      entityId: preview.promo.id,
      amountInCents: preview.discountInCents,
      metadata: { code: preview.promo.code },
    });

    return {
      promoId: preview.promo.id,
      promoCode: preview.promo.code,
      stackWithLoyalty: preview.stackWithLoyalty,
    };
  }

  private async resolveActivePromo(input: {
    code?: string;
    promoId?: string;
    now?: Date;
  }) {
    const tenant = TenantContext.require();
    const now = input.now ?? new Date();
    const where = input.promoId
      ? { id: input.promoId, tenantId: tenant.id }
      : input.code
        ? { code: input.code.trim().toUpperCase(), tenantId: tenant.id }
        : null;
    if (!where) return null;

    const promo = await this.prisma.db.promo.findFirst({ where });
    if (!promo || !promo.isActive) return null;
    if (promo.startsAt && promo.startsAt > now) return null;
    if (promo.endsAt && promo.endsAt < now) return null;
    if (promo.usageLimit != null && promo.usedCount >= promo.usageLimit) return null;
    return promo;
  }

  private computeDiscount(
    promo: {
      type: PromoType;
      scope: PromoScope;
      percentBps: number | null;
      amountInCents: number | null;
      maxDiscountInCents: number | null;
      minSubtotalInCents: number;
      categoryId: string | null;
      productId: string | null;
    },
    lines: PromoLineInput[],
  ): { discountInCents: number; eligibleBaseInCents: number } {
    const eligible = lines.filter((line) => {
      if (promo.scope === PromoScope.ALL) return true;
      if (promo.scope === PromoScope.PRODUCT) return line.productId === promo.productId;
      if (promo.scope === PromoScope.CATEGORY) {
        return Boolean(promo.categoryId) && line.categoryId === promo.categoryId;
      }
      return false;
    });

    const eligibleBaseInCents = eligible.reduce(
      (s, l) => s + l.lineSubtotalInCents + l.taxInCents,
      0,
    );
    if (eligibleBaseInCents < promo.minSubtotalInCents) {
      return { discountInCents: 0, eligibleBaseInCents };
    }

    let discountInCents = 0;
    if (promo.type === PromoType.FIXED) {
      discountInCents = Math.min(promo.amountInCents ?? 0, eligibleBaseInCents);
    } else {
      const bps = promo.percentBps ?? 0;
      discountInCents = Math.floor((eligibleBaseInCents * bps) / 10_000);
      if (promo.maxDiscountInCents != null) {
        discountInCents = Math.min(discountInCents, promo.maxDiscountInCents);
      }
      discountInCents = Math.min(discountInCents, eligibleBaseInCents);
    }

    return { discountInCents, eligibleBaseInCents };
  }

  private normalize(input: UpsertPromoInput) {
    const code = input.code?.trim().toUpperCase();
    const name = input.name?.trim();
    if (!code || !name) throw new BadRequestException('code and name are required');

    const type = input.type;
    const scope = input.scope ?? PromoScope.ALL;
    if (type === PromoType.PERCENT) {
      if (!Number.isInteger(input.percentBps) || (input.percentBps ?? 0) < 1) {
        throw new BadRequestException('percentBps must be an integer >= 1');
      }
    } else if (type === PromoType.FIXED) {
      if (!Number.isInteger(input.amountInCents) || (input.amountInCents ?? 0) < 1) {
        throw new BadRequestException('amountInCents must be an integer >= 1');
      }
    } else {
      throw new BadRequestException('Invalid promo type');
    }

    if (scope === PromoScope.CATEGORY && !input.categoryId) {
      throw new BadRequestException('categoryId required for CATEGORY scope');
    }
    if (scope === PromoScope.PRODUCT && !input.productId) {
      throw new BadRequestException('productId required for PRODUCT scope');
    }

    const minSubtotalInCents = input.minSubtotalInCents ?? 0;
    if (!Number.isInteger(minSubtotalInCents) || minSubtotalInCents < 0) {
      throw new BadRequestException('minSubtotalInCents must be a non-negative integer');
    }

    return {
      code,
      name,
      type,
      scope,
      percentBps: type === PromoType.PERCENT ? input.percentBps! : null,
      amountInCents: type === PromoType.FIXED ? input.amountInCents! : null,
      maxDiscountInCents: input.maxDiscountInCents ?? null,
      minSubtotalInCents,
      categoryId: scope === PromoScope.CATEGORY ? input.categoryId! : null,
      productId: scope === PromoScope.PRODUCT ? input.productId! : null,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
      usageLimit: input.usageLimit ?? null,
      isActive: input.isActive ?? true,
      stackWithLoyalty: input.stackWithLoyalty ?? true,
    };
  }
}
