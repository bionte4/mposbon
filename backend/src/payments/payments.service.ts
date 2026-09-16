import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  ActivityAction,
  PaymentChargeStatus,
  PaymentProvider,
  Prisma,
} from '@prisma/client';
import { AuditService } from '../common/audit/audit.service';
import { PrismaAdminService } from '../common/prisma/prisma-admin.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { TenantContext } from '../common/tenant/tenant-context';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: PrismaAdminService,
    private readonly audit: AuditService,
  ) {}

  /** Active provider from env: local | midtrans | xendit */
  getProvider(): PaymentProvider {
    const raw = (process.env.PAYMENT_PROVIDER || 'local').toLowerCase();
    if (raw === 'midtrans') return PaymentProvider.MIDTRANS;
    if (raw === 'xendit') return PaymentProvider.XENDIT;
    return PaymentProvider.LOCAL_QRIS;
  }

  async createQrisCharge(input: {
    storeId: string;
    clientUuid: string;
    amountInCents: number;
    localQrString?: string | null;
    billNumber?: string | null;
  }) {
    const tenant = TenantContext.require();
    if (!Number.isInteger(input.amountInCents) || input.amountInCents < 1) {
      throw new BadRequestException('amountInCents must be an integer >= 1');
    }
    const store = await this.prisma.db.store.findFirst({
      where: { id: input.storeId, tenantId: tenant.id },
    });
    if (!store) throw new BadRequestException('Store not found');

    const provider = this.getProvider();
    const orderId = `BP-${tenant.id.slice(0, 8)}-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000);

    let qrString: string | null = null;
    let deeplinkUrl: string | null = null;
    let providerRef: string | null = orderId;

    if (provider === PaymentProvider.MIDTRANS) {
      const charged = await this.midtransCreateQris(orderId, input.amountInCents);
      qrString = charged.qrString;
      providerRef = charged.providerRef;
    } else if (provider === PaymentProvider.XENDIT) {
      const charged = await this.xenditCreateQris(orderId, input.amountInCents);
      qrString = charged.qrString;
      deeplinkUrl = charged.deeplinkUrl;
      providerRef = charged.providerRef;
    } else {
      qrString = input.localQrString?.trim() || store.qrisPayload || null;
      if (!qrString) {
        throw new BadRequestException(
          'No local QRIS payload — configure store QRIS or PAYMENT_PROVIDER=midtrans|xendit',
        );
      }
    }

    const charge = await this.prisma.db.paymentCharge.create({
      data: {
        tenantId: tenant.id,
        storeId: input.storeId,
        clientUuid: input.clientUuid,
        provider,
        status: PaymentChargeStatus.PENDING,
        amountInCents: input.amountInCents,
        providerRef,
        qrString,
        deeplinkUrl,
        expiresAt,
      },
    });

    await this.audit.log({
      action: ActivityAction.PAYMENT_CHARGE,
      entityType: 'payment_charge',
      entityId: charge.id,
      amountInCents: input.amountInCents,
      metadata: { provider, providerRef, billNumber: input.billNumber ?? null },
    });

    return charge;
  }

  async getCharge(id: string) {
    const tenant = TenantContext.require();
    const charge = await this.prisma.db.paymentCharge.findFirst({
      where: { id, tenantId: tenant.id },
    });
    if (!charge) throw new NotFoundException('Payment charge not found');
    return charge;
  }

  async refreshCharge(id: string) {
    const charge = await this.getCharge(id);
    if (charge.status !== PaymentChargeStatus.PENDING) return charge;

    if (charge.expiresAt && charge.expiresAt < new Date()) {
      return this.prisma.db.paymentCharge.update({
        where: { id: charge.id },
        data: { status: PaymentChargeStatus.EXPIRED },
      });
    }

    if (charge.provider === PaymentProvider.MIDTRANS && charge.providerRef) {
      const status = await this.midtransStatus(charge.providerRef);
      if (status === 'settlement' || status === 'capture') {
        return this.markPaidTenant(charge.id, { source: 'midtrans_poll', status });
      }
      if (status === 'expire' || status === 'deny' || status === 'cancel') {
        return this.prisma.db.paymentCharge.update({
          where: { id: charge.id },
          data: {
            status:
              status === 'expire'
                ? PaymentChargeStatus.EXPIRED
                : PaymentChargeStatus.FAILED,
          },
        });
      }
    }

    if (charge.provider === PaymentProvider.XENDIT && charge.providerRef) {
      const status = await this.xenditStatus(charge.providerRef);
      if (status === 'SUCCEEDED' || status === 'COMPLETED') {
        return this.markPaidTenant(charge.id, { source: 'xendit_poll', status });
      }
      if (status === 'EXPIRED' || status === 'FAILED') {
        return this.prisma.db.paymentCharge.update({
          where: { id: charge.id },
          data: {
            status:
              status === 'EXPIRED'
                ? PaymentChargeStatus.EXPIRED
                : PaymentChargeStatus.FAILED,
          },
        });
      }
    }

    return charge;
  }

  async confirmLocal(id: string) {
    const charge = await this.getCharge(id);
    if (charge.provider !== PaymentProvider.LOCAL_QRIS) {
      throw new BadRequestException('Only LOCAL_QRIS charges can be manually confirmed');
    }
    if (charge.status === PaymentChargeStatus.PAID) return charge;
    if (charge.status !== PaymentChargeStatus.PENDING) {
      throw new BadRequestException(`Cannot confirm charge in status ${charge.status}`);
    }
    return this.markPaidTenant(charge.id, { source: 'local_confirm' });
  }

  async attachSale(chargeId: string, saleId: string) {
    const tenant = TenantContext.require();
    const charge = await this.prisma.db.paymentCharge.findFirst({
      where: { id: chargeId, tenantId: tenant.id },
    });
    if (!charge) throw new NotFoundException('Payment charge not found');
    if (charge.status !== PaymentChargeStatus.PAID) {
      throw new BadRequestException('Charge must be PAID before attaching sale');
    }
    return this.prisma.db.paymentCharge.update({
      where: { id: chargeId },
      data: { saleId },
    });
  }

  /** Public webhook — uses admin client (BYPASSRLS) then stamps tenant. */
  async handleMidtransWebhook(body: Record<string, unknown>) {
    const serverKey = process.env.MIDTRANS_SERVER_KEY || '';
    if (!serverKey) {
      throw new BadRequestException('MIDTRANS_SERVER_KEY not configured');
    }
    const orderId = String(body.order_id ?? '');
    const statusCode = String(body.status_code ?? '');
    const grossAmount = String(body.gross_amount ?? '');
    const signature = String(body.signature_key ?? '');
    const expected = createHash('sha512')
      .update(`${orderId}${statusCode}${grossAmount}${serverKey}`)
      .digest('hex');
    if (signature !== expected) {
      throw new UnauthorizedException('Invalid Midtrans signature');
    }

    const charge = await this.admin.paymentCharge.findFirst({
      where: { providerRef: orderId, provider: PaymentProvider.MIDTRANS },
    });
    if (!charge) {
      this.logger.warn(`Midtrans webhook for unknown order ${orderId}`);
      return { ok: true, matched: false };
    }

    const txStatus = String(body.transaction_status ?? '');
    if (txStatus === 'settlement' || txStatus === 'capture') {
      await this.markPaidAdmin(charge.id, body);
    } else if (txStatus === 'expire') {
      await this.admin.paymentCharge.update({
        where: { id: charge.id },
        data: { status: PaymentChargeStatus.EXPIRED, rawWebhook: body as Prisma.InputJsonValue },
      });
    } else if (txStatus === 'deny' || txStatus === 'cancel' || txStatus === 'failure') {
      await this.admin.paymentCharge.update({
        where: { id: charge.id },
        data: { status: PaymentChargeStatus.FAILED, rawWebhook: body as Prisma.InputJsonValue },
      });
    }
    return { ok: true, matched: true, chargeId: charge.id, txStatus };
  }

  async handleXenditWebhook(body: Record<string, unknown>, callbackToken?: string) {
    const expected = process.env.XENDIT_CALLBACK_TOKEN || '';
    if (expected && callbackToken !== expected) {
      throw new UnauthorizedException('Invalid Xendit callback token');
    }
    const externalId = String(body.external_id ?? body.reference_id ?? '');
    const qrId = String(body.id ?? body.qr_id ?? '');
    const status = String(body.status ?? '');
    const or: Prisma.PaymentChargeWhereInput[] = [];
    if (externalId) or.push({ providerRef: externalId });
    if (qrId) or.push({ providerRef: qrId });
    if (!or.length) return { ok: true, matched: false };

    const charge = await this.admin.paymentCharge.findFirst({
      where: { provider: PaymentProvider.XENDIT, OR: or },
    });
    if (!charge) {
      this.logger.warn(`Xendit webhook unmatched ${externalId || qrId}`);
      return { ok: true, matched: false };
    }

    if (status === 'SUCCEEDED' || status === 'COMPLETED' || status === 'PAID') {
      await this.markPaidAdmin(charge.id, body);
    } else if (status === 'EXPIRED') {
      await this.admin.paymentCharge.update({
        where: { id: charge.id },
        data: { status: PaymentChargeStatus.EXPIRED, rawWebhook: body as Prisma.InputJsonValue },
      });
    } else if (status === 'FAILED' || status === 'INACTIVE') {
      await this.admin.paymentCharge.update({
        where: { id: charge.id },
        data: { status: PaymentChargeStatus.FAILED, rawWebhook: body as Prisma.InputJsonValue },
      });
    }
    return { ok: true, matched: true, chargeId: charge.id, status };
  }

  private markPaidTenant(id: string, meta: Record<string, unknown>) {
    return this.prisma.db.paymentCharge.update({
      where: { id },
      data: {
        status: PaymentChargeStatus.PAID,
        paidAt: new Date(),
        rawWebhook: meta as Prisma.InputJsonValue,
      },
    });
  }

  private markPaidAdmin(id: string, body: Record<string, unknown>) {
    return this.admin.paymentCharge.update({
      where: { id },
      data: {
        status: PaymentChargeStatus.PAID,
        paidAt: new Date(),
        rawWebhook: body as Prisma.InputJsonValue,
      },
    });
  }

  private midtransBaseUrl(): string {
    return process.env.MIDTRANS_IS_PRODUCTION === 'true'
      ? 'https://api.midtrans.com'
      : 'https://api.sandbox.midtrans.com';
  }

  private midtransAuthHeader(): string {
    const key = process.env.MIDTRANS_SERVER_KEY || '';
    if (!key) throw new BadRequestException('MIDTRANS_SERVER_KEY not configured');
    return `Basic ${Buffer.from(`${key}:`).toString('base64')}`;
  }

  private async midtransCreateQris(orderId: string, amountInCents: number) {
    const res = await fetch(`${this.midtransBaseUrl()}/v2/charge`, {
      method: 'POST',
      headers: {
        Authorization: this.midtransAuthHeader(),
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        payment_type: 'qris',
        transaction_details: {
          order_id: orderId,
          gross_amount: amountInCents,
        },
        qris: { acquirer: 'gopay' },
      }),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new BadRequestException(`Midtrans charge failed: ${JSON.stringify(json)}`);
    }
    const actions = (json.actions as Array<{ name?: string; url?: string }>) || [];
    const qrAction = actions.find((a) => a.name === 'generate-qr-code');
    const qrString = (json.qr_string as string) || qrAction?.url || null;
    if (!qrString) {
      throw new BadRequestException('Midtrans did not return a QR string');
    }
    return { providerRef: String(json.order_id ?? orderId), qrString };
  }

  private async midtransStatus(orderId: string): Promise<string> {
    const res = await fetch(
      `${this.midtransBaseUrl()}/v2/${encodeURIComponent(orderId)}/status`,
      {
        headers: {
          Authorization: this.midtransAuthHeader(),
          Accept: 'application/json',
        },
      },
    );
    const json = (await res.json()) as Record<string, unknown>;
    return String(json.transaction_status ?? '');
  }

  private async xenditCreateQris(externalId: string, amountInCents: number) {
    const key = process.env.XENDIT_SECRET_KEY || '';
    if (!key) throw new BadRequestException('XENDIT_SECRET_KEY not configured');
    const res = await fetch('https://api.xendit.co/qr_codes', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        reference_id: externalId,
        type: 'DYNAMIC',
        currency: 'IDR',
        amount: amountInCents,
      }),
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new BadRequestException(`Xendit QR failed: ${JSON.stringify(json)}`);
    }
    return {
      providerRef: String(json.id ?? externalId),
      qrString: String(json.qr_string ?? ''),
      deeplinkUrl: null as string | null,
    };
  }

  private async xenditStatus(id: string): Promise<string> {
    const key = process.env.XENDIT_SECRET_KEY || '';
    if (!key) return '';
    const res = await fetch(`https://api.xendit.co/qr_codes/${encodeURIComponent(id)}`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${key}:`).toString('base64')}`,
      },
    });
    const json = (await res.json()) as Record<string, unknown>;
    return String(json.status ?? '');
  }
}
