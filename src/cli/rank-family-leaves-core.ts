import {
  preparedQueryRoleCapabilityVerbFoldedAdditionTokens,
  preparedQueryRoleFamilyScopedFoldedTokens,
  preparedQueryRoleFolded,
  preparedQueryRoleFoldedTokens,
  preparedQueryRoleNormalized,
  preparedQueryRoleUsefulFoldedRecallTokens,
  type PreparedQuery,
  type SupportedQueryLocale
} from '../query/query-preparation.js';
import type {
  RuntimeAliasRecord,
  RuntimeCapabilityRecord,
  RuntimeSearchMetaCoreRecord,
  SearchMetaArtifactCacheEntry
} from '../runtime/occupation-search-meta-artifact.js';
import type { OccupationLeafStructureArtifact } from '../runtime/occupation-leaf-structure-artifact.js';
import type { OccupationLeafStructureRecord } from '../runtime/occupation-leaf-structure-contract.js';
import type { LeafSpecializationKind } from '../runtime/occupation-leaf-structure-contract.js';
import {
  ATOMIC_SPECIALIZATION_SYNONYMS,
  detectLeafLevelKind,
  type LeafLevelKind,
  resolveLeafSpecializationKindsFromTokens,
  specializationKindAlignedWithQuery,
  specializationKindImpliedByQueryVenue,
  specializationKindSupportedByCapabilities
} from '../runtime/occupation-leaf-structure-rules.js';
import { TokenLeafClosenessRanker, type LeafClosenessRank } from '../search-pipeline/ranking/leaf-closeness-ranker.js';
import { CapabilityFitRanker, type CapabilityFit } from '../search-pipeline/ranking/capability-fit-ranker.js';
import { FamilyScopedLeafRanker, type FamilyScopedLeafFit } from '../search-pipeline/ranking/family-scoped-leaf-ranker.js';
import { findCommonRolePhraseMatch, type CommonRolePhraseMatch } from '../query/common-role-phrase-atlas.js';
import { isOptionalLinkerToken } from '../query/phrase-match.js';
import { tokenMatchesLocaleVariant } from '../query/token-variants.js';
import { foldSearchText, foldWeakPunctuationLookupText, tokenizeNormalizedText } from '../utils/texts.js';

export type RankedFamilyLeaf = {
  rank: number;
  graphNodeId: number;
  canonicalLabel: string;
  aliases: string[];
  structure: OccupationLeafStructureRecord | null;
  closeness: LeafClosenessRank;
  scoreBreakdown: LeafScoreBreakdown;
  totalScore: number;
  canonicalUsefulTokenCoverage: number;
};

// Per-leaf trace of the unsupportedSpecialization penalty's inputs -- surfaces which specialization
// kinds the leaf carries, which of those are "penalizable" (not already excused by family-inherent
// industry context), and which of those penalizable kinds the query actually supports, so a -5 can
// be explained rather than just observed. CLI-only (see debugComputeSpecialization below) --
// deliberately NOT part of RankedFamilyLeaf/scoreLeaf, which the real runtime pipeline
// (occupation-search-pipeline.ts) also calls into.
export type SpecializationDebug = {
  specializationKinds: LeafSpecializationKind[];
  industryContextInherentToFamily: boolean;
  penalizableSpecializationKinds: LeafSpecializationKind[];
  supportedPenalizableSpecializationKinds: LeafSpecializationKind[];
  unsupportedPenalizableSpecializationKinds: LeafSpecializationKind[];
};

// SCORE TABLE -- the fields of LeafScoreBreakdown, in the order scoreLeaf computes them below.
// This is the single reference for "what does a leaf's score actually mean" -- keep it in sync
// whenever a field's condition or point value changes in scoreLeaf.
//
//   noTokenRelationship        -30 if the query matched none of the leaf's useful tokens at all.
//   missingRequiredRoleHead     -8 if query preparation marked the role head as requiring context
//                               and the leaf matched the context/modifier without that role head.
//   exactCanonicalMatch         55 if the leaf's canonical label exactly matches the raw, unsplit
//                               query text; 50 if it exactly matches the cleaned/role-scoped
//                               preparedQuery and leaves no useful query terms missing.
//                               Short-circuits every other field to 0 only when either full-title
//                               exactness fires -- a role-only canonical match with missing useful
//                               context is role grounding, not final leaf authority.
//   aliasExactMatch              3 if some alias exactly matches the preparedQuery. Small because
//                               aliases are noisy (see leafSpecificAliasLabels below).
//   exactAliasMatch             20 if the matched label was an alias, it covered every useful query
//                               token, and anything left over is only an optional linker word --
//                               effectively an exact match on a curated label.
//   translatedRoleAliasExact    12 if an alias exactly matches the prepared role-normalized/
//                               role-folded query surface. This is weaker than raw alias equality
//                               but preserves cross-lingual role aliases such as et "poe juht" ->
//                               en "store manager".
//   levelMatch                   5 for an exact level match, 3 for a related level band match.
//   roleHeadOrUsefulCanonical   0 / 5 / 10 / 15, see roleHeadOrUsefulCanonicalTier -- how strongly
//                               the query's role-head token(s) or useful-canonical tokens matched.
//   specializationMatch         +8 per specialization value supported by both the leaf and the
//                               prepared query. Query-side kind evidence alone is not enough.
//   familyFit                   5 if family-scoped leaf fit finds title/alias/capability support.
//                               This is bounded support, not standalone leaf authority.
//   genericBaseRoleFit           1 if familyFit fired and the leaf is a generic_base_role -- a
//                               small nudge for the safer default among family-fit candidates.
//   unsupportedSpecialization   -5 if the leaf carries a specialization kind the query does not
//                               support (and does not already carry any matched useful tokens'
//                               worth of exemption -- see the closeness.matchedUsefulTokens guard
//                               in scoreLeaf). Suppressed entirely when noTokenRelationship already
//                               disqualified the leaf, since it would add noise, not signal.
//   usefulMatchNoSpecialization  5 if the leaf matched a useful canonical token and carries no
//                               specialization kind at all -- a plain, unqualified role is safe.
//   usefulDomainSupport          2 if the query supports the leaf's domain tokens.
//   usefulVenueSupport           2 if the query supports the leaf's venue tokens.
//   usefulCapabilityFit        0 / 2 / 4 if low-risk leaf capabilities partially/strongly cover
//                               the family-scoped query tokens. Requires independent leaf/title
//                               relationship; capabilities support, they do not select alone.
//   usefulTokenCoverage         0 / 1 / 3 / 5, see usefulTokenCoverageScore -- steeper reward for
//                               matching 2+ useful query tokens than a flat per-token rate would give.
//
// sumScoreBreakdown adds every field above into the leaf's totalScore. There is no normalization
// step here -- totalScore is an unbounded additive score, not a [0,1] confidence (the real
// pipeline's PIPELINE_DECISION_GATE thresholds were calibrated against a different, [0,1]-scaled
// ranking strategy; see occupation-search-pipeline.ts).
export type LeafScoreBreakdown = {
  noTokenRelationship: number;
  missingRequiredRoleHead: number;
  exactCanonicalMatch: number;
  aliasExactMatch: number;
  exactAliasMatch: number;
  translatedRoleAliasExact: number;
  levelMatch: number;
  roleHeadOrUsefulCanonical: number;
  specializationMatch: number;
  familyFit: number;
  genericBaseRoleFit: number;
  unsupportedSpecialization: number;
  usefulMatchNoSpecialization: number;
  usefulDomainSupport: number;
  usefulVenueSupport: number;
  usefulCapabilityFit: number;
  usefulTokenCoverage: number;
};

export type LeafSupportEvidence = {
  familyScopedFit: FamilyScopedLeafFit;
  capabilityFit: CapabilityFit;
};

const LEAF_CLOSENESS_RANKER = new TokenLeafClosenessRanker();
const CAPABILITY_FIT_RANKER = new CapabilityFitRanker();
const FAMILY_SCOPED_LEAF_RANKER = new FamilyScopedLeafRanker();

type LeafRankingQueryContext = {
  roleNormalized: string;
  roleFolded: string;
  roleFoldedTokens: string[];
  roleFoldedTokenText: string;
  roleFamilyScopedFoldedTokens: string[];
  roleCapabilityVerbFoldedAdditionTokens: string[];
  foldedTokenSet: Set<string>;
  queryLevelKind: LeafLevelKind;
  specializationQueryTokens: Set<string>;
  translatedRoleSpecializationTokens: Set<string>;
  exactQueryFolded: string;
  exactQueryWeakFolded: string;
};

const LEAF_RANKING_QUERY_CONTEXT_CACHE = new WeakMap<PreparedQuery, Map<string, LeafRankingQueryContext>>();

export function cliRankFamilyLeaves(
  artifact: SearchMetaArtifactCacheEntry,
  leafStructureArtifact: OccupationLeafStructureArtifact | null,
  leaves: RuntimeSearchMetaCoreRecord[],
  preparedQuery: PreparedQuery,
  effectiveQuery: string,
  locale: string,
  exactQueryText: string = effectiveQuery
): RankedFamilyLeaf[] {
  const rolePhraseMatch = findCommonRolePhraseMatch(effectiveQuery, locale as SupportedQueryLocale);
  // One cache per CLI invocation so a leaf's derived specializationKinds (used when the artifact's
  // authored value is empty/unclassified) is computed once even though `rankLeaf` runs per leaf.
  const specializationKindsCache: Map<number, LeafSpecializationKind[]> = new Map();

  return leaves
    .map((leaf) =>
      cliRankLeaf(artifact, leafStructureArtifact, leaf, preparedQuery, locale, rolePhraseMatch, exactQueryText, specializationKindsCache)
    )
    .sort(compareRankedLeaves)
    .map((leaf, index) => ({ ...leaf, rank: index + 1 }));
}

function getLeafRankingQueryContext(preparedQuery: PreparedQuery, exactQueryText: string): LeafRankingQueryContext {
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

function buildLeafRankingQueryContext(preparedQuery: PreparedQuery, exactQueryText: string): LeafRankingQueryContext {
  const roleFoldedTokens = preparedQueryRoleFoldedTokens(preparedQuery);
  const specializationQueryTokens = new Set<string>();

  for (const token of [
    ...preparedQuery.usefulFoldedRecallTokens,
    ...preparedQuery.intent.roleTokens,
    ...preparedQuery.intent.roleHeadTokens,
    ...preparedQuery.intent.domainTokens,
    ...preparedQuery.intent.venueTokens
  ]) {
    specializationQueryTokens.add(foldSearchText(token));
  }

  const translatedRoleSpecializationTokens = new Set<string>();

  for (const token of [...preparedQuery.intent.roleTokens, ...roleFoldedTokens]) {
    translatedRoleSpecializationTokens.add(foldSearchText(token));
  }

  return {
    roleNormalized: preparedQueryRoleNormalized(preparedQuery),
    roleFolded: preparedQueryRoleFolded(preparedQuery),
    roleFoldedTokens,
    roleFoldedTokenText: roleFoldedTokens.join(' '),
    roleFamilyScopedFoldedTokens: preparedQueryRoleFamilyScopedFoldedTokens(preparedQuery),
    roleCapabilityVerbFoldedAdditionTokens: preparedQueryRoleCapabilityVerbFoldedAdditionTokens(preparedQuery),
    foldedTokenSet: new Set(preparedQuery.foldedTokens),
    queryLevelKind: detectLeafLevelKind(
      new Set([...preparedQuery.modifierTokens, ...preparedQuery.foldedTokens].map((token) => foldSearchText(token)))
    ),
    specializationQueryTokens,
    translatedRoleSpecializationTokens,
    exactQueryFolded: foldSearchText(exactQueryText),
    exactQueryWeakFolded: foldWeakPunctuationLookupText(exactQueryText)
  };
}

function cliRankLeaf(
  artifact: SearchMetaArtifactCacheEntry,
  leafStructureArtifact: OccupationLeafStructureArtifact | null,
  leaf: RuntimeSearchMetaCoreRecord,
  preparedQuery: PreparedQuery,
  locale: string,
  rolePhraseMatch: CommonRolePhraseMatch | null,
  exactQueryText: string,
  specializationKindsCache: Map<number, LeafSpecializationKind[]>
): RankedFamilyLeaf {
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
      usefulFoldedRecallTokens: preparedQuery.usefulFoldedRecallTokens
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
  const supportEvidence = computeLeafSupportEvidence(
    preparedQuery,
    leaf.canonicalLabel,
    leafSpecificAliases,
    capabilityLabels,
    queryContext.roleFamilyScopedFoldedTokens,
    queryContext.roleCapabilityVerbFoldedAdditionTokens,
    queryContext.roleFolded
  );
  const scoreBreakdown = scoreLeaf(
    closeness,
    leafSpecificAliases,
    structure,
    preparedQuery,
    canonicalTokens,
    matchedLabelTokens,
    familyTokens,
    capabilityLabels,
    rolePhraseMatch,
    locale,
    leaf.canonicalLabel,
    exactQueryText,
    leaf.graphNodeId,
    specializationKindsCache,
    queryContext.roleFamilyScopedFoldedTokens,
    queryContext.roleCapabilityVerbFoldedAdditionTokens,
    supportEvidence
  );
  const totalScore = sumScoreBreakdown(scoreBreakdown);
  // Aliases are wild -- a leaf can win closeness/usefulTokenCoverage purely through an alias that
  // happens to contain the query's words alongside unrelated ones (e.g. "night auditor" matching
  // via the alias "night customer care manager" for query "customer care specialist"). The leaf's
  // OWN canonical label is a much more trustworthy proximity signal, so it's tracked separately
  // here and checked as a tie-break ahead of any alias-driven signal.
  const canonicalUsefulTokenCoverage =
    preparedQuery.usefulFoldedRecallTokens.length > 0
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
export function debugComputeSpecialization(
  closeness: LeafClosenessRank,
  structure: OccupationLeafStructureRecord | null,
  preparedQuery: PreparedQuery,
  canonicalTokens: Set<string>,
  familyTokens: Set<string>,
  capabilityLabels: RuntimeCapabilityRecord[],
  graphNodeId: number,
  specializationKindsCache: Map<number, LeafSpecializationKind[]>
): SpecializationDebug {
  const specializationKinds = resolveLeafSpecializationKindsFromTokens(specializationKindsCache, graphNodeId, structure, canonicalTokens);
  const queryContext = getLeafRankingQueryContext(preparedQuery, preparedQuery.normalized);

  const industryContextInherentToFamily =
    specializationKinds.includes('industry_context') &&
    synonymClusterIntersectsBoth(ATOMIC_SPECIALIZATION_SYNONYMS.industry_context, canonicalTokens, familyTokens);

  const penalizableSpecializationKinds = specializationKinds.filter(
    (kind) =>
      !(kind === 'industry_context' && industryContextInherentToFamily) &&
      !specializationKindAlignedWithQuery(kind, canonicalTokens, preparedQuery) &&
      !specializationKindImpliedByQueryVenue(kind, canonicalTokens, preparedQuery) &&
      !translatedRoleAliasSupportsSpecialization(kind, canonicalTokens, preparedQuery, queryContext) &&
      !specializationKindSupportedByCapabilities(kind, preparedQuery, capabilityLabels)
  );

  const supportedSpecializationKinds = specializationKinds.filter((kind) =>
    leafAndQueryShareSpecializationValue(kind, canonicalTokens, preparedQuery, capabilityLabels, queryContext)
  );
  const supportedPenalizableSpecializationKinds =
    closeness.matchedUsefulTokens.length === 0
      ? penalizableSpecializationKinds
      : supportedSpecializationKinds.filter((kind) => penalizableSpecializationKinds.includes(kind));
  const unsupportedPenalizableSpecializationKinds =
    closeness.matchedUsefulTokens.length === 0
      ? []
      : penalizableSpecializationKinds.filter((kind) => !supportedPenalizableSpecializationKinds.includes(kind));

  return {
    specializationKinds,
    industryContextInherentToFamily,
    penalizableSpecializationKinds,
    supportedPenalizableSpecializationKinds,
    unsupportedPenalizableSpecializationKinds
  };
}

export function scoreLeaf(
  closeness: LeafClosenessRank,
  aliases: string[],
  structure: OccupationLeafStructureRecord | null,
  preparedQuery: PreparedQuery,
  canonicalTokens: Set<string>,
  matchedLabelTokens: Set<string>,
  familyTokens: Set<string>,
  capabilityLabels: RuntimeCapabilityRecord[],
  rolePhraseMatch: CommonRolePhraseMatch | null,
  locale: string,
  canonicalLabel: string,
  exactQueryText: string,
  graphNodeId: number,
  specializationKindsCache: Map<number, LeafSpecializationKind[]>,
  familyScopedFoldedTokens: string[] = preparedQueryRoleFamilyScopedFoldedTokens(preparedQuery),
  capabilityVerbFoldedAdditionTokens: string[] = preparedQueryRoleCapabilityVerbFoldedAdditionTokens(preparedQuery),
  supportEvidence: LeafSupportEvidence = computeLeafSupportEvidence(
    preparedQuery,
    canonicalLabel,
    aliases,
    capabilityLabels,
    familyScopedFoldedTokens,
    capabilityVerbFoldedAdditionTokens
  )
): LeafScoreBreakdown {
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
  } else if (
    leafHasExactCanonicalMatch(closeness, canonicalTokens, preparedQuery, locale as SupportedQueryLocale, queryContext) &&
    leafCanonicalCoversEveryUsefulQueryToken(canonicalTokens, preparedQuery, locale as SupportedQueryLocale)
  ) {
    exactCanonicalMatch = 50;
  }

  if (exactCanonicalMatch > 0) {
    return {
      noTokenRelationship: 0,
      missingRequiredRoleHead: 0,
      exactCanonicalMatch,
      aliasExactMatch: 0,
      exactAliasMatch: 0,
      translatedRoleAliasExact: 0,
      levelMatch: 0,
      roleHeadOrUsefulCanonical: 0,
      specializationMatch: 0,
      familyFit: 0,
      genericBaseRoleFit: 0,
      unsupportedSpecialization: 0,
      usefulMatchNoSpecialization: 0,
      usefulDomainSupport: 0,
      usefulVenueSupport: 0,
      usefulCapabilityFit: 0,
      usefulTokenCoverage: 0
    };
  }

  const roleHeadTokenCount = preparedQuery.intent.roleHeadTokens.length;
  const rolePhraseTokenCount = rolePhraseMatch?.canonicalTokens.length ?? 0;
  const roleHeadMatched = leafHasRoleHeadMatch(preparedQuery, matchedLabelTokens);
  const roleHeadPhraseMatched = leafHasRoleHeadPhraseMatch(rolePhraseMatch, matchedLabelTokens);
  const hasRoleHeadRelationship = roleHeadMatched || roleHeadPhraseMatched;
  const noTokenRelationship = closeness.matchedUsefulTokens.length === 0 && !hasRoleHeadRelationship ? -30 : 0;
  const missingRequiredRoleHead =
    preparedQuery.intent.roleHeadRequiresContext && closeness.matchedUsefulTokens.length > 0 && !hasRoleHeadRelationship ? -8 : 0;
  const usefulTokenCoverage = usefulTokenCoverageScore(closeness.matchedUsefulTokens.length);
  // Alias hits are noisy in practice (an alias can drift toward a related-but-distinct concept),
  // so this is a boost, not the full weight an exact canonical match gets.
  const exactAliasMatch = leafHasExactAliasMatch(aliases, preparedQuery) ? 3 : 0;

  // A leaf-specific alias (family-supporting ones are already excluded upstream) that covers every
  // useful query token, with nothing left over except optional linker words (e.g. ro "de"), is
  // effectively an exact match on a curated label -- it deserves clearly more credit than the
  // generic role-head/useful-canonical tiers below.
  const aliasExactMatch =
    closeness.matchedLabelSource === 'alias' &&
    closeness.missingUsefulTokens.length === 0 &&
    closeness.extraTitleTokens.every((token) => isOptionalLinkerToken(token, locale as SupportedQueryLocale))
      ? 20
      : 0;
  const translatedRoleAliasExact = leafHasTranslatedRoleExactAliasMatch(aliases, preparedQuery, queryContext) ? 12 : 0;
  const hasLeafRelationship = closeness.matchedUsefulTokens.length > 0 || hasRoleHeadRelationship;
  const leafLevelKind = detectLeafLevelKind(canonicalTokens);
  const levelMatch = hasLeafRelationship ? levelMatchScore(queryContext.queryLevelKind, leafLevelKind) : 0;

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
  const bareRoleHeadMatched = roleHeadMatched && closeness.matchedLabelSource === 'canonical';

  const roleHeadOrUsefulCanonical = roleHeadOrUsefulCanonicalTier({
    aliasExactMatch,
    roleHeadMatched,
    roleHeadPhraseMatched,
    roleHeadHasSupportingEvidence,
    usefulCanonicalMatched,
    bareRoleHeadMatched
  });

  const leafSpecializationKinds = resolveLeafSpecializationKindsFromTokens(
    specializationKindsCache,
    graphNodeId,
    structure,
    canonicalTokens
  );
  const supportedSpecializationKinds = leafSpecializationKinds.filter((kind) =>
    leafAndQueryShareSpecializationValue(kind, canonicalTokens, preparedQuery, capabilityLabels, queryContext)
  );

  const specializationMatch = hasLeafRelationship ? supportedSpecializationKinds.length * 8 : 0;

  const familyFit = familyScopedFitScore(preparedQuery, matchedLabelTokens, supportEvidence.familyScopedFit);

  // A generic base role (e.g. "software developer") is the safer default among family-fit
  // candidates when nothing else distinguishes them -- a specialized leaf (e.g. "blockchain
  // developer") only deserves to win on the strength of its own matched evidence
  // (specializationMatch, aliasExactMatch, etc.), not by accident of alias overlap. Gated on
  // familyFit so an off-topic generic leaf never gets this nudge just for being generic.
  const genericBaseRoleFit = familyFit > 0 && structure?.baseRoleKind === 'generic_base_role' ? 1 : 0;

  // industry_context is derived from a single broad marker word (e.g. "software"), which is often
  // also the word that put this leaf in its family in the first place -- the family label itself
  // contains it (e.g. "Software and applications developers and analysts"). Penalizing a query for
  // not repeating a word the family selection already established would punish e.g. "backend
  // developer" for not saying "software" against a leaf the family already committed to being
  // software-flavored. Other specialization kinds (venue/channel/product/population/task_focus)
  // don't get this exemption -- those really are disqualifying when the query doesn't support them,
  // regardless of family.
  const industryContextInherentToFamily =
    leafSpecializationKinds.includes('industry_context') &&
    synonymClusterIntersectsBoth(ATOMIC_SPECIALIZATION_SYNONYMS.industry_context, canonicalTokens, familyTokens);
  const penalizableSpecializationKinds = leafSpecializationKinds.filter(
    (kind) =>
      !(kind === 'industry_context' && industryContextInherentToFamily) &&
      !specializationKindAlignedWithQuery(kind, canonicalTokens, preparedQuery) &&
      !specializationKindImpliedByQueryVenue(kind, canonicalTokens, preparedQuery) &&
      !translatedRoleAliasSupportsSpecialization(kind, canonicalTokens, preparedQuery, queryContext) &&
      !specializationKindSupportedByCapabilities(kind, preparedQuery, capabilityLabels)
  );

  const supportedPenalizableSpecializationKinds = supportedSpecializationKinds.filter((kind) =>
    penalizableSpecializationKinds.includes(kind)
  );
  // Per-kind, not any-of: a leaf can carry more than one specialization kind (e.g. "motor vehicles
  // parts advisor" is both industry_context and product), and each is an independent claim the query
  // either does or doesn't back up. If even one penalizable kind goes unsupported, that specific claim
  // is unaddressed by the query and should count against the leaf, even when another kind on the same
  // leaf happens to be supported.
  let hasUnsupportedSpecialization = supportedPenalizableSpecializationKinds.length < penalizableSpecializationKinds.length;
  // Optimization: with zero lexical overlap, noTokenRelationship (-30) already disqualifies the
  // leaf -- piling an extra -5 on top adds no real signal, just noise that reorders
  // otherwise-equally-irrelevant leaves by incidental specialization-vocab luck. Suppress the
  // penalty in that case; it only means something as a tie-breaker between leaves that already
  // have some matched evidence.
  if (closeness.matchedUsefulTokens.length === 0) {
    hasUnsupportedSpecialization = false;
  }
  const unsupportedSpecialization = hasUnsupportedSpecialization ? -5 : 0;

  // Extra Generic leaf reward
  const usefulMatchNoSpecialization = leafHasUsefulCanonicalMatch(closeness) && leafSpecializationKinds.length === 0 ? 5 : 0;

  const usefulDomainSupport = leafHasUsefulDomainSupport(preparedQuery, matchedLabelTokens) ? 2 : 0;
  const usefulVenueSupport = leafHasUsefulVenueSupport(preparedQuery, matchedLabelTokens) ? 2 : 0;
  const usefulCapabilityFit = capabilityFitScore(
    closeness,
    structure,
    capabilityLabels,
    hasLeafRelationship,
    supportEvidence.capabilityFit
  );

  return {
    noTokenRelationship,
    missingRequiredRoleHead,
    exactCanonicalMatch,
    aliasExactMatch,
    exactAliasMatch,
    translatedRoleAliasExact,
    levelMatch,
    roleHeadOrUsefulCanonical,
    specializationMatch,
    familyFit,
    genericBaseRoleFit,
    unsupportedSpecialization,
    usefulMatchNoSpecialization,
    usefulDomainSupport,
    usefulVenueSupport,
    usefulCapabilityFit,
    usefulTokenCoverage
  };
}

// Rewards multi-token lexical overlap more steeply than a flat per-token rate would --
// a leaf that matches 2+ useful query tokens is a much stronger lexical candidate than one
// matching a single token, not just proportionally stronger.
function usefulTokenCoverageScore(matchedUsefulTokenCount: number): number {
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

function roleHeadOrUsefulCanonicalTier(input: {
  aliasExactMatch: number;
  roleHeadMatched: boolean;
  roleHeadPhraseMatched: boolean;
  roleHeadHasSupportingEvidence: boolean;
  usefulCanonicalMatched: boolean;
  bareRoleHeadMatched: boolean;
}): number {
  if (input.aliasExactMatch > 0) {
    return 0;
  }

  if ((input.roleHeadMatched || input.roleHeadPhraseMatched) && input.roleHeadHasSupportingEvidence) {
    return 15;
  }

  if (input.usefulCanonicalMatched) {
    return 10;
  }

  if (input.bareRoleHeadMatched || input.roleHeadPhraseMatched) {
    return 5;
  }

  return 0;
}

function levelMatchScore(queryLevelKind: LeafLevelKind, leafLevelKind: LeafLevelKind): number {
  if (queryLevelKind === 'none' || leafLevelKind === 'none') {
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
    case 'supervisor':
      return leafLevelKind === 'senior' || leafLevelKind === 'lead' || leafLevelKind === 'supervisor' ? 3 : 0;
    case 'manager':
    case 'director':
    case 'chief':
      return leafLevelKind === 'manager' || leafLevelKind === 'director' || leafLevelKind === 'chief' ? 3 : 0;
  }
}

export function sumScoreBreakdown(breakdown: LeafScoreBreakdown): number {
  return (
    breakdown.noTokenRelationship +
    breakdown.missingRequiredRoleHead +
    breakdown.exactCanonicalMatch +
    breakdown.aliasExactMatch +
    breakdown.exactAliasMatch +
    breakdown.translatedRoleAliasExact +
    breakdown.levelMatch +
    breakdown.roleHeadOrUsefulCanonical +
    breakdown.specializationMatch +
    breakdown.familyFit +
    breakdown.genericBaseRoleFit +
    breakdown.unsupportedSpecialization +
    breakdown.usefulMatchNoSpecialization +
    breakdown.usefulDomainSupport +
    breakdown.usefulVenueSupport +
    breakdown.usefulCapabilityFit +
    breakdown.usefulTokenCoverage
  );
}

export function computeLeafSupportEvidence(
  preparedQuery: PreparedQuery,
  canonicalLabel: string,
  aliases: string[],
  capabilityLabels: RuntimeCapabilityRecord[],
  familyScopedFoldedTokens: string[] = preparedQueryRoleFamilyScopedFoldedTokens(preparedQuery),
  capabilityVerbFoldedAdditionTokens: string[] = preparedQueryRoleCapabilityVerbFoldedAdditionTokens(preparedQuery),
  foldedQuery: string = preparedQueryRoleFolded(preparedQuery)
): LeafSupportEvidence {
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

function leafHasExactCanonicalMatch(
  closeness: LeafClosenessRank,
  canonicalTokens: Set<string>,
  preparedQuery: PreparedQuery,
  locale: SupportedQueryLocale,
  queryContext: LeafRankingQueryContext
): boolean {
  if (closeness.matchedLabelSource === 'canonical' && (closeness.exactNormalizedLabel || closeness.exactFoldedLabel)) {
    return true;
  }

  // The canonical label itself can still be an exact match at the token level -- a plural/singular
  // (or other grammatical-variant) restatement of the query with no extra content, e.g. canonical
  // "software developer" against query "software developers" -- even when a literally-matching
  // alias won the closeness ranker's comparison and so `closeness.matchedLabelSource` reads
  // 'alias' instead. That's a stronger signal than a mere alias exact match, so it must be judged
  // against the canonical label directly rather than deferring to whichever label the ranker picked.
  const missingFromCanonical = preparedQuery.usefulFoldedRecallTokens.filter(
    (token) => !canonicalTokens.has(token) && !tokenMatchesLocaleVariant(token, canonicalTokens, locale)
  );
  const extraInCanonical = Array.from(canonicalTokens).filter(
    (token) => !queryContext.foldedTokenSet.has(token) && !tokenMatchesLocaleVariant(token, queryContext.foldedTokenSet, locale)
  );

  return missingFromCanonical.length === 0 && extraInCanonical.every((token) => isOptionalLinkerToken(token, locale));
}

function leafCanonicalCoversEveryUsefulQueryToken(
  canonicalTokens: Set<string>,
  preparedQuery: PreparedQuery,
  locale: SupportedQueryLocale
): boolean {
  return preparedQuery.usefulFoldedRecallTokens.every(
    (token) => canonicalTokens.has(token) || tokenMatchesLocaleVariant(token, canonicalTokens, locale)
  );
}

function synonymClusterIntersectsBoth(clusters: Record<string, string[]>, leftTokens: Set<string>, rightTokens: Set<string>): boolean {
  return Object.values(clusters).some((aliases) => {
    const foldedAliases = aliases.map((alias) => foldSearchText(alias));
    return foldedAliases.some((alias) => leftTokens.has(alias)) && foldedAliases.some((alias) => rightTokens.has(alias));
  });
}

function translatedRoleAliasSupportsSpecialization(
  kind: LeafSpecializationKind,
  canonicalTokens: Set<string>,
  preparedQuery: PreparedQuery,
  queryContext: LeafRankingQueryContext
): boolean {
  if (preparedQuery.locale === 'en') {
    return false;
  }

  if (queryContext.translatedRoleSpecializationTokens.size === 0) {
    return false;
  }

  return synonymClusterIntersectsBoth(
    ATOMIC_SPECIALIZATION_SYNONYMS[kind],
    canonicalTokens,
    queryContext.translatedRoleSpecializationTokens
  );
}

function leafAndQueryShareSpecializationValue(
  kind: LeafSpecializationKind,
  canonicalTokens: Set<string>,
  preparedQuery: PreparedQuery,
  capabilityLabels: RuntimeCapabilityRecord[],
  queryContext: LeafRankingQueryContext
): boolean {
  return (
    synonymClusterIntersectsBoth(ATOMIC_SPECIALIZATION_SYNONYMS[kind], canonicalTokens, queryContext.specializationQueryTokens) ||
    specializationKindAlignedWithQuery(kind, canonicalTokens, preparedQuery) ||
    specializationKindImpliedByQueryVenue(kind, canonicalTokens, preparedQuery) ||
    translatedRoleAliasSupportsSpecialization(kind, canonicalTokens, preparedQuery, queryContext) ||
    specializationKindSupportedByCapabilities(kind, preparedQuery, capabilityLabels)
  );
}

// leafHasExactCanonicalMatch above only ever sees the cleaned/role-scoped preparedQuery, so a
// canonical label with its own qualifying clause (e.g. "import export manager in agricultural
// machinery and equipment") can never register as exact once query cleaning splits that clause
// into a separate context span -- ranking would score it as a partial match and only a bolted-on
// post-ranking rescue could recover it, with no fix to its (too-low) score/confidence. Checking the
// raw, unsplit query text directly here lets ranking itself recognize this leaf as the true exact
// match, no separate rescue pass required.
function leafHasRawQueryFullStringExactCanonical(canonicalLabel: string, queryContext: LeafRankingQueryContext): boolean {
  return (
    foldSearchText(canonicalLabel) === queryContext.exactQueryFolded ||
    foldWeakPunctuationLookupText(canonicalLabel) === queryContext.exactQueryWeakFolded
  );
}

function leafHasExactAliasMatch(aliases: string[], preparedQuery: PreparedQuery): boolean {
  if (aliases.some((alias) => alias === preparedQuery.normalized)) {
    return true;
  }

  if (aliases.some((alias) => foldSearchText(alias) === preparedQuery.folded)) {
    return true;
  }

  const foldedQueryTokens = preparedQuery.foldedTokens.join(' ');
  return aliases.some((alias) => tokenizeNormalizedText(foldSearchText(alias)).join(' ') === foldedQueryTokens);
}

function leafHasTranslatedRoleExactAliasMatch(
  aliases: string[],
  preparedQuery: PreparedQuery,
  queryContext: LeafRankingQueryContext
): boolean {
  // This signal is meant to rescue cross-locale role translations (e.g. Estonian role text matching
  // an English-backed alias). In English, the same comparison mostly rewards broad role trimming and
  // duplicates ordinary exact-alias authority.
  if (preparedQuery.locale === 'en') {
    return false;
  }

  if (
    queryContext.roleFoldedTokens.length < 2 ||
    (!queryContext.roleNormalized && !queryContext.roleFolded && !queryContext.roleFoldedTokenText)
  ) {
    return false;
  }

  return aliases.some((alias) => {
    const foldedAlias = foldSearchText(alias);

    return (
      (queryContext.roleNormalized.length > 0 && alias === queryContext.roleNormalized) ||
      (queryContext.roleFolded.length > 0 && foldedAlias === queryContext.roleFolded) ||
      (queryContext.roleFoldedTokenText.length > 0 && tokenizeNormalizedText(foldedAlias).join(' ') === queryContext.roleFoldedTokenText)
    );
  });
}

function leafHasRoleHeadMatch(preparedQuery: PreparedQuery, canonicalTokens: Set<string>): boolean {
  const roleHeadTokens = preparedQuery.intent.roleHeadTokens;
  return roleHeadTokens.length > 0 && roleHeadTokens.every((token) => canonicalTokens.has(foldSearchText(token)));
}

function leafHasRoleHeadPhraseMatch(rolePhraseMatch: CommonRolePhraseMatch | null, canonicalTokens: Set<string>): boolean {
  if (!rolePhraseMatch) {
    return false;
  }

  return rolePhraseMatch.canonicalTokens.every((token) => canonicalTokens.has(foldSearchText(token)));
}

function leafHasUsefulCanonicalMatch(closeness: LeafClosenessRank): boolean {
  return closeness.matchedLabelSource === 'canonical' && closeness.usefulQueryCoverage >= 1 && closeness.missingUsefulTokens.length === 0;
}

function familyScopedFitScore(preparedQuery: PreparedQuery, matchedLabelTokens: Set<string>, fit: FamilyScopedLeafFit): number {
  if (fit.tier !== 'weak') {
    return 5;
  }

  return preparedQuery.intent.roleTokens.some((token) => matchedLabelTokens.has(foldSearchText(token))) ? 5 : 0;
}

function leafHasUsefulDomainSupport(preparedQuery: PreparedQuery, canonicalTokens: Set<string>): boolean {
  return preparedQuery.intent.domainTokens.some((token) => canonicalTokens.has(foldSearchText(token)));
}

function leafHasUsefulVenueSupport(preparedQuery: PreparedQuery, canonicalTokens: Set<string>): boolean {
  return preparedQuery.intent.venueTokens.some((token) => canonicalTokens.has(foldSearchText(token)));
}

function capabilityFitScore(
  closeness: LeafClosenessRank,
  structure: OccupationLeafStructureRecord | null,
  capabilityLabels: RuntimeCapabilityRecord[],
  hasLeafRelationship: boolean,
  fit: CapabilityFit
): number {
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

// Deterministic tie-break, only reached when totalScore is equal: prefer an exact canonical
// match, then an exact alias match, then whichever leaf's OWN canonical label sits closer to the
// query, then whichever leaf covers more of the query's useful tokens (canonical-or-alias), then
// whichever leaf carries fewer query-supported specialization kinds (a more generic leaf is the
// safer pick when the query hasn't clearly earned a narrower one).
// Single deterministic ordering, each rule only breaking ties left by the ones above it:
// totalScore, then exact canonical match, then exact alias match, then canonical-label proximity,
// then how many useful query tokens matched (canonical or alias), then how generic the leaf is
// (fewer specialization kinds wins), then the existing closeness/token-count/label fallbacks.
// canonicalUsefulTokenCoverage is checked before the alias-driven signals below (matchedUsefulTokens.length,
// closeness.score) because aliases are wild -- a leaf can win those purely through an alias that
// drags in unrelated words alongside the query's own, while its own canonical label shares nothing
// with the query at all. The leaf's own label is the more trustworthy proximity signal.
const RANKED_LEAF_TIE_BREAKERS: Array<(leaf: RankedFamilyLeaf) => number> = [
  (leaf) => leaf.totalScore,
  (leaf) => (leaf.scoreBreakdown.exactCanonicalMatch > 0 ? 1 : 0),
  (leaf) => (leaf.scoreBreakdown.aliasExactMatch > 0 ? 1 : 0),
  (leaf) => (leaf.scoreBreakdown.exactAliasMatch > 0 ? 1 : 0),
  (leaf) => leaf.canonicalUsefulTokenCoverage,
  (leaf) => leaf.closeness.matchedUsefulTokens.length,
  (leaf) => -leafSpecializationKindCount(leaf),
  (leaf) => leaf.closeness.score,
  (leaf) => -canonicalTokenCount(leaf.canonicalLabel)
];

export function compareRankedLeaves(left: RankedFamilyLeaf, right: RankedFamilyLeaf): number {
  for (const tieBreaker of RANKED_LEAF_TIE_BREAKERS) {
    const difference = tieBreaker(right) - tieBreaker(left);

    if (difference !== 0) {
      return difference;
    }
  }

  return left.canonicalLabel.localeCompare(right.canonicalLabel);
}

// How specific/narrow the leaf itself is (independent of whether the query supports that
// specialization) -- used only as a tie-break, preferring the more generic leaf when the score
// and lexical evidence are otherwise equal.
// Unshared cache: this only runs as a last-resort tie-break (totalScore already equal), so it's
// fine for it not to share the per-run cache the real scoring pass (rankLeaf) uses above.
function leafSpecializationKindCount(leaf: RankedFamilyLeaf): number {
  const canonicalTokens = new Set(tokenizeNormalizedText(foldSearchText(leaf.canonicalLabel)));
  return resolveLeafSpecializationKindsFromTokens(new Map(), leaf.graphNodeId, leaf.structure, canonicalTokens).length;
}

export function resolveFamily(artifact: SearchMetaArtifactCacheEntry, familyInput: string): { familyNodeId: number; familyLabel: string } {
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
  const familyById = new Map<number, string>();

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

  const [familyNodeId, familyLabel] = matches[0]!;
  return { familyNodeId, familyLabel };
}

export function localeAliasLabels(aliases: RuntimeAliasRecord[], locale: string): string[] {
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
export function leafEvidenceAliasLabels(aliases: RuntimeAliasRecord[], locale: string, includeEnglishFallback: boolean): string[] {
  return uniqueStrings(
    aliases
      .filter((alias) => {
        const matchesLocale = alias.localeCode === locale || (includeEnglishFallback && alias.localeCode === 'en');
        // Some upstream hydration paths build alias records without an aliasRole; fall back to
        // isPrimary the same way the live pipeline already did before this was shared.
        const aliasRole = alias.aliasRole ?? (alias.isPrimary ? 'locale_primary' : 'locale_supporting');

        return matchesLocale && aliasRole !== 'family_supporting';
      })
      .flatMap((alias) => [alias.alias, alias.normalizedAlias])
  );
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
export function leafSpecificAliasLabels(aliases: RuntimeAliasRecord[], locale: string, includeEnglishFallback: boolean = true): string[] {
  return leafEvidenceAliasLabels(aliases, locale, includeEnglishFallback);
}

export function formatScoreBreakdown(breakdown: LeafScoreBreakdown): string {
  return (
    Object.entries(breakdown)
      .filter(([, value]) => value !== 0)
      .map(([key, value]) => `${key}:${value > 0 ? '+' : ''}${value}`)
      .join(',') || 'none'
  );
}

export function canonicalTokenCount(value: string): number {
  return tokenizeNormalizedText(foldSearchText(value)).length;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));
}

export function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
