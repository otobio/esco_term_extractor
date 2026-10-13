import { describe, expect, it } from 'vitest';
import { openGazetteerSync } from '../src/gazetteer-bin.ts';
import { DEFAULT_EUROPEAN_COUNTRIES, DEFAULT_GEONAMES, gazetteerCountryBucket } from '../src/location-store.ts';

describe('gazetteerCountryBucket', () => {
  it.each(DEFAULT_GEONAMES.map((c) => [c.iso, c.locale]))('maps GeoNames country %s to its data locale %s', (iso, locale) => {
    expect(gazetteerCountryBucket(iso)).toBe(locale);
    expect(gazetteerCountryBucket(iso.toLowerCase())).toBe(locale);
  });

  it.each(DEFAULT_EUROPEAN_COUNTRIES.map((c) => [c.code]))('keeps synthetic country %s as its own code', (code) => {
    expect(gazetteerCountryBucket(code)).toBe(code);
    expect(gazetteerCountryBucket(code.toUpperCase())).toBe(code);
  });

  it('is idempotent on a bucket that is already a data locale', () => {
    for (const { locale } of DEFAULT_GEONAMES) expect(gazetteerCountryBucket(locale)).toBe(locale);
  });

  it('passes unknown codes through lowercased and abstains on empty', () => {
    expect(gazetteerCountryBucket('ZZ')).toBe('zz');
    expect(gazetteerCountryBucket(undefined)).toBeUndefined();
    expect(gazetteerCountryBucket('')).toBeUndefined();
  });
});

describe('every supported country resolves under its ISO code against the built gazetteer', () => {
  const gaz = openGazetteerSync();
  const countries = [
    ...DEFAULT_GEONAMES.map((c) => ({ iso: c.iso, name: c.countryName })),
    ...DEFAULT_EUROPEAN_COUNTRIES.map((c) => ({ iso: c.code, name: c.name })),
  ];

  it.skipIf(!gaz).each(countries.map((c) => [c.iso, c.name]))('%s (%s)', (iso, name) => {
    const terms = gaz!.resolve([], name, gazetteerCountryBucket(iso));
    expect(terms.length).toBeGreaterThan(0);
    expect(terms.every((t) => t.languageCode === gazetteerCountryBucket(iso))).toBe(true);
  });
});
