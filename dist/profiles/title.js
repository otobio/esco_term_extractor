/**
 * Title resolve profile — a clear pipeline over the uniform BucketLookup set.
 *
 *   splitClauses         → clauses
 *   scan (lookupAll)     → per-clause alias hits (ONE number-aware pass, all buckets)
 *   location (gazetteer) → resolved early, local, no OS round trip
 *   residual             → peel modifier spans (level/workplace/…/location) → occupation core
 *   candidates           → each bucket's OS surfaces (its own mechanism)
 *   match (one _msearch)  → responses
 *   finalize             → each bucket's results (OS and/or local gazetteer)
 *
 * Candidate generation lives in its own stage, not inside the match loop, so the
 * pipeline reads top-to-bottom. Location resolves locally via the gazetteer;
 * occupation/capabilities via OS additive; finite buckets via OS lexical — all
 * behind the same interface, no per-bucket special-casing here.
 *
 * Two extra stages run after finalize: (7) an optional dense-agreement verify —
 * stamps each non-location resolved term with the MAX cosine in [0,1] between its
 * span and the term's same-locale surfaces (or the English display name as a
 * cross-lingual fallback), never reordering or removing; (8) collar_kind derived
 * from the resolved occupation via the occupation→collar graph edge, merged with
 * any explicitly-stated collar_kind (highest score per key) — runs after verify
 * so the derived, non-OS term is never sent for dense agreement.
 *
 * The alt occupation engine (`inferOccupation`) is kicked off right after clause
 * splitting so it overlaps with the OS `_msearch`, and is awaited only at the
 * end. It is still in dev, so a failure must never break the profile — a
 * rejection degrades to no alt output, surfaced alongside `byBucket.occupation`
 * rather than merged into it.
 *
 * The alias scan (`lookupAll`) covers the locale plus `en`+`global`, mirroring
 * `buildFilters`, so English/global surfaces are always found even when the
 * locale is a country code whose surfaces are English (e.g. `ng` — English
 * titles, only the location stored as `ng`).
 *
 * `countryCode` gates the gazetteer by COUNTRY and is distinct from `locale`
 * (the text language) — defaults to `locale`, which coincides for single-country
 * locales but must be passed explicitly for en/hu/et callers.
 */
import { timed } from '@term-extractor/utils/perf';
import { inferLocation, setGazetteer } from '../inference/location.js';
import { inferOccupation } from '../inference/occupation.js';
import { numberVariants } from '../matchers/morphology.js';
import { buildFilters, strategyForBucket } from '../matchers/resolve.js';
import { splitClauses } from '../tokenizer.js';
import { computeResidual, LOOKUPS, } from './lookups.js';
const PEEL_BUCKETS = new Set(LOOKUPS.filter((l) => l.peels).map((l) => l.bucket));
const DISPLAY_SOURCE = ['canonical_key', 'value', 'display_name', 'aliases', 'searchable', 'language_code'];
const ALT_OCCUPATION_LIMIT = 2;
export async function resolveTitle(text, deps) {
    const { client, lexical, gazetteer, locale } = deps;
    const countryCode = deps.countryCode ?? locale;
    setGazetteer(gazetteer);
    const clauses = splitClauses(text, 'text');
    if (!clauses.length)
        return { clauses: [], byBucket: {} };
    const langs = locale
        ? [...new Set(locale === 'en' ? ['en', 'global'] : [locale, 'en', 'global'])]
        : undefined;
    const expand = (gram) => numberVariants(gram, locale);
    const scan = clauses.map((clause) => lexical.lookupAll(clause.text, langs, expand));
    // Resolved ahead of the residual so its matched span peels like other modifiers.
    // A hierarchy-inferred term (`evidence[].clause` = "inferred from …") never
    // appeared in the text, so it's excluded from what gets peeled.
    const locationTerms = gazetteer
        ? await timed(() => inferLocation(clauses, countryCode), 'title_location')
        : [];
    const locationGrams = locationTerms.flatMap((t) => t.evidence.filter((e) => !e.clause.startsWith('inferred from ')).map((e) => e.clause));
    const residual = computeResidual(clauses, scan, PEEL_BUCKETS, locale, locationGrams);
    const ctx = { locale, countryCode, gazetteer, residual, titleMode: true, locationTerms };
    const plan = [];
    for (const lookup of LOOKUPS) {
        for (const candidate of lookup.candidates(clauses, scan, ctx))
            plan.push({ lookup, candidate });
    }
    const matchCtx = { queryModelId: await client.queryModelId(), buildFilters };
    const responses = plan.length
        ? await timed(() => client.msearch(plan.map(({ lookup, candidate }) => {
            const q = strategyForBucket(lookup.bucket).buildQuery({ bucket: lookup.bucket, surface: candidate.surface, locale }, matchCtx);
            q._source = DISPLAY_SOURCE;
            return q;
        })), `title_bucket_scan plan=${plan.length}`)
        : [];
    const byLookup = new Map();
    plan.forEach((p, i) => {
        const list = byLookup.get(p.lookup) ?? [];
        list.push({ ...p.candidate, response: responses[i] });
        byLookup.set(p.lookup, list);
    });
    const byBucket = {};
    for (const lookup of LOOKUPS) {
        const terms = lookup.finalize(byLookup.get(lookup) ?? [], clauses, ctx);
        if (terms.length)
            byBucket[lookup.bucket] = terms;
    }
    if (deps.verify) {
        const rows = Object.entries(byBucket)
            .filter(([bucket]) => bucket !== 'location')
            .flatMap(([, terms]) => terms);
        if (rows.length) {
            const scores = await deps.verify(rows.map((t) => ({ span: t.span, texts: t.verifyTargets?.length ? t.verifyTargets : [t.name] })));
            rows.forEach((t, i) => {
                t.agreement = scores[i];
                if (!t.verifyTargets?.length)
                    t.agreementCrossLingual = true;
                delete t.verifyTargets;
            });
        }
    }
    if (deps.collar && byBucket.occupation?.length) {
        const derived = deriveCollarKind(byBucket.occupation, deps.collar, locale);
        if (derived) {
            const byKey = new Map((byBucket.collar_kind ?? []).map((t) => [t.key, t]));
            const prev = byKey.get(derived.key);
            if (!prev || derived.score > prev.score)
                byKey.set(derived.key, derived);
            byBucket.collar_kind = [...byKey.values()].sort((a, b) => b.score - a.score);
        }
    }
    const altP = timed(() => inferOccupation(clauses, locale, {
        limit: ALT_OCCUPATION_LIMIT,
        ...(deps.companyType && { companyType: deps.companyType }),
    }).catch(() => []), 'title_alt_occupation');
    const altOccupation = await altP;
    return {
        clauses: clauses.map((c) => c.text),
        byBucket,
        ...(altOccupation.length ? { altOccupation } : {}),
    };
}
function deriveCollarKind(occupations, collar, locale) {
    for (const o of [...occupations].sort((a, b) => b.score - a.score)) {
        const edge = collar.lookup(o.key);
        if (!edge)
            continue;
        return {
            key: edge.collar,
            name: edge.collar.split(':').pop() ?? edge.collar,
            score: edge.confidence,
            lang: locale ?? 'global',
            status: 'resolved',
            span: `derived from occupation: ${o.name}`,
        };
    }
    return null;
}
