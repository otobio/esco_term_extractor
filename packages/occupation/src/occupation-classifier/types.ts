import type { SupportedQueryLocale } from '../query/query-preparation.js';
import type { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
import type { SpecializationDimension } from './specialization/specialization-dimension-mapper.js';
import type {
  SpecializationDimensionJudgment,
  SpecializationGateDecision,
  SpecializationGateResult
} from './specialization/specialization-gate.js';

export type { SupportedQueryLocale };

export type SimpleClassificationInput = {
  query: string;
  locale?: SupportedQueryLocale;
  sourceName?: string;
  runtime?: OccupationRuntimeContext;
};

export type NormalizedInput = {
  query: string;
  locale: SupportedQueryLocale;
  sourceName: string;
  runtime?: OccupationRuntimeContext;
};

export type CleanedTitle = {
  rawTitle: string;
  cleanedTitle: string;
  locale: SupportedQueryLocale;
};

export type TitleSpan = {
  text: string;
};

export type ClassifierSurface = {
  spanText: string;
  weakFolded: string;
  weakFoldedTokens: string[];
};

export type TranslatedTitle = {
  matchedTokens: string[];
  modifierTokens: string[];
  unresolvedTokens: string[];
  foldedFullText?: string;
  resolvedRoleHeadTokens?: string[];
  // The local-language token(s) whose English translation landed in a known role-head group --
  // i.e. the local surface's own role head, found by reversing the local->English translation
  // instead of needing a separate local-language role-head list. See isKnownRoleHeadWord.
  localRoleHeadTokens?: string[];
  translationUnits?: TranslationUnit[];
};

export type TranslationConceptDimension = Exclude<SpecializationDimension, 'role_head'>;

export type TranslationAlternative =
  | { kind: 'role_head'; token: string }
  | { kind: 'modifier'; token: string }
  | { kind: 'concept'; token: string; dimension: TranslationConceptDimension; conceptId: string };

export type TranslationUnit = {
  localText: string;
  alternatives: TranslationAlternative[];
};

export type CanonicalComparisonQuery = {
  englishTokens: string[];
  modifierTokens: string[];
  unresolvedTokens: string[];
  canonicalExactKeys: string[];
  // Non-generic role head recovered from the cross-locale equivalence lookup (direct or via a
  // locale token-variant, e.g. RO "patiserie" -> "patiser" -> "chef") when the query's own
  // structural profile had no role head to begin with. buildRetrievalRequest treats this as the
  // authoritative role-head signal instead of every other translated token, since a curated
  // role-head-alias translation (e.g. "sef" -> "boss"/"chief") is generic and floods recall.
  resolvedRoleHeadTokens: string[];
  localRoleHeadTokens: string[];
  translationUnits: TranslationUnit[];
};

export type ClassifierRetrievalRequest = {
  sourceName: string;
  locale: SupportedQueryLocale;
  localFullAliasKey: string;
  localAliasTokens: string[];
  englishCanonicalExactKeys: string[];
  englishWeakFoldedTokens: string[];
  englishFullAliasKey: string;
  englishModifierTokens: string[];
  englishRoleHeadTokens: string[];
  localRoleHeadTokens: string[];
  roleHeadEquivalentTerms: string[];
  fuzzyAliasRecallEnabled: boolean;
};

export type SelectedLeaf = {
  graphNodeId: number;
  canonicalLabel: string;
  familyNodeId: number | null;
  familyLabel: string | null;
};

export type SelectedFamily = {
  familyNodeId: number;
  familyLabel: string;
};

export type SimpleDecisionReason =
  | 'empty_after_cleaning'
  | 'multi_span'
  | 'exact_canonical_leaf'
  | 'exact_primary_alias_leaf'
  | 'exact_canonical_family'
  | 'promotable_leaf'
  | 'family_dictionary_gap'
  | 'family_leaf_ambiguity'
  | 'unresolved_no_candidates'
  | 'unresolved_all_candidates_rejected'
  | 'unresolved_low_confidence'
  | 'unresolved_ambiguous_leaves';

export type CoreDecision = {
  type: 'leaf' | 'family' | 'multi_span' | 'unresolved';
  reason: SimpleDecisionReason;
  confidence: number;
};

export type CoverageResult = {
  status: 'exact_canonical_match' | 'closest_available_match' | 'likely_dictionary_gap' | 'insufficient_evidence' | 'multi_span';
  canonicalComparsion?: CanonicalComparisonQuery;
  // matchedComparableTokens: string[];
  // missingComparableTokens: string[];
  // unresolvedLocalTokens: string[];
};

export type LeafRejectReason =
  | 'missing_core_record'
  | 'authority_conflict'
  | 'structural_contradiction'
  | 'no_canonical_relationship'
  | 'alias_only'
  | 'retrieval_only';

export type NearMissReason =
  | 'missing_role_head_translation'
  | 'missing_primary_modifier'
  | 'missing_specialization'
  | 'low_canonical_resemblance'
  | 'leaf_ambiguity';

export type FamilyRejectReason =
  | 'family_structure_contradiction'
  | 'family_not_role_grounded'
  | 'family_domain_only'
  | 'family_only_hard_rejected_leaf_support';

export type CandidateEvidence = {
  exactCanonical: boolean;
  weakExactCanonical: boolean;
  exactPrimaryAlias: boolean;
  exactSupportingAlias: boolean;
  foldedAlias: boolean;
  subphraseAlias: boolean;
  englishAlias: boolean;
  titleToken: boolean;
  ngramAlias: boolean;
  roleHeadEquivalent: boolean;
  tieBreakerScore: number;
};

export type CandidateEvidenceById = Map<number, CandidateEvidence>;

export type HydratedCandidate = {
  graphNodeId: number;
  canonicalLabel: string;
  canonicalWeakFolded: string;
  familyNodeId: number | null;
  familyLabel: string | null;
  evidence: CandidateEvidence;
};

export type GateDecision = 'accept' | 'penalize' | 'reject';
export type AuthorityGate = { decision: GateDecision; reason: string | null };
export type StructuralGate = {
  rawDecision: SpecializationGateDecision;
  decision: GateDecision;
  reason: string | null;
  matchedDimensions: string[];
  contradictedDimensions: string[];
  queriedDimensionCount: number;
  matchedDimensionCount: number;
  unknownDimensionCount: number;
  judgments: SpecializationDimensionJudgment[];
};

export type RoleResemblanceTier = 'exact' | 'similar' | 'generic' | 'none';

export type CanonicalResemblance = {
  exactCanonical: boolean;
  weakExactCanonical: boolean;
  roleResemblanceTier: RoleResemblanceTier;
  requestedCoverage: number;
  wildDimensionCount: number;
  tokenCoverage: number;
  hasSharedModifierToken: boolean;
  interestingResemblanceOrder: number;
  allowGateAccess: boolean;
  //isAuthoritative: boolean;
  score: number;
};

export type CandidateAssessment = {
  graphNodeId: number;
  canonicalLabel: string;
  familyNodeId: number | null;
  familyLabel: string | null;
  evidence: CandidateEvidence;
  status: 'promotable' | 'near_miss' | 'hard_rejected';
  authorityGate: AuthorityGate;
  structuralGate: StructuralGate;
  canonical: CanonicalResemblance;
  selectionAuthority: 'canonical' | 'canonical_with_alias' | 'alias_only' | 'retrieval_only';
  rejectReason: LeafRejectReason | null;
  nearMissReason: NearMissReason | null;
};

export type CandidateLedger = Map<number, CandidateAssessment>;

export type RankedLeaf = CandidateAssessment;

export type ExactFamilyCandidate = {
  familyNodeId: number;
  familyLabel: string;
  weakFoldedFamilyLabel: string;
};

export type FamilyAssessment = {
  familyNodeId: number;
  familyLabel: string;
  exactCanonical: boolean;
  roleGrounded: boolean;
  structureDecision: 'accept' | 'partial' | 'reject';
  supportKind: 'exact' | 'has_promotable_leaf' | 'dictionary_gap_from_near_miss' | 'structural' | 'rejected';
  confidence: number;
  rejectReason: FamilyRejectReason | null;
};

export type CoreResult = {
  candidateLedger: CandidateLedger;
  rankedLeaves: RankedLeaf[];
  familyAssessments: FamilyAssessment[];
  decision: CoreDecision;
  selectedLeaf: SelectedLeaf | null;
  selectedFamily: SelectedFamily | null;
  coverage: CoverageResult;
  cleaned: CleanedTitle | null;
  // translated: TranslatedTitle | null;
  spans?: Array<{ query: string; result: CoreResult }>;
};

export type AltLeafCanonicalTerm = {
  graphNodeId: number;
  canonicalTerm: string;
  familyNodeId: number | null;
  familyLabel: string | null;
  confidence: number;
};

export type RuntimeResult = {
  decision: CoreDecision;
  leaf: SelectedLeaf | null;
  family: SelectedFamily | null;
  coverage: CoverageResult;
  cleaned: CleanedTitle | null;
  query: CanonicalComparisonQuery | null;
  // translated: TranslatedTitle | null;
  // Other promotable leaves under the selected family, informational only -- mirrors the old
  // pipeline's altLeafCanonicalTerms (src/api/canonical-term.ts). Populated whenever a family was
  // selected (leaf or family decision), even when the decision itself abstained from a specific leaf.
  altLeafCanonicalTerms: AltLeafCanonicalTerm[];
  spans?: Array<{ query: string; result: RuntimeResult }>;
};

export type DebugTrace = {
  pipeline: DebugPipelineStep[];
};

export type DebugResult = {
  runtime: RuntimeResult;
  trace: DebugTrace;
  candidates: CandidateAssessment[];
  rankedLeaves: RankedLeaf[];
  familyAssessments: FamilyAssessment[];
};

export type DebugPipelineStep = {
  name: ClassifierPipelineStageName;
  args: unknown[];
  output: unknown;
  durationMs: number;
};

export type ClassifierPipelineStageName =
  | 'normalizeInput'
  | 'selectClassifierLocale'
  | 'loadOrUseRuntime'
  | 'cleanOccupationQuerySurface'
  | 'splitIndependentSpans'
  | 'prepareClassifierSurface'
  | 'loadOccupationLeafStructureArtifact'
  | 'translateTitleForClassifier'
  | 'buildQueryStructuralProfile'
  | 'buildRetrievalRequest'
  | 'findExactCanonicalLeaves'
  | 'selectUniqueExactCanonicalLeaf'
  | 'findExactAliasLeaves'
  | 'selectUniqueExactAliasLeaf'
  | 'findExactCanonicalFamilies'
  | 'selectUniqueExactCanonicalFamily'
  | 'retrieveRecallCandidates'
  | 'mergeCandidateEvidence'
  | 'hydrateCandidateCores'
  | 'assessCandidatesThroughFilterFunnel'
  | 'rankPromotableLeaves'
  | 'validateFamilies'
  | 'selectDecision'
  | 'buildCoreResult';
