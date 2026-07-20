/**
 * Additive-hybrid term matcher for occupation + capabilities.
 *
 * Neither signal gates the other: the neural-sparse clause and the lexical
 * clauses (exact / phrase / fuzzy) all sit in `should`, so a strong lexical or
 * alias hit resolves on its own — even when neural is silent (e.g. Romanian,
 * whose docs carry no sparse vector) — while neural still surfaces English
 * paraphrase the lexicon can't. `minimum_should_match: 1` stops it returning the
 * whole bucket. Unlike a `must: neural_sparse`, the neural clause can never veto.
 *
 * Selection is ASYMMETRIC by confidence: an EXACT (term-anchored) hit is
 * grounded and accepted at a low floor; a hit that matched only via
 * phrase/fuzzy/neural is riskier and must clear a higher, per-bucket floor.
 */
import type { TermMatchStrategy } from './types.js';
export declare const additiveHybridStrategy: TermMatchStrategy;
