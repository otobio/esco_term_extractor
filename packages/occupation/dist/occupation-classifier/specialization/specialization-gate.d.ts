import { type ClassifierOptions, type QuerySpecializationClassification, type SpecializationEvidenceDimension, type TitleClassification } from './specialization-dimension-mapper.js';
export declare const SPECIALIZATION_DATA_DIMENSIONS: SpecializationEvidenceDimension[];
export type SpecializationGateInput = QuerySpecializationClassification | TitleClassification | string;
export type SpecializationGateDecision = 'pass_strict' | 'pass_partial' | 'reject';
export type SpecializationDimensionJudgmentKind = 'exact_concept' | 'equivalent_concept' | 'role_head_default_industry' | 'exact_literal' | 'recoverable_available' | 'unknown' | 'contradiction';
export type SpecializationDimensionJudgment = {
    dimension: SpecializationEvidenceDimension;
    kind: SpecializationDimensionJudgmentKind;
    leafConceptIds: string[];
    leafRecoverableValues: string[];
    leafValues: string[];
    matchedValues: string[];
    queryConceptIds: string[];
    queryRecoverableValues: string[];
    queryValues: string[];
};
export type SpecializationGateQueryConceptWeight = {
    conceptId: string;
    dimension: SpecializationEvidenceDimension;
    values: string[];
    weight: number;
};
export type SpecializationGateResult = {
    accepted: boolean;
    compatibleDimensions: SpecializationEvidenceDimension[];
    contradictionDimensions: SpecializationEvidenceDimension[];
    decision: SpecializationGateDecision;
    equivalentDimensions: SpecializationEvidenceDimension[];
    judgments: SpecializationDimensionJudgment[];
    queryWeights: {
        concepts: SpecializationGateQueryConceptWeight[];
    };
    queriedDimensions: SpecializationEvidenceDimension[];
    relatedness: {
        reinforcedDimensions: SpecializationEvidenceDimension[];
        reinforcedEquivalentDimensions: SpecializationEvidenceDimension[];
        roleHead: {
            exact: boolean;
            queryRoleHeads: string[];
            leafRoleHeads: string[];
            sameFamily: boolean;
            sharedGroups: string[];
            strength: 'none' | 'role_only' | 'role_and_dimensions';
        };
    };
    unknownDimensions: SpecializationEvidenceDimension[];
};
export declare function specializationGate(queryInput: SpecializationGateInput, leafInput: SpecializationGateInput, options?: ClassifierOptions): SpecializationGateResult;
export declare function failsHardContradiction(queryInput: SpecializationGateInput, leafInput: SpecializationGateInput, options?: ClassifierOptions): boolean;
