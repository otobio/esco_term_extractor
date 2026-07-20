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
import type { Currency, SalaryRange } from '../types.js';
export type { Currency, SalaryRange };
/** Extract salary ranges from free text. Returns [] when nothing validates. */
export declare function extractSalary(text: string): SalaryRange[];
