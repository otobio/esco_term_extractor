import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { GazetteerIndex, type LocationEdge } from '../src/gazetteer-index.ts';
import { normalizeText } from '../src/normalize.ts';
import { GAZETTEER_CONFIG, type GazetteerConfig, GazetteerResolver } from '../src/resolver.ts';
import type { Clause, DictionaryTerm, SupportedLanguage } from '../src/types.ts';

/*
 * STANDARDIZED gazetteer tests.
 *
 * The resolver engine is language-agnostic; these tests prove that by asserting
 * only STRUCTURE — admin depth, per-country leaf/container, corroboration, seat,
 * promotion, gating — never real per-locale word lists. Country codes below are
 * OPAQUE TAGS (any two distinct SupportedLanguage values); a test never relies on
 * a code "being Romanian". All patterns (stop-names, major cities, subdivisions)
 * are INJECTED per fixture, so nothing leaks from production data — the same knobs
 * a new locale will populate. Add a locale by adding a fixture, not a code path.
 */

// Opaque country tags (distinct codes; behaviour must not depend on which).
const A: SupportedLanguage = 'ro'; // used as a 2- or 3-tier country per fixture
const B: SupportedLanguage = 'hu';
const C: SupportedLanguage = 'et';

interface PlaceSpec {
  key: string;
  depth: number;
  name: string;
  code: SupportedLanguage;
  aliases?: string[];
  parent?: string; // parent canonicalKey (omit for a root subdivision)
}

const toTerm = (s: PlaceSpec): DictionaryTerm => ({
  canonicalKey: s.key,
  bucket: 'location',
  termType: `depth${s.depth}`,
  displayName: s.name,
  value: s.name,
  languageCode: s.code,
  aliases: s.aliases ?? [],
});

const edgesOf = (specs: PlaceSpec[]): LocationEdge[] =>
  specs.filter((s) => s.parent).map((s) => ({ parentKey: s.parent!, childKey: s.key }));

interface BuildOpts {
  majorCities?: Record<string, string>; // normalized city name -> parent slug
  exonyms?: Record<string, string>; // normalized exonym -> canonical key
  stopNames?: string[];
  subdivisions?: { re: RegExp; parentKey: string }[];
  cfg?: Partial<GazetteerConfig>;
}

/** Build an index + resolver with fully injected patterns (defaults: none), so a
 *  fixture is isolated from production STOP_NAMES / MAJOR_CITIES / SUBDIVISIONS. */
function build(specs: PlaceSpec[], opts: BuildOpts = {}) {
  const index = GazetteerIndex.fromTerms(specs.map(toTerm), edgesOf(specs), {
    majorCities: new Map(Object.entries(opts.majorCities ?? {})),
    exonyms: new Map(Object.entries(opts.exonyms ?? {})),
  });
  const cfg: GazetteerConfig = {
    ...GAZETTEER_CONFIG,
    stopNames: new Set(opts.stopNames ?? []),
    subdivisions: opts.subdivisions ?? [],
    ...opts.cfg,
  };
  const resolver = new GazetteerResolver(index, cfg);
  const idxOf = (key: string) => index.places.findIndex((p) => p.canonicalKey === key);
  const clause = (text: string): Clause => ({ text, source: 'text' });
  const run = (text: string, o: { structured?: string; locale?: SupportedLanguage } = {}) =>
    resolver.resolve(o.structured ? [] : [clause(text)], o.structured, o.locale);
  const keys = (text: string, o?: { structured?: string; locale?: SupportedLanguage }) =>
    run(text, o).map((t) => t.canonicalKey);
  return { index, resolver, idxOf, run, keys };
}

// ---------------------------------------------------------------------------
describe('leaf/container model is per-country (the core abstraction)', () => {
  // ALPHA: 3 tiers (region > county > locality-leaf). BETA: 2 tiers (state >
  // district-leaf). depth-2 is a CONTAINER in ALPHA but a LEAF in BETA — proving
  // trust is decided by each country's own deepest tier, not an absolute number.
  const g = build([
    { key: 'a:region', depth: 1, name: 'Aregion', code: A },
    { key: 'a:county', depth: 2, name: 'Acounty', code: A, parent: 'a:region' },
    { key: 'a:town', depth: 3, name: 'Atown', code: A, parent: 'a:county' },
    { key: 'b:state', depth: 1, name: 'Bstate', code: B },
    { key: 'b:district', depth: 2, name: 'Bdistrict', code: B, parent: 'b:state' },
  ]);

  it('marks only each country’s deepest tier as a leaf', () => {
    expect(g.index.isLeaf(g.idxOf('a:town'))).toBe(true);
    expect(g.index.isLeaf(g.idxOf('a:county'))).toBe(false);
    expect(g.index.isLeaf(g.idxOf('a:region'))).toBe(false);
    expect(g.index.isLeaf(g.idxOf('b:district'))).toBe(true);
    expect(g.index.isLeaf(g.idxOf('b:state'))).toBe(false);
  });

  it('treats every container (non-leaf) as always-trusted (isMajor)', () => {
    expect(g.index.isMajor(g.idxOf('a:region'))).toBe(true);
    expect(g.index.isMajor(g.idxOf('a:county'))).toBe(true);
    expect(g.index.isMajor(g.idxOf('b:state'))).toBe(true);
    expect(g.index.isMajor(g.idxOf('a:town'))).toBe(false); // leaf, not promoted
  });

  it('resolves a container bare but requires corroboration for a bare leaf', () => {
    expect(g.keys('office in Acounty')).toContain('a:county'); // container, bare OK
    expect(g.keys('office in Bstate')).toContain('b:state'); // container, bare OK
    expect(g.keys('office in Atown')).toEqual([]); // leaf, no container in text
    expect(g.keys('office in Bdistrict')).toEqual([]); // leaf, no container in text
  });

  it('gives the SAME depth number opposite trust across countries', () => {
    expect(g.keys('based in Acounty')).toContain('a:county'); // depth-2 container → bare OK
    expect(g.keys('based in Bdistrict')).toEqual([]); // depth-2 leaf → needs context
  });
});

// ---------------------------------------------------------------------------
describe('corroboration, disambiguation and abstention', () => {
  // Two counties, each with a same-named leaf; plus a two-word-named ambiguous leaf.
  const specs: PlaceSpec[] = [
    { key: 'a:c1', depth: 2, name: 'Countyone', code: A, parent: 'a:region' },
    { key: 'a:c2', depth: 2, name: 'Countytwo', code: A, parent: 'a:region' },
    { key: 'a:region', depth: 1, name: 'Aregion', code: A },
    { key: 'a:c1:dup', depth: 3, name: 'Dup, Countyone', code: A, aliases: ['Dup'], parent: 'a:c1' },
    { key: 'a:c2:dup', depth: 3, name: 'Dup, Countytwo', code: A, aliases: ['Dup'], parent: 'a:c2' },
    { key: 'a:c1:nf', depth: 3, name: 'North Field, Countyone', code: A, aliases: ['North Field'], parent: 'a:c1' },
    { key: 'a:c2:nf', depth: 3, name: 'North Field, Countytwo', code: A, aliases: ['North Field'], parent: 'a:c2' },
  ];

  it('drops a bare ambiguous single-token leaf (no corroboration)', () => {
    expect(build(specs).keys('job in Dup')).toEqual([]);
  });

  it('accepts + disambiguates a leaf via its container in text (both directions)', () => {
    const g = build(specs);
    const k1 = g.keys('site in Dup, part of Countyone');
    expect(k1).toContain('a:c1:dup');
    expect(k1).not.toContain('a:c2:dup');
    const k2 = g.keys('site in Dup, part of Countytwo');
    expect(k2).toContain('a:c2:dup');
    expect(k2).not.toContain('a:c1:dup');
  });

  it('ABSTAINS when a multi-word span matches several places with no distinguishing signal', () => {
    // "North Field" is a 2-word span → accepted without corroboration, but both
    // candidates are equally undistinguished → resolver refuses rather than guess.
    expect(build(specs).keys('hiring in North Field')).toEqual([]);
  });

  it('breaks the same tie when one candidate is a promoted major city', () => {
    const g = build(specs, { majorCities: { 'north field': 'c1' } });
    const k = g.keys('hiring in North Field');
    expect(k).toContain('a:c1:nf'); // the promoted one wins
    expect(k).not.toContain('a:c2:nf');
  });
});

// ---------------------------------------------------------------------------
describe('county-seat (a leaf named like its container ancestor) is trusted bare', () => {
  // Container surface is the full "Seaton County"; the leaf is bare "Seaton" whose
  // name is a prefix of the container → a seat, trusted without other context.
  const g = build([
    { key: 'a:region', depth: 1, name: 'Aregion', code: A },
    { key: 'a:seatco', depth: 2, name: 'Seaton County', code: A, parent: 'a:region' },
    { key: 'a:seatco:seaton', depth: 3, name: 'Seaton', code: A, parent: 'a:seatco' },
    { key: 'a:seatco:other', depth: 3, name: 'Elsewhere', code: A, parent: 'a:seatco' },
  ]);

  it('resolves the seat bare and expands its hierarchy', () => {
    const k = g.keys('job based in Seaton');
    expect(k).toContain('a:seatco:seaton');
    expect(k).toContain('a:seatco'); // inferred container
    expect(k).toContain('a:region');
  });

  it('still requires corroboration for a non-seat leaf under the same container', () => {
    expect(g.keys('job based in Elsewhere')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('major-city promotion is parent-verified', () => {
  // Same city name under two different parents; only the one under the configured
  // parent slug is promoted. Guards against promoting a same-named village.
  const g = build(
    [
      { key: 'a:c1', depth: 2, name: 'Countyone', code: A, parent: 'a:region' },
      { key: 'a:c2', depth: 2, name: 'Countytwo', code: A, parent: 'a:region' },
      { key: 'a:region', depth: 1, name: 'Aregion', code: A },
      { key: 'a:c1:metro', depth: 3, name: 'Metro', code: A, parent: 'a:c1' },
      { key: 'a:c2:metro', depth: 3, name: 'Metro', code: A, parent: 'a:c2' },
    ],
    { majorCities: { metro: 'c1' } },
  );

  it('promotes only the city under the configured parent', () => {
    expect(g.index.isMajor(g.idxOf('a:c1:metro'))).toBe(true);
    expect(g.index.isMajor(g.idxOf('a:c2:metro'))).toBe(false);
  });

  it('resolves the promoted city bare and not its same-named twin', () => {
    const k = g.keys('we are hiring in Metro');
    expect(k).toContain('a:c1:metro');
    expect(k).not.toContain('a:c2:metro');
  });
});

// ---------------------------------------------------------------------------
describe('stop-name precision guard (generalises the "common-word place" problem)', () => {
  // 'common' is injected as a stop-name AND is the name of a container. A stop-name
  // is dropped as a bare free-text mention regardless of admin depth — this is the
  // mechanism the delta/plateau-style false positives feed into.
  const specs: PlaceSpec[] = [
    { key: 'a:common', depth: 1, name: 'Common', code: A },
    { key: 'a:common:leaf', depth: 2, name: 'Downtown', code: A, parent: 'a:common' },
    { key: 'a:real', depth: 1, name: 'Realia', code: A },
    { key: 'a:real:leaf', depth: 2, name: 'Uptown', code: A, parent: 'a:real' },
  ];

  it('drops a bare stop-name container but keeps a normal container', () => {
    const g = build(specs, { stopNames: ['common'] });
    expect(g.keys('we saw a common issue')).toEqual([]); // stop-name → not a location
    expect(g.keys('office in Realia')).toContain('a:real'); // normal container → OK
  });

  it('documents the recall trade-off: a child of a stop-name container loses corroboration', () => {
    // Because the stop-name is never emitted, it cannot corroborate its leaf.
    const g = build(specs, { stopNames: ['common'] });
    expect(g.keys('office in Downtown')).toEqual([]);
    // ...whereas the identical structure under a non-stop container resolves.
    expect(g.keys('office in Uptown but really Realia')).toContain('a:real:leaf');
  });

  it('the structured field bypasses stop-name gating (a deliberate value)', () => {
    const g = build(specs, { stopNames: ['common'] });
    expect(g.keys('unrelated text', { structured: 'Common' })).toContain('a:common');
  });
});

// ---------------------------------------------------------------------------
describe('hierarchy expansion', () => {
  const specs: PlaceSpec[] = [
    { key: 'a:region', depth: 1, name: 'Aregion', code: A },
    { key: 'a:county', depth: 2, name: 'Acounty', code: A, parent: 'a:region' },
    { key: 'a:city', depth: 3, name: 'Bigcity, Acounty', code: A, aliases: ['Bigcity'], parent: 'a:county' },
  ];

  it('expands a matched leaf to its ancestors with the inferred score', () => {
    const g = build(specs, { majorCities: { bigcity: 'county' } }); // promote so bare leaf resolves
    const terms = g.run('relocating to Bigcity');
    const byKey = Object.fromEntries(terms.map((t) => [t.canonicalKey, t.score]));
    expect(byKey['a:city']).toBeDefined();
    expect(byKey['a:county']).toBeCloseTo(GAZETTEER_CONFIG.scores.inferred, 5);
    expect(byKey['a:region']).toBeCloseTo(GAZETTEER_CONFIG.scores.inferred, 5);
  });

  it('emits no ancestors when hierarchy expansion is disabled', () => {
    const g = build(specs, { majorCities: { bigcity: 'county' }, cfg: { enableHierarchyExpansion: false } });
    const k = g.keys('relocating to Bigcity');
    expect(k).toContain('a:city');
    expect(k).not.toContain('a:county');
    expect(k).not.toContain('a:region');
  });
});

// ---------------------------------------------------------------------------
describe('fuzzy matching gates', () => {
  const specs: PlaceSpec[] = [
    { key: 'a:region', depth: 1, name: 'Aregion', code: A },
    { key: 'a:riverside', depth: 2, name: 'Riverside', code: A, parent: 'a:region' }, // container, len 9
    { key: 'a:toma', depth: 2, name: 'Toma', code: A, parent: 'a:region' }, // container, len 4
    { key: 'a:riverside:leaf', depth: 3, name: 'Leaf', code: A, parent: 'a:riverside' },
  ];

  it('applies fuzzy to the structured field (typo within edit distance)', () => {
    expect(build(specs).keys('', { structured: 'Rivrside' })).toContain('a:riverside'); // 1 deletion from "riverside"
  });

  it('does not fuzzy-match a structured token below the min length', () => {
    expect(build(specs).keys('', { structured: 'Tomo' })).toEqual([]); // len 4 < fuzzyMinLen
  });

  it('never fuzzy-matches free text by default', () => {
    expect(build(specs).keys('office in Riverdise')).toEqual([]);
  });

  it('fuzzy-matches free text only when explicitly enabled', () => {
    const g = build(specs, { cfg: { enableFuzzy: true } });
    expect(g.keys('office in Riverdise')).toContain('a:riverside');
  });
});

// ---------------------------------------------------------------------------
describe('per-locale gating (a name shared across two countries)', () => {
  // Same normalized surface "Sameton" exists as a container in both countries.
  const g = build([
    { key: 'a:sameton', depth: 1, name: 'Sameton', code: A },
    { key: 'a:sameton:leaf', depth: 2, name: 'Aleaf', code: A, parent: 'a:sameton' },
    { key: 'b:sameton', depth: 1, name: 'Sameton', code: B },
    { key: 'b:sameton:leaf', depth: 2, name: 'Bleaf', code: B, parent: 'b:sameton' },
  ]);

  it('keeps only the query-locale place', () => {
    expect(g.keys('hiring in Sameton', { locale: A })).toEqual(['a:sameton']);
    expect(g.keys('hiring in Sameton', { locale: B })).toEqual(['b:sameton']);
  });

  it('yields nothing for a locale with no such place', () => {
    expect(g.keys('hiring in Sameton', { locale: C })).toEqual([]);
  });

  it('is ungated when no locale is given (both are candidates; disambiguation picks one)', () => {
    // A single surface names one place, not two countries at once — so with both in
    // play the resolver deterministically collapses to one. The point here is only
    // that NO locale filter was applied (contrast: locale C yields []).
    expect(g.keys('hiring in Sameton')).toEqual(['a:sameton']);
  });
});

// ---------------------------------------------------------------------------
describe('build-time surface guards', () => {
  const g = build([
    { key: 'a:place', depth: 1, name: 'Validname', code: A, aliases: ['XY', '99'] }, // container
    { key: 'a:place:leaf', depth: 2, name: 'Suburbia', code: A, parent: 'a:place' },
  ]);

  it('excludes 2-letter and numeric aliases from the surface map', () => {
    expect(g.index.exact('xy')).toEqual([]); // 2 chars → dropped (avoids matching everywhere)
    expect(g.index.exact('99')).toEqual([]); // numeric → dropped
    expect(g.index.exact('validname').length).toBeGreaterThan(0);
  });

  it('does not resolve the excluded short/numeric tokens from free text', () => {
    expect(g.keys('code XY and 99 units')).toEqual([]);
    expect(g.keys('office in Validname')).toContain('a:place');
  });
});

// ---------------------------------------------------------------------------
describe('subdivisions (injected pattern, generic)', () => {
  const g = build(
    [{ key: 'a:city', depth: 1, name: 'Bigcity', code: A }], // root: no ancestors to infer
    { subdivisions: [{ re: /\bzone\s*([1-9])\b/gi, parentKey: 'a:city' }] },
  );

  it('maps a subdivision mention to its parent place', () => {
    expect(g.keys('team for Zone 3')).toContain('a:city');
  });

  it('dedupes multiple subdivision mentions to a single parent', () => {
    expect(g.keys('Zone 1 and Zone 2 teams')).toEqual(['a:city']);
  });
});

// ---------------------------------------------------------------------------
describe('result set: multiple places, cap and empties', () => {
  const specs: PlaceSpec[] = [
    ...Array.from({ length: 6 }, (_, i) => ({ key: `a:c${i}`, depth: 1, name: `City${i}`, code: A })),
    // A deeper tier so the City* roots are containers (non-leaf), trusted bare.
    { key: 'a:c0:leaf', depth: 2, name: 'Bump', code: A, parent: 'a:c0' },
  ];

  it('resolves several distinct places from one text', () => {
    const k = build(specs).keys('offices in City0 and City1 and City2');
    expect(k).toEqual(expect.arrayContaining(['a:c0', 'a:c1', 'a:c2']));
  });

  it('caps the result set at maxPerBucket', () => {
    const g = build(specs, { cfg: { maxPerBucket: 2 } });
    expect(g.keys('offices in City0 City1 City2 City3 City4')).toHaveLength(2);
  });

  it('returns nothing when there is no location signal', () => {
    expect(build(specs).keys('remote software role, competitive pay')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('diacritic-insensitive matching', () => {
  const g = build([
    { key: 'a:city', depth: 1, name: 'Tîmișoara', code: A }, // container
    { key: 'a:city:leaf', depth: 2, name: 'Suburb', code: A, parent: 'a:city' },
  ]);

  it('matches a query written without diacritics', () => {
    expect(g.keys('office in Timisoara')).toContain('a:city');
  });
});

// ---------------------------------------------------------------------------
describe('exonyms resolve to the native place (injected mechanism)', () => {
  const g = build(
    [
      { key: 'a:city', depth: 1, name: 'Nativa', code: A }, // container
      { key: 'a:city:leaf', depth: 2, name: 'Sub', code: A, parent: 'a:city' },
    ],
    { exonyms: { foreignname: 'a:city' } },
  );

  it('adds the exonym as an exact surface for the target place', () => {
    expect(g.index.exact('foreignname')).toEqual(g.index.exact('nativa'));
    expect(g.keys('office in Foreignname')).toContain('a:city');
  });

  it('ignores an exonym whose target key does not exist', () => {
    const g2 = build([{ key: 'a:city', depth: 1, name: 'Nativa', code: A }], { exonyms: { ghost: 'a:nope' } });
    expect(g2.keys('office in Ghost')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// This block exercises the real packed binary the production `openGazetteer()`
// loads. It guards the HU runtime surfaces we just added without asserting the
// broader legacy JSON index, which is a separate compatibility artifact.
describe('production patterns data integrity', () => {
  let resolver: GazetteerResolver;
  const keys = (text: string, locale?: SupportedLanguage) =>
    resolver.resolve([{ text, source: 'text' }], undefined, locale).map((x) => x.canonicalKey);
  beforeAll(async () => {
    // The package's own data dir, resolved from this file so it works from any CWD.
    const { openGazetteer } = await import('../src/gazetteer-bin.ts');
    resolver = (await openGazetteer(fileURLToPath(new URL('../data', import.meta.url))))!;
    expect(resolver).toBeDefined();
  });

  it('resolves Magyarország to Hungary and keeps the country root intact', () => {
    expect(keys('office in Magyarország', 'hu')).toContain('location:depth0:hungary');
  });

  it('keeps the Csongrád tree and adds the Csongrád-Csanád surface', () => {
    const hit = keys('role in Csongrád-Csanád megye', 'hu');
    expect(hit).toContain('location:depth1:csongrad_megye');
    expect(hit).toContain('location:depth0:hungary');
  });

  it('resolves the foreign-country names from the requested list to country roots', () => {
    const cases: Array<[string, string]> = [
      ['Németország', 'location:depth0:germany'],
      ['Ausztria', 'location:depth0:austria'],
      ['Hollandia', 'location:depth0:netherlands'],
      ['Egyesült Királyság', 'location:depth0:united_kingdom'],
      ['Dánia', 'location:depth0:denmark'],
      ['USA', 'location:depth0:united_states'],
      ['Norvégia', 'location:depth0:norway'],
      ['Svédország', 'location:depth0:sweden'],
      ['Olaszország', 'location:depth0:italy'],
      ['Svájc', 'location:depth0:switzerland'],
      ['Franciaország', 'location:depth0:france'],
      ['Belgium', 'location:depth0:belgium'],
      ['Szerbia', 'location:depth0:serbia'],
      ['Románia', 'location:depth0:romania'],
      ['Horvátország', 'location:depth0:croatia'],
      ['Szlovénia', 'location:depth0:slovenia'],
      ['Csehország', 'location:depth0:czechia'],
      ['Szlovákia', 'location:depth0:slovakia'],
      ['Ukrajna', 'location:depth0:ukraine'],
      ['Lengyelország', 'location:depth0:poland'],
    ];
    for (const [text, key] of cases) expect(keys(text)).toContain(key);
  });

  it('keeps Külföld out of the gazetteer location bucket', () => {
    expect(keys('Külföld', 'hu')).toEqual([]);
  });

  it('regression: common-word NG states do not resolve bare, but real cities do', () => {
    for (const word of ['delta', 'plateau', 'niger']) {
      expect(keys(`we analysed the ${word} in Q3`, 'ng')).toEqual([]);
    }
    expect(keys('role based in Ikeja', 'ng')).toContain('location:depth1:lagos_state'); // promoted leaf → state
  });
});
