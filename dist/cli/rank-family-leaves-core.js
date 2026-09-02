import { findCommonRolePhraseMatch } from '../query/common-role-phrase-atlas.js';
import { isOptionalLinkerToken } from '../query/phrase-match.js';
import { preparedQueryRoleCapabilityVerbFoldedAdditionTokens, preparedQueryRoleFamilyScopedFoldedTokens, preparedQueryRoleFolded, preparedQueryRoleFoldedTokens, preparedQueryRoleNormalized } from '../query/query-preparation.js';
import { tokenMatchesLocaleVariant } from '../query/token-variants.js';
import { ATOMIC_SPECIALIZATION_SYNONYMS, canonicalLeafSpecializationSlotComparison, detectLeafLevelKind, resolveLeafSpecializationKindsFromTokens, leafMarkerTokensForKind, specializationKindAlignedWithQuery, specializationKindAlignedWithQueryMatch, specializationKindContradictedByQuery, specializationKindImpliedByQueryVenue, specializationKindSupportedByCapabilities } from '../runtime/occupation-leaf-structure-rules.js';
import { CapabilityFitRanker } from '../search-pipeline/ranking/capability-fit-ranker.js';
import { FamilyScopedLeafRanker } from '../search-pipeline/ranking/family-scoped-leaf-ranker.js';
import { TokenLeafClosenessRanker } from '../search-pipeline/ranking/leaf-closeness-ranker.js';
import { foldSearchText, foldWeakPunctuationLookupText, tokenizeNormalizedText } from '../utils/texts.js';
const LEAF_CLOSENESS_RANKER = new TokenLeafClosenessRanker();
const CAPABILITY_FIT_RANKER = new CapabilityFitRanker();
const FAMILY_SCOPED_LEAF_RANKER = new FamilyScopedLeafRanker();
const LEAF_RANKING_QUERY_CONTEXT_CACHE = new WeakMap();
export function cliRankFamilyLeaves(artifact, leafStructureArtifact, leaves, preparedQuery, effectiveQuery, locale, exactQueryText = effectiveQuery) {
    const rolePhraseMatch = findCommonRolePhraseMatch(effectiveQuery, locale);
    // One cache per CLI invocation so a leaf's derived specializationKinds (used when the artifact's
    // authored value is empty/unclassified) is computed once even though `rankLeaf` runs per leaf.
    const specializationKindsCache = new Map();
    const siblingCompetitionScores = computeSiblingCompetitionScores(leaves.map((leaf) => ({
        graphNodeId: leaf.graphNodeId,
        canonicalLabel: leaf.canonicalLabel
    })), preparedQuery);
    return leaves
        .map((leaf) => cliRankLeaf(artifact, leafStructureArtifact, leaf, preparedQuery, locale, rolePhraseMatch, exactQueryText, specializationKindsCache, siblingCompetitionScores.get(leaf.graphNodeId) ?? 0))
        .sort(compareRankedLeaves)
        .map((leaf, index) => ({ ...leaf, rank: index + 1 }));
}
function getLeafRankingQueryContext(preparedQuery, exactQueryText) {
    let contextByExactQuery = LEAF_RANKING_QUERY_CONTEXT_CACHE.get(preparedQuery);
    if (!contextByExactQuery) {
        contextByExactQuery = new Map();
        LEAF_RANKING_QUERY_CONTEXT_CACHE.set(preparedQuery, contextByExactQuery);
    }
    const cached = contextByExactQuery.get(exactQueryText);
    if (cached) {
        return cached;
    }
    const context = buildLeafRankingQueryContext(preparedQuery, exactQueryText);
    contextByExactQuery.set(exactQueryText, context);
    return context;
}
function buildLeafRankingQueryContext(preparedQuery, exactQueryText) {
    const roleFoldedTokens = preparedQueryRoleFoldedTokens(preparedQuery);
    const specializationQueryTokens = new Set();
    // Every facet of query intent that can carry a specialization value -- role head, its curated
    // cross-locale equivalents, the leftover role modifier and its equivalents, domain, venue -- must
    // feed the same dimension mapping the leaf side is compared against below, or a query that
    // expresses a specialization only through e.g. altRoleModifierTokens would silently diff as
    // "silent" (unsupportedBroad) instead of "aligned", regardless of what the user actually typed.
    // roleModifierTokens is included for that completeness even though it's already a subset of
    // roleTokens today (roleTokens = head + modifier) -- the redundancy is harmless, the omission
    // wouldn't be if that invariant ever changes.
    for (const token of [
        ...preparedQuery.usefulFoldedRecallTokens,
        ...preparedQuery.intent.roleTokens,
        ...preparedQuery.intent.roleHeadTokens,
        ...preparedQuery.intent.altRoleHeadTokens,
        ...preparedQuery.intent.roleModifierTokens,
        ...preparedQuery.intent.altRoleModifierTokens,
        ...preparedQuery.intent.domainTokens,
        ...preparedQuery.intent.venueTokens
    ]) {
        specializationQueryTokens.add(foldSearchText(token));
    }
    // Genuine cross-locale equivalence data, as opposed to specializationQueryTokens above --
    // altRoleHeadTokens/altRoleModifierTokens are the query's curated safe-English-equivalent forms
    // (see OccupationQueryIntent), empty for English queries. This used to be built from
    // `[...preparedQuery.intent.roleTokens, ...roleFoldedTokens]`, which is just the query's OWN
    // locale tokens re-folded -- roleFoldedTokens (preparedQueryRoleFoldedTokens) is itself derived
    // from intent.roleTokens with no translation involved, so that carried no actual cross-locale
    // signal at all and only ever duplicated tokens already in specializationQueryTokens above.
    const translatedRoleSpecializationTokens = new Set();
    for (const token of [...preparedQuery.intent.altRoleHeadTokens, ...preparedQuery.intent.altRoleModifierTokens]) {
        translatedRoleSpecializationTokens.add(foldSearchText(token));
    }
    return {
        roleNormalized: preparedQueryRoleNormalized(preparedQuery),
        roleFolded: preparedQueryRoleFolded(preparedQuery),
        roleFoldedTokens,
        altRoleHeadFoldedTokens: preparedQuery.intent.altRoleHeadTokens,
        roleFoldedTokenText: roleFoldedTokens.join(' '),
        roleFamilyScopedFoldedTokens: preparedQueryRoleFamilyScopedFoldedTokens(preparedQuery),
        roleCapabilityVerbFoldedAdditionTokens: preparedQueryRoleCapabilityVerbFoldedAdditionTokens(preparedQuery),
        foldedTokenSet: new Set(preparedQuery.foldedTokens),
        queryLevelKind: detectLeafLevelKind(new Set([...preparedQuery.modifierTokens, ...preparedQuery.foldedTokens].map((token) => foldSearchText(token)))),
        specializationQueryTokens,
        translatedRoleSpecializationTokens,
        exactQueryFolded: foldSearchText(exactQueryText),
        exactQueryWeakFolded: foldWeakPunctuationLookupText(exactQueryText)
    };
}
function cliRankLeaf(artifact, leafStructureArtifact, leaf, preparedQuery, locale, rolePhraseMatch, exactQueryText, specializationKindsCache, siblingCompetitionScore) {
    const queryContext = getLeafRankingQueryContext(preparedQuery, exactQueryText);
    const rawAliases = artifact.getAliases(leaf.graphNodeId);
    const aliases = localeAliasLabels(rawAliases, locale);
    // Family-supporting aliases are a generic crosswalk list shared verbatim across many unrelated
    // leaves in a family (e.g. a shared IT-job-title tail) -- they aren't evidence this specific
    // leaf matches the query, so they're excluded from closeness/exact-match scoring below and only
    // still surface in the `aliases` field for display.
    const leafSpecificAliases = leafSpecificAliasLabels(rawAliases, locale);
    const capabilityLabels = artifact.getCapabilityLabels(leaf.graphNodeId);
    const closeness = LEAF_CLOSENESS_RANKER.rank({
        query: {
            locale: preparedQuery.locale,
            normalized: queryContext.roleNormalized,
            folded: queryContext.roleFolded,
            foldedTokens: preparedQuery.foldedTokens,
            usefulFoldedRecallTokens: preparedQuery.usefulFoldedRecallTokens,
            roleHeadTokens: preparedQuery.intent.roleHeadTokens,
            altRoleHeadTokens: preparedQuery.intent.altRoleHeadTokens,
            roleModifierTokens: preparedQuery.intent.roleModifierTokens,
            altRoleModifierTokens: preparedQuery.intent.altRoleModifierTokens
        },
        canonicalLabel: leaf.canonicalLabel,
        aliases: leafSpecificAliases
    });
    const structure = leafStructureArtifact?.getRecord(leaf.graphNodeId) ?? null;
    const canonicalTokens = new Set(tokenizeNormalizedText(foldSearchText(leaf.canonicalLabel)));
    // Lexical checks (role head, family fit, domain/venue support) must test against whichever
    // label the closeness ranker actually matched -- canonical or alias -- not always the
    // canonical label, otherwise an alias-driven match never earns token-relationship credit.
    const matchedLabelTokens = new Set(tokenizeNormalizedText(foldSearchText(closeness.matchedLabel)));
    // The family label is already loaded on the leaf record, so this is a free token-set comparison,
    // not a lookup -- used below to tell "industry_context I derived from the family's own name"
    // (e.g. "software" on a leaf inside the "Software ..." family) apart from a genuinely distinct
    // industry the query never asked for.
    const familyTokens = new Set(tokenizeNormalizedText(foldSearchText(leaf.familyLabel ?? '')));
    const supportEvidence = computeLeafSupportEvidence(preparedQuery, leaf.canonicalLabel, leafSpecificAliases, capabilityLabels, queryContext.roleFamilyScopedFoldedTokens, queryContext.roleCapabilityVerbFoldedAdditionTokens, queryContext.roleFolded);
    const scoreBreakdown = scoreLeaf(closeness, leafSpecificAliases, structure, preparedQuery, canonicalTokens, matchedLabelTokens, familyTokens, capabilityLabels, rolePhraseMatch, locale, leaf.canonicalLabel, exactQueryText, leaf.graphNodeId, specializationKindsCache, queryContext.roleFamilyScopedFoldedTokens, queryContext.roleCapabilityVerbFoldedAdditionTokens, supportEvidence, siblingCompetitionScore);
    const totalScore = sumScoreBreakdown(scoreBreakdown);
    // Aliases are wild -- a leaf can win closeness/usefulTokenCoverage purely through an alias that
    // happens to contain the query's words alongside unrelated ones (e.g. "night auditor" matching
    // via the alias "night customer care manager" for query "customer care specialist"). The leaf's
    // OWN canonical label is a much more trustworthy proximity signal, so it's tracked separately
    // here and checked as a tie-break ahead of any alias-driven signal.
    const canonicalUsefulTokenCoverage = preparedQuery.locale !== 'en'
        ? 0
        : preparedQuery.usefulFoldedRecallTokens.length > 0
            ? preparedQuery.usefulFoldedRecallTokens.filter((token) => canonicalTokens.has(token)).length /
                preparedQuery.usefulFoldedRecallTokens.length
            : 0;
    return {
        rank: 0,
        graphNodeId: leaf.graphNodeId,
        canonicalLabel: leaf.canonicalLabel,
        aliases,
        structure,
        closeness,
        scoreBreakdown,
        totalScore,
        canonicalUsefulTokenCoverage
    };
}
// CLI-only: recomputes the same specialization-kind/penalizability logic scoreLeaf uses internally,
// but as its own inputs/outputs so the runtime-shared RankedFamilyLeaf/scoreLeaf types above don't
// need to carry debug-only fields. Intentionally duplicates a few lines of scoreLeaf rather than
// having scoreLeaf itself return this -- scoreLeaf is also called from the real pipeline
// (occupation-search-pipeline.ts), which has no use for a debug trace.
export function debugComputeSpecialization(closeness, structure, preparedQuery, canonicalTokens, familyTokens, capabilityLabels, graphNodeId, specializationKindsCache) {
    const specializationKinds = resolveLeafSpecializationKindsFromTokens(specializationKindsCache, graphNodeId, structure, canonicalTokens);
    const queryContext = getLeafRankingQueryContext(preparedQuery, preparedQuery.normalized);
    const industryContextInherentToFamilyMatch = specializationKinds.includes('industry_context')
        ? findSynonymClusterIntersectionBoth(ATOMIC_SPECIALIZATION_SYNONYMS.industry_context, canonicalTokens, familyTokens)
        : null;
    const industryContextInherentToFamily = industryContextInherentToFamilyMatch !== null &&
        !leafHasSpecializationClusterOutsideFamily(ATOMIC_SPECIALIZATION_SYNONYMS.industry_context, canonicalTokens, familyTokens);
    const penalizableSpecializationKinds = specializationKinds.filter((kind) => !(kind === 'industry_context' && industryContextInherentToFamily) &&
        !specializationKindAlignedWithQuery(kind, canonicalTokens, preparedQuery) &&
        !specializationKindImpliedByQueryVenue(kind, canonicalTokens, preparedQuery) &&
        !translatedRoleAliasSupportsSpecialization(kind, canonicalTokens, preparedQuery, queryContext) &&
        !specializationKindSupportedByCapabilities(kind, preparedQuery, capabilityLabels));
    const supportedSpecializationKinds = specializationKinds.filter((kind) => leafAndQueryShareSpecializationValue(kind, canonicalTokens, preparedQuery, capabilityLabels, queryContext));
    const supportedPenalizableSpecializationKinds = closeness.matchedUsefulTokens.length === 0
        ? penalizableSpecializationKinds
        : supportedSpecializationKinds.filter((kind) => penalizableSpecializationKinds.includes(kind));
    const unsupportedPenalizableSpecializationKinds = closeness.matchedUsefulTokens.length === 0
        ? []
        : penalizableSpecializationKinds.filter((kind) => !supportedPenalizableSpecializationKinds.includes(kind));
    const specializationSupportMatches = {};
    for (const kind of supportedSpecializationKinds) {
        const clusterMatch = findSynonymClusterIntersectionBoth(ATOMIC_SPECIALIZATION_SYNONYMS[kind], canonicalTokens, queryContext.specializationQueryTokens);
        if (clusterMatch) {
            specializationSupportMatches[kind] = {
                cluster: clusterMatch.cluster,
                leafToken: clusterMatch.leafToken,
                queryToken: clusterMatch.familyToken
            };
            continue;
        }
        const alignedMatch = specializationKindAlignedWithQueryMatch(kind, canonicalTokens, preparedQuery);
        if (alignedMatch) {
            specializationSupportMatches[kind] = alignedMatch;
        }
    }
    const penalizableSpecializationLeafMarkers = {};
    for (const kind of penalizableSpecializationKinds) {
        penalizableSpecializationLeafMarkers[kind] = leafMarkerTokensForKind(kind, canonicalTokens);
    }
    return {
        specializationKinds,
        industryContextInherentToFamily,
        industryContextInherentToFamilyMatch,
        penalizableSpecializationKinds,
        supportedSpecializationKinds,
        supportedPenalizableSpecializationKinds,
        unsupportedPenalizableSpecializationKinds,
        specializationSupportMatches,
        penalizableSpecializationLeafMarkers
    };
}
export function scoreLeaf(closeness, aliases, structure, preparedQuery, canonicalTokens, matchedLabelTokens, familyTokens, capabilityLabels, rolePhraseMatch, locale, canonicalLabel, exactQueryText, graphNodeId, specializationKindsCache, familyScopedFoldedTokens = preparedQueryRoleFamilyScopedFoldedTokens(preparedQuery), capabilityVerbFoldedAdditionTokens = preparedQueryRoleCapabilityVerbFoldedAdditionTokens(preparedQuery), supportEvidence = computeLeafSupportEvidence(preparedQuery, canonicalLabel, aliases, capabilityLabels, familyScopedFoldedTokens, capabilityVerbFoldedAdditionTokens), siblingCompetitionScore = 0) {
    const queryContext = getLeafRankingQueryContext(preparedQuery, exactQueryText);
    // A match against the raw, unsplit query text is stronger evidence than one against the
    // cleaned/role-scoped preparedQuery -- the raw match means the leaf's canonical label accounts
    // for every word the user actually typed, including a qualifying clause query cleaning stripped
    // out. It must outscore a cleaned-query-only match, or a shorter sibling leaf that merely
    // matches the trimmed role span can tie with (and, via the generic-leaf tie-break, beat) the
    // leaf that is the true exact match for what was typed.
    let exactCanonicalMatch = 0;
    if (leafHasRawQueryFullStringExactCanonical(canonicalLabel, queryContext)) {
        exactCanonicalMatch = 55;
    }
    else if (leafHasExactCanonicalMatch(closeness, canonicalTokens, preparedQuery, locale, queryContext) &&
        leafCanonicalCoversEveryUsefulQueryToken(canonicalTokens, preparedQuery, locale)) {
        exactCanonicalMatch = 50;
    }
    if (exactCanonicalMatch > 0) {
        return {
            noTokenRelationship: 0,
            missingRequiredRoleHead: 0,
            exactCanonicalMatch,
            aliasMatchBonus: 0,
            translatedRoleAliasExact: 0,
            levelMatch: 0,
            roleHeadOrUsefulCanonical: 0,
            specializationScore: 0,
            familyFit: 0,
            genericBaseRoleFit: 0,
            authorityLevelContradiction: false,
            usefulMatchNoSpecialization: 0,
            usefulDomainSupport: 0,
            usefulVenueSupport: 0,
            usefulCapabilityFit: 0,
            relativeSiblingEvidence: 0,
            usefulTokenCoverage: 0,
            specializationBuckets: {
                alignedBroad: [],
                unsupportedBroad: [],
                contradictoryBroad: [],
                alignedNarrow: [],
                unsupportedNarrow: [],
                contradictoryNarrow: []
            }
        };
    }
    const roleHeadTokenCount = preparedQuery.intent.roleHeadTokens.length;
    const rolePhraseTokenCount = rolePhraseMatch?.canonicalTokens.length ?? 0;
    // The query has real content words (useful tokens) beyond its role head, but this leaf's closeness
    // pick satisfied NONE of them -- so a role-head-only claim (literal, phrase, or cross-lingual
    // equivalence) here is incidental vocabulary overlap, not real evidence of a match (e.g. ro
    // "vanzari"/"sales" surfacing via an English alias like "sales consultant" that shares nothing else
    // with the query, or ro "lucrator"/"worker" landing inside an unrelated alias like "lucrător în
    // echipă de achiziții"/"worker in the procurement team"). Suppress every role-head-match flag in
    // that case so it can't smuggle a leaf past noTokenRelationship or earn roleHeadOrUsefulCanonical/
    // familyFit credit on the strength of the role head alone. A role-head-only query (no useful tokens
    // at all) is exempt -- there, the role head is all the leaf ever had to match.
    const bareRoleHeadOnly = preparedQuery.usefulFoldedRecallTokens.length > 0 && closeness.matchedUsefulTokens.length === 0;
    const roleHeadMatched = !bareRoleHeadOnly && leafHasRoleHeadMatch(preparedQuery, matchedLabelTokens);
    const roleHeadPhraseMatched = !bareRoleHeadOnly && leafHasRoleHeadPhraseMatch(rolePhraseMatch, matchedLabelTokens);
    // The role head's English equivalent can live only in one of the leaf's own English aliases
    // (e.g. "specialised seller" whose alias "specialised sales advisor" carries "advisor") rather
    // than in the canonical label or the single alias the closeness ranker happened to pick, so the
    // equivalence check must search all of the leaf's English-fallback alias tokens too.
    const roleHeadEquivalentMatched = !bareRoleHeadOnly && leafHasRoleHeadEquivalentMatch(preparedQuery, allLeafRoleHeadEquivalentTokens(canonicalTokens, aliases));
    const hasRoleHeadRelationship = roleHeadMatched || roleHeadPhraseMatched || roleHeadEquivalentMatched;
    const leafSpecializationKinds = resolveLeafSpecializationKindsFromTokens(specializationKindsCache, graphNodeId, structure, canonicalTokens);
    const supportedSpecializationKinds = leafSpecializationKinds.filter((kind) => leafAndQueryShareSpecializationValue(kind, canonicalTokens, preparedQuery, capabilityLabels, queryContext));
    // A genuine broad specialization alignment (e.g. query "retail" and leaf "sales" sharing the same
    // ESCO industry_context synonym cluster) is real structural evidence the leaf is on-topic, even
    // when the closeness ranker found no literal token overlap and the role-head match got suppressed
    // by bareRoleHeadOnly above. Without this, a leaf like "sales assistant" gets nuked by
    // noTokenRelationship for a query like "retail assistant" purely because "retail" and "sales"
    // aren't the same string, while an unrelated leaf that happens to contain the literal substring
    // "retail" in one alias survives untouched -- rewarding coincidental text over real domain
    // alignment. This does not touch bareRoleHeadOnly/hasRoleHeadRelationship themselves: a lone,
    // otherwise-unsupported role-head coincidence should still be treated with suspicion, but a
    // supported specialization value is independent, deliberate evidence, not incidental overlap.
    const hasSpecializationRelationship = supportedSpecializationKinds.length > 0;
    const hasLeafRelationship = closeness.matchedUsefulTokens.length > 0 || hasRoleHeadRelationship || hasSpecializationRelationship;
    const noTokenRelationship = closeness.matchedUsefulTokens.length === 0 && !hasRoleHeadRelationship && !hasSpecializationRelationship ? -30 : 0;
    // Short, non-English-locale queries often can't spell out full disambiguating context around a
    // generic role head -- if the leaf already matched the query on some other specialization value
    // (venue/product/task_focus/etc.), that's independent positive evidence the leaf is right, and it
    // should excuse the missing role-head context rather than stack an extra penalty on top of it.
    const missingRequiredRoleHead = preparedQuery.intent.roleHeadRequiresContext &&
        closeness.matchedUsefulTokens.length > 0 &&
        !hasRoleHeadRelationship &&
        supportedSpecializationKinds.length === 0
        ? HAMMER_MISSING_REQUIRED_ROLE_HEAD
        : 0;
    const usefulTokenCoverage = usefulTokenCoverageScore(closeness.matchedUsefulTokens.length);
    // Any alias in the leaf's alias list textually equaling the full query is weak, noisy evidence on
    // its own -- it doesn't require this to be the alias the closeness ranker actually matched on, just
    // that some alias in the list happens to coincide with the query text.
    const looseAliasTextEquality = leafHasExactAliasMatch(aliases, preparedQuery) ? 3 : 0;
    // The closeness ranker's own matched label being an alias that covers every useful query token,
    // with nothing left over except optional linker words (e.g. ro "de"), is much stronger evidence --
    // effectively an exact match on a curated label. Both signals are evidence of the same underlying
    // fact (the query hit an exact alias), so they must not stack -- take whichever is stronger.
    const rankedAliasFullCoverage = closeness.matchedLabelSource === 'alias' &&
        closeness.missingUsefulTokens.length === 0 &&
        closeness.extraTitleTokens.every((token) => isOptionalLinkerToken(token, locale))
        ? 20
        : 0;
    const aliasMatchBonus = Math.max(looseAliasTextEquality, rankedAliasFullCoverage);
    const translatedRoleAliasExact = leafHasTranslatedRoleExactAliasMatch(aliases, preparedQuery, queryContext) ? 12 : 0;
    const leafLevelKind = detectLeafLevelKind(canonicalTokens);
    // Deliberately NOT gated on hasLeafRelationship: levelMatchScore's own 'none'-query branch is the
    // "no elevated authority when it wasn't requested" decay -- a leaf that carries authority
    // (supervisor/manager/director/chief) the query never asked for must sink relative to a
    // non-authority leaf even when NEITHER leaf shares any vocabulary with the query at all (the
    // noTokenRelationship/unresolved case). Gating this behind hasLeafRelationship silenced the exact
    // signal that should decide the tie among leaves that are all equally unrelated to the query --
    // the base, no-authority leaf must still win that tie, not an accident of alphabetical/token-count
    // fallback. levelMatchScore is self-gating for every other branch (0 whenever the leaf carries no
    // level info, or the query's specific requested tier doesn't match), so lifting the gate doesn't
    // reward a leaf for a level match it hasn't earned.
    const levelMatch = levelMatchScore(queryContext.queryLevelKind, leafLevelKind);
    const authorityLevelContradiction = hasLeafRelationship && leafAuthorityLevelKindsContradict(queryContext.queryLevelKind, leafLevelKind);
    const usefulCanonicalMatched = leafHasUsefulCanonicalMatch(closeness);
    // A bare role-head token match (e.g. one exact word, no other evidence) shouldn't score the
    // same as a role-head match backed by additional matched useful tokens -- only the latter
    // earns the top tier.
    const relevantRoleTokenCount = Math.max(roleHeadTokenCount, rolePhraseTokenCount);
    const roleHeadHasSupportingEvidence = closeness.matchedUsefulTokens.length > relevantRoleTokenCount;
    // The bare/unsupported tier only fires on a bare role-head token with no other matched useful
    // tokens backing it up -- at that point the match had better be the leaf's own canonical label
    // saying it's an "X professional"/"X technician", not an alias that happens to contain the role
    // head word amid other, unmatched vocabulary. An alias match with zero supporting evidence is
    // just as likely to be an unrelated leaf that shares one generic word.
    let bareRoleHeadMatched = roleHeadMatched && closeness.matchedLabelSource === 'canonical';
    // its possible the canonical has the rolehead but matchedLabelSource was alias, so we do one last check for a lower score
    if (!bareRoleHeadMatched) {
        const foldedCanonicalTokens = Array.from(canonicalTokens).map(foldSearchText);
        if (queryContext.roleFoldedTokens.every((token) => foldedCanonicalTokens.includes(token)) ||
            queryContext.altRoleHeadFoldedTokens.some((token) => foldedCanonicalTokens.includes(token))) {
            bareRoleHeadMatched = true;
        }
    }
    const roleHeadOrUsefulCanonical = roleHeadOrUsefulCanonicalTier({
        strongAliasMatch: rankedAliasFullCoverage,
        roleHeadMatched,
        roleHeadPhraseMatched,
        roleHeadEquivalentMatched,
        roleHeadHasSupportingEvidence,
        usefulCanonicalMatched,
        bareRoleHeadMatched
    });
    const familyFit = familyScopedFitScore(supportEvidence.familyScopedFit);
    // A generic base role (e.g. "software developer") is the safer default among family-fit
    // candidates when nothing else distinguishes them -- a specialized leaf (e.g. "blockchain
    // developer") only deserves to win on the strength of its own matched evidence
    // (specializationMatch, aliasMatchBonus, etc.), not by accident of alias overlap. Gated on
    // familyFit so an off-topic generic leaf never gets this nudge just for being generic. Also
    // excluded when the query has more than one useful token but this leaf only shares one of them
    // (e.g. ro "consultant vanzari mare" matching only "vanzari" via an unrelated leaf like
    // "shipbroker") -- that single shared token is as incidental as the zero-overlap case
    // bareRoleHeadOnly guards against, and a generic leaf has no specialization tag to be penalized
    // for being wrong, so without this it can out-rank specialized leaves that share the same token
    // but get docked for a mismatched specialization.
    const bareGenericMatchOnly = preparedQuery.usefulFoldedRecallTokens.length > 1 && closeness.matchedUsefulTokens.length <= 1;
    let genericBaseRoleFit = 0;
    if (!bareGenericMatchOnly && closeness.matchedUsefulTokens.length && familyFit > 0) {
        if (structure?.baseRoleKind === 'generic_base_role') {
            genericBaseRoleFit = 2;
        }
        else if (structure?.baseRoleKind === 'generic_family_base_role') {
            genericBaseRoleFit = 1;
        }
    }
    let slotComparison = { contradictionCount: 0, alignmentCount: 0, contradictionKinds: [], alignmentKinds: [] };
    // industry_context is derived from a single broad marker word (e.g. "software"), which is often
    // also the word that put this leaf in its family in the first place -- the family label itself
    // contains it (e.g. "Software and applications developers and analysts"). Penalizing a query for
    // not repeating a word the family selection already established would punish e.g. "backend
    // developer" for not saying "software" against a leaf the family already committed to being
    // software-flavored. Other specialization kinds (venue/channel/product/population/task_focus)
    // don't get this exemption -- those really are disqualifying when the query doesn't support them,
    // regardless of family.
    const industryContextInherentToFamily = leafSpecializationKinds.includes('industry_context') &&
        synonymClusterIntersectsBoth(ATOMIC_SPECIALIZATION_SYNONYMS.industry_context, canonicalTokens, familyTokens) &&
        !leafHasSpecializationClusterOutsideFamily(ATOMIC_SPECIALIZATION_SYNONYMS.industry_context, canonicalTokens, familyTokens);
    const penalizableSpecializationKinds = leafSpecializationKinds.filter((kind) => !(kind === 'industry_context' && industryContextInherentToFamily) &&
        !specializationKindAlignedWithQuery(kind, canonicalTokens, preparedQuery) &&
        !specializationKindImpliedByQueryVenue(kind, canonicalTokens, preparedQuery) &&
        !translatedRoleAliasSupportsSpecialization(kind, canonicalTokens, preparedQuery, queryContext) &&
        !specializationKindSupportedByCapabilities(kind, preparedQuery, capabilityLabels));
    const supportedPenalizableSpecializationKinds = supportedSpecializationKinds.filter((kind) => penalizableSpecializationKinds.includes(kind));
    // Per-kind, not any-of: a leaf can carry more than one specialization kind (e.g. "motor vehicles
    // parts advisor" is both industry_context and product), and each is an independent claim the query
    // either does or doesn't back up. If even one penalizable kind goes unsupported, that specific claim
    // is unaddressed by the query and should count against the leaf, even when another kind on the same
    // leaf happens to be supported.
    const unsupportedPenalizableSpecializationKinds = penalizableSpecializationKinds.filter((kind) => !supportedPenalizableSpecializationKinds.includes(kind));
    // Broad contradiction: the leaf carries a specific ATOMIC value for `kind` and the query names a
    // different specific ATOMIC value for the same kind (not merely silent on it, which is
    // unsupportedPenalizableSpecializationKinds's job). Checked over leafSpecializationKinds rather than
    // penalizableSpecializationKinds -- an actual named contradiction (e.g. leaf="hospital", query names
    // "community") should count even for a kind otherwise exempted from penalty (e.g. industry_context
    // inherent to the family), since the query is not silent here, it is disagreeing.
    const contradictoryBroadSpecializationKinds = leafSpecializationKinds.filter((kind) => specializationKindContradictedByQuery(kind, canonicalTokens, preparedQuery));
    if (hasLeafRelationship) {
        slotComparison = canonicalLeafSpecializationSlotComparison(canonicalTokens, preparedQuery);
    }
    // Extra Generic leaf reward
    const usefulMatchNoSpecialization = leafHasUsefulCanonicalMatch(closeness) && leafSpecializationKinds.length === 0 ? 5 : 0;
    // Gated against unsupportedPenalizableSpecializationKinds so a leaf never gets penalized -5 for an
    // unsupported specialization (e.g. "venue") and rewarded +2 for the very same kind in the same
    // breakdown -- that happened when a query token classified as domain/venue vocabulary in one
    // locale (e.g. "retail" in ro) merely co-occurred in the leaf's matched alias text without
    // actually aligning with the leaf's own specialization marker (e.g. "shop"), which the alignment
    // check above already correctly judged unsupported.
    const usefulDomainSupport = leafHasUsefulDomainSupport(preparedQuery, matchedLabelTokens) && !unsupportedPenalizableSpecializationKinds.includes('industry_context')
        ? 2
        : 0;
    const usefulVenueSupport = leafHasUsefulVenueSupport(preparedQuery, matchedLabelTokens) && !unsupportedPenalizableSpecializationKinds.includes('venue') ? 2 : 0;
    const usefulCapabilityFit = capabilityFitScore(closeness, structure, capabilityLabels, hasLeafRelationship, supportEvidence.capabilityFit);
    const relativeSiblingEvidence = hasLeafRelationship ? siblingCompetitionScore : 0;
    const specializationBuckets = {
        // Not supportedPenalizableSpecializationKinds -- penalizableSpecializationKinds deliberately
        // excludes any kind specializationKindAlignedWithQuery already confirmed, so intersecting with it
        // can never capture that (the most common) alignment case. alignedBroad needs the full support
        // signal independent of the penalizable filter. industry_context is dropped when it's merely
        // inherent to the family (e.g. "software" already selected this family) -- that's baseline
        // membership, not a distinguishing specialization, so it must not feed combo weight either, same
        // reasoning as its exclusion from penalizableSpecializationKinds above.
        alignedBroad: supportedSpecializationKinds.filter((kind) => !(kind === 'industry_context' && industryContextInherentToFamily)),
        unsupportedBroad: unsupportedPenalizableSpecializationKinds,
        contradictoryBroad: contradictoryBroadSpecializationKinds,
        alignedNarrow: slotComparison?.alignmentKinds || [],
        unsupportedNarrow: [],
        contradictoryNarrow: slotComparison?.contradictionKinds || []
    };
    const specializationScore = specializationScoreCalc(specializationBuckets);
    return {
        noTokenRelationship,
        missingRequiredRoleHead,
        exactCanonicalMatch,
        // aliasMatchBonus/translatedRoleAliasExact/familyFit/usefulTokenCoverage carry their real
        // computed values here (not zeroed) so RANKED_LEAF_TIE_BREAKERS has real alias/closeness
        // evidence to break ties with -- but sumScoreBreakdown deliberately excludes all four from
        // totalScore, since that alias/closeness-rank evidence is exactly the "invisible" signal that
        // should decide between otherwise-equal leaves, not drive the primary structural ranking.
        aliasMatchBonus,
        translatedRoleAliasExact,
        levelMatch,
        roleHeadOrUsefulCanonical,
        specializationScore,
        familyFit,
        genericBaseRoleFit,
        authorityLevelContradiction,
        usefulMatchNoSpecialization,
        usefulDomainSupport,
        usefulVenueSupport,
        usefulCapabilityFit,
        relativeSiblingEvidence,
        usefulTokenCoverage,
        specializationBuckets
    };
}
// Authority weight per specialization kind, ranked per product direction: industry_context is the
// single strongest signal, product close behind, task_focus a mid-tier booster, venue/channel/
// population weak on their own. Everything below is pure arithmetic over these weights -- no kind
// pair or kind-count is special-cased, so a new kind only ever needs a weight, never a new branch.
const SPECIALIZATION_KIND_WEIGHT = {
    industry_context: 5,
    product: 4,
    task_focus: 2,
    venue: 1,
    channel: 1,
    population: 1
};
const SPECIALIZATION_TOP_TIER_KINDS = new Set(['industry_context', 'product']);
// A leaf that aligns/contradicts on more specialization kinds at once is inherently stronger evidence
// than any single kind alone, and reality already reflects that ordering (more specialization ==
// more win) -- so magnitude is just weight-of-the-set plus a size floor, never a hardcoded per-pair
// score: 3+ kinds together always count as a combo; exactly 2 kinds only count as a combo when one of
// them is top-tier (industry/product); anything short of that (a single kind, or a weak 2-kind pairing
// like venue+channel) gets no combo floor at all, which is what makes the low-tier kinds drop off fast.
//
// Magnitude is deliberately kept in the same realistic range as the rest of LeafScoreBreakdown's
// additive fields (roleHeadOrUsefulCanonical maxes at 15, relativeSiblingEvidence at 10, etc.) --
// specialization is one structural-fit signal among several, not the dominant one. A single top-tier
// kind (industry_context, weight 5) scores 5; the richest realistic combo (industry+product+task_focus,
// weight 11) scores 14+11=25. That keeps specializationScore's whole positive/negative range roughly
// [-28, +28] -- well short of authorityLevelContradiction's -200 hammer (so a strong specialization
// match can never buy back an authority-tier mismatch) and of exactCanonicalMatch's +300/-300
// short-circuits (see sumScoreBreakdown), while still clearly outweighing a single low-tier kind
// (venue/channel/population, weight 1) against a bare token match.
function specializationComboMagnitude(kinds) {
    if (kinds.length === 0) {
        return 0;
    }
    const weight = kinds.reduce((sum, kind) => sum + SPECIALIZATION_KIND_WEIGHT[kind], 0);
    const isCombo = kinds.length >= 3 || (kinds.length === 2 && kinds.some((kind) => SPECIALIZATION_TOP_TIER_KINDS.has(kind)));
    if (!isCombo) {
        return weight;
    }
    return (kinds.length >= 3 ? 14 : 10) + weight;
}
// Narrow (curated slot) evidence is stronger for alignment; broad (ATOMIC-vocabulary) evidence is
// stronger for contradiction -- a broad contradiction casts the wider net and is the one we treat as
// the harder failure (roughly twice as effective as the same contradiction found only narrowly),
// while narrow alignment is the stronger promotion signal. Either way we take the stronger of the two
// per direction rather than summing them, so a leaf that trips both broad and narrow evidence for the
// same kind-set is never double-scored.
const SPECIALIZATION_WEAKER_TIER_FACTOR = 0.5;
function specializationTierScore(buckets) {
    const narrowAlign = specializationComboMagnitude(buckets.alignedNarrow);
    const broadAlign = specializationComboMagnitude(buckets.alignedBroad) * SPECIALIZATION_WEAKER_TIER_FACTOR;
    const broadContradiction = specializationComboMagnitude(buckets.contradictoryBroad);
    const narrowContradiction = specializationComboMagnitude(buckets.contradictoryNarrow) * SPECIALIZATION_WEAKER_TIER_FACTOR;
    return Math.max(narrowAlign, broadAlign, 0) - Math.max(broadContradiction, narrowContradiction, 0);
}
function specializationScoreCalc(evaluation) {
    let aggScore = specializationTierScore(evaluation);
    for (const kind of evaluation.unsupportedBroad) {
        switch (kind) {
            case 'venue':
            case 'population':
            case 'channel':
            case 'task_focus':
                aggScore -= 2;
                break;
            case 'product':
            case 'industry_context':
                aggScore -= 5;
                break;
        }
    }
    return aggScore;
}
// Rewards multi-token lexical overlap more steeply than a flat per-token rate would --
// a leaf that matches 2+ useful query tokens is a much stronger lexical candidate than one
// matching a single token, not just proportionally stronger.
function usefulTokenCoverageScore(matchedUsefulTokenCount) {
    if (matchedUsefulTokenCount >= 3) {
        return 5;
    }
    if (matchedUsefulTokenCount === 2) {
        return 3;
    }
    if (matchedUsefulTokenCount === 1) {
        return 1;
    }
    return 0;
}
function roleHeadOrUsefulCanonicalTier(input) {
    // Every branch below is an independent signal for the SAME underlying fact (this leaf is a real
    // match), not a priority ladder to short-circuit through -- a leaf can trip more than one at once
    // (e.g. an exact full-alias match whose canonical label also carries the role head with
    // supporting evidence), and the strongest one present must win. Returning early on the first
    // branch that fires silently capped a leaf with the single STRONGEST possible signal
    // (strongAliasMatch: the query is an exact match on the leaf's own curated alias) below a leaf
    // with only a weaker partial signal (a role-head token plus some other matched tokens), which is
    // backwards -- an exact alias match is never weaker evidence than an incidental token overlap.
    let tier = 0;
    if (input.strongAliasMatch > 0) {
        tier = Math.max(tier, 10);
    }
    if ((input.roleHeadMatched || input.roleHeadPhraseMatched || input.roleHeadEquivalentMatched) && input.roleHeadHasSupportingEvidence) {
        tier = Math.max(tier, 15);
    }
    if (input.usefulCanonicalMatched) {
        tier = Math.max(tier, 10);
    }
    if (input.bareRoleHeadMatched || input.roleHeadPhraseMatched || input.roleHeadEquivalentMatched) {
        tier = Math.max(tier, 5);
    }
    return tier;
}
// Authority tier: supervisor/manager/director/chief name a distinct, higher-authority occupation --
// unlike assistant/junior/senior/lead, which are experience bands on the SAME non-authority role, a
// supervisor-or-above-flavored leaf is a different job than its non-authority sibling.
const AUTHORITY_TIER_KINDS = new Set(['supervisor', 'manager', 'director', 'chief']);
function isAuthorityTier(levelKind) {
    return AUTHORITY_TIER_KINDS.has(levelKind);
}
// Binary hard gate: management-or-above vs everything else. When the query states no level at all
// ('none'), there is nothing to contradict -- silence isn't a claim. When it does state a level, the
// leaf's tier either matches the query's tier or it doesn't; there is no partial credit here, only a
// cross mark either way (a non-authority query landing on an authority leaf, or vice versa).
function leafAuthorityLevelKindsContradict(queryLevelKind, leafLevelKind) {
    if (queryLevelKind === 'none') {
        return false;
    }
    return isAuthorityTier(queryLevelKind) !== isAuthorityTier(leafLevelKind);
}
function levelMatchScore(queryLevelKind, leafLevelKind) {
    // Query never asked for a level: prefer the non-authority leaf, since promoting an
    // authority-tier leaf the query never asked for is still a real (if softer) mismatch.
    if (queryLevelKind === 'none') {
        return isAuthorityTier(leafLevelKind) ? 0 : 1;
    }
    // Query asked for a level but this leaf's own canonical label carries none -- the hard gate above
    // already sinks this leaf when the query is authority-tier; when it isn't, this is a neutral,
    // same-tier non-match.
    if (leafLevelKind === 'none') {
        return 0;
    }
    if (queryLevelKind === leafLevelKind) {
        return 5;
    }
    switch (queryLevelKind) {
        case 'assistant':
        case 'junior':
            return leafLevelKind === 'assistant' || leafLevelKind === 'junior' ? 3 : 0;
        case 'senior':
        case 'lead':
            return leafLevelKind === 'senior' || leafLevelKind === 'lead' ? 3 : 0;
        case 'supervisor':
        case 'manager':
        case 'director':
        case 'chief':
            return isAuthorityTier(leafLevelKind) ? 3 : 0;
    }
}
// Category-level promote/reject decisions, layered on top of the continuous decay fields below
// rather than replacing them (hammerScore is additive, never a short-circuit on its own -- see
// sumScoreBreakdown). Calibrated against the realistic ceiling of every OTHER field in
// LeafScoreBreakdown fields that actually feed totalScore (sumScoreBreakdown deliberately excludes
// aliasMatchBonus/translatedRoleAliasExact/familyFit/usefulTokenCoverage -- see its comment) summed
// at once: roleHeadOrUsefulCanonical(15) + levelMatch(5) + genericBaseRoleFit(2) +
// usefulMatchNoSpecialization(5) + usefulDomainSupport(2) + usefulVenueSupport(2) +
// usefulCapabilityFit(4) + relativeSiblingEvidence(10) + specializationScore(~28, see
// specializationComboMagnitude) ~= 73. Each hammer below sits with a deliberate margin past that
// ceiling (not past 0) so the category decision reliably wins the comparison against even the
// strongest continuous-only leaf, while staying on the same order of magnitude as the rest of the
// score instead of a disconnected round number. Ranked most to least severe -- when more than one
// condition applies to the same leaf, the cascade below picks the worst one rather than summing
// them (see the double-jeopardy note on missingRequiredRoleHead):
//   - NO_TOKEN_RELATIONSHIP: the most severe rejection -- the leaf shares no vocabulary with the
//     query at all, only a role-head coincidence at best.
//   - AUTHORITY_CONTRADICTION: severe, but one notch softer than NO_TOKEN_RELATIONSHIP -- the leaf
//     did match real query vocabulary, it just asserts the wrong authority tier.
//   - MISSING_REQUIRED_ROLE_HEAD: softer still -- the leaf matched real query vocabulary (context/
//     modifier tokens) but not the query's actual role-head word, and nothing else (specialization
//     alignment) stepped in to excuse that. Genuinely bad, but the least certain of the three
//     rejections, so it sits closest to the continuous ceiling rather than furthest past it.
//   - EXACT_CANONICAL_MATCH: promotion past every non-exact leaf's own ceiling.
const HAMMER_NO_TOKEN_RELATIONSHIP = -170;
const HAMMER_AUTHORITY_CONTRADICTION = -150;
const HAMMER_MISSING_REQUIRED_ROLE_HEAD = -130;
const HAMMER_EXACT_CANONICAL_MATCH = 150;
export function sumScoreBreakdown(breakdown) {
    let hammerScore = 0;
    // Rejection to the bottom of the list, most severe first. noTokenRelationship and
    // authorityLevelContradiction can never both apply to the same leaf (the latter requires
    // hasLeafRelationship, which the former rules out by definition), so their relative order below
    // is for readability only. missingRequiredRoleHead CAN co-occur with authorityLevelContradiction
    // (a leaf can simultaneously miss the query's role head and assert the wrong authority tier) --
    // checking it last here is what stops that from silently stacking into a score more negative than
    // NO_TOKEN_RELATIONSHIP itself, which would rank a leaf that matched real tokens below one that
    // matched none at all. Specialization contradictions are scored by
    // specializationTierScore/specializationScore below instead of a hammer branch here -- that
    // formula already scales severity with how many kinds contradict and whether the evidence is
    // broad or narrow, so a fixed hammer value would either duplicate or undercut it.
    if (hammerScore === 0) {
        if (breakdown.noTokenRelationship < 0) {
            hammerScore = HAMMER_NO_TOKEN_RELATIONSHIP;
        }
    }
    if (hammerScore === 0) {
        if (breakdown.authorityLevelContradiction) {
            hammerScore = HAMMER_AUTHORITY_CONTRADICTION;
        }
    }
    if (hammerScore === 0) {
        if (breakdown.missingRequiredRoleHead < 0) {
            hammerScore = HAMMER_MISSING_REQUIRED_ROLE_HEAD;
        }
    }
    // Promotions to the top of the list
    if (hammerScore === 0) {
        if (breakdown.exactCanonicalMatch > 0) {
            hammerScore = HAMMER_EXACT_CANONICAL_MATCH;
        }
    }
    // aliasMatchBonus, translatedRoleAliasExact, familyFit, and usefulTokenCoverage are deliberately
    // excluded from totalScore -- they're all downstream of the alias-aware closeness ranker
    // (matchedLabelSource === 'alias', closeness.matchedUsefulTokens), the "invisible"/closeness-rank
    // evidence the query-to-leaf structural ranking must not be driven by. They still carry their
    // real computed values on the returned breakdown (see scoreLeaf) so RANKED_LEAF_TIE_BREAKERS can
    // use them to break ties between leaves whose structural evidence (specialization/authority/role
    // match) is otherwise equal.
    return (hammerScore +
        breakdown.levelMatch +
        breakdown.roleHeadOrUsefulCanonical +
        breakdown.specializationScore +
        breakdown.genericBaseRoleFit +
        breakdown.usefulMatchNoSpecialization +
        breakdown.usefulDomainSupport +
        breakdown.usefulVenueSupport +
        breakdown.usefulCapabilityFit +
        breakdown.relativeSiblingEvidence);
}
export function computeSiblingCompetitionScores(leaves, preparedQuery, familyScopedFoldedTokens = preparedQueryRoleFamilyScopedFoldedTokens(preparedQuery)) {
    const queryTokens = uniqueStrings(familyScopedFoldedTokens.filter((token) => token.length > 0));
    const leafTokenSets = leaves.map((leaf) => ({
        graphNodeId: leaf.graphNodeId,
        tokens: leafSurfaceTokens(leaf)
    }));
    const totalLeafCount = leafTokenSets.length;
    const tokenLeafCounts = new Map();
    return new Map(leaves.map((leaf) => [leaf.graphNodeId, 0]));
    if (totalLeafCount <= 1 || queryTokens.length === 0) {
        return new Map(leaves.map((leaf) => [leaf.graphNodeId, 0]));
    }
    for (const token of queryTokens) {
        tokenLeafCounts.set(token, leafTokenSets.filter((leaf) => leaf.tokens.has(token)).length);
    }
    return new Map(leafTokenSets.map((leaf) => {
        let score = 0;
        for (const token of queryTokens) {
            if (!leaf.tokens.has(token)) {
                continue;
            }
            const leafCount = tokenLeafCounts.get(token) ?? totalLeafCount;
            const rarity = Math.log((totalLeafCount + 1) / (leafCount + 1)) / Math.log(totalLeafCount + 1);
            score += Math.min(6, rarity * 8);
        }
        return [leaf.graphNodeId, Math.min(10, Math.round(score))];
    }));
}
function leafSurfaceTokens(leaf) {
    return new Set(tokenizeNormalizedText(foldSearchText(leaf.canonicalLabel)));
}
export function computeLeafSupportEvidence(preparedQuery, canonicalLabel, aliases, capabilityLabels, familyScopedFoldedTokens = preparedQueryRoleFamilyScopedFoldedTokens(preparedQuery), capabilityVerbFoldedAdditionTokens = preparedQueryRoleCapabilityVerbFoldedAdditionTokens(preparedQuery), foldedQuery = preparedQueryRoleFolded(preparedQuery)) {
    const capabilityLabelTexts = capabilityLabels.map((capability) => capability.normalizedLabel || capability.label);
    return {
        familyScopedFit: FAMILY_SCOPED_LEAF_RANKER.rank({
            locale: preparedQuery.locale,
            foldedQuery,
            familyScopedFoldedTokens,
            canonicalLabel,
            aliases,
            capabilityLabels: capabilityLabelTexts
        }),
        capabilityFit: CAPABILITY_FIT_RANKER.rank({
            familyScopedFoldedTokens,
            capabilityVerbFoldedAdditionTokens,
            capabilityLabels: capabilityLabelTexts
        })
    };
}
function leafHasExactCanonicalMatch(closeness, canonicalTokens, preparedQuery, locale, queryContext) {
    if (closeness.matchedLabelSource === 'canonical' && (closeness.exactNormalizedLabel || closeness.exactFoldedLabel)) {
        return true;
    }
    // The canonical label itself can still be an exact match at the token level -- a plural/singular
    // (or other grammatical-variant) restatement of the query with no extra content, e.g. canonical
    // "software developer" against query "software developers" -- even when a literally-matching
    // alias won the closeness ranker's comparison and so `closeness.matchedLabelSource` reads
    // 'alias' instead. That's a stronger signal than a mere alias exact match, so it must be judged
    // against the canonical label directly rather than deferring to whichever label the ranker picked.
    const missingFromCanonical = preparedQuery.usefulFoldedRecallTokens.filter((token) => !canonicalTokens.has(token) && !tokenMatchesLocaleVariant(token, canonicalTokens, locale));
    const extraInCanonical = Array.from(canonicalTokens).filter((token) => !queryContext.foldedTokenSet.has(token) && !tokenMatchesLocaleVariant(token, queryContext.foldedTokenSet, locale));
    return missingFromCanonical.length === 0 && extraInCanonical.every((token) => isOptionalLinkerToken(token, locale));
}
function leafCanonicalCoversEveryUsefulQueryToken(canonicalTokens, preparedQuery, locale) {
    return preparedQuery.usefulFoldedRecallTokens.every((token) => canonicalTokens.has(token) || tokenMatchesLocaleVariant(token, canonicalTokens, locale));
}
// "business" is a generic commerce catch-all (sales/comercial/marketing/...), not a real industry --
// a sales-family leaf and a sales family always share it trivially, so it can't tell us the leaf's
// industry actually matches the family's.
function findSynonymClusterIntersectionBoth(clusters, leftTokens, rightTokens) {
    for (const [clusterName, aliases] of Object.entries(clusters)) {
        if (clusterName === 'business') {
            continue;
        }
        const foldedAliases = aliases.map((alias) => foldSearchText(alias));
        const leafToken = foldedAliases.find((alias) => leftTokens.has(alias));
        const familyToken = foldedAliases.find((alias) => rightTokens.has(alias));
        if (leafToken && familyToken) {
            return { cluster: clusterName, leafToken, familyToken };
        }
    }
    return null;
}
function synonymClusterIntersectsBoth(clusters, leftTokens, rightTokens) {
    return findSynonymClusterIntersectionBoth(clusters, leftTokens, rightTokens) !== null;
}
// The family-inherent exemption is only earned by the SPECIFIC cluster that ties the leaf to its
// family (e.g. "software" in the "ict" cluster, because the family label itself says "software").
// A leaf can carry an ADDITIONAL industry_context cluster the family label says nothing about (e.g.
// "embedded" on "embedded systems software developer") -- that extra cluster is a genuine
// distinguishing specialization, not baseline family membership, so its presence must withdraw the
// exemption for the whole kind rather than let it ride tax-free alongside the family-inherent word.
function leafHasSpecializationClusterOutsideFamily(clusters, leafTokens, familyTokens) {
    for (const [clusterName, aliases] of Object.entries(clusters)) {
        if (clusterName === 'business') {
            continue;
        }
        const foldedAliases = aliases.map((alias) => foldSearchText(alias));
        const leafHasCluster = foldedAliases.some((alias) => leafTokens.has(alias));
        if (!leafHasCluster) {
            continue;
        }
        const familyHasCluster = foldedAliases.some((alias) => familyTokens.has(alias));
        if (!familyHasCluster) {
            return true;
        }
    }
    return false;
}
function translatedRoleAliasSupportsSpecialization(kind, canonicalTokens, preparedQuery, queryContext) {
    if (preparedQuery.locale === 'en') {
        return false;
    }
    if (queryContext.translatedRoleSpecializationTokens.size === 0) {
        return false;
    }
    return synonymClusterIntersectsBoth(ATOMIC_SPECIALIZATION_SYNONYMS[kind], canonicalTokens, queryContext.translatedRoleSpecializationTokens);
}
function leafAndQueryShareSpecializationValue(kind, canonicalTokens, preparedQuery, capabilityLabels, queryContext) {
    return (synonymClusterIntersectsBoth(ATOMIC_SPECIALIZATION_SYNONYMS[kind], canonicalTokens, queryContext.specializationQueryTokens) ||
        specializationKindAlignedWithQuery(kind, canonicalTokens, preparedQuery) ||
        specializationKindImpliedByQueryVenue(kind, canonicalTokens, preparedQuery) ||
        translatedRoleAliasSupportsSpecialization(kind, canonicalTokens, preparedQuery, queryContext) ||
        specializationKindSupportedByCapabilities(kind, preparedQuery, capabilityLabels));
}
// leafHasExactCanonicalMatch above only ever sees the cleaned/role-scoped preparedQuery, so a
// canonical label with its own qualifying clause (e.g. "import export manager in agricultural
// machinery and equipment") can never register as exact once query cleaning splits that clause
// into a separate context span -- ranking would score it as a partial match and only a bolted-on
// post-ranking rescue could recover it, with no fix to its (too-low) score/confidence. Checking the
// raw, unsplit query text directly here lets ranking itself recognize this leaf as the true exact
// match, no separate rescue pass required.
function leafHasRawQueryFullStringExactCanonical(canonicalLabel, queryContext) {
    return (foldSearchText(canonicalLabel) === queryContext.exactQueryFolded ||
        foldWeakPunctuationLookupText(canonicalLabel) === queryContext.exactQueryWeakFolded);
}
function leafHasExactAliasMatch(aliases, preparedQuery) {
    if (aliases.some((alias) => alias === preparedQuery.normalized)) {
        return true;
    }
    if (aliases.some((alias) => foldSearchText(alias) === preparedQuery.folded)) {
        return true;
    }
    const foldedQueryTokens = preparedQuery.foldedTokens.join(' ');
    return aliases.some((alias) => tokenizeNormalizedText(foldSearchText(alias)).join(' ') === foldedQueryTokens);
}
function leafHasTranslatedRoleExactAliasMatch(aliases, preparedQuery, queryContext) {
    // This signal is meant to rescue cross-locale role translations (e.g. Estonian role text matching
    // an English-backed alias). In English, the same comparison mostly rewards broad role trimming and
    // duplicates ordinary exact-alias authority.
    if (preparedQuery.locale === 'en') {
        return false;
    }
    if (queryContext.roleFoldedTokens.length < 2 ||
        (!queryContext.roleNormalized && !queryContext.roleFolded && !queryContext.roleFoldedTokenText)) {
        return false;
    }
    return aliases.some((alias) => {
        const foldedAlias = foldSearchText(alias);
        return ((queryContext.roleNormalized.length > 0 && alias === queryContext.roleNormalized) ||
            (queryContext.roleFolded.length > 0 && foldedAlias === queryContext.roleFolded) ||
            (queryContext.roleFoldedTokenText.length > 0 && tokenizeNormalizedText(foldedAlias).join(' ') === queryContext.roleFoldedTokenText));
    });
}
function leafHasRoleHeadMatch(preparedQuery, canonicalTokens) {
    const { roleHeadTokens, altRoleHeadTokens } = preparedQuery.intent;
    return (roleHeadTokens.length > 0 &&
        (roleHeadTokens.every((token) => canonicalTokens.has(foldSearchText(token))) ||
            altRoleHeadTokens.some((token) => canonicalTokens.has(foldSearchText(token)))));
}
function allLeafRoleHeadEquivalentTokens(canonicalTokens, aliases) {
    const tokens = new Set(canonicalTokens);
    for (const alias of aliases) {
        for (const token of tokenizeNormalizedText(foldSearchText(alias))) {
            tokens.add(token);
        }
    }
    return tokens;
}
// altRoleHeadTokens is resolved once at intent-build time (query-intent.ts) from the curated
// role-head equivalence classes, so this checks a plain token set instead of calling the
// equivalence artifact itself -- see OccupationQueryIntent.altRoleHeadTokens.
function leafHasRoleHeadEquivalentMatch(preparedQuery, canonicalTokens) {
    const { roleHeadTokens, altRoleHeadTokens } = preparedQuery.intent;
    if (roleHeadTokens.length === 0) {
        return false;
    }
    return (roleHeadTokens.every((token) => canonicalTokens.has(foldSearchText(token))) ||
        altRoleHeadTokens.some((term) => canonicalTokens.has(term)));
}
function leafHasRoleHeadPhraseMatch(rolePhraseMatch, canonicalTokens) {
    if (!rolePhraseMatch) {
        return false;
    }
    return rolePhraseMatch.canonicalTokens.every((token) => canonicalTokens.has(foldSearchText(token)));
}
function leafHasUsefulCanonicalMatch(closeness) {
    return closeness.matchedLabelSource === 'canonical' && closeness.usefulQueryCoverage >= 1 && closeness.missingUsefulTokens.length === 0;
}
// Only FamilyScopedLeafRanker's own literal-token verdict decides this -- 5 unless its tier is
// 'weak'. This used to also credit a 'weak' tier when roleHeadEquivalentMatched had fired (a
// curated cross-locale role-head equivalence FamilyScopedLeafRanker itself can't see, since it
// only compares literal tokens), but that branch was dead code (an unconditional `return 0`
// above it), so the doc comment was describing behavior the function didn't actually have. Left
// removed rather than revived -- familyFit is tie-breaker-only now (see sumScoreBreakdown), and
// adding another equivalence-driven path into it is exactly the kind of extra invisible sway to
// avoid rather than restore without a specific reason to.
function familyScopedFitScore(fit) {
    return fit.tier !== 'weak' ? 5 : 0;
}
function leafHasUsefulDomainSupport(preparedQuery, canonicalTokens) {
    return preparedQuery.intent.domainTokens.some((token) => canonicalTokens.has(foldSearchText(token)));
}
function leafHasUsefulVenueSupport(preparedQuery, canonicalTokens) {
    return preparedQuery.intent.venueTokens.some((token) => canonicalTokens.has(foldSearchText(token)));
}
function capabilityFitScore(_closeness, structure, capabilityLabels, hasLeafRelationship, fit) {
    if (!hasLeafRelationship || structure?.capabilityDominanceRisk !== 'low' || capabilityLabels.length === 0) {
        return 0;
    }
    if (fit.tier === 'strong') {
        return 4;
    }
    if (fit.tier === 'partial') {
        return 2;
    }
    return 0;
}
// Deterministic tie-break, evaluated top-down, totalScore first. Hard contradictions (management-
// vs-non-management authority) and specialization tier scoring are not separate gates here --
// sumScoreBreakdown folds them directly into totalScore, so a contradiction sinks a leaf through
// plain score comparison rather than a comparator tier. The rest
// are the pre-existing fallbacks: exact-match flags, canonical-label proximity, alias-driven coverage,
// genericity, and label length. canonicalUsefulTokenCoverage is checked before the alias-driven
// signals below (matchedUsefulTokens.length, closeness.score) because aliases are wild -- a leaf
// can win those purely through an alias that drags in unrelated words alongside the query's own,
// while its own canonical label shares nothing with the query at all. The leaf's own label is the
// more trustworthy proximity signal.
// totalScore (structural/authority evidence) always decides first; everything below it only
// breaks ties -- including the alias/closeness-rank evidence (aliasMatchBonus,
// closeness.matchedUsefulTokens, closeness.score) that sumScoreBreakdown deliberately keeps out of
// totalScore itself.
const RANKED_LEAF_TIE_BREAKERS = [
    (leaf) => leaf.totalScore,
    (leaf) => leaf.canonicalUsefulTokenCoverage,
    (leaf) => leaf.scoreBreakdown.genericBaseRoleFit,
    (leaf) => (leaf.scoreBreakdown.aliasMatchBonus > 0 ? 1 : 0),
    (leaf) => (leaf.scoreBreakdown.translatedRoleAliasExact > 0 ? 1 : 0),
    (leaf) => leaf.closeness.matchedUsefulTokens.length,
    (leaf) => leaf.closeness.score,
    (leaf) => canonicalTokenCount(leaf.canonicalLabel)
];
export function compareRankedLeaves(left, right) {
    for (const tieBreaker of RANKED_LEAF_TIE_BREAKERS) {
        const difference = tieBreaker(right) - tieBreaker(left);
        if (difference !== 0) {
            return difference;
        }
    }
    // Use esco default order
    return left.graphNodeId.toString().localeCompare(right.graphNodeId.toString());
}
export function resolveFamily(artifact, familyInput) {
    const parsedFamilyId = Number.parseInt(familyInput, 10);
    if (Number.isInteger(parsedFamilyId) && String(parsedFamilyId) === familyInput.trim()) {
        const matchingRecord = artifact.getLeafCoreRecordsForFamilies([parsedFamilyId])[0] ?? null;
        if (!matchingRecord?.familyLabel) {
            throw new Error(`No runtime leaves found for family id ${parsedFamilyId}.`);
        }
        return {
            familyNodeId: parsedFamilyId,
            familyLabel: matchingRecord.familyLabel
        };
    }
    const foldedFamilyInput = foldSearchText(familyInput);
    const familyById = new Map();
    for (const record of artifact.getAllCoreRecords()) {
        if (record.familyNodeId === null || record.familyLabel === null) {
            continue;
        }
        familyById.set(record.familyNodeId, record.familyLabel);
    }
    const matches = Array.from(familyById.entries())
        .filter(([, label]) => foldSearchText(label) === foldedFamilyInput)
        .sort((left, right) => left[1].localeCompare(right[1]) || left[0] - right[0]);
    if (matches.length === 0) {
        throw new Error(`No family matched "${familyInput}". Pass the family id or the exact family label.`);
    }
    const firstMatch = matches[0];
    if (!firstMatch) {
        throw new Error(`No family matched "${familyInput}". Pass the family id or the exact family label.`);
    }
    const [familyNodeId, familyLabel] = firstMatch;
    return { familyNodeId, familyLabel };
}
export function localeAliasLabels(aliases, locale) {
    return uniqueStrings(aliases.filter((alias) => alias.localeCode === locale).flatMap((alias) => [alias.alias, alias.normalizedAlias]));
}
// Which aliases count as evidence that THIS leaf matches the query -- as opposed to
// localeAliasLabels above, which returns every alias for display regardless of whether it's
// leaf-specific. Shared by cliRankLeaf here and by the live pipeline's loadLeafAliasesFromRecords
// (occupation-search-pipeline.ts), so both score against the same rule instead of two
// hand-written filters silently drifting apart.
//
// 'family_supporting' aliases are always dropped -- a generic crosswalk list shared verbatim
// across every leaf in a family, not evidence specific to this leaf.
//
// includeEnglishFallback is named explicitly here, rather than hidden inside a filter condition,
// because it's a real scoring choice: whether an English alias should also count as evidence for
// a non-English-locale query. Both callers currently pass true (cliRankLeaf via
// leafSpecificAliasLabels' default, the live pipeline via loadLeafAliasesFromRecords) so they
// agree by default. Keep the parameter, don't inline the literal -- it's the one thing to flip
// per-caller if CLI testing on more locales turns up a real downside to the English fallback.
export function leafEvidenceAliasLabels(aliases, locale, includeEnglishFallback) {
    return uniqueStrings(aliases
        .filter((alias) => {
        const matchesLocale = alias.localeCode === locale || (includeEnglishFallback && alias.localeCode === 'en');
        // Some upstream hydration paths build alias records without an aliasRole; fall back to
        // isPrimary the same way the live pipeline already did before this was shared.
        const aliasRole = alias.aliasRole ?? (alias.isPrimary ? 'locale_primary' : 'locale_supporting');
        return matchesLocale && aliasRole !== 'family_supporting';
    })
        .flatMap((alias) => [alias.alias, alias.normalizedAlias]));
}
// cliRankLeaf's call site -- kept as its own named export (rather than inlining
// leafEvidenceAliasLabels(aliases, locale, true) at the call site) so "what aliases did the CLI
// score against" stays a one-word answer to grep for, not a boolean flag to decode.
//
// includeEnglishFallback defaults to true here so the CLI now matches the live pipeline's
// behavior -- the disagreement documented on leafEvidenceAliasLabels above is closed for now, but
// the parameter is left in place (not inlined as a literal) specifically so it's one word to flip
// back to false if CLI testing turns up a real downside to crediting English aliases for
// non-English queries.
export function leafSpecificAliasLabels(aliases, locale, includeEnglishFallback = true) {
    return leafEvidenceAliasLabels(aliases, locale, includeEnglishFallback);
}
export function formatScoreBreakdown(breakdown) {
    return (Object.entries(breakdown)
        .filter(([key, value]) => key !== 'specializationBuckets' && value !== 0 && value !== false)
        .map(([key, value]) => `${key}:${Number(value) > 0 ? '+' : ''}${value}`)
        .join(',') || 'none');
}
export function canonicalTokenCount(value) {
    return tokenizeNormalizedText(value).length;
}
function uniqueStrings(values) {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));
}
export function formatPercent(value) {
    return `${Math.round(value * 100)}%`;
}
