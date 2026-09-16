import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { RequirePermissions } from '../auth/rbac.guard';
import { ClockInInput, ClockOutInput, ShiftService } from './shift.service';

@Controller('shifts')
export class ShiftController {
  constructor(private readonly shifts: ShiftService) {}

  @Get('active')
  @RequirePermissions('shift.clock')
  active() {
    return this.shifts.getActiveForActor();
  }

  @Get('archive')
  @RequirePermissions('shift.z_report')
  archive(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('storeId') storeId?: string,
    @Query('status') status?: 'OPEN' | 'CLOSED' | 'ALL',
  ) {
    return this.shifts.listArchive({ from, to, storeId, status });
  }

  @Post('clock-in')
  @RequirePermissions('shift.clock')
  clockIn(@Body() body: ClockInInput) {
    return this.shifts.clockIn(body);
  }

  @Post('clock-out')
  @RequirePermissions('shift.clock')
  clockOut(@Body() body: ClockOutInput) {
    return this.shifts.clockOut(body);
  }

  @Post(':id/cash-drop')
  @RequirePermissions('shift.clock')
  cashDrop(
    @Param('id') id: string,
    @Body() body: { amountInCents: number; note?: string },
  ) {
    return this.shifts.cashDrop({
      shiftId: id,
      amountInCents: body.amountInCents,
      note: body.note,
    });
  }

  @Post(':id/mid-count')
  @RequirePermissions('shift.clock')
  midCount(
    @Param('id') id: string,
    @Body() body: { countedCashInCents: number; note?: string },
  ) {
    return this.shifts.midCount({
      shiftId: id,
      countedCashInCents: body.countedCashInCents,
      note: body.note,
    });
  }

  @Get(':id/movements')
  @RequirePermissions('shift.clock')
  movements(@Param('id') id: string) {
    return this.shifts.listMovements(id);
  }

  /** Mid-shift X-Report (OPEN only) — does not close the drawer. */
  @Get(':id/x-report')
  @RequirePermissions('shift.z_report')
  xReport(@Param('id') id: string) {
    return this.shifts.getShiftReport(id, 'X');
  }

  @Get(':id/z-report')
  @RequirePermissions('shift.z_report')
  zReport(@Param('id') id: string) {
    return this.shifts.getShiftReport(id, 'Z');
  }
}
