import type { PreparedFamilyStructureQuery } from '../family-structure/family-structure.js';
export type FamilyStatisticalFit = {
    score: number;
    features: readonly string[];
};
export declare function scoreFamilyStatisticalFit(familyNodeId: number, query: PreparedFamilyStructureQuery): FamilyStatisticalFit;
export declare function statisticalFamilyConfidence(structureDecision: 'accept' | 'partial' | 'reject', fit: FamilyStatisticalFit): number;
