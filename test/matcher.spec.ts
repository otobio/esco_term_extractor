import { describe, expect, it } from 'vitest';
import { additiveHybridStrategy } from '../src/matchers/additive-hybrid.ts';
import { buildFilters, resolveSurfaces, strategyForBucket } from '../src/matchers/resolve.ts';
import type { MatchContext, OpenSearchClient, SurfaceQuery } from '../src/matchers/types.ts';

const ctx = (queryModelId: string | null): MatchContext => ({ queryModelId, buildFilters });
const item = (surface: string, bucket = 'occupation', locale?: string): SurfaceQuery => ({ bucket, surface, locale });

type Hit = { key: string; score: number; value?: string; display_name?: string; aliases?: string[]; collar?: string };
const response = (hits: Hit[]) => ({
  hits: {
    hits: hits.map((h) => ({
      _score: h.score,
      _source: {
        canonical_key: h.key,
        value: h.value,
        display_name: h.display_name,
        aliases: h.aliases,
        searchable: h.collar ? { collar_kind: h.collar } : undefined,
      },
    })),
  },
});

describe('additive-hybrid buildQuery', () => {
  it('puts neural in should (never must) so lexical can resolve alone', () => {
    const q = additiveHybridStrategy.buildQuery(item('nurse'), ctx('model-1')) as any;
    expect(q.query.bool.must).toBeUndefined();
    expect(q.query.bool.minimum_should_match).toBe(1);
    const neural = q.query.bool.should.filter((c: any) => c.neural_sparse);
    expect(neural).toHaveLength(1);
    expect(neural[0].neural_sparse.sparse_embedding.model_id).toBe('model-1');
  });

  it('omits the neural clause when no query model is available', () => {
    const q = additiveHybridStrategy.buildQuery(item('nurse'), ctx(null)) as any;
    expect(q.query.bool.should.some((c: any) => c.neural_sparse)).toBe(false);
    expect(q.query.bool.minimum_should_match).toBe(1);
  });

  it('adds neural for every query when a model is available (NEURAL_ENGLISH_ONLY off)', () => {
    // NEURAL_ENGLISH_ONLY is false: neural is re-enabled on every locale (helps
    // English-primary country-code locales like `ng`) and can never veto (it sits
    // in `should`). If the flag is flipped back to true, update this test.
    const en = additiveHybridStrategy.buildQuery(item('nurse', 'occupation', 'en'), ctx('m')) as any;
    const unset = additiveHybridStrategy.buildQuery(item('nurse'), ctx('m')) as any;
    const ro = additiveHybridStrategy.buildQuery(item('asistent', 'occupation', 'ro'), ctx('m')) as any;
    const ng = additiveHybridStrategy.buildQuery(item('nurse', 'occupation', 'ng'), ctx('m')) as any;
    expect(en.query.bool.should.some((c: any) => c.neural_sparse)).toBe(true);
    expect(unset.query.bool.should.some((c: any) => c.neural_sparse)).toBe(true);
    expect(ro.query.bool.should.some((c: any) => c.neural_sparse)).toBe(true);
    expect(ng.query.bool.should.some((c: any) => c.neural_sparse)).toBe(true);
    // still omitted when no query model is deployed
    expect(
      (additiveHybridStrategy.buildQuery(item('nurse'), ctx(null)) as any).query.bool.should.some(
        (c: any) => c.neural_sparse,
      ),
    ).toBe(false);
  });

  it('gates edit-distance fuzzy to the input locale (no cross-language look-alikes), phrase stays cross-locale', () => {
    const q = additiveHybridStrategy.buildQuery(item('sef', 'occupation', 'ro'), ctx('m')) as any;
    const should = q.query.bool.should as any[];
    // phrase clauses remain unscoped — the always-English surface still resolves
    expect(should.some((c) => c.match_phrase?.value)).toBe(true);
    // fuzziness clauses are wrapped with a NON-SCORING locale filter (no boost)
    const scopedFuzzy = should.filter((c) => c.bool?.must?.[0]?.match && c.bool?.filter);
    expect(scopedFuzzy.length).toBe(2); // value + aliases
    expect(scopedFuzzy[0].bool.filter).toContainEqual({ term: { language_code: 'ro' } });
    expect(scopedFuzzy[0].bool.boost).toBeUndefined();
    // no locale ⇒ fuzzy is unwrapped (unchanged behavior)
    const noLocale = additiveHybridStrategy.buildQuery(item('sef'), ctx('m')) as any;
    expect(noLocale.query.bool.should.some((c: any) => c.match?.value?.fuzziness === 'AUTO')).toBe(true);
  });

  it('folds diacritics + expands number variants in the exact keyword clauses (Șofer)', () => {
    const q = additiveHybridStrategy.buildQuery(item('Șofer'), ctx('m')) as any;
    const exact = q.query.bool.should.find((c: any) => c.constant_score?.filter?.terms?.['aliases.keyword']);
    const variants = exact.constant_score.filter.terms['aliases.keyword'];
    expect(variants).toContain('sofer'); // folded original
    expect(variants).toContain('soferi'); // pluralized variant
  });
});

describe('additive-hybrid select — asymmetric floors', () => {
  it('resolves an EXACT (term-anchored) hit even with no neural signal', () => {
    const r = additiveHybridStrategy.select(
      response([{ key: 'occupation:road_construction_worker', score: 70, aliases: ['pavator'] }]),
      item('pavator'),
    );
    expect(r).toEqual({ status: 'resolved', key: 'occupation:road_construction_worker', score: 70 });
  });

  it('matches an exact alias through diacritics (query sofer vs alias șofer)', () => {
    const r = additiveHybridStrategy.select(
      response([{ key: 'occupation:private_chauffeur', score: 90, aliases: ['șofer'] }]),
      item('sofer'),
    );
    expect(r).toEqual({ status: 'resolved', key: 'occupation:private_chauffeur', score: 90 });
  });

  it('accepts a neural-only hit above the bucket floor and drops it below', () => {
    const above = additiveHybridStrategy.select(
      response([{ key: 'occupation:software_developer', score: 6.0, value: 'software developer' }]),
      item('fullstack python developer'),
    );
    expect(above).toEqual({ status: 'resolved', key: 'occupation:software_developer', score: 6.0 });

    const below = additiveHybridStrategy.select(
      response([{ key: 'occupation:greaser', score: 5.0, value: 'greaser' }]),
      item('pavator'),
    );
    expect(below).toEqual({ status: 'unresolved' });
  });

  it('flags close term-anchored candidates and collar conflicts as ambiguous', () => {
    const close = additiveHybridStrategy.select(
      response([
        { key: 'occupation:a', score: 70, aliases: ['agent'] },
        { key: 'occupation:b', score: 68, aliases: ['agent'] },
      ]),
      item('agent'),
    );
    expect(close).toEqual({ status: 'ambiguous', candidates: ['occupation:a', 'occupation:b'] });

    const collar = additiveHybridStrategy.select(
      response([
        { key: 'occupation:a', score: 70, aliases: ['x'], collar: 'blue_collar' },
        { key: 'occupation:b', score: 40, aliases: ['x'], collar: 'white_collar' },
      ]),
      item('x'),
    );
    expect(collar).toEqual({ status: 'ambiguous', candidates: ['occupation:a', 'occupation:b'] });
  });
});

describe('registry + resolve', () => {
  it('routes occupation/capabilities to additive-hybrid, finite buckets to finite-lexical, rest to lexical', () => {
    expect(strategyForBucket('occupation').name).toBe('additive-hybrid');
    expect(strategyForBucket('capabilities').name).toBe('additive-hybrid');
    // Finite/discrete buckets get the exact+phrase (no edit-distance) strategy.
    expect(strategyForBucket('workplace').name).toBe('finite-lexical');
    expect(strategyForBucket('qualifications').name).toBe('finite-lexical');
    // location is gazetteer-owned; any residual OS route stays plain lexical.
    expect(strategyForBucket('location').name).toBe('lexical');
  });

  it('buildFilters expands locale to [locale, en, global] (en -> [en, global])', () => {
    expect(buildFilters('occupation')).toEqual([{ term: { bucket: 'occupation' } }]);
    expect(buildFilters('occupation', 'en')).toContainEqual({ terms: { language_code: ['en', 'global'] } });
    expect(buildFilters('occupation', 'ro')).toContainEqual({ terms: { language_code: ['ro', 'en', 'global'] } });
  });

  it('resolveSurfaces batches into one msearch and maps responses back in order', async () => {
    let batched = 0;
    const client: OpenSearchClient = {
      queryModelId: async () => 'm',
      msearch: async (queries) => {
        batched = queries.length;
        return [response([{ key: 'occupation:bricklayer', score: 80, aliases: ['zidar'] }]), response([])];
      },
    };
    const out = await resolveSurfaces([item('zidar'), item('nonsense')], client);
    expect(batched).toBe(1 * 2); // both surfaces in a single msearch call
    expect(out[0]).toEqual({ status: 'resolved', key: 'occupation:bricklayer', score: 80 });
    expect(out[1]).toEqual({ status: 'unresolved' });
  });
});
