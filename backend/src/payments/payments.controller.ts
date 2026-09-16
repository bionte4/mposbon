import { Body, Controller, Get, Headers, Param, Post } from '@nestjs/common';
import { Public } from '../auth/public.decorator';
import { RequirePermissions } from '../auth/rbac.guard';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  @Get('provider')
  @RequirePermissions('pos.sale.create')
  provider() {
    return { provider: this.payments.getProvider() };
  }

  @Post('qris/charges')
  @RequirePermissions('pos.sale.create')
  createCharge(
    @Body()
    body: {
      storeId: string;
      clientUuid: string;
      amountInCents: number;
      localQrString?: string | null;
      billNumber?: string | null;
    },
  ) {
    return this.payments.createQrisCharge(body);
  }

  @Get('qris/charges/:id')
  @RequirePermissions('pos.sale.create')
  getCharge(@Param('id') id: string) {
    return this.payments.getCharge(id);
  }

  @Post('qris/charges/:id/refresh')
  @RequirePermissions('pos.sale.create')
  refresh(@Param('id') id: string) {
    return this.payments.refreshCharge(id);
  }

  @Post('qris/charges/:id/confirm-local')
  @RequirePermissions('pos.sale.create')
  confirmLocal(@Param('id') id: string) {
    return this.payments.confirmLocal(id);
  }

  @Public()
  @Post('webhooks/midtrans')
  midtransWebhook(@Body() body: Record<string, unknown>) {
    return this.payments.handleMidtransWebhook(body);
  }

  @Public()
  @Post('webhooks/xendit')
  xenditWebhook(
    @Body() body: Record<string, unknown>,
    @Headers('x-callback-token') callbackToken?: string,
  ) {
    return this.payments.handleXenditWebhook(body, callbackToken);
  }
}
