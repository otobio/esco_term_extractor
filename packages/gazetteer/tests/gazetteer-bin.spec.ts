import { describe, expect, it } from 'vitest';
import { GazetteerBin, pack } from '../src/gazetteer-bin.ts';
import type { LocationRecord, Surface } from '../src/location-store.ts';
import { GAZETTEER_CONFIG, type GazetteerConfig, GazetteerResolver } from '../src/resolver.ts';
import type { Clause } from '../src/types.ts';

const surf = (...t: string[]): Surface[] => t.map((text) => ({ text, kind: 'native' as const }));
const rec = (p: Partial<LocationRecord> & { key: string; name: string }): LocationRecord => ({
  sourceId: p.key,
  parentKey: null,
  kind: 'settlement',
  depth: 2,
  countryCode: 'ro',
  population: null,
  isCapital: false,
  isAdminSeat: false,
  prominence: 0,
  dominant: false,
  surfaces: [],
  stopword: false,
  lat: null,
  lng: null,
  geonamesId: null,
  ...p,
});

// A small RO world: country → admin1 → settlements, incl. a dominant seat, an
// ambiguous same-name pair, and a stop-word container.
const RECORDS: LocationRecord[] = [
  rec({ key: 'location:depth0:romania', name: 'Romania', kind: 'country', depth: 0, surfaces: surf('romania') }),
  rec({
    key: 'location:depth1:cluj',
    name: 'Cluj',
    kind: 'admin1',
    depth: 1,
    parentKey: 'location:depth0:romania',
    surfaces: surf('cluj'),
  }),
  rec({
    key: 'location:depth1:alba',
    name: 'Alba',
    kind: 'admin1',
    depth: 1,
    parentKey: 'location:depth0:romania',
    surfaces: surf('alba'),
  }),
  rec({
    key: 'location:depth2:cluj_napoca',
    name: 'Cluj-Napoca',
    parentKey: 'location:depth1:cluj',
    population: 320000,
    isAdminSeat: true,
    dominant: true,
    prominence: 820000,
    surfaces: surf('cluj napoca', 'kolozsvar'),
  }),
  rec({
    key: 'location:depth2:dup_cluj',
    name: 'Dup',
    parentKey: 'location:depth1:cluj',
    population: 4000,
    surfaces: surf('dup'),
  }),
  rec({
    key: 'location:depth2:dup_alba',
    name: 'Dup',
    parentKey: 'location:depth1:alba',
    population: 3500,
    surfaces: surf('dup'),
  }),
  rec({
    key: 'location:depth1:delta',
    name: 'Delta',
    kind: 'admin1',
    depth: 1,
    parentKey: 'location:depth0:romania',
    stopword: true,
    surfaces: surf('delta'),
  }),
];

const bin = GazetteerBin.fromBuffer(pack(RECORDS));
const idx = (k: string) => bin.indexOfKey(k)!;
const clause = (text: string): Clause => ({ text, source: 'text' });
function resolver(stopNames: string[] = []): GazetteerResolver {
  const cfg: GazetteerConfig = { ...GAZETTEER_CONFIG, stopNames: new Set(stopNames), subdivisions: [] };
  return new GazetteerResolver(bin, cfg);
}
const keys = (text: string, r: GazetteerResolver, locale = 'ro' as const) =>
  r.resolve([clause(text)], undefined, locale).map((t) => t.canonicalKey);

describe('GZB round-trips the dataset losslessly', () => {
  it('preserves every place attribute', () => {
    const i = idx('location:depth2:cluj_napoca');
    const p = bin.place(i);
    expect(p.canonicalKey).toBe('location:depth2:cluj_napoca');
    expect(p.displayName).toBe('Cluj-Napoca');
    expect(p.depth).toBe(2);
    expect(p.languageCode).toBe('ro');
    expect(bin.populationOf(i)).toBe(320000);
    expect(bin.dominant(i)).toBe(true);
    expect(bin.stopword(i)).toBe(false);
    expect(bin.isLeaf(i)).toBe(true); // depth 2 = deepest for ro
  });

  it('precomputes isMajor = container | capital | seat | dominant', () => {
    expect(bin.isMajor(idx('location:depth1:cluj'))).toBe(true); // container
    expect(bin.isMajor(idx('location:depth2:cluj_napoca'))).toBe(true); // dominant seat leaf
    expect(bin.isMajor(idx('location:depth2:dup_cluj'))).toBe(false); // non-dominant leaf
  });

  it('reconstructs the ancestor chain', () => {
    expect(bin.parentsOf(idx('location:depth2:cluj_napoca'))).toEqual([
      idx('location:depth1:cluj'),
      idx('location:depth0:romania'),
    ]);
    expect(bin.parentsOf(idx('location:depth0:romania'))).toEqual([]);
  });

  it('resolves surfaces via binary search, incl. 1:many and misses', () => {
    expect(bin.exact('cluj napoca')).toEqual([idx('location:depth2:cluj_napoca')]);
    expect(bin.exact('kolozsvar')).toEqual([idx('location:depth2:cluj_napoca')]); // exonym
    expect(new Set(bin.exact('dup'))).toEqual(
      new Set([idx('location:depth2:dup_cluj'), idx('location:depth2:dup_alba')]),
    );
    expect(bin.exact('nowhere')).toEqual([]);
    expect(bin.exact('')).toEqual([]);
  });

  it('supports lazy fuzzy for the structured path', () => {
    expect(bin.fuzzy('cluj napoca', 5)?.index).toBe(idx('location:depth2:cluj_napoca')); // exact, dist 0
    expect(bin.fuzzy('kolozsvat', 5)?.index).toBe(idx('location:depth2:cluj_napoca')); // 1-edit typo
    expect(bin.fuzzy('xy', 5)).toBeNull(); // below min length
  });
});

describe('GZB is a drop-in under the resolver', () => {
  it('resolves a dominant seat bare (the population tiebreak, realized in data)', () => {
    const k = keys('we are hiring in Cluj-Napoca', resolver());
    expect(k).toContain('location:depth2:cluj_napoca');
    expect(k).toContain('location:depth1:cluj'); // inferred parent
    expect(k).toContain('location:depth0:romania');
  });

  it('abstains on an ambiguous non-dominant name with no corroboration', () => {
    expect(keys('a job in Dup', resolver())).toEqual([]);
  });

  it('disambiguates the ambiguous name via its admin container in text', () => {
    const k = keys('a job in Dup, part of Alba', resolver());
    expect(k).toContain('location:depth2:dup_alba');
    expect(k).not.toContain('location:depth2:dup_cluj');
  });

  it('suppresses a stop-word place when its surfaces feed cfg.stopNames', () => {
    // Without wiring, the container resolves bare…
    expect(keys('the delta region', resolver())).toContain('location:depth1:delta');
    // …with the binary's stop surfaces wired into the resolver, it is suppressed.
    expect(bin.stopSurfaces()).toContain('delta');
    expect(keys('the delta region', resolver(bin.stopSurfaces()))).toEqual([]);
  });
});
