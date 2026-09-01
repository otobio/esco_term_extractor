import { AliasRetrievalResult } from '../retrieval/retrieval-engine.js';
import type { OccupationLeafStructureArtifact } from '../runtime/occupation-leaf-structure-artifact.js';
import { LeafLevelKind } from '../runtime/occupation-leaf-structure-rules.js';
import type { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
import { QueryStructuralProfile } from './preparation.js';
import type { ExactAliasCandidate, ExactLeafCandidate } from './retrieval.js';
import type { CandidateLedger, CanonicalComparisonQuery, ClassifierRetrievalRequest, FamilyAssessment, HydratedCandidate, RankedLeaf, SelectedLeaf, SimpleDecisionReason } from './types.js';
export declare const LEAF_SELECTION_MARGIN = 0.1;
export type CoreLeafDecision = {
    decision: {
        type: 'leaf';
        reason: Extract<SimpleDecisionReason, 'exact_canonical_leaf' | 'exact_primary_alias_leaf' | 'promotable_leaf'>;
        confidence: number;
    };
    selectedLeaf: SelectedLeaf;
};
export declare function selectUniqueExactCanonicalLeaf(rows: readonly ExactLeafCandidate[], runtime: OccupationRuntimeContext, retrievalRequest: ClassifierRetrievalRequest): CoreLeafDecision | null;
export declare function selectUniqueExactAliasLeaf(rows: readonly ExactAliasCandidate[], rawAliasResults: AliasRetrievalResult, runtime: OccupationRuntimeContext, _retrievalRequest: ClassifierRetrievalRequest, comparisonQuery: CanonicalComparisonQuery): CoreLeafDecision | null;
export declare function isAuthorityTier(levelKind: LeafLevelKind): boolean;
export declare function leafAuthorityLevelKindsContradict(queryLevelKind: LeafLevelKind, leafLevelKind: LeafLevelKind): boolean;
export declare function assessCandidatesThroughFilterFunnel(hydratedCandidates: readonly HydratedCandidate[], comparisonQuery: CanonicalComparisonQuery, _leafStructureArtifact: OccupationLeafStructureArtifact | null, queryProfile: QueryStructuralProfile, locale: string): CandidateLedger;
export declare function rankPromotableLeaves(candidateLedger: CandidateLedger, families: readonly FamilyAssessment[]): RankedLeaf[];
export declare function compareRankedLeaves(first: RankedLeaf, second: RankedLeaf): number;
