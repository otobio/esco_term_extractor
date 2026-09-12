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
export interface InferOccupationOptions {
    limit?: number;
    jobFunction?: string;
    /** 'v2' (default here) routes through the newer occupation-classifier; 'v1' opts back into
     *  the legacy OccupationSearchPipeline. Passed straight through to `getCanonicalTerm`, whose
     *  own package default is still 'v1' — this call site is what makes v2 the default. */
    mode?: 'v1' | 'v2';
}
/** Install/override the global occupation resolver (tests, alternate wiring).
 *  `undefined` restores the package default. */
export declare function setOccupationResolver(r: OccupationResolver | undefined): void;
export declare function inferOccupation(clauses: Clause[], locale?: SupportedLanguage, options?: InferOccupationOptions | number): Promise<ExtractedTerm[]>;
/**
 * Additive, lexical-only `alt_family` signal derived from a structured `job_function`
 * surface (e.g. an HU category label). No leaves, no semantic engine call — an exact
 * lookup against the ESCO occupation-family table (see `lookupOccupationFamilySlugs`).
 * Never touches job_function resolution itself; this is a sibling occupation-bucket
 * output, mirroring `inferOccupation`'s own `occupation_group` shape.
 */
export declare function inferAltFamilyFromJobFunction(surface: string, locale?: SupportedLanguage): ExtractedTerm[];
/** An idea to expand later */
