import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { AttendanceStatus, PtkpStatus } from '@prisma/client';
import { RequirePermissions } from '../auth/rbac.guard';
import { HrisPayrollFacade } from './hris-payroll.facade';
import {
  CreateEmployeeInput,
  CreateWorkShiftInput,
  HrisService,
  UpdateEmployeeInput,
  UpdateWorkShiftInput,
  UpsertAttendanceInput,
} from './hris.service';

@Controller('hris')
export class HrisController {
  constructor(
    private readonly hris: HrisService,
    private readonly payrollFacade: HrisPayrollFacade,
  ) {}

  @Get('employees')
  @RequirePermissions('hris.employee.read')
  listEmployees() {
    return this.hris.listEmployees();
  }

  @Post('employees')
  @RequirePermissions('hris.employee.write')
  createEmployee(@Body() body: CreateEmployeeInput) {
    return this.hris.createEmployee(body);
  }

  @Patch('employees/:id')
  @RequirePermissions('hris.employee.write')
  updateEmployee(@Param('id') id: string, @Body() body: UpdateEmployeeInput) {
    return this.hris.updateEmployee(id, body);
  }

  @Get('work-shifts')
  @RequirePermissions('hris.work_shift.read')
  listWorkShifts() {
    return this.hris.listWorkShifts();
  }

  @Post('work-shifts')
  @RequirePermissions('hris.work_shift.write')
  createWorkShift(@Body() body: CreateWorkShiftInput) {
    return this.hris.createWorkShift(body);
  }

  @Patch('work-shifts/:id')
  @RequirePermissions('hris.work_shift.write')
  updateWorkShift(@Param('id') id: string, @Body() body: UpdateWorkShiftInput) {
    return this.hris.updateWorkShift(id, body);
  }

  @Get('attendances')
  @RequirePermissions('hris.attendance.read')
  listAttendances(@Query('from') from?: string, @Query('to') to?: string) {
    return this.hris.listAttendances(from, to);
  }

  @Put('attendances')
  @RequirePermissions('hris.attendance.write')
  upsertAttendance(@Body() body: UpsertAttendanceInput) {
    return this.hris.upsertAttendance(body);
  }

  @Get('payroll/slips')
  @RequirePermissions('hris.payroll.read')
  listSlips(@Query('year') year?: string, @Query('month') month?: string) {
    return this.payrollFacade.listSlips(
      year ? Number.parseInt(year, 10) : undefined,
      month ? Number.parseInt(month, 10) : undefined,
    );
  }

  @Post('payroll/calculate')
  @RequirePermissions('hris.payroll.calculate')
  calculate(
    @Body() body: { employeeId: string; periodYear: number; periodMonth: number },
  ) {
    return this.payrollFacade.calculateForEmployee(body);
  }

  @Post('payroll/slips/:id/finalize')
  @RequirePermissions('hris.payroll.calculate')
  finalize(@Param('id') id: string) {
    return this.payrollFacade.finalize(id);
  }
}

/** Re-export enums for OpenAPI-ish clients (optional typing aid). */
export type HrisEnums = {
  PtkpStatus: PtkpStatus;
  AttendanceStatus: AttendanceStatus;
};
