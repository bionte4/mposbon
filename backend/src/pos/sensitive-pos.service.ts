import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ActivityAction, SaleStatus, SupervisorActionType } from '@prisma/client';
import { AuthContext } from '../auth/auth-context';
import { SupervisorAuthService } from '../auth/supervisor-auth.service';
import { AnalyticsSummaryService } from '../analytics/analytics-summary.service';
import { AuditService } from '../common/audit/audit.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';
import { assertInt } from '../pos/money';
import { ShiftService } from '../shifts/shift.service';

@Injectable()
export class SensitivePosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly supervisorAuth: SupervisorAuthService,
    private readonly shifts: ShiftService,
    private readonly analyticsSummary: AnalyticsSummaryService,
    private readonly audit: AuditService,
  ) {}

  async voidSale(input: { saleId: string; supervisorPin: string; reason?: string }) {
    return this.reverseCompletedSale({
      saleId: input.saleId,
      supervisorPin: input.supervisorPin,
      reason: input.reason,
      nextStatus: SaleStatus.VOIDED,
      supervisorAction: SupervisorActionType.VOID_SALE,
      activityAction: ActivityAction.VOID_SALE,
      permission: 'pos.void',
    });
  }

  /** Full refund/return: restock + reverse tender buckets (same integrity path as void). */
  async refundSale(input: { saleId: string; supervisorPin: string; reason?: string }) {
    return this.reverseCompletedSale({
      saleId: input.saleId,
      supervisorPin: input.supervisorPin,
      reason: input.reason,
      nextStatus: SaleStatus.REFUNDED,
      supervisorAction: SupervisorActionType.REFUND_SALE,
      activityAction: ActivityAction.REFUND_SALE,
      permission: 'pos.void',
    });
  }

  /**
   * Shared void/refund path: mark sale, restock lines atomically, reverse shift
   * tender buckets, and update daily analytics. Prevents inventory leak on cancel.
   */
  private async reverseCompletedSale(input: {
    saleId: string;
    supervisorPin: string;
    reason?: string;
    nextStatus: typeof SaleStatus.VOIDED | typeof SaleStatus.REFUNDED;
    supervisorAction: SupervisorActionType;
    activityAction: ActivityAction;
    permission: 'pos.void';
  }) {
    const auth = await this.supervisorAuth.authorizeSensitive(
      input.permission,
      input.supervisorAction,
      input.supervisorPin,
    );
    const tenant = TenantContext.require();
    const sale = await this.prisma.db.sale.findFirst({
      where: { id: input.saleId, tenantId: tenant.id },
      include: { lines: true, payments: true },
    });
    if (!sale) {
      throw new NotFoundException('Sale not found');
    }
    if (sale.status !== SaleStatus.COMPLETED) {
      throw new BadRequestException(`Sale cannot be reversed (status=${sale.status})`);
    }

    const updated = await this.prisma.db.sale.update({
      where: { id: sale.id },
      data: { status: input.nextStatus },
      include: { lines: true, payments: true },
    });

    // Restock each line at the sale's store — inventory must match completed→reversed lifecycle.
    for (const line of sale.lines) {
      await this.prisma.db.$executeRaw`
        INSERT INTO store_stocks (tenant_id, store_id, product_id, qty, updated_at)
        SELECT ${tenant.id}::uuid, ${sale.storeId}::uuid, ${line.productId}::uuid, p.stock_qty, CURRENT_TIMESTAMP
        FROM products p
        WHERE p.id = ${line.productId}::uuid AND p.tenant_id = ${tenant.id}::uuid
        ON CONFLICT (tenant_id, store_id, product_id) DO NOTHING
      `;
      await this.prisma.db.$executeRaw`
        UPDATE store_stocks
        SET qty = qty + ${line.quantity},
            updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = ${tenant.id}::uuid
          AND store_id = ${sale.storeId}::uuid
          AND product_id = ${line.productId}::uuid
      `;
      await this.prisma.db.$executeRaw`
        UPDATE products
        SET stock_qty = stock_qty + ${line.quantity},
            updated_at = CURRENT_TIMESTAMP
        WHERE id = ${line.productId}::uuid
          AND tenant_id = ${tenant.id}::uuid
      `;
    }

    if (sale.shiftId) {
      const payments =
        sale.payments.length > 0
          ? sale.payments.map((p) => ({
              paymentMethod: p.paymentMethod,
              amountInCents: p.amountInCents,
            }))
          : [
              {
                paymentMethod: sale.paymentMethod,
                amountInCents: sale.totalInCents,
              },
            ];
      await this.shifts.reverseSalePayments(sale.shiftId, payments);
    }

    await this.analyticsSummary.applyVoid({
      tenantId: tenant.id,
      storeId: sale.storeId,
      at: sale.clientCreatedAt,
      voidTotalInCents: sale.totalInCents,
    });

    await this.supervisorAuth.recordAction({
      actionType: input.supervisorAction,
      supervisorUserId: auth.supervisorUserId,
      shiftId: sale.shiftId,
      saleId: sale.id,
      amountInCents: sale.totalInCents,
      reason: input.reason ?? null,
    });

    await this.audit.log({
      action: input.activityAction,
      entityType: 'sale',
      entityId: sale.id,
      amountInCents: sale.totalInCents,
      reason: input.reason ?? null,
      metadata: {
        supervisorUserId: auth.supervisorUserId,
        paymentMethod: sale.paymentMethod,
        restockedLines: sale.lines.length,
        nextStatus: input.nextStatus,
      },
    });

    return updated;
  }

  async applyManualDiscount(input: {
    saleId: string;
    discountInCents: number;
    supervisorPin: string;
    reason?: string;
  }) {
    assertInt(input.discountInCents, 'discountInCents');
    if (input.discountInCents < 1) {
      throw new BadRequestException('discountInCents must be >= 1');
    }

    const auth = await this.supervisorAuth.authorizeSensitive(
      'pos.discount.manual',
      SupervisorActionType.MANUAL_DISCOUNT,
      input.supervisorPin,
    );
    const tenant = TenantContext.require();
    const sale = await this.prisma.db.sale.findFirst({
      where: { id: input.saleId, tenantId: tenant.id },
    });
    if (!sale) {
      throw new NotFoundException('Sale not found');
    }
    if (sale.status === SaleStatus.VOIDED) {
      throw new BadRequestException('Cannot discount a voided sale');
    }

    const nextDiscount = sale.discountInCents + input.discountInCents;
    const nextTotal =
      sale.subtotalInCents + sale.taxInCents - nextDiscount + sale.tipInCents;
    if (nextTotal < 0) {
      throw new BadRequestException('Discount exceeds sale total');
    }

    const updated = await this.prisma.db.sale.update({
      where: { id: sale.id },
      data: {
        discountInCents: nextDiscount,
        totalInCents: nextTotal,
      },
    });

    if (sale.shiftId) {
      await this.prisma.db.cashierShift.update({
        where: { id: sale.shiftId },
        data: { discountTotalInCents: { increment: input.discountInCents } },
      });
    }

    await this.supervisorAuth.recordAction({
      actionType: SupervisorActionType.MANUAL_DISCOUNT,
      supervisorUserId: auth.supervisorUserId,
      shiftId: sale.shiftId,
      saleId: sale.id,
      amountInCents: input.discountInCents,
      reason: input.reason ?? null,
    });

    await this.audit.log({
      action: ActivityAction.MANUAL_DISCOUNT,
      entityType: 'sale',
      entityId: sale.id,
      amountInCents: input.discountInCents,
      reason: input.reason ?? null,
      metadata: { supervisorUserId: auth.supervisorUserId },
    });

    return updated;
  }

  async forceOpenDrawer(input: { supervisorPin: string; reason?: string }) {
    const auth = await this.supervisorAuth.authorizeSensitive(
      'pos.drawer.open_force',
      SupervisorActionType.FORCE_OPEN_DRAWER,
      input.supervisorPin,
    );
    const actor = AuthContext.require();
    const activeShift = await this.shifts.getActiveForActor();

    await this.supervisorAuth.recordAction({
      actionType: SupervisorActionType.FORCE_OPEN_DRAWER,
      supervisorUserId: auth.supervisorUserId,
      shiftId: activeShift?.id ?? null,
      reason: input.reason ?? 'Force open cash drawer',
      metadata: { requesterRole: actor.role },
    });

    await this.audit.log({
      action: ActivityAction.FORCE_OPEN_DRAWER,
      entityType: 'shift',
      entityId: activeShift?.id ?? null,
      reason: input.reason ?? 'Force open cash drawer',
      metadata: { supervisorUserId: auth.supervisorUserId },
    });

    return {
      authorized: true,
      escPosKickHex: '1b700019fa',
      supervisorUserId: auth.supervisorUserId,
    };
  }

  /**
   * Audit-only (and PIN-gated) cart line removal. Local IndexedDB still mutates;
   * this endpoint records who authorized deleting a line from the active cart.
   */
  async removeCartItem(input: {
    cartClientUuid: string;
    productId: string;
    productName?: string;
    quantity?: number;
    unitPriceInCents?: number;
    supervisorPin: string;
    reason?: string;
  }) {
    const auth = await this.supervisorAuth.authorizeSensitive(
      'pos.void',
      SupervisorActionType.VOID_ITEM,
      input.supervisorPin,
    );

    await this.supervisorAuth.recordAction({
      actionType: SupervisorActionType.VOID_ITEM,
      supervisorUserId: auth.supervisorUserId,
      amountInCents: input.unitPriceInCents ?? null,
      reason: input.reason ?? 'Remove cart item',
      metadata: {
        cartClientUuid: input.cartClientUuid,
        productId: input.productId,
        productName: input.productName ?? null,
        quantity: input.quantity ?? null,
      },
    });

    await this.audit.log({
      action: ActivityAction.REMOVE_CART_ITEM,
      entityType: 'cart',
      entityId: input.cartClientUuid,
      amountInCents: input.unitPriceInCents ?? null,
      reason: input.reason ?? 'Remove cart item',
      metadata: {
        productId: input.productId,
        productName: input.productName ?? null,
        quantity: input.quantity ?? null,
        supervisorUserId: auth.supervisorUserId,
      },
    });

    return { ok: true, supervisorUserId: auth.supervisorUserId };
  }

  async overrideCartItemPrice(input: {
    cartClientUuid: string;
    productId: string;
    productName?: string;
    originalPriceInCents: number;
    newPriceInCents: number;
    supervisorPin: string;
    reason?: string;
  }) {
    assertInt(input.originalPriceInCents, 'originalPriceInCents');
    assertInt(input.newPriceInCents, 'newPriceInCents');
    if (input.newPriceInCents < 0) {
      throw new BadRequestException('newPriceInCents must be >= 0');
    }

    const auth = await this.supervisorAuth.authorizeSensitive(
      'pos.discount.manual',
      SupervisorActionType.MANUAL_DISCOUNT,
      input.supervisorPin,
    );

    const delta = input.originalPriceInCents - input.newPriceInCents;

    await this.audit.log({
      action: ActivityAction.MANUAL_PRICE_OVERRIDE,
      entityType: 'cart',
      entityId: input.cartClientUuid,
      amountInCents: delta,
      reason: input.reason ?? 'Manual price override',
      metadata: {
        productId: input.productId,
        productName: input.productName ?? null,
        originalPriceInCents: input.originalPriceInCents,
        newPriceInCents: input.newPriceInCents,
        supervisorUserId: auth.supervisorUserId,
      },
    });

    return { ok: true, supervisorUserId: auth.supervisorUserId, deltaInCents: delta };
  }
}
