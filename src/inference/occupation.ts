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

import { type GetCanonicalTermInput, type GetCanonicalTermResult, getCanonicalTerm } from 'occupation-search-engine';
import type { Clause } from '../tokenizer.js';
import type { ExtractedTerm, SupportedLanguage } from '../types.js';

/** The one call `inferOccupation` depends on — the package's `getCanonicalTerm`,
 *  or a stand-in installed for tests / alternate wiring. */
export type OccupationResolver = (input: GetCanonicalTermInput) => Promise<GetCanonicalTermResult>;

let resolver: OccupationResolver = getCanonicalTerm;

export interface InferOccupationOptions {
  limit?: number;
  jobFunction?: string;
}

/** Install/override the global occupation resolver (tests, alternate wiring).
 *  `undefined` restores the package default. */
export function setOccupationResolver(r: OccupationResolver | undefined): void {
  resolver = r ?? getCanonicalTerm;
}

export async function inferOccupation(
  clauses: Clause[],
  locale?: SupportedLanguage,
  options: InferOccupationOptions | number = {},
): Promise<ExtractedTerm[]> {
  const input = clauses
    .map((c) => c.text)
    .join(', ')
    .trim();
  if (!input) return [];

  const resolvedOptions = typeof options === 'number' ? { limit: options } : options;
  const result = await resolver({ input, locale, ...resolvedOptions });
  const lang = locale ?? 'global';
  const term = (name: string, termType: string, score: number, span: string): ExtractedTerm => ({
    bucket: 'occupation',
    canonicalKey: slugify(name),
    displayName: name,
    termType,
    languageCode: lang,
    score,
    method: 'inferred',
    evidence: [{ clause: span, method: 'inferred', score }],
  });

  // Each `occupationContext` is ONE detected role (span). A single-role title carries
  // exactly one context; a multi-role title (decisionType 'multi_span', e.g. "LUCRATOR
  // COMERCIAL / AJUTOR BUCATAR FAST FOOD") carries one context PER role — the engine's
  // authoritative per-role results. We emit each role's top leaves + its single winning
  // family (occupation group), tagging evidence with the role's span so a consumer sees
  // which part of the title each occupation came from. Fall back to the top-level
  // leaf/family fields if the engine returned no contexts.
  //
  // Capability terms are intentionally NOT emitted: they describe the resolved
  // occupation, not terms grounded in the title, so a wrong occupation guess would
  // yield wrongly-grounded capabilities. Capability extraction stays evidence-based
  // in the main extractor.
  const roles = result.occupationContexts?.length
    ? result.occupationContexts.map((c) => ({
        span: c.input || input,
        leaves: c.leafCanonicalTerms,
        family: c.familyCanonicalTerms[0],
      }))
    : [{ span: input, leaves: result.leafCanonicalTerms, family: result.familyCanonicalTerms[0] }];

  const out: ExtractedTerm[] = [];
  for (const role of roles) {
    for (const l of role.leaves) out.push(term(l.canonicalTerm, 'occupation', l.confidence, role.span));
    if (role.family) out.push(term(role.family.canonicalTerm, 'occupation_group', role.family.confidence, role.span));
  }
  return out;
}

function slugify(label: string): string {
  return (
    label
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'x'
  );
}
