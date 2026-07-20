import { describe, expect, it } from 'vitest';
import { extractSalary } from '../src/salary/salary.ts';

const one = (t: string) => extractSalary(t)[0];

describe('salary parsing', () => {
  it('parses a RON range and infers monthly', () => {
    const r = one('Pachetul salarial: 3400-3800 lei');
    expect(r).toMatchObject({ minAmount: 3400, maxAmount: 3800, currency: 'RON', period: 'month' });
    expect(r.periodInferred).toBe(true);
  });

  it('parses gross monthly with explicit period + tax', () => {
    const r = one('Gross monthly salary: 9572 RON');
    expect(r).toMatchObject({ minAmount: 9572, currency: 'RON', period: 'month', taxMode: 'gross' });
    expect(r.periodInferred).toBe(false);
  });

  it('parses EUR net per month (Romanian period word)', () => {
    expect(one('2500 EUR net / luna')).toMatchObject({
      minAmount: 2500,
      currency: 'EUR',
      period: 'month',
      taxMode: 'net',
    });
  });

  it('parses a weekly EUR range', () => {
    expect(one('610 - 660 EUR net / saptamana')).toMatchObject({
      minAmount: 610,
      maxAmount: 660,
      currency: 'EUR',
      period: 'week',
      taxMode: 'net',
    });
  });

  it('handles Romanian "." thousands separator', () => {
    expect(one('Salariu: 4.500 – 5.000 lei brut')).toMatchObject({
      minAmount: 4500,
      maxAmount: 5000,
      currency: 'RON',
      taxMode: 'gross',
    });
  });

  it('handles English "between X and Y" and "," thousands', () => {
    expect(one('salary range is between 4,786 and 6,500 RON gross')).toMatchObject({
      minAmount: 4786,
      maxAmount: 6500,
      currency: 'RON',
      taxMode: 'gross',
    });
  });

  it('handles k-notation with cue and explicit period', () => {
    expect(one('competitive salary 60k USD per year')).toMatchObject({
      minAmount: 60000,
      currency: 'USD',
      period: 'year',
    });
  });

  it('accepts a bare amount with a currency, tax and inferred period', () => {
    expect(one('Agent Turism Junior (4000 RON NET)')).toMatchObject({
      minAmount: 4000,
      currency: 'RON',
      period: 'month',
      taxMode: 'net',
    });
  });
});

describe('salary validation (the important part)', () => {
  it('rejects company turnover', () => {
    expect(extractSalary('cifra de afaceri de aproximativ 10.000.000 €')).toEqual([]);
  });

  it('rejects benefit amounts (vouchers, reimbursements)', () => {
    expect(extractSalary('Vouchere de vacanta 1.000 lei/an')).toEqual([]);
    expect(extractSalary('Decont combustibil 400 Ron')).toEqual([]);
  });

  it('rejects an amount too large to be a salary (magnitude bound)', () => {
    expect(extractSalary('profit anual de 10.000.000 lei')).toEqual([]); // 10M RON/yr > bound
  });

  it('rejects a number with no currency and no pay cue', () => {
    expect(extractSalary('echipa de 3400 de angajati')).toEqual([]); // 3400 employees
    expect(extractSalary('peste 400 de orase din Europa')).toEqual([]);
  });

  it('does not treat years of experience as salary', () => {
    expect(extractSalary('minim 5 ani experienta')).toEqual([]);
  });
});
