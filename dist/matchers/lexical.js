/**
 * Baseline lexical matcher — exact / phrase / fuzzy only, no neural.
 *
 * Parity baseline to compare against additive-hybrid, and the default for any
 * bucket that should never use semantic matching. A single flat floor (no
 * asymmetry needed without a neural path).
 */
import { exactClauses, fuzzyClauses, phraseClauses, SOURCE_FIELDS, topHits } from './strategy.js';
const LEXICAL_FLOOR = 5;
const AMBIGUITY_MARGIN_RATIO = 0.15;
/** Shared resolution: floor + close-score/collar ambiguity. Used by both the general
 *  lexical strategy and the finite-safe one (identical selection semantics). */
function selectLexical(response, item) {
    const [first, second] = topHits(response, item, 2);
    if (!first || first.score < LEXICAL_FLOOR)
        return { status: 'unresolved' };
    if (second && second.score >= LEXICAL_FLOOR) {
        const closeInScore = (first.score - second.score) / first.score <= AMBIGUITY_MARGIN_RATIO;
        const collarConflict = !!first.collarKind && !!second.collarKind && first.collarKind !== second.collarKind;
        if (closeInScore || collarConflict) {
            return { status: 'ambiguous', candidates: [first.key, second.key] };
        }
    }
    return { status: 'resolved', key: first.key, score: first.score };
}
export const lexicalStrategy = {
    name: 'lexical',
    buildQuery(item, ctx) {
        return {
            query: {
                bool: {
                    filter: ctx.buildFilters(item.bucket, item.locale),
                    should: [...exactClauses(item.surface, item.locale), ...fuzzyClauses(item.surface, item.locale)],
                    minimum_should_match: 1,
                },
            },
            size: 2,
            _source: SOURCE_FIELDS,
        };
    },
    select: selectLexical,
};
/**
 * Finite-safe lexical strategy — EXACT keyword + PHRASE only, NO edit-distance fuzzy.
 *
 * Finite buckets are discrete categories where a near-miss maps to the WRONG slug
 * (driving licence B↔C, part↔full, day↔night shift). Edit-distance fuzzy there is
 * "only ever a false positive" (see `fuzzyClauses`) and, at FUZZY_BOOST=8 > floor=5,
 * a fuzzy-only hit would still resolve. Recall for these buckets is instead carried
 * by the precise regex-inference layer (unioned in `aliasLookup`), so the OS side
 * stays strictly accurate: only true alias/phrase hits count.
 */
export const finiteLexicalStrategy = {
    name: 'finite-lexical',
    buildQuery(item, ctx) {
        return {
            query: {
                bool: {
                    filter: ctx.buildFilters(item.bucket, item.locale),
                    should: [...exactClauses(item.surface, item.locale), ...phraseClauses(item.surface)],
                    minimum_should_match: 1,
                },
            },
            size: 2,
            _source: SOURCE_FIELDS,
        };
    },
    select: selectLexical,
};
