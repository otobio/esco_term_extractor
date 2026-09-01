import { type ClassifierOptions, type QuerySpecializationClassification, type SpecializationDimension, type TitleClassification } from './specialization-dimension-mapper.js';
export declare const SPECIALIZATION_DATA_DIMENSIONS: ("product" | "population" | "channel" | "venue" | "task" | "industry" | "knowledge_domain" | "work_object")[];
export type SpecializationGateInput = QuerySpecializationClassification | TitleClassification | string;
export type SpecializationGateDecision = 'pass_strict' | 'pass_partial' | 'reject';
export type SpecializationDimensionJudgmentKind = 'exact_concept' | 'equivalent_concept' | 'exact_literal' | 'recoverable_available' | 'unknown' | 'contradiction';
export type SpecializationDimensionJudgment = {
    dimension: Exclude<SpecializationDimension, 'role_head'>;
    kind: SpecializationDimensionJudgmentKind;
    leafConceptIds: string[];
    leafRecoverableValues: string[];
    leafValues: string[];
    matchedValues: string[];
    queryConceptIds: string[];
    queryRecoverableValues: string[];
    queryValues: string[];
};
export type SpecializationGateResult = {
    accepted: boolean;
    compatibleDimensions: Exclude<SpecializationDimension, 'role_head'>[];
    contradictionDimensions: Exclude<SpecializationDimension, 'role_head'>[];
    decision: SpecializationGateDecision;
    equivalentDimensions: Exclude<SpecializationDimension, 'role_head'>[];
    judgments: SpecializationDimensionJudgment[];
    queriedDimensions: Exclude<SpecializationDimension, 'role_head'>[];
    relatedness: {
        reinforcedDimensions: Exclude<SpecializationDimension, 'role_head'>[];
        reinforcedEquivalentDimensions: Exclude<SpecializationDimension, 'role_head'>[];
        roleHead: {
            exact: boolean;
            queryRoleHeads: string[];
            leafRoleHeads: string[];
            sameFamily: boolean;
            sharedGroups: string[];
            strength: 'none' | 'role_only' | 'role_and_dimensions';
        };
    };
    unknownDimensions: Exclude<SpecializationDimension, 'role_head'>[];
};
export declare function specializationGate(queryInput: SpecializationGateInput, leafInput: SpecializationGateInput, options?: ClassifierOptions): SpecializationGateResult;
export declare function failsHardContradiction(queryInput: SpecializationGateInput, leafInput: SpecializationGateInput, options?: ClassifierOptions): boolean;
