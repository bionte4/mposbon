/**
 * Cart total aggregation — integer-only. Used by POS client and unit tests.
 * total = subtotal + tax - discount + tip
 */
import { assertInt, lineMoney, sumCents } from './money';

export type CartLineInput = {
  unitPriceInCents: number;
  quantity: number;
  taxBps: number;
};

export type CartTotals = {
  lines: Array<{
    lineSubtotalInCents: number;
    taxInCents: number;
    lineTotalInCents: number;
  }>;
  subtotalInCents: number;
  taxInCents: number;
  discountInCents: number;
  tipInCents: number;
  totalInCents: number;
};

export function computeCartTotals(
  lines: CartLineInput[],
  discountInCents = 0,
  tipInCents = 0,
): CartTotals {
  assertInt(discountInCents, 'discountInCents');
  assertInt(tipInCents, 'tipInCents');
  if (discountInCents < 0) {
    throw new Error('discountInCents must be >= 0');
  }
  if (tipInCents < 0) {
    throw new Error('tipInCents must be >= 0');
  }

  const priced = lines.map((line) =>
    lineMoney(line.unitPriceInCents, line.quantity, line.taxBps),
  );
  const subtotalInCents = sumCents(priced.map((l) => l.lineSubtotalInCents));
  const taxInCents = sumCents(priced.map((l) => l.taxInCents));
  const totalInCents = subtotalInCents + taxInCents - discountInCents + tipInCents;
  if (totalInCents < 0) {
    throw new Error('Cart total would be negative after discount');
  }

  return {
    lines: priced,
    subtotalInCents,
    taxInCents,
    discountInCents,
    tipInCents,
    totalInCents,
  };
}

/** Validates client-reported totals match recomputed integer totals. */
export function assertCartTotalsMatch(
  lines: CartLineInput[],
  reported: {
    subtotalInCents: number;
    taxInCents: number;
    totalInCents: number;
    discountInCents?: number;
    tipInCents?: number;
  },
): CartTotals {
  const computed = computeCartTotals(
    lines,
    reported.discountInCents ?? 0,
    reported.tipInCents ?? 0,
  );
  if (
    computed.subtotalInCents !== reported.subtotalInCents ||
    computed.taxInCents !== reported.taxInCents ||
    computed.totalInCents !== reported.totalInCents
  ) {
    throw new Error(
      `Cart totals mismatch: expected ${JSON.stringify({
        subtotalInCents: computed.subtotalInCents,
        taxInCents: computed.taxInCents,
        totalInCents: computed.totalInCents,
      })} got ${JSON.stringify(reported)}`,
    );
  }
  return computed;
}
