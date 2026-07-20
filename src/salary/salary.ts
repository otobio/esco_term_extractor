/**
 * Salary-range extraction: free text → structured { min, max, currency, period,
 * taxMode }. This is NOT a canonical-term bucket — it's numeric parsing plus
 * heavy validation. The validation is the point: an amount is only accepted when
 * (a) a currency or explicit pay cue is present, (b) it is NOT in a non-salary
 * money context (turnover, investment, vouchers, counts), and (c) its magnitude
 * is plausible for its currency + period (otherwise it's turnover, a typo, etc.).
 *
 * Per-locale word lists live in ./locales.ts; currency and amount/range syntax
 * are language-neutral. Refine the bounds / lexicons as we see more data.
 */

import type { Currency, SalaryRange } from '../types.ts';
import { type Period, SALARY_LOCALES } from './locales.ts';

export type { Currency, SalaryRange };

const CURRENCY_RE: [RegExp, Currency][] = [
  [/€|\beur\b|euro/i, 'EUR'],
  [/\$|\busd\b|dollars?/i, 'USD'],
  [/\b(?:ron|lei)\b/i, 'RON'],
  [/\b(?:huf|ft|forint)\b/i, 'HUF'],
];

/** Plausible [min, max] pay per currency + period. Out-of-bounds ⇒ not a salary. */
const BOUNDS: Record<Currency, Record<Period, [number, number]>> = {
  RON: { hour: [8, 1000], day: [50, 5000], week: [200, 25000], month: [800, 150000], year: [10000, 2000000] },
  EUR: { hour: [3, 500], day: [20, 3000], week: [80, 12000], month: [300, 60000], year: [4000, 800000] },
  USD: { hour: [3, 500], day: [20, 3000], week: [80, 12000], month: [300, 60000], year: [4000, 800000] },
  HUF: {
    hour: [1000, 200000],
    day: [5000, 1500000],
    week: [20000, 4000000],
    month: [100000, 12000000],
    year: [1000000, 150000000],
  },
};
/** Order to check bounds when validating an explicit period. */
const ALL_PERIODS: Period[] = ['month', 'year', 'hour', 'week', 'day'];
/** Periods we will INFER from magnitude alone. Hour/week/day must be stated
 *  explicitly ("/oră", "/week") — a bare small amount is usually per-event / a
 *  work-hours count, not an hourly wage. */
const INFER_PERIODS: Period[] = ['month', 'year'];
const WINDOW = 36;

/** Lowercase + fold diacritics; keep digits, currency symbols and amount syntax. */
function normalizeMoney(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[–—−]/g, '-')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}€$.,/\- ]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseAmount(raw: string, hasK: boolean): number {
  const cleaned = raw.replace(/\s/g, '');
  if (hasK) return Math.round(parseFloat(cleaned.replace(',', '.')) * 1000);
  return Number(cleaned.replace(/[.,]/g, ''));
}

function detectCurrency(window: string): Currency | undefined {
  for (const [re, cur] of CURRENCY_RE) if (re.test(window)) return cur;
  return undefined;
}

function hasAny(window: string, words: string[], minLen = 3): boolean {
  for (const w of words) {
    if (w.length < minLen) continue;
    if (new RegExp(`(?:^|[^\\p{L}])${w.replace(/[/]/g, '\\/')}(?:$|[^\\p{L}])`, 'u').test(window)) return true;
  }
  return false;
}

function detectPeriod(window: string): Period | undefined {
  for (const L of SALARY_LOCALES) {
    for (const p of ALL_PERIODS) {
      // Require period markers of length >= 4 to avoid bare "an"/"zi"/"ora" noise.
      if (hasAny(window, L.period[p], 4)) return p;
    }
  }
  return undefined;
}

function detectTax(window: string): 'gross' | 'net' | undefined {
  for (const L of SALARY_LOCALES) {
    if (hasAny(window, L.gross)) return 'gross';
    if (hasAny(window, L.net)) return 'net';
  }
  return undefined;
}

function excluded(window: string): boolean {
  return SALARY_LOCALES.some((L) => hasAny(window, L.exclude));
}
function hasCue(window: string): boolean {
  return SALARY_LOCALES.some((L) => hasAny(window, L.cue));
}
function inRange(n: number, [lo, hi]: [number, number]): boolean {
  return n >= lo && n <= hi;
}

interface Classified {
  period?: Period;
  periodInferred: boolean;
  valid: boolean;
}

/** Validate an amount and settle its period (magnitude-aware). */
function classify(amount: number, currency: Currency | undefined, explicit: Period | undefined): Classified {
  if (currency) {
    if (explicit)
      return { period: explicit, periodInferred: false, valid: inRange(amount, BOUNDS[currency][explicit]) };
    for (const p of INFER_PERIODS) {
      if (inRange(amount, BOUNDS[currency][p])) return { period: p, periodInferred: true, valid: true };
    }
    return { periodInferred: false, valid: false }; // outside every band ⇒ not a salary
  }
  // No currency: rely on a pay cue + a broad sanity range only.
  return { period: explicit, periodInferred: false, valid: amount >= 50 && amount <= 10_000_000 };
}

interface Raw {
  start: number;
  end: number;
  min: number;
  max?: number;
}

const NUM = String.raw`\d[\d., ]*\d|\d`;

function collectRaw(norm: string): Raw[] {
  const out: Raw[] = [];
  const consumed: [number, number][] = [];
  const overlaps = (s: number, e: number) => consumed.some(([a, b]) => s < b && e > a);

  // Word-framed ranges, per locale ("between X and Y", "de la X la Y").
  for (const L of SALARY_LOCALES) {
    for (const [a, b] of L.rangePairs) {
      const re = new RegExp(`${a}\\s*(${NUM})\\s*(k)?\\s*${b}\\s*(${NUM})\\s*(k)?`, 'gi');
      for (const m of norm.matchAll(re)) {
        const s = m.index!;
        const e = s + m[0].length;
        if (overlaps(s, e)) continue;
        consumed.push([s, e]);
        out.push({ start: s, end: e, min: parseAmount(m[1], !!m[2]), max: parseAmount(m[3], !!m[4]) });
      }
    }
  }
  // Dash ranges (neutral).
  for (const m of norm.matchAll(new RegExp(`(${NUM})\\s*(k)?\\s*-\\s*(${NUM})\\s*(k)?`, 'gi'))) {
    const s = m.index!;
    const e = s + m[0].length;
    if (overlaps(s, e)) continue;
    consumed.push([s, e]);
    out.push({ start: s, end: e, min: parseAmount(m[1], !!m[2]), max: parseAmount(m[3], !!m[4]) });
  }
  // Single amounts (not already inside a range).
  for (const m of norm.matchAll(new RegExp(`(${NUM})\\s*(k)?`, 'gi'))) {
    const s = m.index!;
    const e = s + m[0].length;
    if (overlaps(s, e)) continue;
    out.push({ start: s, end: e, min: parseAmount(m[1], !!m[2]) });
  }
  return out;
}

/** Extract salary ranges from free text. Returns [] when nothing validates. */
export function extractSalary(text: string): SalaryRange[] {
  const norm = normalizeMoney(text);
  const results: SalaryRange[] = [];
  const seen = new Set<string>();

  for (const raw of collectRaw(norm)) {
    if (!Number.isFinite(raw.min) || raw.min <= 0) continue;
    const window = norm.slice(Math.max(0, raw.start - WINDOW), raw.end + WINDOW);
    if (excluded(window)) continue;

    const currency = detectCurrency(window);
    const cue = hasCue(window);
    if (!currency && !cue) continue; // must look like pay

    const explicit = detectPeriod(window);
    let { min } = raw;
    let max = raw.max;
    if (max !== undefined && max < min) [min, max] = [max, min];

    const c = classify(min, currency, explicit);
    if (!c.valid) continue;
    // Drop an implausible upper bound (keep the validated minimum).
    if (max !== undefined && currency && c.period && !inRange(max, BOUNDS[currency][c.period])) max = undefined;

    let confidence = currency ? (explicit ? 0.9 : 0.8) : 0.6;
    if (detectTax(window)) confidence += 0.05;
    if (max !== undefined) confidence += 0.03;
    confidence = Math.min(0.99, Math.round(confidence * 100) / 100);

    const key = `${min}|${max ?? ''}|${currency ?? ''}|${c.period ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);

    results.push({
      minAmount: min,
      maxAmount: max,
      currency,
      period: c.period,
      periodInferred: c.period ? c.periodInferred : undefined,
      taxMode: detectTax(window),
      evidence: window.trim(),
      confidence,
    });
  }

  return results.sort((a, b) => b.confidence - a.confidence);
}
