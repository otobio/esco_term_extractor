import { type QueryStructuralProfile } from '../preparation.js';
import type { FamilyStructureConceptDimension, FamilyStructureDecision, FamilyStructureRule } from './family-structure.js';
import type { LeafLevelKind } from '../../runtime/occupation-leaf-structure-rules.js';
export type FamilyStructureComparison = {
    familyNodeId: number;
    familyLabel: string;
    decision: FamilyStructureDecision;
    roleHeadMatched: boolean;
    roleHeadUnknown: boolean;
    matchedRoleHeads: readonly string[];
    missingRoleHeads: readonly string[];
    authorityMatched: boolean;
    authorityContradicted: boolean;
    matchedAuthorityLevels: readonly LeafLevelKind[];
    matchedConcepts: readonly FamilyStructureMatchedConcept[];
    contradictedDimensions: readonly FamilyStructureConceptDimension[];
    unknownDimensions: readonly FamilyStructureConceptDimension[];
    bridgeIds: readonly string[];
    residualPolicy: FamilyStructureRule['residualPolicy'];
    reasons: readonly string[];
};
export type FamilyStructureMatchedConcept = {
    dimension: FamilyStructureConceptDimension;
    values: readonly string[];
};
export declare function compareFamilyStructureToQuery(family: FamilyStructureRule | number, query: QueryStructuralProfile | string): FamilyStructureComparison;
