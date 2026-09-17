import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { GlExternalProvider } from '@prisma/client';
import { AuthContext } from '../auth/auth-context';
import type { Permission } from '../auth/permissions';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';

export const FINANCE_INTEGRATION_SCOPES: Permission[] = [
  'admin.finance.read',
  'admin.finance.write',
];

export const WEBHOOK_EVENTS = ['journal.posted', 'account.updated'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

const KEY_PREFIX_LEN = 16; // bp_live_ + 8 hex — kept for createApiKey prefix shape

@Injectable()
export class IntegrationService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── API keys ───────────────────────────────────────────────

  listApiKeys() {
    const tenant = TenantContext.require();
    return this.prisma.db.integrationApiKey.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        lastUsedAt: true,
        revokedAt: true,
        createdAt: true,
        createdByUserId: true,
      },
    });
  }

  async createApiKey(input: { name: string; scopes?: string[] }) {
    const tenant = TenantContext.require();
    const actor = AuthContext.current();
    const name = (input.name ?? '').trim();
    if (name.length < 2 || name.length > 80) {
      throw new BadRequestException('name must be 2–80 characters');
    }
    const scopes = this.normalizeScopes(input.scopes);
    const rawSecret = randomBytes(24).toString('base64url');
    const keyPrefix = `bp_live_${randomBytes(4).toString('hex')}`;
    if (keyPrefix.length !== KEY_PREFIX_LEN) {
      throw new BadRequestException('Internal key prefix length mismatch');
    }
    const apiKey = `${keyPrefix}.${rawSecret}`;
    const keyHash = this.hashSecret(apiKey);

    const row = await this.prisma.db.integrationApiKey.create({
      data: {
        id: randomUUID(),
        tenantId: tenant.id,
        name,
        keyPrefix,
        keyHash,
        scopes,
        createdByUserId: actor?.id ?? null,
      },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        createdAt: true,
      },
    });

    return {
      ...row,
      /** Shown once — store securely; cannot be retrieved again. */
      apiKey,
    };
  }

  async revokeApiKey(id: string) {
    const tenant = TenantContext.require();
    const row = await this.prisma.db.integrationApiKey.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!row) throw new NotFoundException('API key not found');
    if (row.revokedAt) return row;
    return this.prisma.db.integrationApiKey.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
      select: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        revokedAt: true,
      },
    });
  }

  private hashSecret(raw: string): string {
    return createHash('sha256').update(raw).digest('hex');
  }

  private normalizeScopes(raw?: string[]): Permission[] {
    const requested = (raw?.length ? raw : FINANCE_INTEGRATION_SCOPES).map((s) =>
      s.trim(),
    );
    const scopes = FINANCE_INTEGRATION_SCOPES.filter((s) => requested.includes(s));
    if (!scopes.length) {
      throw new BadRequestException(
        `scopes must include at least one of: ${FINANCE_INTEGRATION_SCOPES.join(', ')}`,
      );
    }
    return scopes;
  }

  // ─── Account mappings ───────────────────────────────────────

  listMappings(provider?: GlExternalProvider) {
    const tenant = TenantContext.require();
    return this.prisma.db.glAccountMapping.findMany({
      where: {
        tenantId: tenant.id,
        ...(provider ? { provider } : {}),
      },
      orderBy: [{ provider: 'asc' }, { accountCode: 'asc' }],
    });
  }

  async upsertMapping(input: {
    provider: GlExternalProvider;
    accountCode: string;
    externalAccountId: string;
    externalAccountName?: string | null;
  }) {
    const tenant = TenantContext.require();
    const code = input.accountCode.trim().toUpperCase();
    const externalAccountId = input.externalAccountId.trim();
    if (!code || !externalAccountId) {
      throw new BadRequestException('accountCode and externalAccountId required');
    }
    const account = await this.prisma.db.glAccount.findFirst({
      where: { tenantId: tenant.id, code },
    });
    if (!account) throw new NotFoundException(`GL account ${code} not found`);

    return this.prisma.db.glAccountMapping.upsert({
      where: {
        tenantId_provider_glAccountId: {
          tenantId: tenant.id,
          provider: input.provider,
          glAccountId: account.id,
        },
      },
      create: {
        id: randomUUID(),
        tenantId: tenant.id,
        provider: input.provider,
        glAccountId: account.id,
        accountCode: account.code,
        externalAccountId,
        externalAccountName: input.externalAccountName?.trim() || null,
      },
      update: {
        accountCode: account.code,
        externalAccountId,
        externalAccountName: input.externalAccountName?.trim() || null,
      },
    });
  }

  async deleteMapping(id: string) {
    const tenant = TenantContext.require();
    const row = await this.prisma.db.glAccountMapping.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!row) throw new NotFoundException('Mapping not found');
    await this.prisma.db.glAccountMapping.delete({ where: { id: row.id } });
    return { ok: true };
  }

  // ─── Webhooks ───────────────────────────────────────────────

  listWebhooks() {
    const tenant = TenantContext.require();
    return this.prisma.db.integrationWebhook.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        url: true,
        events: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async createWebhook(input: { url: string; events?: string[]; secret?: string }) {
    const tenant = TenantContext.require();
    const url = this.assertHttpsUrl(input.url);
    const events = this.normalizeEvents(input.events);
    const secret =
      input.secret?.trim() || randomBytes(24).toString('base64url');

    const row = await this.prisma.db.integrationWebhook.create({
      data: {
        id: randomUUID(),
        tenantId: tenant.id,
        url,
        secret,
        events,
      },
    });
    return {
      id: row.id,
      url: row.url,
      events: row.events,
      isActive: row.isActive,
      createdAt: row.createdAt,
      /** Shown once */
      secret: row.secret,
    };
  }

  async updateWebhook(
    id: string,
    input: { url?: string; events?: string[]; isActive?: boolean },
  ) {
    const tenant = TenantContext.require();
    const row = await this.prisma.db.integrationWebhook.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!row) throw new NotFoundException('Webhook not found');

    return this.prisma.db.integrationWebhook.update({
      where: { id: row.id },
      data: {
        ...(input.url !== undefined ? { url: this.assertHttpsUrl(input.url) } : {}),
        ...(input.events !== undefined
          ? { events: this.normalizeEvents(input.events) }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
      select: {
        id: true,
        url: true,
        events: true,
        isActive: true,
        updatedAt: true,
      },
    });
  }

  async deleteWebhook(id: string) {
    const tenant = TenantContext.require();
    const row = await this.prisma.db.integrationWebhook.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!row) throw new NotFoundException('Webhook not found');
    await this.prisma.db.integrationWebhook.delete({ where: { id: row.id } });
    return { ok: true };
  }

  listDeliveries(limit = 50) {
    const tenant = TenantContext.require();
    return this.prisma.db.integrationWebhookDelivery.findMany({
      where: { tenantId: tenant.id },
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
      select: {
        id: true,
        webhookId: true,
        event: true,
        statusCode: true,
        success: true,
        errorMessage: true,
        attempts: true,
        deliveredAt: true,
        createdAt: true,
      },
    });
  }

  /**
   * Fan-out outbound webhook. Non-blocking for callers (errors logged as deliveries).
   */
  async dispatchEvent(event: WebhookEvent, payload: Record<string, unknown>): Promise<void> {
    const tenant = TenantContext.require();
    const hooks = await this.prisma.db.integrationWebhook.findMany({
      where: {
        tenantId: tenant.id,
        isActive: true,
        events: { has: event },
      },
    });
    if (!hooks.length) return;

    const body = {
      id: randomUUID(),
      event,
      createdAt: new Date().toISOString(),
      tenantId: tenant.id,
      data: payload,
    };
    const bodyStr = JSON.stringify(body);

    await Promise.all(
      hooks.map(async (hook) => {
        const signature = createHmac('sha256', hook.secret).update(bodyStr).digest('hex');
        let statusCode: number | null = null;
        let success = false;
        let errorMessage: string | null = null;
        try {
          const res = await fetch(hook.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-BonPOS-Event': event,
              'X-BonPOS-Signature': `sha256=${signature}`,
              'User-Agent': 'BonPOS-Webhook/1.0',
            },
            body: bodyStr,
            signal: AbortSignal.timeout(8_000),
          });
          statusCode = res.status;
          success = res.ok;
          if (!res.ok) {
            errorMessage = `HTTP ${res.status}`;
          }
        } catch (err) {
          errorMessage = err instanceof Error ? err.message : 'delivery failed';
        }

        await this.prisma.db.integrationWebhookDelivery.create({
          data: {
            id: randomUUID(),
            tenantId: tenant.id,
            webhookId: hook.id,
            event,
            payloadJson: body as object,
            statusCode,
            success,
            errorMessage,
            attempts: 1,
            deliveredAt: success ? new Date() : null,
          },
        });
      }),
    );
  }

  private assertHttpsUrl(raw: string): string {
    const url = (raw ?? '').trim();
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new BadRequestException('Invalid webhook URL');
    }
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw new BadRequestException('Webhook URL must be http(s)');
    }
    // Block obvious SSRF to metadata / localhost in production
    if (process.env.NODE_ENV === 'production') {
      const host = parsed.hostname.toLowerCase();
      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '::1' ||
        host.endsWith('.local') ||
        host.startsWith('169.254.') ||
        host.startsWith('10.') ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
        host.startsWith('192.168.')
      ) {
        throw new BadRequestException('Webhook URL host not allowed');
      }
    }
    return parsed.toString();
  }

  private normalizeEvents(raw?: string[]): string[] {
    const requested = raw?.length ? raw : [...WEBHOOK_EVENTS];
    const events = WEBHOOK_EVENTS.filter((e) => requested.includes(e));
    if (!events.length) {
      throw new BadRequestException(
        `events must include at least one of: ${WEBHOOK_EVENTS.join(', ')}`,
      );
    }
    return [...events];
  }
}
