import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createCorsOriginDelegate,
  normalizeOrigin,
  parseCorsAllowlist,
} from '../cors-allowlist';

describe('cors allowlist', () => {
  it('normalizes trailing slashes', () => {
    assert.equal(normalizeOrigin('http://localhost:8080/'), 'http://localhost:8080');
  });

  it('merges FRONTEND_URL and CSV without duplicates', () => {
    const list = parseCorsAllowlist(
      'http://localhost',
      'http://localhost,http://localhost:8080, http://app.example.com/',
    );
    assert.deepEqual(list, [
      'http://localhost',
      'http://localhost:8080',
      'http://app.example.com',
    ]);
  });

  it('allows listed browser origins and rejects others', () => {
    const decide = createCorsOriginDelegate([
      'http://localhost',
      'https://pos.example.com',
    ]);

    decide('http://localhost', (err, ok) => {
      assert.equal(err, null);
      assert.equal(ok, true);
    });

    decide('https://pos.example.com/', (err, ok) => {
      assert.equal(err, null);
      assert.equal(ok, true);
    });

    decide('https://evil.example', (err, ok) => {
      assert.ok(err instanceof Error);
      assert.equal(ok, false);
    });

    decide(undefined, (err, ok) => {
      assert.equal(err, null);
      assert.equal(ok, true);
    });
  });
});
