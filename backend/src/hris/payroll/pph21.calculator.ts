/**
 * PPh 21 monthly withholding — isolated progressive tax engine.
 * Brackets and PTKP amounts are DATA (injected), never embedded in the formula.
 * Reference shape: classic annual progressive rates applied to annualized income.
 * All money = INTEGER smallest currency units (IDR rupiah). Never float.
 */

export type Pph21Bracket = {
  /** Upper bound of this bracket in annual taxable income. null = unlimited. */
  upToInCents: number | null;
  /** Rate in basis points (500 = 5%). */
  rateBps: number;
};

export type PtkpTable = Record<string, number>;

export type Pph21Policy = {
  /** Annual PTKP by status code (TK0, K1, …). */
  ptkpAnnualInCents: PtkpTable;
  /** Progressive annual brackets (ordered ascending). */
  brackets: Pph21Bracket[];
  /** Months in a tax year (normally 12). */
  monthsPerYear: number;
};

/**
 * Illustrative progressive rates + PTKP for demo (swap via config/DB anytime).
 * TK0 PTKP = Rp 54.000.000 stored as integer 54000000.
 */
export const DEFAULT_PPH21_POLICY: Pph21Policy = {
  monthsPerYear: 12,
  ptkpAnnualInCents: {
    TK0: 54_000_000,
    TK1: 58_500_000,
    TK2: 63_000_000,
    TK3: 67_500_000,
    K0: 58_500_000,
    K1: 63_000_000,
    K2: 67_500_000,
    K3: 72_000_000,
  },
  brackets: [
    { upToInCents: 60_000_000, rateBps: 500 },
    { upToInCents: 250_000_000, rateBps: 1500 },
    { upToInCents: 500_000_000, rateBps: 2500 },
    { upToInCents: 5_000_000_000, rateBps: 3000 },
    { upToInCents: null, rateBps: 3500 },
  ],
};

export type Pph21Input = {
  /** Monthly gross taxable compensation (salary + OT). */
  monthlyGrossInCents: number;
  ptkpStatus: string;
  policy?: Pph21Policy;
};

export type Pph21Result = {
  annualGrossInCents: number;
  ptkpInCents: number;
  annualTaxableInCents: number;
  annualTaxInCents: number;
  monthlyWithholdingInCents: number;
  bracketBreakdown: Array<{ layerInCents: number; rateBps: number; taxInCents: number }>;
};

function assertNonNegInt(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
  return value;
}

function mulBps(amount: number, bps: number): number {
  return Math.floor((amount * bps + 5000) / 10000);
}

/**
 * Annualize monthly gross, subtract PTKP, apply progressive brackets,
 * then divide annual tax by monthsPerYear for monthly withholding.
 */
export function calculatePph21Monthly(input: Pph21Input): Pph21Result {
  const monthlyGross = assertNonNegInt(input.monthlyGrossInCents, 'monthlyGrossInCents');
  const policy = input.policy ?? DEFAULT_PPH21_POLICY;
  const ptkp = policy.ptkpAnnualInCents[input.ptkpStatus];
  if (ptkp === undefined || !Number.isInteger(ptkp)) {
    throw new Error(`Unknown or invalid PTKP status: ${input.ptkpStatus}`);
  }

  const annualGrossInCents = monthlyGross * policy.monthsPerYear;
  const annualTaxableInCents = Math.max(0, annualGrossInCents - ptkp);

  let remaining = annualTaxableInCents;
  let lower = 0;
  let annualTaxInCents = 0;
  const bracketBreakdown: Pph21Result['bracketBreakdown'] = [];

  for (const bracket of policy.brackets) {
    if (remaining <= 0) {
      break;
    }
    const upper = bracket.upToInCents;
    const layerCap = upper === null ? remaining : Math.max(0, upper - lower);
    const layer = Math.min(remaining, layerCap);
    const tax = mulBps(layer, bracket.rateBps);
    bracketBreakdown.push({ layerInCents: layer, rateBps: bracket.rateBps, taxInCents: tax });
    annualTaxInCents += tax;
    remaining -= layer;
    if (upper !== null) {
      lower = upper;
    }
  }

  const monthlyWithholdingInCents = Math.floor(annualTaxInCents / policy.monthsPerYear);

  return {
    annualGrossInCents,
    ptkpInCents: ptkp,
    annualTaxableInCents,
    annualTaxInCents,
    monthlyWithholdingInCents,
    bracketBreakdown,
  };
}
