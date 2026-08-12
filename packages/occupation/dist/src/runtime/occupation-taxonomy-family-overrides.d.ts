export type LeafSubFamilyOverride = {
    sourceName: string;
    leafNodeId: number;
    leafLabel: string;
    targetSubFamilyNodeId: number;
    targetSubFamilyLabel: string;
    targetFamilyNodeId: number;
    targetFamilyLabel: string;
    note: string;
};
export type SubFamilyFamilyOverride = {
    sourceName: string;
    subFamilyNodeId: number;
    subFamilyLabel: string;
    targetFamilyNodeId: number;
    targetFamilyLabel: string;
    note: string;
};
export type TaxonomyOverrideFields = {
    graphNodeId: number;
    familyNodeId: number | null;
    familyLabel: string | null;
    groupNodeId: number | null;
    groupLabel: string | null;
    parentNodeId?: number | null;
    parentLabel?: string | null;
};
type TaxonomyAncestorFields = {
    graphNodeId: number;
    canonicalLabel: string;
    nodeLevel: string;
    distanceFromLeaf: number;
    ancestorRole: string;
};
type TaxonomyOverrideRecord = TaxonomyOverrideFields & {
    ancestors?: TaxonomyAncestorFields[];
};
export declare function reviewedLeafSubFamilyOverrides(): readonly LeafSubFamilyOverride[];
export declare function reviewedSubFamilyFamilyOverrides(): readonly SubFamilyFamilyOverride[];
export declare function taxonomySubFamilyOverrideForLeaf(sourceName: string, leafNodeId: number): LeafSubFamilyOverride | null;
export declare function taxonomyFamilyOverrideForSubFamily(sourceName: string, subFamilyNodeId: number | null): SubFamilyFamilyOverride | null;
export declare function applyReviewedTaxonomyOverridesToFields<T extends TaxonomyOverrideFields>(sourceName: string, fields: T): T;
export declare function applyReviewedTaxonomyOverrides<T extends TaxonomyOverrideRecord>(sourceName: string, record: T): T;
export {};
