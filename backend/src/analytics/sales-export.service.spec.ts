import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { SalesExportService } from './sales-export.service';

describe('SalesExportService.journalLinesForSale', () => {
  it('balances tender + discount = sales + tax', () => {
    const lines = SalesExportService.journalLinesForSale({
      saleId: 's1',
      paymentMethod: 'CASH',
      subtotalInCents: 10000,
      taxInCents: 1100,
      discountInCents: 500,
      totalInCents: 10600,
      status: 'COMPLETED',
    });
    const debit = lines.reduce((s, l) => s + l.debitInCents, 0);
    const credit = lines.reduce((s, l) => s + l.creditInCents, 0);
    assert.equal(debit, credit);
    assert.equal(debit, 11100);
  });

  it('reverses voided sales', () => {
    const lines = SalesExportService.journalLinesForSale({
      saleId: 's2',
      paymentMethod: 'QRIS',
      subtotalInCents: 8000,
      taxInCents: 0,
      discountInCents: 0,
      totalInCents: 8000,
      status: 'VOIDED',
    });
    assert.equal(lines[0]?.creditInCents, 8000);
    assert.equal(lines[0]?.debitInCents, 0);
    assert.match(lines[0]?.memo ?? '', /VOIDED/);
  });
});
