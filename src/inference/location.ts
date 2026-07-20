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
import { openGazetteerSync } from '@term-extractor/gazetteer';
import type { Clause } from '../tokenizer.js';
import type { ExtractedTerm } from '../types.js';

export type LocationMode = 'unstructured' | 'structured';

let resolver: GazetteerResolver | undefined;
let initialized = false;

/** Install/override the global gazetteer resolver (production wiring, tests). Once
 *  called, disables the lazy auto-load from GAZETTEER_DIR. */
export function setGazetteer(r: GazetteerResolver | undefined): void {
  resolver = r;
  initialized = true;
}

function gazetteer(): GazetteerResolver | undefined {
  if (!initialized) {
    // GAZETTEER_DIR overrides; otherwise the package's own default data dir.
    resolver = openGazetteerSync(process.env.GAZETTEER_DIR);
    initialized = true;
  }
  return resolver;
}

export function inferLocation(
  clauses: Clause[],
  countryCode?: string,
  mode: LocationMode = 'unstructured',
): ExtractedTerm[] {
  const gaz = gazetteer();
  if (!gaz) return [];
  if (mode === 'structured') {
    const value = clauses
      .map((c) => c.text)
      .join(', ')
      .trim();
    return value ? gaz.resolve([], value, countryCode) : [];
  }
  return gaz.resolve(clauses, undefined, countryCode);
}
