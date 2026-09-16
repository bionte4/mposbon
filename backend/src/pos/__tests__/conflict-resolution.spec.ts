import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildStockConflictMessage,
  shouldApplyClientCartWrite,
} from '../conflict-resolution';

describe('conflict resolution', () => {
  it('applies LWW when client timestamp is newer', () => {
    const server = new Date('2026-09-15T10:00:00.000Z');
    assert.equal(
      shouldApplyClientCartWrite('2026-09-15T10:01:00.000Z', server),
      true,
    );
  });

  it('rejects stale client cart (last-write-wins)', () => {
    const server = new Date('2026-09-15T10:05:00.000Z');
    assert.equal(
      shouldApplyClientCartWrite('2026-09-15T10:00:00.000Z', server),
      false,
    );
  });

  it('allows write when client timestamp missing (legacy)', () => {
    assert.equal(shouldApplyClientCartWrite(null, new Date()), true);
  });

  it('formats stock conflict message without float', () => {
    const msg = buildStockConflictMessage([
      { productId: 'a', productName: 'Kopi', requested: 3, available: 1 },
    ]);
    assert.match(msg, /Kopi/);
    assert.match(msg, /3/);
    assert.match(msg, /1/);
  });
});
