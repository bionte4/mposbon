import { Injectable } from '@nestjs/common';
import { calculateOvertimePay, type OvertimePolicy } from './overtime.calculator';
import { calculatePph21Monthly, type Pph21Policy } from './pph21.calculator';

export type PayrollCalcInput = {
  baseSalaryInCents: number;
  overtimeMinutes: number;
  ptkpStatus: string;
  presentDays: number;
  overtimePolicy?: OvertimePolicy;
  pph21Policy?: Pph21Policy;
};

export type PayrollCalcResult = {
  baseSalaryInCents: number;
  overtimeMinutes: number;
  overtimePayInCents: number;
  grossInCents: number;
  pph21InCents: number;
  netInCents: number;
  presentDays: number;
  breakdown: {
    overtime: ReturnType<typeof calculateOvertimePay>;
    pph21: ReturnType<typeof calculatePph21Monthly>;
  };
};

/**
 * Orchestrates isolated overtime + PPh 21 calculators.
 * No tax rates or OT multipliers live in this class — only wiring.
 */
@Injectable()
export class PayrollService {
  calculate(input: PayrollCalcInput): PayrollCalcResult {
    if (!Number.isInteger(input.baseSalaryInCents) || input.baseSalaryInCents < 0) {
      throw new Error('baseSalaryInCents must be a non-negative integer');
    }
    if (!Number.isInteger(input.overtimeMinutes) || input.overtimeMinutes < 0) {
      throw new Error('overtimeMinutes must be a non-negative integer');
    }
    if (!Number.isInteger(input.presentDays) || input.presentDays < 0) {
      throw new Error('presentDays must be a non-negative integer');
    }

    const overtime = calculateOvertimePay({
      baseSalaryInCents: input.baseSalaryInCents,
      overtimeMinutes: input.overtimeMinutes,
      policy: input.overtimePolicy,
    });

    const grossInCents = input.baseSalaryInCents + overtime.overtimePayInCents;

    const pph21 = calculatePph21Monthly({
      monthlyGrossInCents: grossInCents,
      ptkpStatus: input.ptkpStatus,
      policy: input.pph21Policy,
    });

    const netInCents = grossInCents - pph21.monthlyWithholdingInCents;
    if (netInCents < 0) {
      throw new Error('Net pay would be negative — check tax policy inputs');
    }

    return {
      baseSalaryInCents: input.baseSalaryInCents,
      overtimeMinutes: input.overtimeMinutes,
      overtimePayInCents: overtime.overtimePayInCents,
      grossInCents,
      pph21InCents: pph21.monthlyWithholdingInCents,
      netInCents,
      presentDays: input.presentDays,
      breakdown: { overtime, pph21 },
    };
  }
}
