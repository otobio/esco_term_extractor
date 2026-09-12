import { isGenericQueryToken, isStopQueryToken } from '../query/query-preparation.js';
import conceptLeafFrequencyJson from './specialization/specialization-schema/concept-leaf-frequency.json' with { type: 'json' };
import { detectLeafLevelKind } from '../runtime/occupation-leaf-structure-rules.js';
import { loadOccupationRoleHeadEquivalenceArtifactRequired } from '../runtime/occupation-role-head-equivalence-artifact.js';
import { foldSearchText, foldWeakPunctuationLookupText, tokenizeNormalizedText } from '../utils/texts.js';
import { expandLocaleTokenVariants } from '../query/token-variants.js';
import { loadSpecializationSchemaLookup } from './specialization-schema.js';
import { isAuthorityTier, isKnownRoleHeadWord, isRankRoleHead } from './role-head-groups.js';
const cachedArtifactsByLocale = new Map();
// Translates each non-English input token to English role-head vocabulary, without ever attempting
// to translate a stopword/function word (e.g. "of", "de", "si") -- a stopword occasionally collides
// with a curated alias or equivalence-class term for an unrelated concept, which would otherwise
// "translate" it into a spurious English token and pollute the comparison query.
export async function translateTitleForClassifier(title, locale, queryRoleHeadTokens = []) {
    const foldedTitle = foldSearchText(title);
    const inputTokens = tokenizeNormalizedText(foldedTitle);
    if (locale === 'en') {
        // Modifier tokens are everything but the role head and stopwords.
        const roleHeadTokens = new Set(queryRoleHeadTokens);
        const modifierTokens = inputTokens.filter((token) => !roleHeadTokens.has(token) && !isStopQueryToken(token, locale));
        return buildCanonicalComparisonQuery({
            matchedTokens: [...inputTokens],
            modifierTokens,
            unresolvedTokens: [],
            foldedFullText: foldedTitle,
            localRoleHeadTokens: [...roleHeadTokens],
            translationUnits: []
        });
    }
    let artifactsPromise = cachedArtifactsByLocale.get(locale);
    if (!artifactsPromise) {
        artifactsPromise = loadTranslationArtifacts(locale);
        cachedArtifactsByLocale.set(locale, artifactsPromise);
    }
    const artifacts = await artifactsPromise;
    const matchedByLocalToken = new Map();
    const resolvedRoleHeadTokenSet = new Set();
    const translationUnits = [];
    // Concept-alias matches (level 1) resolve a local token to a specialization *concept* (e.g. "vanzari"
    // -> knowledge_domain concept "business", task concept "sales"), not to a literal role-head noun --
    // the specialization dimension mapper already scores that concept against the candidate's own
    // structural profile elsewhere. Recording those tokens here too, and requiring them to appear
    // verbatim in a candidate's canonical label, double-penalizes generic-role-head queries (e.g. an
    // "agent" query) against equally generic candidates that only carry the concept structurally
    // (e.g. "technical sales representative"). modifierTokenSet tracks which matched tokens came from
    // this level so callers can treat them as supporting context rather than a strict requirement.
    const modifierTokenSet = new Set();
    const resolvedTokenIndices = new Set();
    // Phrase-alias matching is computed first (but pushed below, after the rank/level pass, to keep the
    // original unit ordering for the common case), over every non-stopword token including rank/level
    // words -- a rank word can be the first half of a role-head phrase alias (e.g. "conducator auto" ->
    // driver, where "conducator" alone would otherwise be read as the rank word "chief"). Whichever
    // original token positions it consumes are recorded in resolvedTokenIndices so the rank/level and
    // safe-token passes below never get a chance to override that more accurate match.
    const phraseTokenOriginalIndices = [];
    const phraseInputTokens = inputTokens.filter((token, index) => {
        const keep = !isStopQueryToken(token, locale);
        if (keep) {
            phraseTokenOriginalIndices.push(index);
        }
        return keep;
    });
    // Curated multi-token concept aliases and curated role-head aliases (which can themselves be
    // multi-token phrases, e.g. "conducator auto" -> driver) are matched together in one greedy-longest
    // pass, ranked ahead of the broad cross-locale role-head equivalence lookup below. Matching them as
    // two separate passes (concept aliases first, in full, then role-head aliases) let a short
    // single-token concept alias grab a token before a longer overlapping role-head phrase got a
    // chance -- e.g. "auto" matching the single-token "automotive/vehicle" concept alias before
    // "conducator auto" could be tried as a 2-token role-head phrase for "driver". Running both sources
    // through the same longest-window-first search fixes that: whichever source has the longer match for
    // a given start position wins, regardless of which curated list it came from. Each match marks the
    // input token positions it translated in resolvedTokenIndices, and the less-accurate level below
    // skips those positions -- once a more accurate level has already translated a token, a less
    // accurate level must not be given the chance to override it with a different (or wrong) translation.
    // TODO: You will want to try different morph forms
    const phraseMatches = phraseAliasMatches(phraseInputTokens, artifacts.schema).filter((match) => {
        // A lone rank/level word (e.g. "ajutor") matching a single-token *concept* alias must not steal
        // the token from the more accurate rank/level translation below -- only a genuine multi-token
        // phrase, or a role-head match, is specific enough to override the rank reading.
        const isSoleRankConceptMatch = match.tokenIndices.length === 1 &&
            match.alternatives.every((alternative) => alternative.kind !== 'role_head') &&
            detectLeafLevelKind(new Set([match.localToken])) !== 'none';
        return !isSoleRankConceptMatch;
    });
    for (const match of phraseMatches) {
        for (const index of match.tokenIndices) {
            resolvedTokenIndices.add(phraseTokenOriginalIndices[index]);
        }
    }
    // Rank/level tokens (e.g. "ajutor", "sef") are excluded from safeInputTokens below so the
    // less-accurate translation levels never touch them -- but that used to mean they were silently
    // dropped from the translation entirely. LEVEL_SPECIALIZATION_SYNONYMS already gives an exact,
    // curated English word for each rank (the kind name itself, e.g. "ajutor" -> "assistant"), so
    // translate them from that table directly instead of leaving them untranslated. Tokens already
    // consumed by a phrase alias above (e.g. "conducator" inside "conducator auto") are skipped here.
    inputTokens.forEach((token, index) => {
        if (isStopQueryToken(token, locale) || resolvedTokenIndices.has(index)) {
            return;
        }
        const levelKind = detectLeafLevelKind(new Set([token]));
        if (levelKind !== 'none') {
            const alternatives = [{ kind: 'modifier', token: levelKind }];
            // Authority words like "manager"/"director"/"chief"/"supervisor" also name a real, standalone
            // occupation ("Project Manager" is a whole job title, not rank-on-top-of-something-else) -- unlike
            // a purely-rank word (e.g. "senior"), so they must also be offered as a role-head reading. Without
            // this, a bare/authority-only query never populates a query role head at all, which then lets the
            // structural-context inference below run unchecked and flood resolvedRoleHeadTokens with unrelated
            // guesses -- and makes an exact "X manager" leaf hard-reject as a role contradiction.
            if (isAuthorityTier(levelKind) && isKnownRoleHeadWord(levelKind)) {
                alternatives.push({ kind: 'role_head', token: levelKind });
                if (!isGenericQueryToken(levelKind, 'en')) {
                    resolvedRoleHeadTokenSet.add(levelKind);
                }
            }
            translationUnits.push({ localText: token, alternatives });
            addMatches(matchedByLocalToken, token, [levelKind]);
            modifierTokenSet.add(levelKind);
        }
    });
    for (const match of phraseMatches) {
        translationUnits.push({ localText: match.localToken, alternatives: match.alternatives });
        addMatches(matchedByLocalToken, match.localToken, match.alternatives.map((alternative) => alternative.token));
        for (const alternative of match.alternatives) {
            if (alternative.kind !== 'role_head') {
                modifierTokenSet.add(alternative.token);
                continue;
            }
            const roleHead = alternative.token;
            if (!isGenericQueryToken(roleHead, 'en')) {
                resolvedRoleHeadTokenSet.add(roleHead);
            }
        }
    }
    const safeTokenOriginalIndices = [];
    const safeInputTokens = inputTokens.filter((token, index) => {
        const keep = !isStopQueryToken(token, locale) && !isRankRoleHead(token, 'authority') && !isRankRoleHead(token, 'non-authority');
        if (keep) {
            safeTokenOriginalIndices.push(index);
        }
        return keep;
    });
    safeInputTokens.forEach((token, index) => {
        if (resolvedTokenIndices.has(safeTokenOriginalIndices[index])) {
            return;
        }
        for (const term of expandLocaleTokenVariants(token, locale)) {
            const matches = englishRoleHeadMatches(term, locale, artifacts.roleHeads);
            if (matches.length === 0) {
                continue;
            }
            translationUnits.push({
                localText: token,
                alternatives: matches.map((match) => ({ kind: 'role_head', token: match }))
            });
            addMatches(matchedByLocalToken, token, matches);
            matches
                .filter((match) => !isGenericQueryToken(match, 'en'))
                .forEach((match) => {
                resolvedRoleHeadTokenSet.add(match);
            });
            return;
        }
    });
    const matchedTokens = uniquePreservingOrder([...matchedByLocalToken.values()].flatMap((tokens) => [...tokens]));
    // Reverses the local->English translation to find the local surface's own role head: the local
    // token(s) whose English translation set contains a word from a known role-head group. This lets
    // retrieval build local-language modifier+roleHead combo keys (for the local exact-alias fast
    // path) without needing a separate local-language role-head list.
    const localRoleHeadTokens = [...matchedByLocalToken.entries()]
        .filter(([, englishTokens]) => [...englishTokens].some((token) => isKnownRoleHeadWord(token)))
        .map(([localToken]) => localToken);
    // A multi-token concept-alias match (e.g. "resurse umane" -> human_resources) is keyed in
    // matchedByLocalToken by the joined phrase, not by each individual input token -- so checking
    // matchedByLocalToken.has(token) per original token would wrongly report "resurse" and "umane" as
    // unresolved even though the phrase as a whole matched. resolvedTokenIndices (original inputTokens
    // positions) checks resolution by position too.
    return buildCanonicalComparisonQuery({
        matchedTokens,
        modifierTokens: matchedTokens.filter((token) => modifierTokenSet.has(token)),
        unresolvedTokens: inputTokens.filter((token, index) => !matchedByLocalToken.has(token) && !resolvedTokenIndices.has(index)),
        resolvedRoleHeadTokens: [...resolvedRoleHeadTokenSet],
        localRoleHeadTokens,
        translationUnits
    });
}
export function buildCanonicalComparisonQuery(translated) {
    const hasFullMatch = translated.unresolvedTokens.length === 0 && translated.matchedTokens.length > 0;
    const translationUnits = translated.translationUnits ?? [];
    return {
        englishTokens: translated.matchedTokens,
        modifierTokens: translated.modifierTokens,
        unresolvedTokens: translated.unresolvedTokens,
        canonicalExactKeys: hasFullMatch ? canonicalExactKeysForTranslation(translated, translationUnits) : [],
        resolvedRoleHeadTokens: translated.resolvedRoleHeadTokens ?? [],
        localRoleHeadTokens: translated.localRoleHeadTokens ?? [],
        translationUnits
    };
}
export function modifierTokenUnitsForComparisonQuery(comparisonQuery) {
    const units = [];
    for (const unit of comparisonQuery.translationUnits) {
        const tokens = [];
        for (const alternative of unit.alternatives) {
            if (alternative.kind !== 'role_head' && !tokens.includes(alternative.token)) {
                tokens.push(alternative.token);
            }
        }
        if (tokens.length > 0) {
            units.push(tokens);
        }
    }
    return units;
}
// How many leaves in the whole taxonomy carry a given concept id -- a rare concept (e.g.
// "construction") is stronger coverage evidence than a common one. Weighting units by this instead of
// counting them 1-for-1 keeps a candidate matching only a common concept from tying one matching a
// rare concept.
const CONCEPT_LEAF_FREQUENCY_TOTAL_LEAVES = conceptLeafFrequencyJson.totalLeaves;
const CONCEPT_LEAF_FREQUENCY_BY_ID = conceptLeafFrequencyJson.leafCountByConceptId;
const CONCEPT_UNIT_WEIGHT_FLOOR = 0.6;
function conceptUnitWeight(conceptId) {
    const leafCount = CONCEPT_LEAF_FREQUENCY_BY_ID[conceptId];
    if (!leafCount || leafCount <= 0) {
        return 1;
    }
    const specificity = Math.log(CONCEPT_LEAF_FREQUENCY_TOTAL_LEAVES / leafCount) / Math.log(CONCEPT_LEAF_FREQUENCY_TOTAL_LEAVES);
    return CONCEPT_UNIT_WEIGHT_FLOOR + (1 - CONCEPT_UNIT_WEIGHT_FLOOR) * Math.max(0, Math.min(1, specificity));
}
export function conceptUnitCoverageForComparisonQuery(comparisonQuery, conceptsByDimension) {
    let matchedWeight = 0;
    let totalWeight = 0;
    for (const unit of comparisonQuery.translationUnits) {
        let unitWeight = 0;
        let matched = false;
        for (const alternative of unit.alternatives) {
            if (alternative.kind !== 'concept') {
                continue;
            }
            unitWeight = Math.max(unitWeight, conceptUnitWeight(alternative.conceptId));
            if ((conceptsByDimension.get(alternative.dimension) ?? []).includes(alternative.conceptId)) {
                matched = true;
            }
        }
        if (unitWeight === 0) {
            continue;
        }
        totalWeight += unitWeight;
        if (matched) {
            matchedWeight += unitWeight;
        }
    }
    return totalWeight === 0 ? null : matchedWeight / totalWeight;
}
async function loadTranslationArtifacts(locale) {
    const [roleHeads, schema] = await Promise.all([
        Promise.resolve(loadOccupationRoleHeadEquivalenceArtifactRequired().lookup),
        loadSpecializationSchemaLookup(locale)
    ]);
    return { roleHeads, schema };
}
function addMatches(matchedByLocalToken, localToken, englishTokens) {
    if (englishTokens.length === 0) {
        return;
    }
    const tokens = matchedByLocalToken.get(localToken) ?? new Set();
    for (const token of englishTokens) {
        if (token) {
            tokens.add(token);
        }
    }
    matchedByLocalToken.set(localToken, tokens);
}
function phraseAliasMatches(inputTokens, schema) {
    const matches = [];
    const consumed = new Set();
    const maxTokenCount = Math.max(schema.maxConceptAliasTokenCount, schema.maxRoleHeadAliasTokenCount);
    for (let index = 0; index < inputTokens.length; index += 1) {
        if (consumed.has(index)) {
            continue;
        }
        const firstTokenConceptRules = schema.conceptAliasesByFirstToken.get(inputTokens[index]) ?? [];
        const upperBound = Math.min(inputTokens.length, index + maxTokenCount);
        for (let end = upperBound; end > index; end -= 1) {
            const localToken = inputTokens.slice(index, end).join(' ');
            const conceptRules = firstTokenConceptRules.filter((rule) => rule.weakFoldedAlias === localToken);
            const roleHeads = schema.roleHeadAliasesByLocalToken.get(localToken) ?? [];
            if (conceptRules.length > 0 || roleHeads.length > 0) {
                const tokenIndices = Array.from({ length: end - index }, (_, offset) => index + offset);
                // A single local word can carry both a role-head reading and a concept reading (e.g. a
                // Romanian trade word that maps to a generic English role head AND a specific concept, like
                // "betonist" -> role_head finisher + concept concrete). Emitting only one would throw away
                // the disambiguating signal the other carries, so both are kept as alternatives.
                matches.push({
                    localToken,
                    alternatives: [...roleHeadAlternatives(roleHeads), ...conceptAlternatives(conceptRules)],
                    tokenIndices
                });
                for (const tokenIndex of tokenIndices) {
                    consumed.add(tokenIndex);
                }
                break;
            }
        }
    }
    return matches;
}
function englishRoleHeadMatches(token, locale, lookup) {
    const folded = foldSearchText(token);
    if (!folded) {
        return [];
    }
    // If the local-language token is spelled identically to an English role-head term (a cognate,
    // e.g. RO/EN "agent"), treat it as already-English rather than expanding it through its equivalence
    // classes. A generic cognate like "agent" is shared across dozens of unrelated ESCO leaf classes
    // (guard, firefighter, detective, trader, officer...), each using it as their own locale term for a
    // completely different English role head -- unioning all of those classes' English terms would flood
    // the translation with unrelated tokens instead of preserving the one token that was already correct.
    // Checked against both the equivalence artifact's English vocabulary and the broader
    // DEFAULT_ROLE_HEAD_GROUPS word list (role-head-groups.ts) -- a local token spelled the same as any
    // known English role head is already a valid translation, alias table or not.
    if (lookup.classIdsByLocaleAndTerm.get('en')?.has(folded) || isKnownRoleHeadWord(folded)) {
        return [folded];
    }
    const tokenClassIds = new Set([
        ...(lookup.classIdsByLocaleAndTerm.get(locale)?.get(folded) ?? []),
        ...(locale === 'unknown' ? [] : (lookup.classIdsByLocaleAndTerm.get('unknown')?.get(folded) ?? []))
    ]);
    if (tokenClassIds.size === 0) {
        return [];
    }
    const matches = new Set();
    for (const [englishToken, classIds] of lookup.classIdsByLocaleAndTerm.get('en') ?? []) {
        if (classIds.some((classId) => tokenClassIds.has(classId)) && !isGenericQueryToken(englishToken, 'en')) {
            matches.add(englishToken);
        }
    }
    return uniqueSorted([...matches]);
}
function uniqueSorted(tokens) {
    return [...new Set(tokens.filter(Boolean))].sort();
}
function roleHeadAlternatives(roleHeads) {
    return uniqueSorted(roleHeads).map((token) => ({ kind: 'role_head', token }));
}
function conceptAlternatives(rules) {
    const seen = new Set();
    const alternatives = [];
    for (const rule of rules) {
        const token = rule.concept.canonical;
        const key = `${rule.concept.dimension}:${rule.conceptId}:${token}`;
        if (!token || seen.has(key)) {
            continue;
        }
        seen.add(key);
        alternatives.push({
            kind: 'concept',
            token,
            dimension: rule.concept.dimension,
            conceptId: rule.conceptId
        });
    }
    return alternatives.sort((left, right) => left.token.localeCompare(right.token));
}
function canonicalExactKeysForTranslation(translated, translationUnits) {
    if (translationUnits.length === 0) {
        return [foldWeakPunctuationLookupText(translated.foldedFullText ?? translated.matchedTokens.join(' '))];
    }
    let phrases = [''];
    for (const unit of translationUnits) {
        const tokens = uniquePreservingOrder(unit.alternatives.map((alternative) => alternative.token));
        if (tokens.length === 0) {
            continue;
        }
        const next = [];
        for (const phrase of phrases) {
            for (const token of tokens) {
                next.push(`${phrase} ${token}`.trim());
            }
        }
        phrases = next;
    }
    return uniquePreservingOrder(phrases.map(foldWeakPunctuationLookupText).filter(Boolean));
}
function uniquePreservingOrder(tokens) {
    return [...new Set(tokens.filter(Boolean))];
}
