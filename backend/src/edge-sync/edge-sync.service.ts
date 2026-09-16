import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';

/**
 * Edge↔hub async sync via durable outbox.
 * Enabled when FEATURE_EDGE_SYNC env is on AND tenant settings.edgeSyncEnabled.
 */
@Injectable()
export class EdgeSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  async isEnabledForCurrentTenant(): Promise<boolean> {
    if (!this.config.featureEdgeSync) {
      return false;
    }
    const tenant = TenantContext.current();
    if (!tenant) {
      return false;
    }
    const settings = await this.prisma.db.tenantSetting.findUnique({
      where: { tenantId: tenant.id },
      select: { edgeSyncEnabled: true },
    });
    return settings?.edgeSyncEnabled === true;
  }

  async enqueue(input: {
    entityType: string;
    entityId: string;
    payload: Prisma.InputJsonValue;
    storeId?: string | null;
  }): Promise<void> {
    if (!(await this.isEnabledForCurrentTenant())) {
      return;
    }
    const tenant = TenantContext.require();
    await this.prisma.db.edgeSyncOutbox.create({
      data: {
        tenantId: tenant.id,
        storeId: input.storeId ?? null,
        entityType: input.entityType,
        entityId: input.entityId,
        payload: input.payload,
      },
    });
  }

  async status() {
    const tenant = TenantContext.require();
    const [pending, delivered, cursor] = await Promise.all([
      this.prisma.db.edgeSyncOutbox.count({
        where: { tenantId: tenant.id, deliveredAt: null },
      }),
      this.prisma.db.edgeSyncOutbox.count({
        where: { tenantId: tenant.id, deliveredAt: { not: null } },
      }),
      this.prisma.db.edgeSyncCursor.findUnique({
        where: { tenantId_stream: { tenantId: tenant.id, stream: 'hub.push' } },
      }),
    ]);
    return {
      enabled: await this.isEnabledForCurrentTenant(),
      featureFlag: this.config.featureEdgeSync,
      pending,
      delivered,
      hubUrl: process.env.EDGE_HUB_URL || null,
      lastCursor: cursor?.cursor ?? null,
    };
  }

  /**
   * Drain pending outbox rows. If EDGE_HUB_URL is set, POST batch to hub;
   * otherwise mark delivered locally (dev / dry-run hub).
   */
  async push(limit = 50) {
    const tenant = TenantContext.require();
    if (!(await this.isEnabledForCurrentTenant())) {
      return { pushed: 0, skipped: true as const, reason: 'edge sync disabled' };
    }

    const rows = await this.prisma.db.edgeSyncOutbox.findMany({
      where: {
        tenantId: tenant.id,
        deliveredAt: null,
        availableAt: { lte: new Date() },
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(limit, 200),
    });
    if (!rows.length) {
      return { pushed: 0, skipped: false as const };
    }

    const hubUrl = process.env.EDGE_HUB_URL?.trim();
    if (hubUrl) {
      try {
        const res = await fetch(`${hubUrl.replace(/\/$/, '')}/v1/ingest`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Tenant-Id': tenant.id,
            'X-Tenant-Slug': tenant.slug,
          },
          body: JSON.stringify({
            events: rows.map((r) => ({
              id: r.id,
              entityType: r.entityType,
              entityId: r.entityId,
              storeId: r.storeId,
              payload: r.payload,
              createdAt: r.createdAt,
            })),
          }),
        });
        if (!res.ok) {
          const text = await res.text();
          await this.prisma.db.edgeSyncOutbox.updateMany({
            where: { id: { in: rows.map((r) => r.id) } },
            data: {
              attempts: { increment: 1 },
              lastError: `hub ${res.status}: ${text.slice(0, 200)}`,
              availableAt: new Date(Date.now() + 30_000),
            },
          });
          return { pushed: 0, skipped: false as const, error: text.slice(0, 200) };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'hub unreachable';
        await this.prisma.db.edgeSyncOutbox.updateMany({
          where: { id: { in: rows.map((r) => r.id) } },
          data: {
            attempts: { increment: 1 },
            lastError: message.slice(0, 200),
            availableAt: new Date(Date.now() + 30_000),
          },
        });
        return { pushed: 0, skipped: false as const, error: message };
      }
    }

    const now = new Date();
    await this.prisma.db.edgeSyncOutbox.updateMany({
      where: { id: { in: rows.map((r) => r.id) } },
      data: { deliveredAt: now, lastError: null },
    });
    await this.prisma.db.edgeSyncCursor.upsert({
      where: { tenantId_stream: { tenantId: tenant.id, stream: 'hub.push' } },
      create: {
        tenantId: tenant.id,
        stream: 'hub.push',
        cursor: rows[rows.length - 1].id,
      },
      update: { cursor: rows[rows.length - 1].id },
    });

    return {
      pushed: rows.length,
      skipped: false as const,
      dryRun: !hubUrl,
    };
  }

  /** Hub→edge pull stub: returns undelivered events after cursor for reconciliation tools. */
  async pull(cursor?: string, limit = 50) {
    const tenant = TenantContext.require();
    const rows = await this.prisma.db.edgeSyncOutbox.findMany({
      where: {
        tenantId: tenant.id,
        ...(cursor ? { id: { gt: cursor } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: Math.min(limit, 200),
    });
    return {
      events: rows.map((r) => ({
        id: r.id,
        entityType: r.entityType,
        entityId: r.entityId,
        storeId: r.storeId,
        payload: r.payload,
        deliveredAt: r.deliveredAt,
        createdAt: r.createdAt,
      })),
      nextCursor: rows.length ? rows[rows.length - 1].id : cursor ?? null,
    };
  }
}
