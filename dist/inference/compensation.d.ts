/**
 * Compensation inference — covers `performance_bonus` phrasings the dictionary's
 * exact alias match drops: the plural of "bonus" ("bonusuri de performanta",
 * "teljesitmeny bonuszok"), the "prima"/"premium" synonym RO/HU/ET use
 * interchangeably with "bonus" ("prima de performanta", "teljesitmeny premium",
 * "tulemuspreemia"), and the "sales bonus" framing in EN/HU/ET.
 *
 * Verified against real RO/EN gold-listing text; the HU/ET rules are the same
 * structural fix applied by direct translation, not individually confirmed
 * against real HU/ET listings.
 */
import type { Clause } from '../tokenizer.js';
import { type InferredTerm } from './shared.js';
export declare function inferCompensation(clauses: Clause[]): InferredTerm[];
