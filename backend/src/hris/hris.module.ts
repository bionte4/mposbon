import { Module } from '@nestjs/common';
import { HrisController } from './hris.controller';
import { HrisPayrollFacade } from './hris-payroll.facade';
import { HrisService } from './hris.service';
import { PayrollService } from './payroll/payroll.service';

@Module({
  controllers: [HrisController],
  providers: [HrisService, PayrollService, HrisPayrollFacade],
  exports: [HrisService, PayrollService],
})
export class HrisModule {}
