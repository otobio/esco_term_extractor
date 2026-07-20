/**
 * Occupation inference — the single entry point the extractor and profiles use to
 * turn clauses into occupation terms. Mirrors the `infer*` naming (and the global-
 * resolver shape) of `inferLocation`.
 *
 * The occupation search engine is maintained as a standalone package (symlinked in
 * as `packages/occupation`); `inferOccupation` owns a process-**global** resolver
 * that defaults to the package's `getCanonicalTerm()`. Callers just pass clauses +
 * locale. Unlike the gazetteer, `getCanonicalTerm` is async (it runs the embedding
 * search pipeline over the runtime artifacts), so `inferOccupation` is async too.
 */
import { type GetCanonicalTermInput, type GetCanonicalTermResult } from 'occupation-search-engine';
import type { Clause } from '../tokenizer.js';
import type { ExtractedTerm, SupportedLanguage } from '../types.js';
/** The one call `inferOccupation` depends on — the package's `getCanonicalTerm`,
 *  or a stand-in installed for tests / alternate wiring. */
export type OccupationResolver = (input: GetCanonicalTermInput) => Promise<GetCanonicalTermResult>;
/** Install/override the global occupation resolver (tests, alternate wiring).
 *  `undefined` restores the package default. */
export declare function setOccupationResolver(r: OccupationResolver | undefined): void;
export declare function inferOccupation(clauses: Clause[], locale?: SupportedLanguage, limit?: number): Promise<ExtractedTerm[]>;
