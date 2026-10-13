import { describe, expect, it } from 'vitest';
import { FINITE_FACET_RECORDS } from '../src/inference/facets.ts';
import { FINITE_INFERENCE_BUCKETS, finiteInferenceLanguages, inferFiniteBucket } from '../src/inference/index.ts';
import type { Clause } from '../src/tokenizer.ts';
import type { BucketName, SupportedLanguage } from '../src/types.ts';

const LOCALES = ['ro', 'hu', 'et', 'lv', 'lt'] as const;
const EN_ONLY = 'Construction';
const EN_ONLY_KEYS = ['sector:construction'];
const structured = (text: string): Clause[] => [{ text, source: 'structured' }];
const prose = (text: string): Clause[] => [{ text, source: 'text' }];
const keys = (bucket: BucketName, clauses: Clause[], languages?: SupportedLanguage[]) =>
  inferFiniteBucket(bucket, clauses, languages).map((t) => t.canonicalKey).sort();

describe('English last-resort fallback for structured clauses', () => {
  it('applies to structured values when the locale rules find nothing', () => {
    for (const locale of LOCALES) {
      expect(keys('schedule', structured('Shift work'), [locale])).toEqual(['schedule:rotational_shift']);
      expect(keys('job_function', structured('Customer Service'), [locale])).toEqual(['job_function:customer_support']);
    }
  });

  it('reaches en-only facet records, not just any-locale ones', () => {
    for (const locale of LOCALES) expect(keys('sector', structured(EN_ONLY), [locale])).toEqual(EN_ONLY_KEYS);
  });

  it('applies when the locale is known but unsupported', () => {
    const languages = finiteInferenceLanguages('xx');
    expect(languages).toEqual([]);
    expect(keys('job_function', structured('Customer Service'), languages)).toEqual(['job_function:customer_support']);
  });

  it('never applies to prose clauses', () => {
    for (const locale of LOCALES) {
      expect(keys('sector', prose(EN_ONLY), [locale])).toEqual([]);
    }
  });

  it('never applies when any clause in the set is not structured', () => {
    const mixed: Clause[] = [...structured(EN_ONLY), ...prose('lorem')];
    for (const locale of LOCALES) expect(keys('sector', mixed, [locale])).toEqual([]);
  });

  it('never overrides a locale result with an English one', () => {
    const roFull = keys('employment', structured('Program Full Time'), ['ro']);
    expect(roFull).toEqual(['employment:full_time']);
    expect(keys('employment', prose('Program Full Time'), ['ro'])).toEqual(roFull);
  });

  it('does not fall back when English is already in scope', () => {
    expect(keys('schedule', structured('Shift work'), ['en'])).toEqual(['schedule:rotational_shift']);
    expect(keys('sector', structured(EN_ONLY), ['en'])).toEqual(EN_ONLY_KEYS);
  });

  it('abstains on non-signal structured values in every bucket and locale', () => {
    for (const bucket of FINITE_INFERENCE_BUCKETS) {
      for (const locale of LOCALES) {
        for (const text of ['null', 'Other', 'lorem ipsum dolor', '']) {
          expect(keys(bucket, structured(text), [locale]), `${bucket}/${locale}/${text}`).toEqual([]);
        }
      }
    }
  });

  it('gives every English facet surface a result on every locale: local rules win, else English', () => {
    const failures: string[] = [];
    const english = FINITE_FACET_RECORDS.filter((r) => r.locale === 'en' || r.locale === 'any');
    for (const record of english) {
      for (const surface of record.surfaces) {
        for (const locale of LOCALES) {
          const local = keys(record.bucket, prose(surface), [locale]);
          const expected = local.length ? local : keys(record.bucket, structured(surface), ['en']);
          const actual = keys(record.bucket, structured(surface), [locale]);
          if (JSON.stringify(actual) !== JSON.stringify(expected)) failures.push(`${record.bucket}/${locale}/${surface}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
