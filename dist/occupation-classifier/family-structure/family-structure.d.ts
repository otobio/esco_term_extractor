import { type LeafLevelKind } from '../../runtime/occupation-leaf-structure-rules.js';
import { type QueryStructuralProfile } from '../preparation.js';
import type { SpecializationDimension } from '../specialization/specialization-dimension-mapper.js';
export type FamilyStructureDecision = 'accept' | 'partial' | 'reject' | 'unknown';
export type FamilyStructureConceptDimension = Exclude<SpecializationDimension, 'role_head'>;
export type FamilyStructureRule = {
    familyNodeId: number;
    familyLabel: string;
    roleHeads: readonly string[];
    authorityLevels: readonly LeafLevelKind[];
    conceptsByDimension: ReadonlyMap<FamilyStructureConceptDimension, readonly string[]>;
    residualPolicy: FamilyResidualPolicy;
};
export type FamilyResidualPolicy = 'specific' | 'residual_when_no_specific_family' | 'dictionary_gap_only';
export type FamilyStructureValidationResult = {
    valid: boolean;
    errors: string[];
};
export type FamilyStructureGateResult = {
    familyNodeId: number;
    decision: FamilyStructureDecision;
};
export type PreparedFamilyStructureQuery = {
    roleHeads: readonly string[];
    authority: LeafLevelKind;
    conceptIdsByDimension: ReadonlyMap<FamilyStructureConceptDimension, readonly string[]>;
};
export type FamilyStructureShortlist = {
    accepted: readonly FamilyStructureGateResult[];
    rejected: readonly FamilyStructureGateResult[];
    unknown: readonly FamilyStructureGateResult[];
};
export declare function getFamilyStructureRules(): readonly FamilyStructureRule[];
export declare function getFamilyStructureRule(familyNodeId: number): FamilyStructureRule | undefined;
export declare function requireFamilyStructureRule(familyNodeId: number): FamilyStructureRule;
export declare function validateFamilyStructureRules(): FamilyStructureValidationResult;
export declare function assertValidFamilyStructureRules(): void;
export declare function prepareFamilyStructureQuery(query: QueryStructuralProfile | string): PreparedFamilyStructureQuery;
export declare function gateFamilyStructureForQuery(family: FamilyStructureRule | number, query: QueryStructuralProfile | PreparedFamilyStructureQuery | string): FamilyStructureGateResult;
export declare function shortlistFamilyStructureMatches(query: QueryStructuralProfile | string): FamilyStructureShortlist;
export declare function compareFamilyStructureAuthority(queryAuthority: LeafLevelKind, familyAuthorities: readonly LeafLevelKind[]): {
    matched: boolean;
    contradicted: boolean;
    matchedLevels: ("assistant" | "junior" | "senior" | "lead" | "supervisor" | "manager" | "director" | "chief")[];
};
export declare function compareFamilyStructureConceptDimensions(query: QueryStructuralProfile | PreparedFamilyStructureQuery, rule: FamilyStructureRule): {
    matchedConcepts: {
        dimension: FamilyStructureConceptDimension;
        values: readonly string[];
    }[];
    contradictedDimensions: FamilyStructureConceptDimension[];
    unknownDimensions: FamilyStructureConceptDimension[];
};
export declare function findFamilyStructureRoleBridges(queryRoleHeads: readonly string[], query: QueryStructuralProfile | PreparedFamilyStructureQuery, rule: FamilyStructureRule): string[];
export declare function getFamilyStructureQueryRoleHeads(queryProfile: QueryStructuralProfile): readonly string[];
