import type { CandidateLedger, CanonicalComparisonQuery, CleanedTitle, CoreDecision, CoreResult, DebugResult, DebugTrace, FamilyAssessment, RankedLeaf, RuntimeResult, SelectedFamily, SelectedLeaf } from './types.js';
export type BuildCoreResultInput = {
    cleaned?: CleanedTitle;
    comparisonQuery?: CanonicalComparisonQuery;
    candidateLedger: CandidateLedger;
    rankedLeaves: RankedLeaf[];
    familyAssessments: FamilyAssessment[];
    decision: CoreDecision;
    selectedLeaf?: SelectedLeaf | null;
    selectedFamily?: SelectedFamily | null;
    spans?: Array<{
        query: string;
        result: CoreResult;
    }>;
};
export declare function buildCoreResult(input: BuildCoreResultInput): CoreResult;
export declare function toRuntimeResult(coreResult: CoreResult): RuntimeResult;
export declare function toDebugResult(coreResult: CoreResult, debugTrace: DebugTrace): DebugResult;
export declare function coreUnresolved(reason: CoreDecision['reason']): CoreResult;
