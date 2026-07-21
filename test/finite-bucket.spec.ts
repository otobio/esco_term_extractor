import { describe, expect, it } from 'vitest';
import { inferCompanyType } from '../src/inference/company-type.ts';
import { facetCollisionErrors } from '../src/inference/facets.ts';
import { finalizeFinite, type ResolvedTerm } from '../src/matchers/finite.ts';
import type { Clause } from '../src/tokenizer.ts';

const C = (t: string): Clause[] => [{ text: t, source: 'text' }];

describe('finalizeFinite — unions OS resolution with rule inference for finite buckets', () => {
  it('promotes an OS-side ambiguous key to resolved when inference confirms it, leaving unconfirmed siblings ambiguous', () => {
    const os: ResolvedTerm[] = [
      {
        key: 'company_type:manufacturing',
        name: 'Manufacturing',
        score: 0.5,
        lang: 'ro',
        status: 'ambiguous',
        span: 'Producție',
      },
      { key: 'company_type:factory', name: 'Factory', score: 0.5, lang: 'ro', status: 'ambiguous', span: 'Producție' },
    ];
    const result = finalizeFinite('company_type', os, C('Producție'), { locale: 'ro' });
    expect(result.find((t) => t.key === 'company_type:manufacturing')?.status).toBe('resolved');
    expect(result.find((t) => t.key === 'company_type:factory')?.status).toBe('ambiguous');
  });

  it('adds a fresh resolved term when inference finds a key OS never surfaced at all', () => {
    const result = finalizeFinite('company_type', [], C('Producție'), { locale: 'ro' });
    expect(result.find((t) => t.key === 'company_type:manufacturing')?.status).toBe('resolved');
  });

  it('leaves OS results untouched when inference finds nothing for the clause', () => {
    const os: ResolvedTerm[] = [
      { key: 'company_type:startup', name: 'Startup', score: 0.5, lang: 'ro', status: 'ambiguous', span: 'blah' },
    ];
    const result = finalizeFinite('company_type', os, C('some unrelated clause with no signal'), { locale: 'ro' });
    expect(result).toEqual(os);
  });
});

describe('facets.ts buildLookup — locale-scoped registration', () => {
  it('resolves a RO facet surface that normalizes identically to an EN surface, without either shadowing the other', () => {
    const roKeys = inferCompanyType(C('IT / Telecom'), ['ro']).map((x) => x.canonicalKey);
    expect(roKeys).toContain('company_type:information_technology');
    expect(roKeys).toContain('company_type:telecom');
  });

  it('resolves the equivalent EN facet surface independently of the RO registration', () => {
    const enKeys = inferCompanyType(C('IT & Telecoms'), ['en']).map((x) => x.canonicalKey);
    expect(enKeys).toContain('company_type:information_technology');
    expect(enKeys).toContain('company_type:telecom');
  });

  it('reports no collisions across the full production facet table', () => {
    expect(facetCollisionErrors()).toEqual([]);
  });
});
