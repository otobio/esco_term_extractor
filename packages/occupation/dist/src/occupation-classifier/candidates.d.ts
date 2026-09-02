import { AliasRetrievalResult } from '../retrieval/retrieval-engine.js';
import type { OccupationLeafStructureArtifact } from '../runtime/occupation-leaf-structure-artifact.js';
import type { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
import { QueryStructuralProfile } from './preparation.js';
import type { ExactAliasCandidate, ExactLeafCandidate } from './retrieval.js';
import type { CandidateLedger, CanonicalComparisonQuery, CanonicalResemblance, ClassifierRetrievalRequest, FamilyAssessment, HydratedCandidate, RankedLeaf, SelectedLeaf, SimpleDecisionReason, StructuralGate } from './types.js';
export declare const LEAF_SELECTION_MARGIN = 0.1;
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
export declare function selectUniqueExactCanonicalLeaf(rows: readonly ExactLeafCandidate[], runtime: OccupationRuntimeContext, retrievalRequest: ClassifierRetrievalRequest, queryProfile?: QueryStructuralProfile, comparisonQuery?: CanonicalComparisonQuery): CoreLeafDecision | null;
export declare function selectUniqueExactAliasLeaf(rows: readonly ExactAliasCandidate[], rawAliasResults: AliasRetrievalResult, runtime: OccupationRuntimeContext, _retrievalRequest: ClassifierRetrievalRequest, comparisonQuery: CanonicalComparisonQuery): CoreLeafDecision | null;
export declare function computeCanonicalResemblance(candidate: HydratedCandidate, comparisonQuery: CanonicalComparisonQuery, queryProfile: QueryStructuralProfile, canonicalProfile: QueryStructuralProfile, structuralGate: StructuralGate, queryResemblance?: QueryResemblanceInput): CanonicalResemblance;
export declare function assessCandidatesThroughFilterFunnel(hydratedCandidates: readonly HydratedCandidate[], comparisonQuery: CanonicalComparisonQuery, _leafStructureArtifact: OccupationLeafStructureArtifact | null, queryProfile: QueryStructuralProfile, locale: string): CandidateLedger;
export declare function rankPromotableLeaves(candidateLedger: CandidateLedger, families: readonly FamilyAssessment[]): RankedLeaf[];
export declare function compareRankedLeaves(first: RankedLeaf, second: RankedLeaf): number;
