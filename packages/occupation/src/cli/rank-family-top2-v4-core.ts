import { isGenericQueryToken, isStopQueryToken, isUsefulQueryToken, type PreparedQuery } from '../query/query-preparation.js';
import type { OccupationFamilyTokenRelevanceArtifactCacheEntry } from '../runtime/occupation-family-token-relevance-artifact.js';
import { buildFamilyVectors, buildQueryVector, type FamilyVectorProfile, type QueryVectorTerm } from './rank-family-top2-v3-core.js';
import type { OccupationLeafStructureArtifact } from '../runtime/occupation-leaf-structure-artifact.js';
import {
  type FamilyProfileArtifactCacheEntry,
  type FamilyProfileLocaleRecordRef,
  type RuntimeFamilyProfileSourceKind
} from '../runtime/occupation-family-profile-artifact.js';
import {
  type RuntimeSearchMetaCoreRecord,
  type RuntimeGenericRisk,
  type SearchMetaArtifactCacheEntry
} from '../runtime/occupation-search-meta-artifact.js';
import { roundScore, uniqueSortedStrings } from '../utils/operators.js';
import { foldSearchText, foldWeakPunctuationLookupText, tokenizeNormalizedText } from '../utils/texts.js';

export type FamilyTop2V4ClassifierQuery = {
  preparedQuery: PreparedQuery;
  rawQuery: string;
  effectiveQuery: string;
  locale: string;
  sourceName: string;
};

export type FamilyTop2V4ClassifierOptions = {
  familyProfileArtifact: FamilyProfileArtifactCacheEntry;
  searchMetaArtifact: SearchMetaArtifactCacheEntry;
  leafStructureArtifact: OccupationLeafStructureArtifact;
  familyTokenRelevanceArtifact: OccupationFamilyTokenRelevanceArtifactCacheEntry;
  query: FamilyTop2V4ClassifierQuery;
  limit: number;
};

export type FamilyTop2V4CandidateFamily = {
  familyNodeId: number;
  familyLabel: string;
};

export type FamilyTop2V4CandidateClassifierOptions<TFamily extends FamilyTop2V4CandidateFamily> = FamilyTop2V4ClassifierOptions & {
  candidateFamilies: readonly TFamily[];
};

export type FamilyTop2V4Result = {
  query: FamilyTop2V4ClassifierQuery;
  queryVector: QueryVectorTerm[];
  querySpecificity: number;
  rankedFamilies: FamilyTop2V4FamilyHit[];
};

export type FamilyTop2V4CandidateFamilyHit<TFamily extends FamilyTop2V4CandidateFamily> = {
  rank: number;
  candidate: TFamily;
  hit: FamilyTop2V4FamilyHit;
};

export type FamilyTop2V4CandidateResult<TFamily extends FamilyTop2V4CandidateFamily> = {
  query: FamilyTop2V4ClassifierQuery;
  queryVector: QueryVectorTerm[];
  querySpecificity: number;
  rankedFamilies: FamilyTop2V4CandidateFamilyHit<TFamily>[];
};

export type SpecificityDirection = 'aligned' | 'family_more_base' | 'family_more_specialized';

export type FamilyTop2V4FamilyHit = {
  rank: number;
  familyNodeId: number;
  familyLabel: string;
  groupNodeId: number | null;
  groupLabel: string | null;
  score: number;
  baseCosine: number;
  hierarchyCosine: number;
  specificityAlignment: number;
  specificityPenalty: number;
  exactFamilyLabelPhrase: boolean;
  usefulFamilyLabelPhrase: boolean;
  hierarchyExactPhrase: boolean;
  hierarchyUsefulPhrase: boolean;
  specificityDirection: SpecificityDirection;
  specificityGap: number;
  querySpecificity: number;
  familySpecificity: number;
  familyBroadness: number;
  matchedTerms: string[];
  missingTerms: string[];
  matchedRoleTerms: string[];
  missingRoleTerms: string[];
  matchedDomainTerms: string[];
  matchedSources: RuntimeFamilyProfileSourceKind[];
  matchedHierarchyLabels: string[];
  matchedSiblingLabels: string[];
  matchingLeafIds: number[];
  matchingLeafCount: number;
  profileLeafCount: number;
  genericRisk: RuntimeGenericRisk;
  hasHierarchy: boolean;
  hasCapabilitySupport: boolean;
  specificityStats: FamilySpecificityStats;
  scoreBreakdown: FamilyTop2V4ScoreBreakdown;
};

export type FamilyTop2V4ScoreBreakdown = {
  baseVector: number;
  hierarchyVector: number;
  specificityAlignment: number;
  specificityPenalty: number;
  phrase: number;
  coverage: number;
  roleCoverage: number;
  domainCoverage: number;
  familyLabelExact: number;
  familyLabelUseful: number;
  hierarchyLabelExact: number;
  hierarchyLabelUseful: number;
  baseFamilyBonus: number;
  specializedFamilyBonus: number;
  querySpecificity: number;
  familySpecificity: number;
  queryVectorNorm: number;
  baseVectorNorm: number;
  hierarchyVectorNorm: number;
};

export type FamilySpecificityStats = {
  leafCount: number;
  specializationLeafCount: number;
  genericBaseLeafCount: number;
  authorityLeafCount: number;
  specializedBaseLeafCount: number;
  uniqueSpecializationKindCount: number;
  hierarchyDepth: number;
  siblingCount: number;
  genericRiskHighCount: number;
};

const QUERY_KIND_WEIGHT: Record<QueryVectorTerm['kind'], number> = {
  support: 0.3,
  role: 1.8,
  role_head: 3.0,
  domain: 0.9,
  venue: 0.75
};

export function rankFamilyTop2V4(options: FamilyTop2V4ClassifierOptions): FamilyTop2V4Result {
  const rankedFamilies = rankFamilyTop2V4Hits(options);

  return {
    query: options.query,
    queryVector: rankedFamilies.queryVector,
    querySpecificity: rankedFamilies.querySpecificity,
    rankedFamilies: rankedFamilies.rankedFamilies
  };
}

export function rankFamilyTop2V4CandidateFamilies<TFamily extends FamilyTop2V4CandidateFamily>(
  options: FamilyTop2V4CandidateClassifierOptions<TFamily>
): FamilyTop2V4CandidateResult<TFamily> {
  const candidateByFamilyNodeId = new Map(options.candidateFamilies.map((family) => [family.familyNodeId, family]));
  const rankedHits = rankFamilyTop2V4Hits(options, new Set(candidateByFamilyNodeId.keys()));

  return {
    query: options.query,
    queryVector: rankedHits.queryVector,
    querySpecificity: rankedHits.querySpecificity,
    rankedFamilies: rankedHits.rankedFamilies.map((hit, index) => ({
      rank: index + 1,
      candidate: candidateByFamilyNodeId.get(hit.familyNodeId) as TFamily,
      hit
    }))
  };
}

function rankFamilyTop2V4Hits(
  options: FamilyTop2V4ClassifierOptions,
  familyNodeIds: ReadonlySet<number> | null = null
): FamilyTop2V4Result {
  const familyVectors = buildFamilyVectors(
    options.familyProfileArtifact,
    options.searchMetaArtifact,
    options.query.locale,
    options.query.effectiveQuery
  );
  const queryVector = buildQueryVector(options.query.preparedQuery, options.familyTokenRelevanceArtifact, options.query.locale);
  const querySpecificity = computeQuerySpecificity(options.query.preparedQuery, queryVector);
  const hits: FamilyTop2V4FamilyHit[] = [];

  for (const family of familyVectors) {
    if (familyNodeIds && !familyNodeIds.has(family.familyNodeId)) {
      continue;
    }

    const specificityStats = computeFamilySpecificityStats(family, options.searchMetaArtifact, options.leafStructureArtifact);
    const hit = scoreFamilyVector(family, specificityStats, queryVector, querySpecificity, options.familyProfileArtifact);

    if (hit.score > 0) {
      hits.push(hit);
    }
  }

  const rankedFamilies = hits
    .sort(compareFamilyHits)
    .slice(0, options.limit)
    .map((family, index) => ({
      ...family,
      rank: index + 1
    }));

  return {
    query: options.query,
    queryVector,
    querySpecificity: roundScore(querySpecificity),
    rankedFamilies
  };
}

function computeFamilySpecificityStats(
  family: FamilyVectorProfile,
  searchMetaArtifact: SearchMetaArtifactCacheEntry,
  leafStructureArtifact: OccupationLeafStructureArtifact
): FamilySpecificityStats {
  const core = searchMetaArtifact.getCoreRecord(family.familyNodeId);
  const leaves = leafStructureArtifact.getRecordsForFamily(family.familyNodeId);
  const leafCount = Math.max(leaves.length, family.profileLeafCount);
  const specializationLeafCount = leaves.filter(
    (leaf) =>
      leaf.baseRoleKind === 'specialized_base_role' ||
      leaf.specializationKinds.length > 0 ||
      leaf.authorityKind !== 'none' ||
      leaf.headPreservingSpecialization ||
      leaf.broadAliasRisk !== 'low' ||
      leaf.capabilityDominanceRisk !== 'low'
  ).length;
  const genericBaseLeafCount = leaves.filter((leaf) => leaf.baseRoleKind === 'generic_base_role').length;
  const authorityLeafCount = leaves.filter((leaf) => leaf.authorityKind !== 'none').length;
  const specializedBaseLeafCount = leaves.filter((leaf) => leaf.baseRoleKind === 'specialized_base_role').length;
  const uniqueSpecializationKindCount = new Set(leaves.flatMap((leaf) => leaf.specializationKinds)).size;
  const hierarchyDepth = core?.ancestors.length ?? 0;
  const siblingCount = core?.siblings.length ?? 0;
  const genericRiskHighCount = core?.genericRisk === 'high' ? 1 : 0;

  return {
    leafCount,
    specializationLeafCount,
    genericBaseLeafCount,
    authorityLeafCount,
    specializedBaseLeafCount,
    uniqueSpecializationKindCount,
    hierarchyDepth,
    siblingCount,
    genericRiskHighCount
  };
}

function computeFamilySpecificityScore(stats: FamilySpecificityStats): number {
  const leafCountPressure = 1 - expDecay(stats.leafCount, 18);
  const specializationPressure = stats.leafCount > 0 ? stats.specializationLeafCount / stats.leafCount : 0;
  const genericBasePressure = stats.leafCount > 0 ? stats.genericBaseLeafCount / stats.leafCount : 0;
  const authorityPressure = stats.leafCount > 0 ? stats.authorityLeafCount / stats.leafCount : 0;
  const specializedBasePressure = stats.leafCount > 0 ? stats.specializedBaseLeafCount / stats.leafCount : 0;
  const uniqueSpecializationPressure = Math.min(stats.uniqueSpecializationKindCount / 6, 1);
  const hierarchyPressure = expDecay(stats.hierarchyDepth, 3);
  const siblingPressure = expDecay(stats.siblingCount, 6);
  const riskPressure = stats.genericRiskHighCount > 0 ? 0.08 : 0;

  return clamp01(
    leafCountPressure * 0.2 +
      specializationPressure * 0.25 +
      specializedBasePressure * 0.15 +
      authorityPressure * 0.15 +
      uniqueSpecializationPressure * 0.1 +
      hierarchyPressure * 0.1 +
      siblingPressure * 0.05 +
      (1 - genericBasePressure) * 0.05 +
      riskPressure
  );
}

function computeQuerySpecificity(preparedQuery: PreparedQuery, queryVector: QueryVectorTerm[]): number {
  const roleCount = preparedQuery.intent.roleTokens.length;
  const roleHeadCount = preparedQuery.intent.authoritativeRoleHeadTokens.length || preparedQuery.intent.roleHeadTokens.length;
  const domainCount = preparedQuery.intent.domainTokens.length;
  const venueCount = preparedQuery.intent.venueTokens.length;
  const tokenSpecificity = queryVector.length > 0 ? queryVector.reduce((sum, term) => sum + term.specificity, 0) / queryVector.length : 0;
  const tokenSpecificityScore = clamp01((tokenSpecificity - 0.5) / 1.2);
  const roleScore = clamp01(roleCount / 4);
  const roleHeadScore = clamp01(roleHeadCount / 2);
  const domainScore = clamp01(domainCount / 3);
  const venueScore = clamp01(venueCount / 2);
  const tokenCountScore = clamp01(queryVector.length / 6);

  return clamp01(
    tokenSpecificityScore * 0.34 + roleScore * 0.18 + roleHeadScore * 0.16 + domainScore * 0.14 + venueScore * 0.08 + tokenCountScore * 0.1
  );
}

function scoreFamilyVector(
  family: FamilyVectorProfile,
  specificityStats: FamilySpecificityStats,
  queryVector: QueryVectorTerm[],
  querySpecificity: number,
  familyProfileArtifact: FamilyProfileArtifactCacheEntry
): FamilyTop2V4FamilyHit {
  const familySpecificity = computeFamilySpecificityScore(specificityStats);
  const familyBroadness = 1 - familySpecificity;
  const specificityGap = querySpecificity - familySpecificity;
  const specificityDirection: SpecificityDirection =
    Math.abs(specificityGap) < 0.08 ? 'aligned' : specificityGap > 0 ? 'family_more_base' : 'family_more_specialized';
  const baseAlignment = (1 - querySpecificity) * (1 - familySpecificity);
  const specializedAlignment = querySpecificity * familySpecificity;
  const specificityAlignment = baseAlignment + specializedAlignment;
  const specificityPenalty = Math.abs(specificityGap) * 0.12;

  const matchedTerms = new Set<string>();
  const matchedRoleTerms = new Set<string>();
  const matchedDomainTerms = new Set<string>();
  const matchedSources = new Set<RuntimeFamilyProfileSourceKind>();
  const matchingLeafIds = new Set<number>();
  let baseDotProduct = 0;
  let hierarchyDotProduct = 0;
  let roleTotal = 0;
  let roleMatched = 0;
  let domainTotal = 0;
  let domainMatched = 0;

  for (const term of queryVector) {
    const baseWeight = family.baseVector.weights.get(term.token) ?? 0;
    const hierarchyWeight = family.hierarchyVector.weights.get(term.token) ?? 0;

    if (baseWeight <= 0 && hierarchyWeight <= 0) {
      if (term.kind === 'role' || term.kind === 'role_head') {
        roleTotal += 1;
      }

      if (term.kind === 'domain' || term.kind === 'venue') {
        domainTotal += 1;
      }

      continue;
    }

    const tokenId = familyProfileArtifact.stringId(term.token);
    if (tokenId >= 0) {
      for (const leafId of familyProfileArtifact.leafIdsForToken(family.localeProfile.rowId, tokenId)) {
        matchingLeafIds.add(leafId);
      }
    }

    baseDotProduct += term.weight * baseWeight;
    hierarchyDotProduct += term.weight * hierarchyWeight;
    matchedTerms.add(term.token);

    if (familyContainsToken(familyProfileArtifact, family.localeProfile, 'alias', term.token)) {
      matchedSources.add('alias');
    }
    if (familyContainsToken(familyProfileArtifact, family.localeProfile, 'leaf_label', term.token)) {
      matchedSources.add('leaf_label');
    }
    if (familyContainsToken(familyProfileArtifact, family.localeProfile, 'capability', term.token)) {
      matchedSources.add('capability');
    }

    if (matchesHierarchyToken(family.matchedHierarchyLabels, term.token, family.locale)) {
      matchedTerms.add(term.token);
    }

    if (term.kind === 'role' || term.kind === 'role_head') {
      matchedRoleTerms.add(term.token);
      roleMatched += 1;
    }

    if (term.kind === 'domain' || term.kind === 'venue') {
      matchedDomainTerms.add(term.token);
      domainMatched += 1;
    }

    if (term.kind === 'role' || term.kind === 'role_head') {
      roleTotal += 1;
    }

    if (term.kind === 'domain' || term.kind === 'venue') {
      domainTotal += 1;
    }
  }

  const queryNorm = vectorNormFromQuery(queryVector);
  const baseCosine = queryNorm > 0 && family.baseVector.norm > 0 ? baseDotProduct / (queryNorm * family.baseVector.norm) : 0;
  const hierarchyCosine =
    queryNorm > 0 && family.hierarchyVector.norm > 0 ? hierarchyDotProduct / (queryNorm * family.hierarchyVector.norm) : 0;
  const coverage = queryVector.length > 0 ? matchedTerms.size / queryVector.length : 0;
  const roleCoverage = roleTotal > 0 ? roleMatched / roleTotal : 0;
  const domainCoverage = domainTotal > 0 ? domainMatched / domainTotal : 0;
  const exactBoost = family.exactFamilyLabelPhrase ? 0.2 : 0;
  const usefulBoost = !family.exactFamilyLabelPhrase && family.usefulFamilyLabelPhrase ? 0.1 : 0;
  const hierarchyExactBoost = !family.exactFamilyLabelPhrase && family.hierarchyExactPhrase ? 0.1 : 0;
  const hierarchyUsefulBoost = !family.usefulFamilyLabelPhrase && family.hierarchyUsefulPhrase ? 0.05 : 0;
  const baseFamilyBonus = (1 - querySpecificity) * familyBroadness;
  const specializedFamilyBonus = querySpecificity * familySpecificity;
  const scoreBreakdown: FamilyTop2V4ScoreBreakdown = {
    baseVector: roundScore(baseCosine * 0.42),
    hierarchyVector: roundScore(hierarchyCosine * 0.28),
    specificityAlignment: roundScore(specificityAlignment * 0.12),
    specificityPenalty: roundScore(specificityPenalty),
    phrase: roundScore(exactBoost + usefulBoost + hierarchyExactBoost + hierarchyUsefulBoost),
    coverage: roundScore(coverage * 0.04),
    roleCoverage: roundScore(roleCoverage * 0.06),
    domainCoverage: roundScore(domainCoverage * 0.03),
    familyLabelExact: roundScore(exactBoost),
    familyLabelUseful: roundScore(usefulBoost),
    hierarchyLabelExact: roundScore(hierarchyExactBoost),
    hierarchyLabelUseful: roundScore(hierarchyUsefulBoost),
    baseFamilyBonus: roundScore(baseFamilyBonus * 0.1),
    specializedFamilyBonus: roundScore(specializedFamilyBonus * 0.1),
    querySpecificity: roundScore(querySpecificity),
    familySpecificity: roundScore(familySpecificity),
    queryVectorNorm: roundScore(queryNorm),
    baseVectorNorm: roundScore(family.baseVector.norm),
    hierarchyVectorNorm: roundScore(family.hierarchyVector.norm)
  };

  const score = roundScore(
    scoreBreakdown.baseVector +
      scoreBreakdown.hierarchyVector +
      scoreBreakdown.specificityAlignment +
      scoreBreakdown.phrase +
      scoreBreakdown.coverage +
      scoreBreakdown.roleCoverage +
      scoreBreakdown.domainCoverage +
      scoreBreakdown.baseFamilyBonus +
      scoreBreakdown.specializedFamilyBonus -
      scoreBreakdown.specificityPenalty
  );

  const matchedHierarchyTerms = queryVector
    .filter((term) => matchesHierarchyToken(family.matchedHierarchyLabels, term.token, family.locale))
    .map((term) => term.token);
  const matchedSiblingTerms = queryVector
    .filter((term) => matchesHierarchyToken(family.matchedSiblingLabels, term.token, family.locale))
    .map((term) => term.token);

  return {
    rank: 0,
    familyNodeId: family.familyNodeId,
    familyLabel: family.familyLabel,
    groupNodeId: family.groupNodeId,
    groupLabel: family.groupLabel,
    score,
    baseCosine: roundScore(baseCosine),
    hierarchyCosine: roundScore(hierarchyCosine),
    specificityAlignment: roundScore(specificityAlignment),
    specificityPenalty: roundScore(specificityPenalty),
    exactFamilyLabelPhrase: family.exactFamilyLabelPhrase,
    usefulFamilyLabelPhrase: family.usefulFamilyLabelPhrase,
    hierarchyExactPhrase: family.hierarchyExactPhrase,
    hierarchyUsefulPhrase: family.hierarchyUsefulPhrase,
    specificityDirection,
    specificityGap: roundScore(specificityGap),
    querySpecificity: roundScore(querySpecificity),
    familySpecificity: roundScore(familySpecificity),
    familyBroadness: roundScore(familyBroadness),
    matchedTerms: uniqueSortedStrings(matchedTerms),
    missingTerms: queryVector.filter((term) => !matchedTerms.has(term.token)).map((term) => term.token),
    matchedRoleTerms: uniqueSortedStrings(matchedRoleTerms),
    missingRoleTerms: queryVector
      .filter((term) => (term.kind === 'role' || term.kind === 'role_head') && !matchedRoleTerms.has(term.token))
      .map((term) => term.token),
    matchedDomainTerms: uniqueSortedStrings(matchedDomainTerms),
    matchedSources: Array.from(matchedSources).sort(),
    matchedHierarchyLabels: matchedHierarchyTerms,
    matchedSiblingLabels: matchedSiblingTerms,
    matchingLeafIds: Array.from(matchingLeafIds).sort((left, right) => left - right),
    matchingLeafCount: matchingLeafIds.size,
    profileLeafCount: family.profileLeafCount,
    genericRisk: family.genericRisk,
    hasHierarchy: family.hasHierarchy,
    hasCapabilitySupport: family.hasCapabilitySupport,
    specificityStats,
    scoreBreakdown
  };
}

function familyContainsToken(
  artifact: FamilyProfileArtifactCacheEntry,
  localeProfile: FamilyProfileLocaleRecordRef,
  sourceKind: RuntimeFamilyProfileSourceKind,
  token: string
): boolean {
  const source = artifact.getSource(localeProfile, sourceKind);
  const tokenId = artifact.stringId(token);
  return tokenId >= 0 && artifact.sourceHasToken(source, tokenId);
}

function matchesHierarchyToken(labels: string[], token: string, locale: string): boolean {
  const queryTokens = new Set(simpleTokenVariants(token).concat(token));
  return labels.some((label) => {
    const labelTokens = tokenSetForText(label, locale);
    return Array.from(queryTokens).some((variant) => tokenSetHasEquivalent(labelTokens, variant));
  });
}

function tokenSetForText(value: string, locale: string): Set<string> {
  return new Set(
    tokenizeNormalizedText(foldSearchText(value)).filter(
      (token) => token.length >= 2 && !isStopQueryToken(token, locale) && !isGenericQueryToken(token, locale)
    )
  );
}

function tokenSetHasEquivalent(values: Set<string>, token: string): boolean {
  if (values.has(token)) {
    return true;
  }

  const queryVariants = simpleTokenVariants(token);

  if (queryVariants.some((variant) => values.has(variant))) {
    return true;
  }

  for (const value of values) {
    if (simpleTokenVariants(value).includes(token)) {
      return true;
    }

    if (queryVariants.some((variant) => simpleTokenVariants(value).includes(variant))) {
      return true;
    }
  }

  return false;
}

function simpleTokenVariants(token: string): string[] {
  if (token.endsWith('ies') && token.length > 4) {
    return [`${token.slice(0, -3)}y`];
  }

  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
    return [token.slice(0, -1)];
  }

  return [];
}

function vectorNormFromQuery(queryVector: QueryVectorTerm[]): number {
  let sum = 0;
  for (const term of queryVector) {
    sum += term.weight * term.weight;
  }
  return Math.sqrt(sum);
}

function expDecay(value: number, halfLife: number): number {
  return 1 - Math.exp(-value / halfLife);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function compareFamilyHits(left: FamilyTop2V4FamilyHit, right: FamilyTop2V4FamilyHit): number {
  return (
    right.score - left.score ||
    right.specificityAlignment - left.specificityAlignment ||
    right.baseCosine - left.baseCosine ||
    right.hierarchyCosine - left.hierarchyCosine ||
    Number(right.exactFamilyLabelPhrase) - Number(left.exactFamilyLabelPhrase) ||
    Number(right.usefulFamilyLabelPhrase) - Number(left.usefulFamilyLabelPhrase) ||
    right.matchingLeafCount - left.matchingLeafCount ||
    left.familyLabel.localeCompare(right.familyLabel)
  );
}
