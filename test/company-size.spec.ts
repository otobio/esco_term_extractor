import { describe, expect, it } from 'vitest';
import { inferCompanySize } from '../src/inference/company-size.ts';
import type { Clause } from '../src/tokenizer.ts';

const C = (t: string): Clause[] => [{ text: t, source: 'text' }];
const keys = (t: string) => inferCompanySize(C(t)).map((x) => x.canonicalKey);

describe('company_size inference — stage words', () => {
  it('reads explicit stage words (multilingual)', () => {
    expect(keys('companie multinationala cu capital german')).toContain('company_size:global');
    expect(keys("we're a fast-growing consumer scaleup")).toContain('company_size:mid_growing');
    expect(keys('IMM din Cluj')).toContain('company_size:small');
    expect(keys('join our startup')).toContain('company_size:startup');
    expect(keys('a stable, established company based in the city center')).toContain('company_size:mid_stable');
    expect(keys('a global corporation with offices worldwide')).toContain('company_size:global');
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
  it('ignores reach/expansion phrasing that is not about headcount', () => {
    expect(keys('growing our global market presence')).toEqual([]);
    expect(keys('expanding our global footprint')).toEqual([]);
  });
});

describe('company_size inference — employee-count tier boundaries', () => {
  const LOCALE_EMPLOYEE_WORD: Record<string, string> = {
    en: 'employees',
    ro: 'angajati',
    hu: 'alkalmazott',
    et: 'tootajat',
  };

  const BOUNDARIES: [number, string][] = [
    [10, 'company_size:startup'],
    [11, 'company_size:small'],
    [50, 'company_size:small'],
    [51, 'company_size:mid_growing'],
    [200, 'company_size:mid_growing'],
    [201, 'company_size:mid_stable'],
    [500, 'company_size:mid_stable'],
    [501, 'company_size:large'],
    [1000, 'company_size:large'],
    [1001, 'company_size:enterprise'],
    [5000, 'company_size:enterprise'],
    [5001, 'company_size:global'],
  ];

  for (const [locale, word] of Object.entries(LOCALE_EMPLOYEE_WORD)) {
    for (const [count, expectedKey] of BOUNDARIES) {
      it(`[${locale}] ${count} ${word} → ${expectedKey}`, () => {
        expect(keys(`${count} ${word}`)).toContain(expectedKey);
      });
    }
  }

  it('maps "team of N" framings the same way', () => {
    expect(keys('team of 5 people')).toContain('company_size:startup');
    expect(keys('team of 20 people')).toContain('company_size:small');
    expect(keys('echipa de 100 de oameni')).toContain('company_size:mid_growing');
  });

  it('does not treat non-employee counts as size', () => {
    expect(keys('over 5000 clients worldwide')).toEqual([]);
    expect(keys('present in 40 countries')).toEqual([]);
    expect(keys('peste 400 de magazine')).toEqual([]);
  });
});
