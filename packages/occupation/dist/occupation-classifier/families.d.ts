import type { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
import type { QueryStructuralProfile } from './preparation.js';
import type { CandidateLedger, CanonicalComparisonQuery, ExactFamilyCandidate, FamilyAssessment, SelectedFamily, SimpleDecisionReason } from './types.js';
export declare function selectUniqueExactCanonicalFamily(exactCanonicalFamilies: readonly ExactFamilyCandidate[]): CoreFamilyDecision | null;
export declare function validateFamilies(_runtime: OccupationRuntimeContext, candidateLedger: CandidateLedger, exactFamilies: readonly ExactFamilyCandidate[], _comparisonQuery: CanonicalComparisonQuery, queryProfile?: QueryStructuralProfile): FamilyAssessment[];
export type CoreFamilyDecision = {
    decision: {
        type: 'family';
        reason: Extract<SimpleDecisionReason, 'exact_canonical_family' | 'family_dictionary_gap' | 'family_leaf_ambiguity'>;
        confidence: number;
    };
    selectedFamily: SelectedFamily;
};
