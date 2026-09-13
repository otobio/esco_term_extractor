export type FamilyStructureCoverageAddition = {
    familyNodeId: number;
    familyLabel: string;
    field: string;
    value: string;
    evidenceCount: number;
    familyLeafCount: number;
    evidenceRatio: number;
    reason: 'coverage_threshold' | 'true_family_acceptance' | 'true_family_viability';
};
export type FamilyStructureCoverageReview = {
    additions: FamilyStructureCoverageAddition[];
    familyCount: number;
    leafCount: number;
};
export declare function reviewFamilyStructureCoverage(): FamilyStructureCoverageReview;
export declare function applyFamilyStructureCoverageReview(): FamilyStructureCoverageReview;
