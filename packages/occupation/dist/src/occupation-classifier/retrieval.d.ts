import type { AliasRetrievalResult } from '../retrieval/retrieval-engine.js';
import type { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
import { type ClassifierRecallLimits } from './constants.js';
import { QueryStructuralProfile } from './preparation.js';
import type { CandidateEvidenceById, CanonicalComparisonQuery, ClassifierRetrievalRequest, ClassifierSurface, ExactFamilyCandidate, HydratedCandidate } from './types.js';
export type ExactLeafCandidate = {
    graphNodeId: number;
    weakFoldedCanonicalLabel: string;
};
export type ExactAliasCandidate = {
    graphNodeId: number;
    weakFoldedAlias: string;
};
export type RawRecallEvidence = {
    graphNodeId: number;
    channel: 'exact_canonical' | 'weak_exact_canonical' | 'exact_primary_alias' | 'exact_supporting_alias' | 'folded_alias' | 'subphrase_alias' | 'english_alias' | 'family_scoped_title_token' | 'title_token' | 'ngram_alias' | 'role_head_equivalent';
    selectionUsable: boolean;
    tieBreakerScore: number;
    aliasRole?: string;
};
export declare function buildRetrievalRequest(sourceName: string, locale: ClassifierRetrievalRequest['locale'], surface: ClassifierSurface, comparisonQuery: CanonicalComparisonQuery, queryProfile: QueryStructuralProfile): ClassifierRetrievalRequest;
export declare function findExactCanonicalLeaves(runtime: OccupationRuntimeContext, request: ClassifierRetrievalRequest): Promise<ExactLeafCandidate[]>;
export declare function findExactAliasLeaves(runtime: OccupationRuntimeContext, request: ClassifierRetrievalRequest, limit: number): Promise<{
    candidates: ExactAliasCandidate[];
    aliasResult: AliasRetrievalResult;
}>;
export declare function findExactCanonicalFamilies(_runtime: OccupationRuntimeContext, request: ClassifierRetrievalRequest): Promise<ExactFamilyCandidate[]>;
export declare function retrieveRecallCandidates(runtime: OccupationRuntimeContext, request: ClassifierRetrievalRequest, priorExact: {
    exactCanonicalLeaves: readonly ExactLeafCandidate[];
    exactAliasLeaves: readonly ExactAliasCandidate[];
    aliasResult: AliasRetrievalResult;
}, limits: ClassifierRecallLimits): Promise<RawRecallEvidence[]>;
export declare function mergeCandidateEvidence(rawRecall: readonly RawRecallEvidence[]): CandidateEvidenceById;
export declare function hydrateCandidateCores(runtime: OccupationRuntimeContext, evidenceById: CandidateEvidenceById): HydratedCandidate[];
