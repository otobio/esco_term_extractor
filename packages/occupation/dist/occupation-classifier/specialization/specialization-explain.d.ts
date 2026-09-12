import { type QuerySpecializationClassification, type SpecializationEvidenceDimension } from './specialization-dimension-mapper.js';
export type SpecializationConceptExplain = {
    conceptId: string;
    tokens: string[];
};
export type SpecializationStructuralCombinationExplain = {
    concepts: Array<{
        conceptId: string;
        dimension: SpecializationEvidenceDimension;
        tokens: string[];
    }>;
    derivedRoleHeads: string[];
    id: string;
    roleHeads: string[];
};
export type SpecializationExplain = {
    conceptsByDimension: Partial<Record<SpecializationEvidenceDimension, SpecializationConceptExplain[]>>;
    noopConcepts: SpecializationConceptExplain[];
    roleHeads: string[];
    structuralCombinations: SpecializationStructuralCombinationExplain[];
};
export declare function explainSpecializationClassification(classification: QuerySpecializationClassification): SpecializationExplain;
