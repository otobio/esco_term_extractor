import { describe, expect, it } from 'vitest';
import { FACETED_FINITE_VALUES, FINITE_VALUES, SECTOR_LABELS } from '../src/finite-values.ts';
import { DisplayTitleStore, selectDisplayTitleEntries } from '../src/display-titles.ts';
import { facetCollisionErrors } from '../src/inference/facets.ts';
import { qualificationCanonicalKeys } from '../src/inference/qualifications.ts';
import { inferSector } from '../src/inference/sector.ts';
import { finalizeFinite, type ResolvedTerm } from '../src/matchers/finite.ts';
import type { Clause } from '../src/tokenizer.ts';

const C = (t: string): Clause[] => [{ text: t, source: 'text' }];

describe('locked sector taxonomy', () => {
  it('exposes only the approved canonical sector set', () => {
    expect(FINITE_VALUES.sector).toEqual([
      'agriculture_agri_business',
      'automotive',
      'aviation',
      'banking_financial_services',
      'construction',
      'education',
      'energy',
      'food_beverage',
      'government',
      'hospital_healthcare',
      'hospitality',
      'industrial_services',
      'information_technology',
      'insurance',
      'manufacturing',
      'media_advertising',
      'nonprofit',
      'pharma_biotech',
      'professional_services',
      'real_estate_property',
      'retailer',
      'security',
      'telecom',
      'transportation',
      'utility_provider',
      'warehouse_logistics',
    ]);
  });

  it('keeps sector labels in lock-step with canonical sector slugs', () => {
    expect(Object.keys(SECTOR_LABELS)).toEqual([...FINITE_VALUES.sector]);
  });
});

describe('display-title generation', () => {
  it('synthesizes titles for finite values even when the dictionary has no explicit row', () => {
    const entries = selectDisplayTitleEntries([]);
    const byKey = new Map(entries.map((entry) => [`${entry.bucket}:${entry.canonicalKey}`, entry.displayTitle]));

    expect(byKey.get('employment:full_time')).toBe('Full Time');
    expect(byKey.get('benefits:phone_provided')).toBe('Phone Provided');
    expect(byKey.get('compensation:annual_bonus')).toBe('Annual Bonus');
    expect(byKey.get('sector:banking_financial_services')).toBe('Banking & Financial Services');
    expect(byKey.get('qualifications:qualification:license:driving_license_b')).toBe('Driving License B');
  });

  it('keeps the packed DTB in sync with every finite-value key', async () => {
    const store = await DisplayTitleStore.load();
    expect(store).toBeDefined();

    for (const [bucket, values] of Object.entries(FINITE_VALUES) as [keyof typeof FINITE_VALUES, readonly string[]][]) {
      for (const canonicalKey of values) {
        expect(store?.titleFor(bucket, canonicalKey)).toEqual(expect.any(String));
      }
    }

    for (const canonicalKey of qualificationCanonicalKeys()) {
      expect(store?.titleFor('qualifications', canonicalKey)).toEqual(expect.any(String));
    }
  });
});

describe('qualification faceted finite values', () => {
  it('keeps the sub-field breakdown in lock-step with the qualification canonical key set', () => {
    const rebuilt = Object.values(FACETED_FINITE_VALUES.qualifications.valuesBySubField).flat();

    expect(new Set(rebuilt)).toEqual(new Set(qualificationCanonicalKeys()));
  });
});

describe('finalizeFinite — unions OS resolution with rule inference for finite buckets', () => {
  it('promotes OS-side ambiguous keys to resolved when inference confirms them', () => {
    const os: ResolvedTerm[] = [
      {
        key: 'sector:information_technology',
        name: 'Information Technology',
        score: 0.5,
        lang: 'ro',
        status: 'ambiguous',
        span: 'IT / Telecom',
      },
      { key: 'sector:telecom', name: 'Telecom', score: 0.5, lang: 'ro', status: 'ambiguous', span: 'IT / Telecom' },
    ];
    const result = finalizeFinite('sector', os, C('IT / Telecom'), { locale: 'ro' });
    expect(result.find((t) => t.key === 'sector:information_technology')?.status).toBe('resolved');
    expect(result.find((t) => t.key === 'sector:telecom')?.status).toBe('resolved');
  });

  it('adds a fresh resolved term when inference finds a key OS never surfaced at all', () => {
    const result = finalizeFinite('sector', [], C('IT / Telecom'), { locale: 'ro' });
    expect(result.find((t) => t.key === 'sector:information_technology')?.status).toBe('resolved');
  });

  it('leaves OS results untouched when inference finds nothing for the clause', () => {
    const os: ResolvedTerm[] = [
      { key: 'company_size:startup', name: 'Startup', score: 0.5, lang: 'ro', status: 'ambiguous', span: 'blah' },
    ];
    const result = finalizeFinite('sector', os, C('some unrelated clause with no signal'), { locale: 'ro' });
    expect(result).toEqual(os);
  });
});

describe('facets.ts buildLookup — locale-scoped registration', () => {
  it('resolves a RO facet surface that normalizes identically to an EN surface, without either shadowing the other', () => {
    const roKeys = inferSector(C('IT / Telecom'), ['ro']).map((x) => x.canonicalKey);
    expect(roKeys).toContain('sector:information_technology');
    expect(roKeys).toContain('sector:telecom');
  });

  it('resolves the equivalent EN facet surface independently of the RO registration', () => {
    const enKeys = inferSector(C('IT & Telecoms'), ['en']).map((x) => x.canonicalKey);
    expect(enKeys).toContain('sector:information_technology');
    expect(enKeys).toContain('sector:telecom');
  });

  it('reports no collisions across the full production facet table', () => {
    expect(facetCollisionErrors()).toEqual([]);
  });
});
