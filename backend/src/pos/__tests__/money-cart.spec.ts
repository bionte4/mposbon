import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeCartTotals, assertCartTotalsMatch } from '../cart-totals';
import { lineMoney, multiplyQty, taxAmountInCents, sumCents } from '../money';

describe('integer money helpers', () => {
  it('multiplies qty without float', () => {
    assert.equal(multiplyQty(15000, 2), 30000);
  });

  it('rejects non-integer prices', () => {
    assert.throws(() => multiplyQty(15.5 as unknown as number, 1), /integer/);
  });

  it('computes 11% tax with half-up integer math', () => {
    // 15000 * 1100 / 10000 = 1650 exactly
    assert.equal(taxAmountInCents(15000, 1100), 1650);
    // 100 * 1100 = 110000; +5000 = 115000; /10000 = 11
    assert.equal(taxAmountInCents(100, 1100), 11);
  });

  it('line totals equal subtotal + tax', () => {
    const line = lineMoney(25000, 1, 1100);
    assert.equal(line.lineSubtotalInCents, 25000);
    assert.equal(line.taxInCents, 2750);
    assert.equal(line.lineTotalInCents, 27750);
    assert.equal(line.lineTotalInCents, line.lineSubtotalInCents + line.taxInCents);
  });
});

describe('cart totals', () => {
  it('aggregates multiple lines with mixed tax rates', () => {
    const totals = computeCartTotals([
      { unitPriceInCents: 15000, quantity: 2, taxBps: 1100 }, // 30000 + 3300
      { unitPriceInCents: 18000, quantity: 1, taxBps: 0 }, // 18000 + 0
    ]);
    assert.equal(totals.subtotalInCents, 48000);
    assert.equal(totals.taxInCents, 3300);
    assert.equal(totals.totalInCents, 51300);
    assert.equal(
      totals.totalInCents,
      sumCents(totals.lines.map((l) => l.lineTotalInCents)),
    );
  });

  it('applies integer discount without float drift', () => {
    const totals = computeCartTotals(
      [{ unitPriceInCents: 10000, quantity: 1, taxBps: 0 }],
      1500,
    );
    assert.equal(totals.totalInCents, 8500);
  });

  it('rejects discount larger than cart', () => {
    assert.throws(
      () =>
        computeCartTotals([{ unitPriceInCents: 1000, quantity: 1, taxBps: 0 }], 2000),
      /negative/,
    );
  });

  it('assertCartTotalsMatch catches client drift', () => {
    const lines = [{ unitPriceInCents: 15000, quantity: 1, taxBps: 1100 }];
    assert.throws(
      () =>
        assertCartTotalsMatch(lines, {
          subtotalInCents: 15000,
          taxInCents: 1650,
          totalInCents: 16651, // off by 1
        }),
      /mismatch/,
    );
    assertCartTotalsMatch(lines, {
      subtotalInCents: 15000,
      taxInCents: 1650,
      totalInCents: 16650,
    });
  });
});
