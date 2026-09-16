import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CartStatus, PaymentMethod } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuthContext } from '../auth/auth-context';
import { permissionsForRole, type StaffRole } from '../auth/permissions';
import { AnalyticsSummaryService } from '../analytics/analytics-summary.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { EdgeSyncService } from '../edge-sync/edge-sync.service';
import { PaymentsService } from '../payments/payments.service';
import { PromoService } from '../promotions/promo.service';
import { ShiftService } from '../shifts/shift.service';
import {
  buildStockConflictMessage,
  shouldApplyClientCartWrite,
  type StockConflictLine,
} from './conflict-resolution';
import { lineMoney, sumCents } from './money';
import { SyncSaleInput, UpsertCartInput } from './pos.types';
import { SalesExportService } from '../analytics/sales-export.service';
import { ActivityAction, PaymentChargeStatus } from '@prisma/client';
import { AuditService } from '../common/audit/audit.service';
import { RecipesService } from '../recipes/recipes.service';
import { KitchenService } from '../kitchen/kitchen.service';
import { GlService } from '../gl/gl.service';

const PAYMENT_METHODS = new Set<string>(['CASH', 'CARD', 'QRIS', 'OTHER', 'SPLIT']);
const TENDER_METHODS = new Set<string>(['CASH', 'CARD', 'QRIS', 'OTHER']);

function loyaltyPointValueCents(): number {
  const raw = Number.parseInt(process.env.LOYALTY_POINT_VALUE_CENTS || '100', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 100;
}

@Injectable()
export class PosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly shifts: ShiftService,
    private readonly analyticsSummary: AnalyticsSummaryService,
    private readonly edgeSync: EdgeSyncService,
    private readonly promos: PromoService,
    private readonly payments: PaymentsService,
    private readonly audit: AuditService,
    private readonly recipes: RecipesService,
    private readonly kitchen: KitchenService,
    private readonly gl: GlService,
  ) {}

  async bootstrap(storeId?: string) {
    const tenant = TenantContext.require();
    const actor = AuthContext.current();
    const stores = await this.prisma.db.store.findMany({
      where: { tenantId: tenant.id },
      orderBy: { code: 'asc' },
    });
    // Prefer MAIN when no storeId so BRANCH overrides (price/stock) do not leak into the default view.
    const defaultStore =
      stores.find((s) => s.code === 'MAIN') ?? stores[0] ?? null;

    const cashier = actor
      ? await this.prisma.db.user.findFirst({
          where: { id: actor.id, tenantId: tenant.id },
        })
      : await this.prisma.db.user.findFirst({
          where: { tenantId: tenant.id, role: 'CASHIER', isActive: true },
          orderBy: { createdAt: 'asc' },
        });

    // Active shift is per cashier (any store). Do NOT scope by requested store —
    // otherwise BRANCH UI hides a MAIN open shift and clock-in returns 409.
    const activeShift = cashier
      ? await this.prisma.db.cashierShift.findFirst({
          where: {
            tenantId: tenant.id,
            cashierUserId: cashier.id,
            status: 'OPEN',
          },
        })
      : null;

    // Prefer the store that owns the open shift so catalog/stock match the drawer.
    const store =
      (activeShift ? stores.find((s) => s.id === activeShift.storeId) : null) ??
      (storeId ? stores.find((s) => s.id === storeId) : null) ??
      defaultStore;
    if (storeId && !stores.find((s) => s.id === storeId) && !activeShift) {
      throw new NotFoundException('Store not found');
    }

    const categories = await this.prisma.db.category.findMany({
      where: { tenantId: tenant.id },
      orderBy: { sortOrder: 'asc' },
    });
    const products = await this.prisma.db.product.findMany({
      where: { tenantId: tenant.id, isActive: true },
      orderBy: { name: 'asc' },
      include: {
        modifierGroups: {
          orderBy: { sortOrder: 'asc' },
          include: {
            options: {
              where: { isActive: true },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
        variants: {
          where: { isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        },
      },
    });

    const stockRows = store
      ? await this.prisma.db.storeStock.findMany({
          where: { tenantId: tenant.id, storeId: store.id },
        })
      : [];
    const priceRows = store
      ? await this.prisma.db.storePrice.findMany({
          where: { tenantId: tenant.id, storeId: store.id },
        })
      : [];
    const variantStockRows = store
      ? await this.prisma.db.storeVariantStock.findMany({
          where: { tenantId: tenant.id, storeId: store.id },
        })
      : [];
    const stockMap = new Map(stockRows.map((r) => [r.productId, r.qty]));
    const priceMap = new Map(priceRows.map((r) => [r.productId, r.unitPriceInCents]));
    const variantStockMap = new Map(variantStockRows.map((r) => [r.variantId, r.qty]));

    const productsForStore = products.map((p) => ({
      ...p,
      stockQty: stockMap.has(p.id) ? stockMap.get(p.id)! : p.stockQty,
      unitPriceInCents: priceMap.has(p.id) ? priceMap.get(p.id)! : p.unitPriceInCents,
      baseUnitPriceInCents: p.unitPriceInCents,
      hasStorePriceOverride: priceMap.has(p.id),
      variants: (p.variants ?? []).map((v) => ({
        ...v,
        stockQty: variantStockMap.get(v.id) ?? 0,
      })),
    }));

    const role = (cashier?.role ?? 'CASHIER') as StaffRole;

    return {
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name },
      store,
      stores,
      cashier: cashier
        ? {
            id: cashier.id,
            displayName: cashier.displayName,
            role,
            email: cashier.email,
            permissions: permissionsForRole(role),
          }
        : null,
      activeShift,
      categories,
      products: productsForStore,
    };
  }

  /**
   * Upsert an open cart from the cashier device.
   * Last-write-wins: stale offline snapshots (older clientUpdatedAt) are ignored.
   * Totals are recomputed server-side from catalog prices.
   */
  async upsertCart(input: UpsertCartInput) {
    const tenant = TenantContext.require();
    if (!input.clientUuid || !input.storeId) {
      throw new BadRequestException('clientUuid and storeId are required');
    }

    const store = await this.prisma.db.store.findFirst({
      where: { id: input.storeId, tenantId: tenant.id },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const existing = await this.prisma.db.cart.findUnique({
      where: { tenantId_clientUuid: { tenantId: tenant.id, clientUuid: input.clientUuid } },
      include: { items: true },
    });

    const status = (input.status as CartStatus | undefined) ?? CartStatus.OPEN;

    // LWW for OPEN carts only — CHECKED_OUT from sale sync always wins.
    if (
      existing &&
      existing.status === CartStatus.OPEN &&
      status === CartStatus.OPEN &&
      !shouldApplyClientCartWrite(input.clientUpdatedAt, existing.updatedAt)
    ) {
      return { stale: true as const, cart: existing };
    }

    let tableId: string | null = input.tableId ?? existing?.tableId ?? null;
    let label = input.label ?? existing?.label ?? null;
    if (input.tableId) {
      const table = await this.prisma.db.diningTable.findFirst({
        where: { id: input.tableId, tenantId: tenant.id, storeId: input.storeId, isActive: true },
      });
      if (!table) {
        throw new BadRequestException('Dining table not found for this store');
      }
      tableId = table.id;
      if (!label?.trim()) {
        label = `${table.code} · ${table.name}`;
      }
      // One active OPEN cart per table — release stale empty assignments.
      await this.prisma.db.cart.updateMany({
        where: {
          tenantId: tenant.id,
          tableId: table.id,
          status: CartStatus.OPEN,
          NOT: { clientUuid: input.clientUuid },
        },
        data: { tableId: null },
      });
    } else if (input.tableId === null) {
      tableId = null;
    }

    const priced = await this.priceLines(tenant.id, input.storeId, input.lines);
    const subtotalInCents = sumCents(priced.map((line) => line.lineSubtotalInCents));
    const taxInCents = sumCents(priced.map((line) => line.taxInCents));
    const totalInCents = subtotalInCents + taxInCents;

    const cartId = existing?.id ?? randomUUID();

    if (existing) {
      await this.prisma.db.cartItem.deleteMany({ where: { cartId: existing.id, tenantId: tenant.id } });
      await this.prisma.db.cart.update({
        where: { id: existing.id },
        data: {
          storeId: input.storeId,
          cashierUserId: input.cashierUserId ?? null,
          customerId: input.customerId ?? null,
          label,
          tableId,
          parkedAt: input.parkedAt ? new Date(input.parkedAt) : null,
          status,
          subtotalInCents,
          taxInCents,
          totalInCents,
        },
      });
    } else {
      await this.prisma.db.cart.create({
        data: {
          id: cartId,
          tenantId: tenant.id,
          storeId: input.storeId,
          cashierUserId: input.cashierUserId ?? null,
          customerId: input.customerId ?? null,
          label,
          tableId,
          parkedAt: input.parkedAt ? new Date(input.parkedAt) : null,
          clientUuid: input.clientUuid,
          status,
          subtotalInCents,
          taxInCents,
          totalInCents,
        },
      });
    }

    if (priced.length) {
      await this.prisma.db.cartItem.createMany({
        data: priced.map((line) => ({
          tenantId: tenant.id,
          cartId,
          productId: line.productId,
          productName: line.productName,
          quantity: line.quantity,
          unitPriceInCents: line.unitPriceInCents,
          taxBps: line.taxBps,
          taxInCents: line.taxInCents,
          lineSubtotalInCents: line.lineSubtotalInCents,
          lineTotalInCents: line.lineTotalInCents,
          modifiersJson: line.modifiers.length ? line.modifiers : undefined,
          guestIndex: line.guestIndex,
        })),
      });
    }

    const cart = await this.prisma.db.cart.findFirst({
      where: { id: cartId, tenantId: tenant.id },
      include: { items: true, table: { select: { id: true, code: true, name: true } } },
    });
    return { stale: false as const, cart };
  }

  /** Download an OPEN cart snapshot for cross-device table resume. */
  async getOpenCart(clientUuid: string) {
    const tenant = TenantContext.require();
    const cart = await this.prisma.db.cart.findFirst({
      where: {
        tenantId: tenant.id,
        clientUuid,
        status: CartStatus.OPEN,
      },
      include: {
        items: true,
        table: { select: { id: true, code: true, name: true } },
        customer: { select: { id: true, name: true } },
      },
    });
    if (!cart) {
      throw new NotFoundException('Open cart not found');
    }
    return cart;
  }

  /**
   * Idempotent sale ingest (offline queue). Duplicate `id` (client UUID) returns
   * the existing row without decrementing stock twice.
   *
   * Conflict resolution: atomic stock check-and-decrement. If central stock moved
   * while the cashier was offline, respond 409 STOCK_CONFLICT (transaction rolls back).
   */
  async syncSale(input: SyncSaleInput) {
    const tenant = TenantContext.require();
    this.assertSaleShape(input);

    const existing = await this.prisma.db.sale.findFirst({
      where: { id: input.id, tenantId: tenant.id },
      include: { lines: true },
    });
    if (existing) {
      return { duplicate: true, conflict: false, sale: existing };
    }

    const store = await this.prisma.db.store.findFirst({
      where: { id: input.storeId, tenantId: tenant.id },
    });
    if (!store) {
      throw new NotFoundException('Store not found');
    }

    const priced = await this.priceLines(
      tenant.id,
      input.storeId,
      input.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        variantId: line.variantId,
        modifierOptionIds: line.modifierOptionIds,
        guestIndex: line.guestIndex,
      })),
    );
    const subtotalInCents = sumCents(priced.map((line) => line.lineSubtotalInCents));
    const taxInCents = sumCents(priced.map((line) => line.taxInCents));

    const promoLines = priced.map((line) => ({
      productId: line.productId,
      categoryId: line.categoryId,
      quantity: line.quantity,
      lineSubtotalInCents: line.lineSubtotalInCents,
      taxInCents: line.taxInCents,
    }));

    // Promo discount (voucher) — server authoritative.
    let promoDiscount = 0;
    let promoId: string | null = null;
    let promoCode: string | null = null;
    let stackWithLoyalty = true;
    if (input.promoId || input.promoCode) {
      const preview = await this.promos.preview({
        promoId: input.promoId ?? undefined,
        code: input.promoCode ?? undefined,
        lines: promoLines,
      });
      if (!preview.promo || preview.discountInCents < 1) {
        throw new BadRequestException('Promo is not applicable to this cart');
      }
      promoDiscount = preview.discountInCents;
      promoId = preview.promo.id;
      promoCode = preview.promo.code;
      stackWithLoyalty = preview.stackWithLoyalty;
    }

    // Loyalty redeem — 1 point = LOYALTY_POINT_VALUE_CENTS (default Rp 100).
    const loyaltyPointsRedeemed = input.loyaltyPointsRedeemed ?? 0;
    if (!Number.isInteger(loyaltyPointsRedeemed) || loyaltyPointsRedeemed < 0) {
      throw new BadRequestException('loyaltyPointsRedeemed must be a non-negative integer');
    }
    let loyaltyDiscount = 0;
    if (loyaltyPointsRedeemed > 0) {
      if (!input.customerId) {
        throw new BadRequestException('Customer required to redeem loyalty points');
      }
      if (!stackWithLoyalty && promoDiscount > 0) {
        throw new BadRequestException('This promo cannot be stacked with loyalty redeem');
      }
      const customer = await this.prisma.db.customer.findFirst({
        where: { id: input.customerId, tenantId: tenant.id },
      });
      if (!customer) throw new BadRequestException('Customer not found');
      if (customer.loyaltyPoints < loyaltyPointsRedeemed) {
        throw new BadRequestException('Insufficient loyalty points');
      }
      loyaltyDiscount = loyaltyPointsRedeemed * loyaltyPointValueCents();
    }

    const discountInCents = promoDiscount + loyaltyDiscount;
    if (discountInCents !== (input.discountInCents ?? 0)) {
      throw new BadRequestException(
        `Discount mismatch (server ${discountInCents}, client ${input.discountInCents ?? 0})`,
      );
    }

    const tipInCents = input.tipInCents ?? 0;
    if (!Number.isInteger(tipInCents) || tipInCents < 0) {
      throw new BadRequestException('tipInCents must be a non-negative integer');
    }

    const totalInCents = subtotalInCents + taxInCents - discountInCents + tipInCents;

    if (
      subtotalInCents !== input.subtotalInCents ||
      taxInCents !== input.taxInCents ||
      totalInCents !== input.totalInCents ||
      tipInCents !== (input.tipInCents ?? 0)
    ) {
      throw new BadRequestException(
        'Sale totals do not match integer catalog pricing (possible stale offline prices)',
      );
    }

    if (promoId) {
      await this.promos.consumeOnSale({
        promoId,
        promoCode,
        lines: promoLines,
        expectedDiscountInCents: promoDiscount,
      });
    }

    const cashierUserId = input.cashierUserId ?? AuthContext.current()?.id ?? null;
    let shiftId: string | null = input.shiftId ?? null;
    if (!shiftId && cashierUserId) {
      const openShift = await this.prisma.db.cashierShift.findFirst({
        where: {
          tenantId: tenant.id,
          cashierUserId,
          storeId: input.storeId,
          status: 'OPEN',
        },
      });
      shiftId = openShift?.id ?? null;
    }
    if (!shiftId) {
      throw new BadRequestException('No open cashier shift — clock in before selling');
    }

    const payments = this.normalizePayments(input, totalInCents);

    if (input.customerId) {
      const customer = await this.prisma.db.customer.findFirst({
        where: { id: input.customerId, tenantId: tenant.id },
        select: { id: true },
      });
      if (!customer) {
        throw new BadRequestException('Customer not found');
      }
    }

    const stockConsumption = await this.recipes.expandStockConsumption(
      priced.map((line) => ({
        productId: line.productId,
        productName: line.productName,
        quantity: line.quantity,
      })),
    );

    const cogsByLine = new Map<string, number>();
    for (const line of priced) {
      cogsByLine.set(
        line.productId,
        await this.recipes.calculateCogs(line.productId, line.quantity),
      );
    }

    // Pre-check stock for a clear conflict payload, then atomic decrement below.
    await this.assertStockAvailable(tenant.id, input.storeId, stockConsumption);

    const cartResult = await this.upsertCart({
      clientUuid: input.cartClientUuid,
      storeId: input.storeId,
      cashierUserId,
      customerId: input.customerId ?? null,
      status: 'CHECKED_OUT',
      clientUpdatedAt: input.clientCreatedAt,
      lines: input.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        modifierOptionIds: line.modifierOptionIds,
      })),
    });

    const loyaltyPointsEarned = input.customerId
      ? Math.floor(totalInCents / 10_000)
      : 0;

    const primaryMethod =
      payments.length === 1
        ? (payments[0].paymentMethod as PaymentMethod)
        : ('SPLIT' as PaymentMethod);

    if (input.paymentChargeId) {
      const charge = await this.prisma.db.paymentCharge.findFirst({
        where: { id: input.paymentChargeId, tenantId: tenant.id },
      });
      if (!charge) throw new BadRequestException('Payment charge not found');
      if (charge.status !== PaymentChargeStatus.PAID) {
        throw new BadRequestException('Payment charge is not PAID yet');
      }
      const qrisPaid = payments
        .filter((p) => p.paymentMethod === 'QRIS')
        .reduce((s, p) => s + p.amountInCents, 0);
      if (qrisPaid > 0 && charge.amountInCents !== qrisPaid) {
        throw new BadRequestException(
          `QRIS charge amount ${charge.amountInCents} != tender ${qrisPaid}`,
        );
      }
    }

    const sale = await this.prisma.db.sale.create({
      data: {
        id: input.id,
        tenantId: tenant.id,
        storeId: input.storeId,
        cashierUserId,
        shiftId,
        cartId: cartResult.cart?.id ?? null,
        customerId: input.customerId ?? null,
        paymentMethod: primaryMethod,
        subtotalInCents,
        taxInCents,
        discountInCents,
        tipInCents,
        totalInCents,
        loyaltyPointsEarned,
        loyaltyPointsRedeemed,
        promoId,
        promoCode,
        clientCreatedAt: new Date(input.clientCreatedAt),
        lines: {
          create: priced.map((line) => ({
            tenantId: tenant.id,
            productId: line.productId,
            variantId: line.variantId ?? null,
            productName: line.productName,
            quantity: line.quantity,
            unitPriceInCents: line.unitPriceInCents,
            taxBps: line.taxBps,
            taxInCents: line.taxInCents,
            lineSubtotalInCents: line.lineSubtotalInCents,
            lineTotalInCents: line.lineTotalInCents,
            modifiersJson: line.modifiers.length ? line.modifiers : undefined,
            guestIndex: line.guestIndex,
            cogsInCents: cogsByLine.get(line.productId) ?? 0,
          })),
        },
        payments: {
          create: payments.map((p) => ({
            tenantId: tenant.id,
            paymentMethod: p.paymentMethod as PaymentMethod,
            amountInCents: p.amountInCents,
            amountTenderedInCents: p.amountTenderedInCents ?? null,
          })),
        },
      },
      include: { lines: true, payments: true },
    });

    if (input.customerId) {
      const pointDelta = loyaltyPointsEarned - loyaltyPointsRedeemed;
      if (loyaltyPointsRedeemed > 0) {
        const redeemed = await this.prisma.db.$executeRaw`
          UPDATE customers
          SET loyalty_points = loyalty_points - ${loyaltyPointsRedeemed},
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ${input.customerId}::uuid
            AND tenant_id = ${tenant.id}::uuid
            AND loyalty_points >= ${loyaltyPointsRedeemed}
        `;
        if (Number(redeemed) === 0) {
          throw new BadRequestException('Loyalty redeem race — insufficient points');
        }
        await this.audit.log({
          action: ActivityAction.LOYALTY_REDEEM,
          entityType: 'customer',
          entityId: input.customerId,
          amountInCents: loyaltyDiscount,
          metadata: { points: loyaltyPointsRedeemed },
        });
      }
      if (loyaltyPointsEarned > 0) {
        await this.prisma.db.customer.update({
          where: { id: input.customerId },
          data: { loyaltyPoints: { increment: loyaltyPointsEarned } },
        });
      }
      void pointDelta;
    }

    if (input.paymentChargeId) {
      await this.payments.attachSale(input.paymentChargeId, sale.id);
    }

    // Atomic decrement — BOM expands to ingredients; races cannot oversell.
    for (const line of stockConsumption) {
      await this.decrementStockAtomic(
        tenant.id,
        input.storeId,
        line.productId,
        line.productName,
        line.quantity,
      );
    }
    for (const line of priced) {
      if (line.variantId) {
        await this.decrementVariantStockAtomic(
          tenant.id,
          input.storeId,
          line.variantId,
          line.productName,
          line.quantity,
        );
      }
    }
    await this.recipes.logRecipeConsume(sale.id, stockConsumption);
    await this.kitchen.completeForSale(input.cartClientUuid, sale.id);

    const totalCogs = [...cogsByLine.values()].reduce((s, n) => s + n, 0);
    await this.gl.postSaleJournal({
      id: sale.id,
      paymentMethod: primaryMethod,
      payments: payments.map((p) => ({
        paymentMethod: p.paymentMethod,
        amountInCents: p.amountInCents,
      })),
      subtotalInCents,
      taxInCents,
      discountInCents,
      tipInCents,
      totalInCents,
      status: 'COMPLETED',
      cogsInCents: totalCogs,
    });

    await this.shifts.attachSalePayments(
      shiftId,
      payments.map((p) => ({
        paymentMethod: p.paymentMethod as PaymentMethod,
        amountInCents: p.amountInCents,
      })),
      discountInCents,
      tipInCents,
    );

    const grossInCents = subtotalInCents + taxInCents;
    await this.analyticsSummary.applySale({
      tenantId: tenant.id,
      storeId: input.storeId,
      at: input.clientCreatedAt,
      grossInCents,
      discountInCents,
      netInCents: totalInCents,
      paymentMethod: input.paymentMethod as PaymentMethod,
      lines: priced.map((line) => ({
        productId: line.productId,
        productName: line.productName,
        quantity: line.quantity,
        revenueInCents: line.lineTotalInCents,
      })),
    });

    await this.edgeSync.enqueue({
      entityType: 'sale.completed',
      entityId: sale.id,
      storeId: input.storeId,
      payload: {
        saleId: sale.id,
        storeId: input.storeId,
        paymentMethod: input.paymentMethod,
        totalInCents,
        subtotalInCents,
        taxInCents,
        discountInCents,
        customerId: input.customerId ?? null,
        lineCount: priced.length,
        clientCreatedAt: input.clientCreatedAt,
        // Soft journal hook for hub/accounting consumers (no full COA).
        tipInCents,
        journalLines: SalesExportService.journalLinesForSale({
          saleId: sale.id,
          paymentMethod: primaryMethod,
          payments: payments.map((p) => ({
            paymentMethod: p.paymentMethod,
            amountInCents: p.amountInCents,
          })),
          subtotalInCents,
          taxInCents,
          discountInCents,
          tipInCents,
          totalInCents,
          status: 'COMPLETED',
        }),
      },
    });

    return { duplicate: false, conflict: false, sale };
  }

  private async assertStockAvailable(
    tenantId: string,
    storeId: string,
    lines: Array<{ productId: string; productName: string; quantity: number }>,
  ): Promise<void> {
    const conflicts: StockConflictLine[] = [];
    for (const line of lines) {
      const available = await this.getStoreStockQty(tenantId, storeId, line.productId);
      if (available < line.quantity) {
        const product = await this.prisma.db.product.findFirst({
          where: { id: line.productId, tenantId },
          select: { name: true },
        });
        conflicts.push({
          productId: line.productId,
          productName: product?.name ?? line.productName,
          requested: line.quantity,
          available,
        });
      }
    }
    if (conflicts.length) {
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'STOCK_CONFLICT',
        message: buildStockConflictMessage(conflicts),
        conflicts,
      });
    }
  }

  private async getStoreStockQty(
    tenantId: string,
    storeId: string,
    productId: string,
  ): Promise<number> {
    const row = await this.prisma.db.storeStock.findUnique({
      where: {
        tenantId_storeId_productId: { tenantId, storeId, productId },
      },
    });
    if (row) {
      return row.qty;
    }
    const product = await this.prisma.db.product.findFirst({
      where: { id: productId, tenantId },
      select: { stockQty: true },
    });
    return product?.stockQty ?? 0;
  }

  private async decrementStockAtomic(
    tenantId: string,
    storeId: string,
    productId: string,
    productName: string,
    quantity: number,
  ): Promise<void> {
    // Ensure row exists (copy from global catalog default on first touch).
    await this.prisma.db.$executeRaw`
      INSERT INTO store_stocks (tenant_id, store_id, product_id, qty, updated_at)
      SELECT ${tenantId}::uuid, ${storeId}::uuid, ${productId}::uuid, p.stock_qty, CURRENT_TIMESTAMP
      FROM products p
      WHERE p.id = ${productId}::uuid AND p.tenant_id = ${tenantId}::uuid
      ON CONFLICT (tenant_id, store_id, product_id) DO NOTHING
    `;

    const rows = await this.prisma.db.$executeRaw`
      UPDATE store_stocks
      SET qty = qty - ${quantity},
          updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${tenantId}::uuid
        AND store_id = ${storeId}::uuid
        AND product_id = ${productId}::uuid
        AND qty >= ${quantity}
    `;
    if (rows === 0) {
      const available = await this.getStoreStockQty(tenantId, storeId, productId);
      const conflict: StockConflictLine = {
        productId,
        productName,
        requested: quantity,
        available,
      };
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'STOCK_CONFLICT',
        message: buildStockConflictMessage([conflict]),
        conflicts: [conflict],
      });
    }

    // Keep catalog Product.stockQty roughly in sync as sum fallback for admin views.
    await this.prisma.db.$executeRaw`
      UPDATE products
      SET stock_qty = GREATEST(0, stock_qty - ${quantity}),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ${productId}::uuid AND tenant_id = ${tenantId}::uuid
    `;
  }

  private assertSaleShape(input: SyncSaleInput): void {
    if (!input.id || !input.storeId || !input.cartClientUuid || !input.lines?.length) {
      throw new BadRequestException('Sale id, storeId, cartClientUuid, and lines are required');
    }
    if (!PAYMENT_METHODS.has(input.paymentMethod)) {
      throw new BadRequestException('Invalid paymentMethod');
    }
    if (Number.isNaN(Date.parse(input.clientCreatedAt))) {
      throw new BadRequestException('clientCreatedAt must be an ISO timestamp');
    }
    for (const key of ['subtotalInCents', 'taxInCents', 'totalInCents'] as const) {
      if (!Number.isInteger(input[key]) || input[key] < 0) {
        throw new BadRequestException(`${key} must be a non-negative integer`);
      }
    }
    if (input.payments?.length) {
      for (const p of input.payments) {
        if (!TENDER_METHODS.has(p.paymentMethod)) {
          throw new BadRequestException('Invalid payments[].paymentMethod');
        }
        if (!Number.isInteger(p.amountInCents) || p.amountInCents < 1) {
          throw new BadRequestException('payments[].amountInCents must be a positive integer');
        }
      }
    }
  }

  private normalizePayments(
    input: SyncSaleInput,
    totalInCents: number,
  ): Array<{
    paymentMethod: string;
    amountInCents: number;
    amountTenderedInCents?: number;
  }> {
    if (input.payments?.length) {
      const sum = input.payments.reduce((s, p) => s + p.amountInCents, 0);
      if (sum !== totalInCents) {
        throw new BadRequestException(
          `payments sum (${sum}) must equal totalInCents (${totalInCents})`,
        );
      }
      if (input.payments.length === 1 && input.paymentMethod === 'SPLIT') {
        throw new BadRequestException('SPLIT requires at least two payment lines');
      }
      if (input.payments.length > 1 && input.paymentMethod !== 'SPLIT') {
        // Allow clients to send paymentMethod of the primary tender; coerce to SPLIT.
      }
      return input.payments;
    }
    if (input.paymentMethod === 'SPLIT') {
      throw new BadRequestException('SPLIT sales require payments[]');
    }
    return [
      {
        paymentMethod: input.paymentMethod,
        amountInCents: totalInCents,
      },
    ];
  }

  private async priceLines(
    tenantId: string,
    storeId: string,
    lines: Array<{
      productId: string;
      quantity: number;
      variantId?: string | null;
      modifierOptionIds?: string[];
      guestIndex?: number;
    }>,
  ) {
    if (!lines.length) {
      return [];
    }

    const productIds = [...new Set(lines.map((l) => l.productId))];
    const products = await this.prisma.db.product.findMany({
      where: { tenantId, id: { in: productIds }, isActive: true },
      include: { variants: { where: { isActive: true } } },
    });
    const productMap = new Map(products.map((p) => [p.id, p]));
    if (productMap.size !== productIds.length) {
      throw new BadRequestException('One or more products are missing or inactive');
    }

    const storePrices = await this.prisma.db.storePrice.findMany({
      where: { tenantId, storeId, productId: { in: productIds } },
    });
    const storePriceMap = new Map(storePrices.map((r) => [r.productId, r.unitPriceInCents]));

    const allOptionIds = [
      ...new Set(lines.flatMap((l) => l.modifierOptionIds ?? []).filter(Boolean)),
    ];
    const options =
      allOptionIds.length === 0
        ? []
        : await this.prisma.db.productModifierOption.findMany({
            where: { tenantId, id: { in: allOptionIds }, isActive: true },
            include: { group: true },
          });
    const optionMap = new Map(options.map((o) => [o.id, o]));

    return lines.map((line) => {
      if (!Number.isInteger(line.quantity) || line.quantity < 1) {
        throw new BadRequestException('Each line quantity must be an integer >= 1');
      }
      const guestIndex = line.guestIndex ?? 1;
      if (!Number.isInteger(guestIndex) || guestIndex < 1 || guestIndex > 20) {
        throw new BadRequestException('guestIndex must be an integer 1..20');
      }
      const product = productMap.get(line.productId)!;
      const activeVariants = product.variants ?? [];
      if (activeVariants.length > 0 && !line.variantId) {
        throw new BadRequestException(`Variant required for ${product.name}`);
      }
      let variantName = '';
      let variantId: string | null = null;
      let basePrice = storePriceMap.get(product.id) ?? product.unitPriceInCents;
      if (line.variantId) {
        const variant = activeVariants.find((v) => v.id === line.variantId);
        if (!variant) {
          throw new BadRequestException(`Invalid variant for ${product.name}`);
        }
        variantId = variant.id;
        variantName = ` · ${variant.name}`;
        basePrice = variant.unitPriceInCents;
      }
      const mods = (line.modifierOptionIds ?? []).map((id) => {
        const opt = optionMap.get(id);
        if (!opt || opt.group.productId !== product.id) {
          throw new BadRequestException(`Invalid modifier option ${id} for product ${product.name}`);
        }
        return {
          optionId: opt.id,
          name: opt.name,
          priceDeltaInCents: opt.priceDeltaInCents,
        };
      });
      const delta = mods.reduce((s, m) => s + m.priceDeltaInCents, 0);
      const unitPriceInCents = basePrice + delta;
      const money = lineMoney(unitPriceInCents, line.quantity, product.taxBps);
      const suffix = mods.length ? ` (${mods.map((m) => m.name).join(', ')})` : '';
      return {
        productId: product.id,
        variantId,
        productName: `${product.name}${variantName}${suffix}`,
        categoryId: product.categoryId,
        quantity: line.quantity,
        unitPriceInCents,
        taxBps: product.taxBps,
        modifiers: mods,
        guestIndex,
        ...money,
      };
    });
  }

  private async decrementVariantStockAtomic(
    tenantId: string,
    storeId: string,
    variantId: string,
    productName: string,
    quantity: number,
  ): Promise<void> {
    await this.prisma.db.$executeRaw`
      INSERT INTO store_variant_stocks (tenant_id, store_id, variant_id, qty, updated_at)
      VALUES (${tenantId}::uuid, ${storeId}::uuid, ${variantId}::uuid, 0, CURRENT_TIMESTAMP)
      ON CONFLICT (tenant_id, store_id, variant_id) DO NOTHING
    `;
    const rows = await this.prisma.db.$executeRaw`
      UPDATE store_variant_stocks
      SET qty = qty - ${quantity}, updated_at = CURRENT_TIMESTAMP
      WHERE tenant_id = ${tenantId}::uuid
        AND store_id = ${storeId}::uuid
        AND variant_id = ${variantId}::uuid
        AND qty >= ${quantity}
    `;
    if (rows === 0) {
      const row = await this.prisma.db.storeVariantStock.findUnique({
        where: {
          tenantId_storeId_variantId: { tenantId, storeId, variantId },
        },
      });
      throw new ConflictException({
        statusCode: 409,
        error: 'Conflict',
        code: 'STOCK_CONFLICT',
        message: buildStockConflictMessage([
          {
            productId: variantId,
            productName,
            requested: quantity,
            available: row?.qty ?? 0,
          },
        ]),
        conflicts: [
          {
            productId: variantId,
            productName,
            requested: quantity,
            available: row?.qty ?? 0,
          },
        ],
      });
    }
  }
}
