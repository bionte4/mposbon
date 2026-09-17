import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { GlAccountType } from '@prisma/client';
import { RequirePermissions } from '../auth/rbac.guard';
import { GlService } from './gl.service';

@Controller('gl')
export class GlController {
  constructor(private readonly gl: GlService) {}

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

  @Get('entries')
  @RequirePermissions('admin.finance.read')
  listEntries(@Query('limit') limit?: string) {
    return this.gl.listEntries(limit ? Number(limit) : 50);
  }
}
