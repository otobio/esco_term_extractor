/**
 * Structural contract test for the production ingest surface. Guards against
 * accidental drift in the bucket taxonomy, per-bucket config completeness, and
 * the company_size tier vocabulary — run in the pre-commit hook so a break
 * here blocks the commit rather than shipping.
 */
import { describe, expect, it } from 'vitest';
import { getDefaultBucketConfigs } from '../src/buckets.ts';
import { FINITE_VALUES } from '../src/finite-values.ts';
import { inferCompanySize } from '../src/inference/company-size.ts';
import type { Clause } from '../src/tokenizer.ts';
import { ALL_BUCKETS, type BucketConfig } from '../src/types.ts';

describe('ingest contract — bucket taxonomy', () => {
  it('declares company_size and collar_kind as canonical buckets', () => {
    expect(ALL_BUCKETS).toContain('company_size');
    expect(ALL_BUCKETS).toContain('collar_kind');
  });

  it('has a complete BucketConfig for every declared bucket', () => {
    const requiredFields: (keyof BucketConfig)[] = [
      'bucket',
      'matchStrategy',
      'semanticThreshold',
      'lexicalConfidence',
      'unigramCorroboration',
      'maxPerBucket',
      'openEnded',
      'titleAnchored',
    ];
    const configs = getDefaultBucketConfigs();
    for (const bucket of ALL_BUCKETS) {
      const config = configs[bucket];
      expect(config, `missing BucketConfig for "${bucket}"`).toBeDefined();
      expect(config.bucket).toBe(bucket);
      for (const field of requiredFields) {
        expect(config[field], `BucketConfig.${field} missing for "${bucket}"`).not.toBeUndefined();
      }
    }
  });
});

describe('ingest contract — company_size tier vocabulary', () => {
  const clause = (t: string): Clause[] => [{ text: t, source: 'text' }];

  it('exposes exactly the 7 canonical tier keys, sourced from the inference module itself', () => {
    const EMPLOYEE_COUNTS_BY_TIER: Record<string, number> = {
      startup: 5,
      small: 20,
      mid_growing: 100,
      mid_stable: 300,
      large: 800,
      enterprise: 2000,
      global: 10000,
    };
    const observedKeys = new Set(
      Object.values(EMPLOYEE_COUNTS_BY_TIER).flatMap((n) =>
        inferCompanySize(clause(`${n} employees`)).map((t) => t.canonicalKey),
      ),
    );
    expect(observedKeys).toEqual(new Set(Object.keys(EMPLOYEE_COUNTS_BY_TIER).map((tier) => `company_size:${tier}`)));
  });

  it('keeps FINITE_VALUES.company_size in sync with the inference module tiers', () => {
    expect(new Set(FINITE_VALUES.company_size)).toEqual(
      new Set(['startup', 'small', 'mid_growing', 'mid_stable', 'large', 'enterprise', 'global']),
    );
  });
});
