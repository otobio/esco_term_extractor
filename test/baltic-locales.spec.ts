import { describe, expect, it } from 'vitest';
import { inferFiniteBucket, isSupportedLanguage } from '../src/inference/index.ts';
import { extractSalary } from '../src/salary/salary.ts';
import type { Clause } from '../src/tokenizer.ts';
import type { BucketName, SupportedLanguage } from '../src/types.ts';

const C = (t: string): Clause[] => [{ text: t, source: 'text' }];
const keys = (bucket: BucketName, text: string, languages?: SupportedLanguage[]) =>
  inferFiniteBucket(bucket, C(text), languages).map((t) => t.canonicalKey);

describe('lv / lt language support', () => {
  it('recognises lv and lt as supported languages', () => {
    expect(isSupportedLanguage('lv')).toBe(true);
    expect(isSupportedLanguage('lt')).toBe(true);
  });

  it('maps category taxonomy labels to job_function and sector', () => {
    expect(keys('job_function', 'Būvniecība / Nekustamais īpašums (12)', ['lv'])).toEqual([
      'job_function:skilled_trades',
    ]);
    expect(keys('sector', 'Būvniecība / Nekustamais īpašums', ['lv'])).toEqual([
      'sector:construction',
      'sector:real_estate_property',
    ]);
    expect(keys('job_function', 'Marketingas / Reklama / PR', ['lt'])).toEqual(['job_function:marketing_communications']);
    expect(keys('job_function', 'Banking / Insurance', ['en'])).toEqual(['job_function:banking', 'job_function:insurance']);
    expect(keys('sector', 'Work at sea', ['en'])).toEqual(['sector:transportation']);
  });

  it('abstains on "Other" and on a label outside the requested locale', () => {
    expect(keys('job_function', 'Other', ['en'])).toEqual([]);
    expect(keys('job_function', 'Klientų aptarnavimas', ['lv'])).toEqual([]);
  });

  it('infers employment from lv/lt idioms without part/full-time cross-talk', () => {
    expect(keys('employment', 'Darbs uz pilnu slodzi')).toContain('employment:full_time');
    expect(keys('employment', 'Darbs uz nepilnu slodzi')).toEqual(['employment:part_time']);
    expect(keys('employment', 'Neterminuota darbo sutartis')).toEqual(['employment:full_time']);
    expect(keys('employment', 'Terminuota darbo sutartis')).toEqual(['employment:temporary']);
  });

  it('reads class-first driving licence phrasing', () => {
    expect(keys('qualifications', 'B kategorijas vadītāja apliecība')).toContain(
      'qualification:license:driving_license_b',
    );
    expect(keys('qualifications', 'B kategorijos vairuotojo pažymėjimas')).toContain(
      'qualification:license:driving_license_b',
    );
    expect(keys('qualifications', 'B kategorijas preces')).not.toContain('qualification:license:driving_license_b');
  });

  it('requires language context for lv/lt language names', () => {
    expect(keys('qualifications', 'Angļu valodas zināšanas')).toContain('qualification:language_requirement:english');
    expect(keys('qualifications', 'Anglų kalbos žinios')).toContain('qualification:language_requirement:english');
  });

  it('parses lv/lt salary ranges', () => {
    expect(extractSalary('Atalgojums no 1200 līdz 1500 EUR mēnesī')[0]).toMatchObject({
      minAmount: 1200,
      maxAmount: 1500,
      currency: 'EUR',
      period: 'month',
    });
    expect(extractSalary('Atlyginimas nuo 1800 iki 2400 EUR bruto')[0]).toMatchObject({
      minAmount: 1800,
      maxAmount: 2400,
      taxMode: 'gross',
    });
  });

  it('does not read turnover as salary', () => {
    expect(extractSalary('Uzņēmuma apgrozījums 5000000 EUR')).toEqual([]);
  });
});
