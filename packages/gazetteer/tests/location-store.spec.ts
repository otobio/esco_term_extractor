import { describe, expect, it } from 'vitest';
import { enrich, type RawRow } from '../src/location-store.ts';

/*
 * STANDARDIZED gazetteer tests (see gazetteer.spec.ts).
 *
 * enrich() is pure (RawRow[] -> LocationRecord[] + report), so these tests build
 * synthetic rows directly — no real GeoNames dump, no MySQL, no real place names.
 * Country tag is an OPAQUE string; enrich() never inspects it beyond grouping.
 */

const CC = 'zz';

const country = (id: string): RawRow => ({
  id,
  name: 'Country',
  type: 'country',
  country_code: CC,
  parent_id: '',
  population: '',
  is_capital: '0',
  is_seat: '0',
  is_lower_seat: '0',
  alternate_names: '',
});

const settlement = (over: Partial<RawRow> & { id: string; name: string; parent_id: string }): RawRow => ({
  type: 'settlement',
  country_code: CC,
  population: '',
  is_capital: '0',
  is_seat: '0',
  is_lower_seat: '0',
  alternate_names: '',
  ...over,
});

function keysOf(records: ReturnType<typeof enrich>['records']): Set<string> {
  return new Set(records.map((r) => r.name));
}

describe('enrich() population-floor pruning: lower-tier seats with unknown population', () => {
  it('rescues a lower-tier admin seat whose population is 0 (a data gap, not a verified-empty place)', () => {
    const raw = [
      country('C'),
      settlement({ id: 'S1', name: 'Lowtown', parent_id: 'C', population: '0', is_lower_seat: '1' }),
    ];
    const { records, report } = enrich(raw, { minPopulation: 3000 });
    expect(keysOf(records)).toContain('Lowtown');
    expect(report.rescuedUnknownPopulationSeats).toBe(1);
    expect(report.prunedSettlements).toBe(0);
  });

  it('rescues a lower-tier admin seat whose population is missing entirely (not just literal 0)', () => {
    const raw = [
      country('C'),
      settlement({ id: 'S1', name: 'Nodata', parent_id: 'C', population: '', is_lower_seat: '1' }),
    ];
    const { records, report } = enrich(raw, { minPopulation: 3000 });
    expect(keysOf(records)).toContain('Nodata');
    expect(report.rescuedUnknownPopulationSeats).toBe(1);
  });

  it('still prunes a lower-tier admin seat with a real, known-low population (no regression)', () => {
    const raw = [
      country('C'),
      settlement({ id: 'S1', name: 'Smallseat', parent_id: 'C', population: '500', is_lower_seat: '1' }),
    ];
    const { records, report } = enrich(raw, { minPopulation: 3000 });
    expect(keysOf(records)).not.toContain('Smallseat');
    expect(report.prunedSettlements).toBe(1);
    expect(report.rescuedUnknownPopulationSeats).toBe(0);
  });

  it('still prunes an ordinary non-seat settlement with population 0 (rescue is seat-scoped, not a blanket exemption)', () => {
    const raw = [country('C'), settlement({ id: 'S1', name: 'Emptydata', parent_id: 'C', population: '0' })];
    const { records, report } = enrich(raw, { minPopulation: 3000 });
    expect(keysOf(records)).not.toContain('Emptydata');
    expect(report.prunedSettlements).toBe(1);
    expect(report.rescuedUnknownPopulationSeats).toBe(0);
  });

  it('still keeps a first-order (ADM1) seat with population 0 — pre-existing unconditional exemption, unchanged', () => {
    const raw = [
      country('C'),
      settlement({ id: 'S1', name: 'Countyseat', parent_id: 'C', population: '0', is_seat: '1' }),
    ];
    const { records, report } = enrich(raw, { minPopulation: 3000 });
    expect(keysOf(records)).toContain('Countyseat');
    // Counted as an ordinary first-order-seat keep, not the new lower-tier rescue path.
    expect(report.rescuedUnknownPopulationSeats).toBe(0);
  });

  it('never marks a rescued lower-tier seat as isAdminSeat (resolver bare-mention trust stays scoped to first-order seats)', () => {
    const raw = [
      country('C'),
      settlement({ id: 'S1', name: 'Lowtown', parent_id: 'C', population: '0', is_lower_seat: '1' }),
      settlement({ id: 'S2', name: 'Countyseat', parent_id: 'C', population: '0', is_seat: '1' }),
    ];
    const { records } = enrich(raw, { minPopulation: 3000 });
    const lowtown = records.find((r) => r.name === 'Lowtown');
    const countyseat = records.find((r) => r.name === 'Countyseat');
    expect(lowtown?.isAdminSeat).toBe(false);
    expect(countyseat?.isAdminSeat).toBe(true);
  });

  it('keeps a plain settlement whose known population meets the floor, regardless of seat tier', () => {
    const raw = [country('C'), settlement({ id: 'S1', name: 'Bigtown', parent_id: 'C', population: '5000' })];
    const { records, report } = enrich(raw, { minPopulation: 3000 });
    expect(keysOf(records)).toContain('Bigtown');
    expect(report.rescuedUnknownPopulationSeats).toBe(0);
  });
});

describe('HU alias surfaces keep the current tree while adding the new public labels', () => {
  it('adds Magyarország to the synthetic Hungary country row without changing the tree shape', () => {
    const raw = [
      {
        id: 'C_hu',
        name: 'Hungary',
        type: 'country',
        country_code: 'hu',
        parent_id: '',
        population: '',
        is_capital: '0',
        is_seat: '0',
        is_lower_seat: '0',
        alternate_names: JSON.stringify(['Magyarország']),
      },
    ];
    const { records } = enrich(raw);
    const country = records.find((r) => r.name === 'Hungary');
    expect(country?.parentKey).toBeNull();
    expect(country?.surfaces.map((s) => s.text)).toContain('magyarorszag');
  });

  it('keeps the Csongrád tree but adds the newer Csongrád-Csanád surface', () => {
    const raw = [
      country('C'),
      settlement({
        id: 'S1',
        name: 'Csongrád megye',
        parent_id: 'C',
        population: '423751',
        type: 'admin1',
        alternate_names: 'Csongrád-Csanád megye',
      }),
    ];
    const { records } = enrich(raw, { minPopulation: 0 });
    const county = records.find((r) => r.name === 'Csongrád megye');
    expect(county?.key).toBeDefined();
    expect(county?.surfaces.map((s) => s.text)).toEqual(
      expect.arrayContaining(['csongrad megye', 'csongrad csanad megye', 'csongrad megye county']),
    );
  });
});
