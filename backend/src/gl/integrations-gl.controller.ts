import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { GlAccountType, JournalSourceType } from '@prisma/client';
import { RequirePermissions } from '../auth/rbac.guard';
import { GlService } from './gl.service';

/**
 * Finance integration surface for external GL/COA systems.
 *
 * Base: `GET/POST /api/v1/integrations/gl/...`
 * Auth: Bearer session JWT with `admin.finance.read` / `admin.finance.write`
 *       (+ tenant header / resolution same as other APIs).
 *
 * Amounts are always integer sen (IDR × 100). Journals are posted GL entries
 * (source of truth), not soft recomputed sales export.
 */
@Controller('integrations/gl')
export class IntegrationsGlController {
  constructor(private readonly gl: GlService) {}

  /** Default CoA code dictionary for mapping to Accurate / Jurnal / Xero / etc. */
  @Get('account-map')
  @RequirePermissions('admin.finance.read')
  accountMap() {
    return this.gl.accountCodeMap();
  }

  @Get('accounts')
  @RequirePermissions('admin.finance.read')
  listAccounts(@Query('includeInactive') includeInactive?: string) {
    return this.gl.listAccounts(includeInactive === '1' || includeInactive === 'true');
  }

  @Get('accounts/:idOrCode')
  @RequirePermissions('admin.finance.read')
  getAccount(@Param('idOrCode') idOrCode: string) {
    return this.gl.getAccount(idOrCode);
  }

  @Post('accounts')
  @RequirePermissions('admin.finance.write')
  createAccount(
    @Body() body: { code: string; name: string; type: GlAccountType },
  ) {
    return this.gl.createAccount(body);
  }

  @Patch('accounts/:id')
  @RequirePermissions('admin.finance.write')
  updateAccount(
    @Param('id') id: string,
    @Body() body: { code?: string; name?: string; type?: GlAccountType },
  ) {
    return this.gl.updateAccount(id, body);
  }

  @Post('accounts/:id/deactivate')
  @RequirePermissions('admin.finance.write')
  deactivate(@Param('id') id: string) {
    return this.gl.setAccountActive(id, false);
  }

  @Post('accounts/:id/activate')
  @RequirePermissions('admin.finance.write')
  activate(@Param('id') id: string) {
    return this.gl.setAccountActive(id, true);
  }

  /**
   * Cursor-paginated posted journals.
   * Query: from, to (ISO or YYYY-MM-DD), sourceType, cursor, limit (max 200).
   */
  @Get('journals')
  @RequirePermissions('admin.finance.read')
  listJournals(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('sourceType') sourceType?: JournalSourceType,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.gl.queryEntries({
      from,
      to,
      sourceType,
      cursor,
      limit: limit ? Number(limit) : 50,
    });
  }

  @Get('journals/by-source/:sourceType/:sourceId')
  @RequirePermissions('admin.finance.read')
  getBySource(
    @Param('sourceType') sourceType: JournalSourceType,
    @Param('sourceId') sourceId: string,
  ) {
    return this.gl.getEntryBySource(sourceType, sourceId);
  }

  @Get('journals/:id')
  @RequirePermissions('admin.finance.read')
  getJournal(@Param('id') id: string) {
    return this.gl.getEntry(id);
  }

  /**
   * Post a balanced MANUAL journal (adjusting entry).
   * Pass `Idempotency-Key` header or body.sourceId for safe retries.
   */
  @Post('journals')
  @RequirePermissions('admin.finance.write')
  postManual(
    @Body()
    body: {
      sourceId?: string;
      memo?: string | null;
      lines: Array<{
        accountCode: string;
        debitInCents: number;
        creditInCents: number;
        memo?: string | null;
      }>;
    },
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.gl.postManualEntry({
      sourceId: body.sourceId?.trim() || idempotencyKey?.trim() || '',
      memo: body.memo,
      lines: body.lines ?? [],
    });
  }
}
