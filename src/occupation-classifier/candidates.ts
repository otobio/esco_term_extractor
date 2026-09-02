import { AliasRetrievalResult } from '../retrieval/retrieval-engine.js';
import type { OccupationLeafStructureArtifact } from '../runtime/occupation-leaf-structure-artifact.js';
import type { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
import type { RuntimeSearchMetaCoreRecord } from '../runtime/occupation-search-meta-artifact.js';
import { foldWeakPunctuationLookupText, tokenizeNormalizedText } from '../utils/texts.js';
import { buildQueryStructuralProfile, QueryStructuralProfile } from './preparation.js';
import type { ExactAliasCandidate, ExactLeafCandidate } from './retrieval.js';
import {
  VAGUE_ROLE_HEAD_TOKENS,
  leafAuthorityLevelKindsContradict,
  roleHeadsAreBroadlySimilar,
  selectStrongRoleHeads
} from './role-head-groups.js';
import { SPECIALIZATION_DATA_DIMENSIONS, specializationGate } from './specialization/specialization-gate.js';
import { conceptUnitCoverageForComparisonQuery, modifierTokenUnitsForComparisonQuery } from './translation.js';
import type {
  AuthorityGate,
  CandidateAssessment,
  CandidateLedger,
  CanonicalComparisonQuery,
  CanonicalResemblance,
  ClassifierRetrievalRequest,
  FamilyAssessment,
  HydratedCandidate,
  NearMissReason,
  RankedLeaf,
  RoleResemblanceTier,
  SelectedLeaf,
  SimpleDecisionReason,
  StructuralGate
} from './types.js';
import type { TranslationConceptDimension } from './types.js';

// Fixed weight for each specialization dimension (venue, product, industry, etc.) the candidate
// carries that the query never asked about at all -- a "wild" specialization the query gives no
// evidence for. Small and additive so a couple of extra dimensions meaningfully decay score without
// swamping the role-match/requested-coverage signal.
const WILD_DIMENSION_PENALTY = 0.1;
// A 'generic' role-head match (e.g. query "worker" == candidate "worker") already earns zero role
// credit (roleScore stays 0, see computeCanonicalResemblance), but the authority/structural score
// floor alone can still clear PROMOTION_SCORE_THRESHOLD for a candidate with no real role relevance.
// This penalty pushes that floor back down -- generic matches stay eligible (near_miss, not hard
// rejected), they just shouldn't be able to outrank/out-promote a genuinely role-grounded candidate.
const GENERIC_ROLE_HEAD_PENALTY = 0.15;
// A dimension judged exact_concept/exact_literal is real evidence the query and candidate mean the
// same thing on that dimension; recoverable_available only means the candidate's tokens happen to
// contain the query's words as a substring/part match -- weaker, "tag-only" evidence. Weight it down
// rather than crediting it the same as an exact hit.
const RECOVERABLE_DIMENSION_WEIGHT = 0.6;
// Small nudge when the query names a specific authority tier (supervisor/manager/etc.) and the
// candidate shares that exact tier -- a same-family sibling tie-break, not a gate. Not applied when
// the query names no tier at all (authorityGate already handles genuine tier contradictions).
const AUTHORITY_TIER_MATCH_BOOST = 0.05;
// Once a candidate's total score clears this, it is selectable (status: promotable) regardless of
// which credit tier produced the score -- literal role-head completeness is no longer a separate
// hard requirement layered on top of the score (see decideStatus).
const PROMOTION_SCORE_THRESHOLD = 0.45;
// Leaf selection (decision.ts) requires the top-ranked candidate to lead the runner-up by at least
// this much score to be picked outright; within this margin the existing family/ambiguity fallback
// still applies. Kept at (not above) WILD_DIMENSION_PENALTY so a single unrequested specialization
// dimension on the runner-up is, by itself, enough to prefer the base leaf outright.
export const LEAF_SELECTION_MARGIN = 0.1;

// Ranking credit only (see compareRankedLeaves) -- 'generic' and 'none' both get zero, since a
// generic role head matching itself proves nothing about semantic equivalence.
const ROLE_RESEMBLANCE_TIER_RANK: Record<RoleResemblanceTier, number> = {
  exact: 2,
  similar: 1,
  generic: 0,
  none: 0
};

// Hand-built list used only to stop the zero-role-head-equivalence hard reject below from firing
// on words we aren't confident are actually a mismatch.
const AUTHORITY_ROLE_HEAD_TOKENS = new Set([
  'assistant',
  'manager',
  'supervisor',
  'director',
  'chief',
  'head' /*'lead', 'foreman', 'superintendent', 'principal'*/
]);

export type CoreLeafDecision = {
  decision: {
    type: 'leaf';
    reason: Extract<SimpleDecisionReason, 'exact_canonical_leaf' | 'exact_primary_alias_leaf' | 'promotable_leaf'>;
    confidence: number;
  };
  selectedLeaf: SelectedLeaf;
};

export type QueryResemblanceInput = {
  roleHeads: readonly string[];
  modifierTokens: readonly string[];
  modifierTokenUnits: readonly (readonly (readonly string[])[])[];
  requiredNonRoleTokens: readonly string[];
  requiredNonRoleTokenUnits: readonly (readonly (readonly string[])[])[];
};

export function selectUniqueExactCanonicalLeaf(
  rows: readonly ExactLeafCandidate[],
  runtime: OccupationRuntimeContext,
  retrievalRequest: ClassifierRetrievalRequest,
  queryProfile?: QueryStructuralProfile,
  comparisonQuery?: CanonicalComparisonQuery
): CoreLeafDecision | null {
  const exactKeys = new Set(retrievalRequest.englishCanonicalExactKeys);
  const matchedGraphNodeIds = new Set<number>();

  for (const row of rows) {
    if (!exactKeys.has(row.weakFoldedCanonicalLabel)) {
      continue;
    }

    const core = runtime.searchMetaArtifact.getCoreRecord(row.graphNodeId);

    if (!core?.familyNodeId) {
      continue;
    }

    matchedGraphNodeIds.add(row.graphNodeId);
  }

  if (matchedGraphNodeIds.size !== 1) {
    return null;
  }

  let graphNodeId = 0;
  for (const matchedGraphNodeId of matchedGraphNodeIds) {
    graphNodeId = matchedGraphNodeId;
    break;
  }
  const core = runtime.searchMetaArtifact.getCoreRecord(graphNodeId);

  if (!core?.familyNodeId) {
    return null;
  }
  if (queryProfile && !exactCanonicalLeafCoversQuery(core.canonicalLabel, queryProfile, comparisonQuery)) {
    return null;
  }

  return leafDecision(graphNodeId, core, 'exact_canonical_leaf', 1);
}

function exactCanonicalLeafCoversQuery(
  canonicalLabel: string,
  queryProfile: QueryStructuralProfile,
  comparisonQuery?: CanonicalComparisonQuery
): boolean {
  const canonicalTokens = new Set(tokenizeNormalizedText(foldWeakPunctuationLookupText(canonicalLabel)));
  const queryRoleHeads = selectStrongRoleHeads(queryProfile.profile.role_head);

  if (queryRoleHeads.length > 0) {
    const canonicalProfile = buildQueryStructuralProfile(canonicalLabel, 'en');
    const canonicalRoleHeads = selectStrongRoleHeads(canonicalProfile.profile.role_head);
    if (roleResemblanceTierFor(queryRoleHeads, canonicalRoleHeads) === 'none') {
      return false;
    }
  }

  if (comparisonQuery) {
    const queryResemblance = buildQueryResemblanceInput(queryProfile, comparisonQuery);
    for (const unit of queryResemblance.requiredNonRoleTokenUnits) {
      let unitMatched = false;
      for (const alternative of unit) {
        let alternativeMatched = true;
        for (const token of alternative) {
          if (!canonicalTokens.has(token)) {
            alternativeMatched = false;
            break;
          }
        }
        if (alternativeMatched) {
          unitMatched = true;
          break;
        }
      }
      if (!unitMatched) {
        return false;
      }
    }
    return true;
  }

  const knownTokens = new Set(queryRoleHeads);
  if (queryProfile.authority !== 'none') {
    knownTokens.add(queryProfile.authority);
  }

  const requiredTokens = queryConceptLiteralTokens(queryProfile, knownTokens);
  if (queryProfile.authority !== 'none') {
    requiredTokens.push(queryProfile.authority);
  }

  return requiredTokens.every((token) => canonicalTokens.has(token));
}

export function selectUniqueExactAliasLeaf(
  rows: readonly ExactAliasCandidate[],
  rawAliasResults: AliasRetrievalResult,
  runtime: OccupationRuntimeContext,
  _retrievalRequest: ClassifierRetrievalRequest,
  comparisonQuery: CanonicalComparisonQuery
): CoreLeafDecision | null {
  const matchedGraphNodeIds = new Set<number>();

  for (const row of rows) {
    const core = runtime.searchMetaArtifact.getCoreRecord(row.graphNodeId);

    if (!core?.familyNodeId) {
      continue;
    }

    if (!isSafeExactAliasMatch(core.canonicalLabel, comparisonQuery)) {
      continue;
    }

    matchedGraphNodeIds.add(row.graphNodeId);
  }

  if (matchedGraphNodeIds.size > 0) {
    const graphNodeId = [...matchedGraphNodeIds][0];
    const core = runtime.searchMetaArtifact.getCoreRecord(graphNodeId);

    if (!core?.familyNodeId) {
      return null;
    }

    return leafDecision(graphNodeId, core, 'exact_primary_alias_leaf', 0.96);
  }

  // Check the other raw fields
  for (const subphraseRow of rawAliasResults.subphraseRows) {
    if (isSafeExactAliasMatch(subphraseRow.canonical_label, comparisonQuery)) {
      const kore = runtime.searchMetaArtifact.getCoreRecord(subphraseRow.graph_node_id);

      if (!kore?.familyNodeId) {
        return null;
      }

      return leafDecision(subphraseRow.graph_node_id, kore, 'exact_primary_alias_leaf', 0.6);
    }
  }

  return null;
}

function isSafeExactAliasMatch(canonicalLabel: string, comparisonQuery: CanonicalComparisonQuery): boolean {
  const weakFoldedCanonical = foldWeakPunctuationLookupText(canonicalLabel);
  if (comparisonQuery.canonicalExactKeys.includes(weakFoldedCanonical)) {
    return true;
  }

  // At the very least must be multi-token
  if (
    comparisonQuery.englishTokens.length > 1 &&
    comparisonQuery.englishTokens.every((token) => tokenizeNormalizedText(weakFoldedCanonical).includes(token))
  ) {
    return true;
  }

  // TODO: Explore this later likely safer
  // const tokenized = tokenizeNormalizedText(weakFoldedCanonical).filter((token) => ['in', 'of', 'the', 'and'].includes(token));
  // // At the very least must be multi-token
  // if (comparisonQuery.englishTokens.length > 1 && tokenized.every((token) => comparisonQuery.englishTokens.includes(token))) {
  //   return true;
  // }

  return false;
}

function leafDecision(
  graphNodeId: number,
  core: RuntimeSearchMetaCoreRecord,
  reason: Extract<SimpleDecisionReason, 'exact_canonical_leaf' | 'exact_primary_alias_leaf'>,
  confidence: number
): CoreLeafDecision {
  return {
    decision: { type: 'leaf', reason, confidence },
    selectedLeaf: {
      graphNodeId,
      canonicalLabel: core.canonicalLabel,
      familyNodeId: core.familyNodeId,
      familyLabel: core.familyLabel
    }
  };
}

function assessCandidate(
  candidate: HydratedCandidate,
  comparisonQuery: CanonicalComparisonQuery,
  queryProfile: QueryStructuralProfile,
  queryResemblance: QueryResemblanceInput,
  locale: string
): CandidateAssessment {
  const canonicalProfile = buildQueryStructuralProfile(candidate.canonicalLabel);

  const authorityConflict = leafAuthorityLevelKindsContradict(queryProfile.authority, canonicalProfile.authority);

  const authorityGate: AuthorityGate = {
    decision: authorityConflict ? 'reject' : 'accept',
    reason: authorityConflict ? 'authority_conflict' : null
  };

  const structuralGate = computeStructuralGate(queryProfile, canonicalProfile, locale);

  const canonical = computeCanonicalResemblance(
    candidate,
    comparisonQuery,
    queryProfile,
    canonicalProfile,
    structuralGate,
    queryResemblance
  );

  if (!candidate.familyNodeId) {
    return rejectedAssessment(candidate, canonical, authorityGate, structuralGate, 'missing_core_record');
  }

  if (authorityGate.decision === 'reject') {
    // if (
    //     structuralGate.decision !== 'reject'
    //     && structuralGate.rawDecision === 'pass_strict'
    //     && structuralGate.matchedDimensionCount > 0
    //     && structuralGate.judgments.every((judgement) => judgement.kind === 'exact_concept' || judgement.kind === 'exact_literal'))
    // {
    //   // Specialcase bypass for exact role with wrong authority selection
    // } else {
    return rejectedAssessment(candidate, canonical, authorityGate, structuralGate, 'authority_conflict');
    //}
  }

  if (structuralGate.decision === 'reject') {
    return rejectedAssessment(candidate, canonical, authorityGate, structuralGate, 'structural_contradiction');
  }

  // exactPrimaryAlias/foldedAlias are direct alias-table hits for this exact leaf, not the shakier
  // exactSupportingAlias (which recall hands to every leaf in a family). That direct hit already proves
  // the candidate is correct even when the translated/canonical role-head tokens don't visibly match --
  // don't let the role-head gate hard-reject it.
  const hasTrustworthyAliasMatch =
    candidate.evidence.exactPrimaryAlias || candidate.evidence.foldedAlias || candidate.evidence.englishAlias;
  // A query role head that exactly names a specific (non-generic) role head the candidate shares is
  // itself strong evidence, same spirit as the alias rescue above -- "cook" asked for and "cook" found
  // should not need to clear the general score threshold to be selectable.
  //const hasExactRoleHeadMatch = canonical.roleResemblanceTier === 'exact';
  // A query role head unrelated to the candidate's (e.g. "person" vs "seller") is normally a hard
  // reject -- but if the query also named a domain/product modifier (e.g. "bakery") that the
  // structural gate confirmed the candidate actually shares, the role-head mismatch alone shouldn't
  // veto it: the candidate still has to clear the score threshold below on that domain evidence, it's
  // just no longer barred from the attempt.
  const hasMatchedDomainDimension = structuralGate.matchedDimensionCount > 0;
  // Same rescue, cheaper evidence: even without a recognized structural dimension match, a literal
  // token the query named (e.g. "bakery") appearing in the candidate's own label is proof the query
  // and candidate are talking about the same thing -- the structural gate reject case above already
  // returned before this point, so reaching here already means no contradiction was found.
  const hasUncontradictedSharedToken = canonical.hasSharedModifierToken;

  if (
    canonical.roleResemblanceTier === 'none' &&
    !hasTrustworthyAliasMatch &&
    !hasMatchedDomainDimension &&
    !hasUncontradictedSharedToken
  ) {
    return rejectedAssessment(candidate, canonical, authorityGate, structuralGate, 'no_canonical_relationship');
  }

  const status = decideStatus(canonical);

  return {
    graphNodeId: candidate.graphNodeId,
    canonicalLabel: candidate.canonicalLabel,
    familyNodeId: candidate.familyNodeId,
    familyLabel: candidate.familyLabel,
    evidence: candidate.evidence,
    status,
    authorityGate,
    structuralGate,
    canonical,
    selectionAuthority: selectionAuthorityFor(candidate, canonical),
    rejectReason: status === 'hard_rejected' ? 'no_canonical_relationship' : null,
    nearMissReason: status === 'near_miss' ? nearMissReasonFor(canonical) : null
  };
}

function decideStatus(canonical: CanonicalResemblance): CandidateAssessment['status'] {
  if (canonical.allowGateAccess) {
    return 'promotable';
  }

  if (canonical.score <= 0) {
    return 'hard_rejected';
  }

  if (canonical.score >= PROMOTION_SCORE_THRESHOLD) {
    return 'promotable';
  }

  return 'near_miss';
}

function selectionAuthorityFor(candidate: HydratedCandidate, canonical: CanonicalResemblance): CandidateAssessment['selectionAuthority'] {
  if (canonical.exactCanonical || canonical.weakExactCanonical) {
    return 'canonical';
  }

  const hasAliasEvidence =
    candidate.evidence.exactPrimaryAlias ||
    candidate.evidence.exactSupportingAlias ||
    candidate.evidence.foldedAlias ||
    candidate.evidence.subphraseAlias ||
    candidate.evidence.englishAlias;

  if (hasAliasEvidence) {
    return canonical.roleResemblanceTier !== 'none' ? 'canonical_with_alias' : 'alias_only';
  }

  return 'retrieval_only';
}

function nearMissReasonFor(canonical: CanonicalResemblance): NearMissReason {
  return canonical.roleResemblanceTier !== 'none' ? 'missing_role_head_translation' : 'low_canonical_resemblance';
}

function rejectedAssessment(
  candidate: HydratedCandidate,
  canonical: CanonicalResemblance,
  authorityGate: AuthorityGate,
  structuralGate: StructuralGate,
  rejectReason: CandidateAssessment['rejectReason']
): CandidateAssessment {
  return {
    graphNodeId: candidate.graphNodeId,
    canonicalLabel: candidate.canonicalLabel,
    familyNodeId: candidate.familyNodeId,
    familyLabel: candidate.familyLabel,
    evidence: candidate.evidence,
    status: 'hard_rejected',
    authorityGate,
    structuralGate,
    canonical,
    selectionAuthority: 'retrieval_only',
    rejectReason,
    nearMissReason: null
  };
}

function computeStructuralGate(
  queryProfile: QueryStructuralProfile,
  canonicalProfile: QueryStructuralProfile,
  locale: string
): StructuralGate {
  const gate = specializationGate(queryProfile.profile, canonicalProfile.profile, { locale });

  return {
    rawDecision: gate.decision,
    decision: gate.decision === 'reject' ? 'reject' : 'accept',
    reason: gate.decision === 'reject' ? 'specialization_contradiction' : null,
    matchedDimensions: gate.compatibleDimensions,
    contradictedDimensions: gate.contradictionDimensions,
    queriedDimensionCount: gate.queriedDimensions.length,
    matchedDimensionCount: gate.compatibleDimensions.length,
    unknownDimensionCount: gate.unknownDimensions.length,
    judgments: gate.judgments
  };
}

// Ranking-only signal (never feeds the score itself, see computeCanonicalResemblance below): a
// generic role head matching itself proves nothing, so it never earns 'exact'/'similar' credit.
function roleResemblanceTierFor(queryRoleHeads: readonly string[], canonicalRoleHeads: readonly string[]): RoleResemblanceTier {
  let hasSimilar = false;
  let hasGeneric = false;

  for (const queryRoleHead of queryRoleHeads) {
    for (const canonicalRoleHead of canonicalRoleHeads) {
      if (!roleHeadsAreBroadlySimilar(queryRoleHead, canonicalRoleHead)) {
        continue;
      }

      if (VAGUE_ROLE_HEAD_TOKENS.has(queryRoleHead) || VAGUE_ROLE_HEAD_TOKENS.has(canonicalRoleHead)) {
        hasGeneric = true;
        continue;
      }

      if (queryRoleHead === canonicalRoleHead) {
        return 'exact';
      }

      hasSimilar = true;
    }
  }

  return hasSimilar ? 'similar' : hasGeneric ? 'generic' : 'none';
}

export function computeCanonicalResemblance(
  candidate: HydratedCandidate,
  comparisonQuery: CanonicalComparisonQuery,
  queryProfile: QueryStructuralProfile,
  canonicalProfile: QueryStructuralProfile,
  structuralGate: StructuralGate,
  queryResemblance: QueryResemblanceInput = buildQueryResemblanceInput(queryProfile, comparisonQuery)
): CanonicalResemblance {
  const candidateTokens = tokenizeNormalizedText(candidate.canonicalWeakFolded);
  const candidateTokenSet = new Set(candidateTokens);

  const canonicalRoleHeads = selectStrongRoleHeads(canonicalProfile.profile.role_head);
  const roleResemblanceTier = roleResemblanceTierFor(queryResemblance.roleHeads, canonicalRoleHeads);

  const exactCanonical = candidate.evidence.exactCanonical || comparisonQuery.canonicalExactKeys.includes(candidate.canonicalWeakFolded);

  const weakExactCanonical = candidate.evidence.weakExactCanonical;

  const hasTrustworthyAliasMatch =
    candidate.evidence.exactPrimaryAlias || candidate.evidence.foldedAlias || candidate.evidence.englishAlias;

  // ---------------------------------------------------------
  // Structural specialization resemblance
  // ---------------------------------------------------------

  // Unknown dimensions stay in the denominator (not subtracted out): a leaf that simply carries no
  // data for a dimension the query asked about is not evidence of a match, so it must not score the
  // same as a leaf that does engage that dimension (exactly or semantically). Excluding it here used
  // to give data-absent leaves a free pass over leaves with a real, if imperfect, semantic match.
  const judgedRequestedDimensionCount = structuralGate.queriedDimensionCount;

  const matchedDimensionWeight = structuralGate.judgments.reduce((total, judgment) => {
    if (judgment.kind === 'exact_concept' || judgment.kind === 'exact_literal') {
      return total + 1;
    }

    // Same partial credit as recoverable_available: an equivalence-class match (e.g. "car" ~
    // "vehicle") is a real semantic hit, not the absence of one, so it must outscore a dimension
    // the leaf has no data for at all.
    if (judgment.kind === 'recoverable_available' || judgment.kind === 'equivalent_concept') {
      return total + RECOVERABLE_DIMENSION_WEIGHT;
    }

    return total;
  }, 0);

  // Vacuous 1 only when the query named no dimension at all; zero signal on a queried dimension scores 0.
  let flatRequestedCoverage: number;
  if (structuralGate.queriedDimensionCount === 0) {
    flatRequestedCoverage = 1;
  } else if (judgedRequestedDimensionCount <= 0) {
    flatRequestedCoverage = 0;
  } else {
    flatRequestedCoverage = matchedDimensionWeight / judgedRequestedDimensionCount;
  }
  let unitConceptCoverage: number | null = null;
  if (comparisonQuery.translationUnits.length > 0) {
    const canonicalConceptIdsByDimension = new Map<TranslationConceptDimension, string[]>();
    for (const concept of canonicalProfile.profile.concepts) {
      const conceptIds = canonicalConceptIdsByDimension.get(concept.dimension) ?? [];
      if (!conceptIds.includes(concept.conceptId)) {
        conceptIds.push(concept.conceptId);
        canonicalConceptIdsByDimension.set(concept.dimension, conceptIds);
      }
    }
    unitConceptCoverage = conceptUnitCoverageForComparisonQuery(comparisonQuery, canonicalConceptIdsByDimension);
  }
  const requestedCoverage = unitConceptCoverage === null ? flatRequestedCoverage : Math.max(flatRequestedCoverage, unitConceptCoverage);

  // Counts by value, not by dimension presence: more unrequested values is wilder.
  const wildDimensionCount = SPECIALIZATION_DATA_DIMENSIONS.reduce((total, dimension) => {
    const querySet = new Set(queryProfile.profile[dimension]);
    const extraValues = canonicalProfile.profile[dimension].filter((value) => !querySet.has(value));
    return total + extraValues.length;
  }, 0);

  const wildDimensionPenalty = wildDimensionCount * WILD_DIMENSION_PENALTY;
  const genericRoleHeadPenalty = roleResemblanceTier === 'generic' ? GENERIC_ROLE_HEAD_PENALTY : 0;

  // Additive: each penalty is judged independently against its own evidence, then combined here so
  // future penalties (e.g. authority mismatch, industry drift) can mix in without reworking the ones
  // already scored.
  const penalty = wildDimensionPenalty + genericRoleHeadPenalty;

  // ---------------------------------------------------------
  // Token-level resemblance
  // ---------------------------------------------------------

  const ROLE_WEIGHT = 0.4;
  const AUTHORITY_WEIGHT = 0.25;
  const MODIFIER_WEIGHT = 0.35;

  // Exact role-head > broad role-head > no role-head.
  let roleScore = 0;

  if (roleResemblanceTier === 'exact') {
    roleScore = 1;
  } else if (roleResemblanceTier === 'similar') {
    roleScore = 0.5;
  }

  // No requested authority is neutral.
  const authorityScore = queryProfile.authority === 'none' ? 1 : canonicalProfile.authority === queryProfile.authority ? 1 : 0;

  // Defensive check: don't let something classified as a modifier
  // also count as the role-head or authority.
  let sharedModifierTokenUnitCount = 0;
  for (const unit of queryResemblance.modifierTokenUnits) {
    let unitMatched = false;
    for (const alternative of unit) {
      let alternativeMatched = true;
      for (const token of alternative) {
        if (!candidateTokenSet.has(token)) {
          alternativeMatched = false;
          break;
        }
      }
      if (alternativeMatched) {
        unitMatched = true;
        break;
      }
    }

    if (unitMatched) {
      sharedModifierTokenUnitCount++;
    }
  }

  const modifierScore =
    queryResemblance.modifierTokenUnits.length === 0 ? 1 : sharedModifierTokenUnitCount / queryResemblance.modifierTokenUnits.length;
  const hasSharedModifierToken = sharedModifierTokenUnitCount > 0;

  const tokenSimilarityCoverageScore = ROLE_WEIGHT * roleScore + AUTHORITY_WEIGHT * authorityScore + MODIFIER_WEIGHT * modifierScore;

  // ---------------------------------------------------------
  // Modifier token completeness
  // ---------------------------------------------------------

  let hasUncoveredRequiredNonRoleTokens = false;
  for (const unit of queryResemblance.requiredNonRoleTokenUnits) {
    let unitMatched = false;
    for (const alternative of unit) {
      let alternativeMatched = true;
      for (const token of alternative) {
        if (!candidateTokenSet.has(token)) {
          alternativeMatched = false;
          break;
        }
      }
      if (alternativeMatched) {
        unitMatched = true;
        break;
      }
    }

    if (!unitMatched) {
      hasUncoveredRequiredNonRoleTokens = true;
      break;
    }
  }

  // ---------------------------------------------------------
  // Final resemblance
  // ---------------------------------------------------------

  const TOKEN_SIMILARITY_WEIGHT = 0.6;
  const STRUCTURAL_WEIGHT = 0.4;

  const baseScore = TOKEN_SIMILARITY_WEIGHT * tokenSimilarityCoverageScore + STRUCTURAL_WEIGHT * requestedCoverage;

  const isExactCandidate = roleResemblanceTier === 'exact' && modifierScore === 1 && !hasUncoveredRequiredNonRoleTokens;
  const isPhraseMatchCandidate = roleResemblanceTier === 'exact' && modifierScore > 0;
  const isSimilarExactCandidate = roleResemblanceTier === 'similar' && modifierScore === 1 && !hasUncoveredRequiredNonRoleTokens;
  const isSimilarPhraseMatchCandidate = roleResemblanceTier === 'similar' && modifierScore > 0;
  const structurallyRelated = structuralGate.rawDecision === 'pass_strict' && requestedCoverage > 0;

  // Only items where there is chance of this been the canonical are given an order the rest get a 0
  let resemblanceOrder = 0;
  if (exactCanonical) {
    resemblanceOrder = 1;
  } else if (isExactCandidate) {
    resemblanceOrder = 2;
  } else if (isPhraseMatchCandidate) {
    resemblanceOrder = 3;
  } else if (isSimilarExactCandidate) {
    resemblanceOrder = 4;
  } else if (isSimilarPhraseMatchCandidate) {
    resemblanceOrder = 5;
  } else if (structurallyRelated) {
    resemblanceOrder = 6;
  }

  const allowAccessGate =
    exactCanonical ||
    weakExactCanonical ||
    resemblanceOrder > 0 ||
    roleResemblanceTier === 'exact' ||
    hasTrustworthyAliasMatch ||
    structuralGate.matchedDimensionCount > 0 ||
    hasSharedModifierToken;

  const score = Math.max(0, baseScore - penalty);

  return {
    exactCanonical,
    weakExactCanonical,
    roleResemblanceTier: roleResemblanceTier,
    requestedCoverage,
    wildDimensionCount,
    tokenCoverage: tokenSimilarityCoverageScore,
    hasSharedModifierToken,
    interestingResemblanceOrder: resemblanceOrder,
    allowGateAccess: allowAccessGate,
    score
  };
}

function buildQueryResemblanceInput(
  queryProfile: QueryStructuralProfile,
  comparisonQuery?: CanonicalComparisonQuery
): QueryResemblanceInput {
  const roleHeads = selectStrongRoleHeads(queryProfile.profile.role_head);
  const knownTokens = new Set<string>();
  for (const roleHead of roleHeads) {
    knownTokens.add(roleHead);
  }
  if (queryProfile.authority !== 'none') {
    knownTokens.add(queryProfile.authority);
  }

  const modifierTokens = queryConceptLiteralTokens(queryProfile, knownTokens);
  const translatedModifierTokenUnits = comparisonQuery ? modifierTokenUnitsForComparisonQuery(comparisonQuery) : [];
  const modifierTokenUnits: string[][][] = [];
  if (translatedModifierTokenUnits.length > 0) {
    for (const unit of translatedModifierTokenUnits) {
      const tokenizedUnit: string[][] = [];
      for (const token of unit) {
        const parts = tokenizeNormalizedText(token);
        if (parts.length > 0) {
          tokenizedUnit.push(parts);
        }
      }
      if (tokenizedUnit.length > 0) {
        modifierTokenUnits.push(tokenizedUnit);
      }
    }
  } else {
    for (const token of modifierTokens) {
      modifierTokenUnits.push([[token]]);
    }
  }
  const requiredNonRoleTokens: string[] = [];
  const requiredNonRoleTokenUnits: string[][][] = [];

  if (queryProfile.authority !== 'none') {
    requiredNonRoleTokens.push(queryProfile.authority);
    requiredNonRoleTokenUnits.push([[queryProfile.authority]]);
  }
  for (const token of modifierTokens) {
    requiredNonRoleTokens.push(token);
  }
  for (const unit of modifierTokenUnits) {
    requiredNonRoleTokenUnits.push(unit);
  }

  return { roleHeads, modifierTokens, modifierTokenUnits, requiredNonRoleTokens, requiredNonRoleTokenUnits };
}

function queryConceptLiteralTokens(queryProfile: QueryStructuralProfile, knownTokens: ReadonlySet<string>): string[] {
  const tokens: string[] = [];
  const seenTokens = new Set<string>();

  for (const dimension of SPECIALIZATION_DATA_DIMENSIONS) {
    for (const literal of queryProfile.profile.literal[dimension]) {
      for (const token of tokenizeNormalizedText(literal)) {
        if (!knownTokens.has(token) && !seenTokens.has(token)) {
          seenTokens.add(token);
          tokens.push(token);
        }
      }
    }
  }

  return tokens;
}

export function assessCandidatesThroughFilterFunnel(
  hydratedCandidates: readonly HydratedCandidate[],
  comparisonQuery: CanonicalComparisonQuery,
  _leafStructureArtifact: OccupationLeafStructureArtifact | null,
  queryProfile: QueryStructuralProfile,
  locale: string
): CandidateLedger {
  const ledger: CandidateLedger = new Map();
  const queryResemblance = buildQueryResemblanceInput(queryProfile, comparisonQuery);

  for (const candidate of hydratedCandidates) {
    ledger.set(candidate.graphNodeId, assessCandidate(candidate, comparisonQuery, queryProfile, queryResemblance, locale));
  }

  return ledger;
}

export function rankPromotableLeaves(candidateLedger: CandidateLedger, families: readonly FamilyAssessment[]): RankedLeaf[] {
  const allowedFamilyIds = new Set<number>();
  for (const family of families) {
    if (family.structureDecision === 'accept' || (family.structureDecision === 'partial' && family.roleGrounded)) {
      allowedFamilyIds.add(family.familyNodeId);
    }
  }

  return [...candidateLedger.values()]
    .filter(
      (candidate) => candidate.status === 'promotable' && candidate.familyNodeId !== null && allowedFamilyIds.has(candidate.familyNodeId)
    )
    .sort(compareRankedLeaves);
}

export function compareRankedLeaves(first: RankedLeaf, second: RankedLeaf): number {
  // 1. Primary resemblance score.
  const scoreDelta = second.canonical.score - first.canonical.score;

  if (Math.abs(scoreDelta) > 1e-9) {
    return scoreDelta;
  }

  // 2. Among score ties, direct proof (exact canonical / trustworthy alias) always wins over coincidence.
  const authoritativeDelta = Number(first.canonical.interestingResemblanceOrder) - Number(second.canonical.interestingResemblanceOrder);

  if (authoritativeDelta !== 0) {
    return authoritativeDelta;
  }

  // 3. An exact (non-generic) role-head match beats a same-group similar one; a generic or absent
  // match earns no credit either way.
  const roleTierDelta =
    ROLE_RESEMBLANCE_TIER_RANK[second.canonical.roleResemblanceTier] - ROLE_RESEMBLANCE_TIER_RANK[first.canonical.roleResemblanceTier];

  if (roleTierDelta !== 0) {
    return roleTierDelta;
  }

  // 4. More matched structural dimensions wins.
  const structuralDelta = second.structuralGate.matchedDimensions.length - first.structuralGate.matchedDimensions.length;

  if (structuralDelta !== 0) {
    return structuralDelta;
  }

  // 5. Prefer the candidate with fewer unexplained extra
  // specialization dimensions.
  const specificityDelta = first.canonical.wildDimensionCount - second.canonical.wildDimensionCount;

  if (specificityDelta !== 0) {
    return specificityDelta;
  }

  // Every scored signal is genuinely tied and neither candidate has authoritative proof over the
  // other -- a shorter-label guess isn't a real signal of correctness, so this is left as a true tie
  // (stable sort keeps recall order) for the caller to treat as ambiguous.
  return 0;
}
