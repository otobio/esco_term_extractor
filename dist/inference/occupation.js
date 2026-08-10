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
import { getCanonicalTerm } from 'occupation-search-engine';
import { OCCUPATION_FAMILIES } from '../finite-values.js';
import { lookupOccupationFamilySlugs } from './facets.js';
let resolver = getCanonicalTerm;
/** Install/override the global occupation resolver (tests, alternate wiring).
 *  `undefined` restores the package default. */
export function setOccupationResolver(r) {
    resolver = r ?? getCanonicalTerm;
}
export async function inferOccupation(clauses, locale, options = {}) {
    const input = clauses
        .map((c) => c.text)
        .join(', ')
        .trim();
    if (!input)
        return [];
    const resolvedOptions = typeof options === 'number' ? { limit: options } : options;
    let result;
    try {
        result = await resolver({ input, locale, ...resolvedOptions });
    }
    catch (err) {
        console.error('inferOccupation failed:', err);
        return [];
    }
    const lang = locale ?? 'global';
    const term = (name, termType, score, span) => ({
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
    const out = [];
    for (const role of roles) {
        for (const l of role.leaves)
            out.push(term(l.canonicalTerm, 'occupation', l.confidence, role.span));
        if (role.family)
            out.push(term(role.family.canonicalTerm, 'occupation_group', role.family.confidence, role.span));
    }
    return out;
}
const OCCUPATION_FAMILY_BY_SLUG = new Map(OCCUPATION_FAMILIES.map((f) => [f.slug, f]));
/**
 * Additive, lexical-only `alt_family` signal derived from a structured `job_function`
 * surface (e.g. an HU category label). No leaves, no semantic engine call — an exact
 * lookup against the ESCO occupation-family table (see `lookupOccupationFamilySlugs`).
 * Never touches job_function resolution itself; this is a sibling occupation-bucket
 * output, mirroring `inferOccupation`'s own `occupation_group` shape.
 */
export function inferAltFamilyFromJobFunction(surface, locale) {
    if (!locale)
        return [];
    const lang = locale;
    const score = 0.93;
    return lookupOccupationFamilySlugs(surface, locale).flatMap((slug) => {
        const family = OCCUPATION_FAMILY_BY_SLUG.get(slug);
        if (!family)
            return [];
        return [
            {
                bucket: 'occupation',
                canonicalKey: family.slug,
                displayName: family.label,
                termType: 'occupation_group',
                languageCode: lang,
                score,
                method: 'lexical',
                evidence: [{ clause: surface, method: 'lexical', score }],
            },
        ];
    });
}
function slugify(label) {
    return (label
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '') || 'x');
}
