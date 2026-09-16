/**
 * Integer-only money helpers.
 * Amounts are smallest currency units (for IDR: whole rupiah as INTEGER — never float).
 */

export type SupportedCurrency = 'IDR';

export type MoneyFormatOptions = {
  /** ISO 4217; default IDR */
  currency?: SupportedCurrency;
  /**
   * BCP-47 locale for digit grouping / currency symbol placement.
   * Formatting still uses integer math only (fraction digits forced to 0).
   */
  locale?: string;
  /** Compact thermal/receipt style without thin space after symbol */
  compact?: boolean;
};

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

/** Digit grouping without float / without Intl currency quirks (dot thousands). */
export function formatGroupedInteger(amount: number, groupSeparator = '.'): string {
  assertInt(amount, 'amount');
  const sign = amount < 0 ? '-' : '';
  const grouped = Math.abs(amount)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, groupSeparator);
  return `${sign}${grouped}`;
}

/**
 * Dynamic currency display for UI.
 * Always formats from integer minor units — never `amount / 100` via float.
 */
export function formatMoney(amountInCents: number, options: MoneyFormatOptions = {}): string {
  assertInt(amountInCents, 'amountInCents');
  const currency = options.currency ?? 'IDR';
  const locale = options.locale ?? (currency === 'IDR' ? 'id-ID' : 'en-US');

  if (currency === 'IDR') {
    const absGrouped = formatGroupedInteger(Math.abs(amountInCents), '.');
    const sign = amountInCents < 0 ? '-' : '';
    if (options.compact) {
      return `${sign}Rp${absGrouped}`;
    }
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0,
        minimumFractionDigits: 0,
      }).format(amountInCents);
    } catch {
      return `${sign}Rp ${absGrouped}`;
    }
  }

  throw new Error(`Unsupported currency: ${currency}`);
}

/** UI default: IDR with locale-aware symbol + thousand separators. */
export function formatIdrFromCents(amountInCents: number): string {
  return formatMoney(amountInCents, { currency: 'IDR', locale: 'id-ID' });
}

/**
 * Parse free-form IDR input into whole rupiah (integer).
 * Strips Rp/IDR symbols, spaces, thousand dots, and commas — never divides by 100.
 */
export function parseIdrInput(raw: string): number | null {
  const cleaned = raw
    .trim()
    .replace(/rp\.?/gi, '')
    .replace(/idr/gi, '')
    .replace(/[\s.]/g, '')
    .replace(/,/g, '');
  if (!cleaned.length || cleaned === '-' || cleaned === '+') return null;
  if (!/^[+-]?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!Number.isSafeInteger(n)) return null;
  return n;
}

/** Grouped digits for controlled money inputs (no currency symbol). */
export function idrInputDisplay(amount: number): string {
  if (!Number.isInteger(amount)) return '';
  return formatGroupedInteger(amount, '.');
}
