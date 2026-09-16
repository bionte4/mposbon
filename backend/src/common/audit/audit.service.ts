import { Injectable, Logger } from '@nestjs/common';
import { ActivityAction, Prisma } from '@prisma/client';
import { AuthContext } from '../../auth/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContext } from '../tenant/tenant-context';

export type AuditEntry = {
  action: ActivityAction;
  entityType?: string | null;
  entityId?: string | null;
  amountInCents?: number | null;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue | null;
  /** Override when actor is not yet in AuthContext (e.g. PIN fail). */
  actorUserId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
};

/**
 * Append-only audit writer. Failures are logged but never abort the business
 * transaction path (best-effort) — except when called inside the same TX
 * where the caller wants atomicity (default: same prisma.db TX).
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    const tenant = TenantContext.current();
    if (!tenant) {
      this.logger.warn(`Audit skipped (no tenant): ${entry.action}`);
      return;
    }

    const actorUserId =
      entry.actorUserId !== undefined
        ? entry.actorUserId
        : AuthContext.current()?.id ?? null;

    try {
      await this.prisma.db.activityLog.create({
        data: {
          tenantId: tenant.id,
          actorUserId,
          action: entry.action,
          entityType: entry.entityType ?? null,
          entityId: entry.entityId ?? null,
          amountInCents: entry.amountInCents ?? null,
          reason: entry.reason ?? null,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ?? null,
          metadata: entry.metadata ?? undefined,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to write activity log ${entry.action}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  listRecent(limit = 50) {
    const tenant = TenantContext.require();
    return this.prisma.db.activityLog.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 200),
      include: {
        actor: { select: { id: true, displayName: true, email: true, role: true } },
      },
    });
  }
}
