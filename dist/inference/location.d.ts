/**
 * Location inference — the single entry point the extractor and profiles use to turn
 * clauses into location terms. Mirrors the `infer*` naming of the other inference rules.
 *
 * The gazetteer is maintained as a standalone sub-module; `inferLocation` owns a
 * process-**global** gazetteer resolver (lazily loaded from the packed binary), so
 * callers just pass clauses. `mode` selects the gazetteer's free-text vs
 * structured-field path; `countryCode` applies the per-country gate. The gazetteer's
 * own `resolve()` is left untouched for direct/standalone use.
 */
import type { GazetteerResolver } from '@term-extractor/gazetteer';
import type { Clause } from '../tokenizer.js';
import type { ExtractedTerm } from '../types.js';
export type LocationMode = 'unstructured' | 'structured';
/** Install/override the global gazetteer resolver (production wiring, tests). Once
 *  called, disables the lazy auto-load from GAZETTEER_DIR. */
export declare function setGazetteer(r: GazetteerResolver | undefined): void;
export declare function inferLocation(clauses: Clause[], countryCode?: string, mode?: LocationMode): ExtractedTerm[];
