/**
 * Integer-only money helpers. Never pass IEEE-754 floats into these functions.
 * Amounts are smallest currency units (IDR: whole rupiah stored as integer).
 */
export function assertInt(value: number, label: string): number {
  if (!Number.isInteger(value)) {
    throw new Error(`${label} must be an integer (smallest currency unit)`);
  }
  return value;
}

export function multiplyQty(unitPriceInCents: number, quantity: number): number {
  assertInt(unitPriceInCents, 'unitPriceInCents');
  assertInt(quantity, 'quantity');
  if (quantity < 1) {
    throw new Error('quantity must be >= 1');
  }
  if (unitPriceInCents < 0) {
    throw new Error('unitPriceInCents must be >= 0');
  }
  return unitPriceInCents * quantity;
}

/** taxBps 1100 = 11.00%. Half-up to nearest sen using integer division only. */
export function taxAmountInCents(baseInCents: number, taxBps: number): number {
  assertInt(baseInCents, 'baseInCents');
  assertInt(taxBps, 'taxBps');
  if (baseInCents < 0 || taxBps < 0) {
    throw new Error('tax inputs must be >= 0');
  }
  return Math.floor((baseInCents * taxBps + 5000) / 10000);
}

export type LineMoney = {
  lineSubtotalInCents: number;
  taxInCents: number;
  lineTotalInCents: number;
};

export function lineMoney(unitPriceInCents: number, quantity: number, taxBps: number): LineMoney {
  const lineSubtotalInCents = multiplyQty(unitPriceInCents, quantity);
  const taxInCents = taxAmountInCents(lineSubtotalInCents, taxBps);
  return {
    lineSubtotalInCents,
    taxInCents,
    lineTotalInCents: lineSubtotalInCents + taxInCents,
  };
}

export function sumCents(values: number[]): number {
  return values.reduce((acc, value) => acc + assertInt(value, 'cents'), 0);
}
