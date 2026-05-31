import { describe, it, expect } from 'vitest';
import { bundleConstructor } from './bundle-constructor.js';
import { MAX_BUNDLE_SIZE, MIN_TIP_LAMPORTS, BundleStatus } from '@solstice/shared';
import type { VersionedTransaction } from '@solana/web3.js';

// validate() only inspects array length and tip magnitude, so opaque
// placeholders stand in for real versioned transactions here.
const tx = () => ({}) as unknown as VersionedTransaction;

describe('BundleConstructor.validate', () => {
  it('rejects an empty bundle', () => {
    expect(bundleConstructor.validate([], 10_000)).toMatch(/at least 1/i);
  });

  it('rejects a bundle larger than the Jito limit', () => {
    const txs = Array.from({ length: MAX_BUNDLE_SIZE + 1 }, tx);
    expect(bundleConstructor.validate(txs, 10_000)).toMatch(/maximum size/i);
  });

  it('rejects a tip below the minimum', () => {
    expect(bundleConstructor.validate([tx()], MIN_TIP_LAMPORTS - 1)).toMatch(
      /below minimum/i,
    );
  });

  it('accepts a valid single-transaction bundle', () => {
    expect(bundleConstructor.validate([tx()], MIN_TIP_LAMPORTS)).toBeNull();
  });
});

describe('BundleConstructor helpers', () => {
  it('returns a tip account from the pool', () => {
    expect(typeof bundleConstructor.getRandomTipAccount()).toBe('string');
    expect(bundleConstructor.getRandomTipAccount().length).toBeGreaterThan(0);
  });

  it('builds a tracking record in the CREATED state', () => {
    const record = bundleConstructor.createRecord([tx()], 12_345, 'TipAcct111');
    expect(record.status).toBe(BundleStatus.CREATED);
    expect(record.tipLamports).toBe(12_345);
    expect(record.bundleId).toBeNull();
    expect(record.id).toMatch(/^bnd_/);
  });
});
