import type { CandidateLedger, CanonicalComparisonQuery, CoreDecision, ExactFamilyCandidate, FamilyAssessment, RankedLeaf, SelectedFamily, SelectedLeaf } from './types.js';
export type DecisionOutcome = {
    decision: CoreDecision;
    selectedLeaf: SelectedLeaf | null;
    selectedFamily: SelectedFamily | null;
};
export declare function selectDecision(rankedLeaves: readonly RankedLeaf[], families: readonly FamilyAssessment[], candidateLedger: CandidateLedger, _comparisonQuery: CanonicalComparisonQuery): DecisionOutcome;
export declare function buildFamilyCandidateSet(_exactCanonicalFamilies: readonly ExactFamilyCandidate[], _candidateLedger: CandidateLedger): Set<number>;
export declare function isLeafGrounded(leaf: RankedLeaf): boolean;
