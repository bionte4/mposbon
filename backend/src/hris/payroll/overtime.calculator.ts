/**
 * Overtime pay calculator — isolated from tax and orchestration.
 * All amounts are INTEGER smallest currency units. Never float.
 *
 * Default policy (injectable): first OT_TIER1_MINUTES at rate1Bps of hourly,
 * remaining at rate2Bps. Hourly = monthlyBase / (workDays * dailyHours * 60) * 60
 * simplified as monthlyBase / MONTHLY_WORK_MINUTES.
 */

export type OvertimePolicy = {
  /** Assumed paid work minutes per month for hourly conversion (e.g. 173 hours × 60). */
  monthlyWorkMinutes: number;
  /** Minutes paid at first OT multiplier (e.g. first 60 minutes). */
  tier1Minutes: number;
  /** Basis points over hourly rate for tier 1 (15000 = 1.5×). */
  tier1RateBps: number;
  /** Basis points over hourly rate for remaining OT (20000 = 2×). */
  tier2RateBps: number;
};

/** Indonesian common retail default — replace via PayrollPolicy without code changes. */
export const DEFAULT_OVERTIME_POLICY: OvertimePolicy = {
  monthlyWorkMinutes: 173 * 60,
  tier1Minutes: 60,
  tier1RateBps: 15000,
  tier2RateBps: 20000,
};

export type OvertimeInput = {
  baseSalaryInCents: number;
  overtimeMinutes: number;
  policy?: OvertimePolicy;
};

export type OvertimeResult = {
  hourlyRateInCents: number;
  tier1Minutes: number;
  tier2Minutes: number;
  overtimePayInCents: number;
  policy: OvertimePolicy;
};

function assertNonNegInt(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

/** Integer half-up: floor((n + d/2) / d) */
function mulBps(amount: number, bps: number): number {
  return Math.floor((amount * bps + 5000) / 10000);
}

export function calculateOvertimePay(input: OvertimeInput): OvertimeResult {
  const base = assertNonNegInt(input.baseSalaryInCents, 'baseSalaryInCents');
  const otMinutes = assertNonNegInt(input.overtimeMinutes, 'overtimeMinutes');
  const policy = input.policy ?? DEFAULT_OVERTIME_POLICY;

  if (policy.monthlyWorkMinutes < 1 || !Number.isInteger(policy.monthlyWorkMinutes)) {
    throw new Error('monthlyWorkMinutes must be a positive integer');
  }

  // Hourly rate in sen: floor(base / (monthlyMinutes/60)) = floor(base * 60 / monthlyMinutes)
  const hourlyRateInCents = Math.floor((base * 60) / policy.monthlyWorkMinutes);
  const minuteRateInCents = Math.floor(hourlyRateInCents / 60);

  const tier1Minutes = Math.min(otMinutes, policy.tier1Minutes);
  const tier2Minutes = Math.max(0, otMinutes - policy.tier1Minutes);

  const tier1Pay = mulBps(minuteRateInCents * tier1Minutes, policy.tier1RateBps);
  const tier2Pay = mulBps(minuteRateInCents * tier2Minutes, policy.tier2RateBps);

  return {
    hourlyRateInCents,
    tier1Minutes,
    tier2Minutes,
    overtimePayInCents: tier1Pay + tier2Pay,
    policy,
  };
}
