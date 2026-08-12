export declare const LEAF_BASE_ROLE_KINDS: readonly ["generic_base_role", "specialized_base_role"];
export declare const LEAF_AUTHORITY_KINDS: readonly ["none", "lead", "supervisor", "manager", "director", "chief", "auditor"];
export declare const LEAF_SPECIALIZATION_KINDS: readonly ["venue", "channel", "product", "population", "task_focus", "industry_context"];
export declare const LEAF_RISK_LEVELS: readonly ["low", "medium", "high"];
export type LeafBaseRoleKind = (typeof LEAF_BASE_ROLE_KINDS)[number];
export type LeafAuthorityKind = (typeof LEAF_AUTHORITY_KINDS)[number];
export type LeafSpecializationKind = (typeof LEAF_SPECIALIZATION_KINDS)[number];
export type LeafRiskLevel = (typeof LEAF_RISK_LEVELS)[number];
export type OccupationLeafStructureRecord = {
    graphNodeId: number;
    canonicalLabel: string;
    familyNodeId: number | null;
    groupNodeId: number | null;
    parentNodeId: number | null;
    baseRoleKind: LeafBaseRoleKind;
    authorityKind: LeafAuthorityKind;
    specializationKinds: LeafSpecializationKind[];
    headPreservingSpecialization: boolean;
    broadAliasRisk: LeafRiskLevel;
    capabilityDominanceRisk: LeafRiskLevel;
};
export type OccupationLeafStructureArtifactManifest = {
    schemaVersion: 2;
    sourceName: string;
    generatedAt: string;
    count: number;
    stringCount: number;
    familyPostingKeyCount: number;
    familyPostingCount: number;
    files: {
        strings: string;
        recordRows: string;
        familyPostings: string;
        familyPostingRows: string;
    };
};
