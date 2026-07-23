/**
 * Compositional head-noun + modifier matcher for `benefits`/`compensation`.
 *
 * Benefit and compensation phrases are almost always `[modifier]* HEAD_NOUN` —
 * "private health insurance", "annual leave", "night shift premium",
 * "performance bonus". `finiteLexicalStrategy` (see matchers/lexical.ts) is
 * exact/phrase-only by design for these buckets — a near-miss must never
 * resolve to the wrong discrete key — so it explicitly punts RECALL to this
 * inference layer. But a literal alias match breaks the moment a real posting
 * adds, drops, or reorders a modifier the alias didn't anticipate ("private
 * health insurance" vs. the dictionary's "Health Insurance"/"private medical
 * insurance" — neither is a phrase-subset of the other).
 *
 * Rather than one literal regex per phrasing (whack-a-mole that never
 * generalizes — see the old per-phrase rules this file replaces), each FAMILY
 * anchors on the HEAD noun (the concept: insurance/leave/bonus/allowance/…)
 * and a small locale-scoped set of MODIFIERS narrows it to the specific
 * canonical key, with a default key when the head fires but no modifier does.
 * New phrasing = one new synonym in an existing head/modifier word list, not a
 * new rule — coverage grows linearly with vocabulary, not with phrase count.
 *
 * `deriveBenefitVariations`/`deriveCompensationVariations` register into
 * `inference/index.ts`'s `REGISTRY` like any other bucket inferer — they
 * already match the `InferFn` shape `(clauses, languages?) => InferredTerm[]`
 * — but internally this module owns its own matching primitive (head+modifier
 * families) rather than the flat `IdiomRule[]` shape the other bucket modules
 * use, since a single literal regex per rule is exactly the whack-a-mole this
 * file replaces.
 *
 * Coverage note: EN and RO get full modifier decomposition (space-separated,
 * gold-listing-verified vocabulary carried over from the rules this file
 * replaces). HU gets decomposition where the dictionary's own aliases show
 * space-separated phrasing (e.g. "magan egeszsegugyi biztositas"). ET is kept
 * head-only or omitted per family where its aliases are single fused
 * compounds (e.g. "eratervisekindlustus") rather than combinable modifier+head
 * phrases — a word-boundary modifier regex can't isolate a prefix inside a
 * fused compound, and the compound forms are already exact dictionary aliases
 * with no recombination gap to close (same conclusion the file this replaces
 * documented locale-by-locale).
 */
import type { Clause } from '../tokenizer.js';
import type { SupportedLanguage } from '../types.js';
import { type InferredTerm } from './shared.js';
export declare function deriveBenefitVariations(clauses: Clause[], languages?: SupportedLanguage[]): InferredTerm[];
export declare function deriveCompensationVariations(clauses: Clause[], languages?: SupportedLanguage[]): InferredTerm[];
