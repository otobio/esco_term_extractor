import { describe, expect, it } from 'vitest';
import { inferCompanySize } from '../src/inference/company-size.ts';
import type { Clause } from '../src/tokenizer.ts';

const C = (t: string): Clause[] => [{ text: t, source: 'text' }];
const keys = (t: string) => inferCompanySize(C(t)).map((x) => x.canonicalKey);

describe('company_size inference — stage words', () => {
  it('reads explicit stage words (multilingual)', () => {
    expect(keys('companie multinationala cu capital german')).toContain('company_size:enterprise');
    expect(keys("we're a fast-growing consumer scaleup")).toContain('company_size:scaleup');
    expect(keys('IMM din Cluj')).toContain('company_size:scaleup');
    expect(keys('join our startup')).toContain('company_size:startup');
  });
  it('ignores stage words that describe a product/culture, not the company', () => {
    expect(keys('experience with enterprise software')).toEqual([]);
    expect(keys('managing strategic enterprise accounts')).toEqual([]);
    expect(keys('we value a startup mindset')).toEqual([]);
  });
  it('ignores a customer/target segment', () => {
    expect(keys('servicii adresate segmentului Small Business')).toEqual([]);
    expect(keys('solutii pentru IMM')).toEqual([]);
  });
});

describe('company_size inference — employee counts', () => {
  it('maps employee counts to a stage', () => {
    expect(keys('team of 20 people')).toContain('company_size:startup'); // <50
    expect(keys('peste 200 de angajati')).toContain('company_size:scaleup'); // 50-249
    expect(keys('500 employees across Bucharest')).toContain('company_size:enterprise'); // >=250
  });
  it('does not treat non-employee counts as size', () => {
    expect(keys('over 5000 clients worldwide')).toEqual([]);
    expect(keys('present in 40 countries')).toEqual([]);
    expect(keys('peste 400 de magazine')).toEqual([]);
  });
});
