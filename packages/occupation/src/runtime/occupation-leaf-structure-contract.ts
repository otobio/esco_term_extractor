export const LEAF_BASE_ROLE_KINDS = ['generic_base_role', 'specialized_base_role'] as const;
export const LEAF_AUTHORITY_KINDS = ['none', 'lead', 'supervisor', 'manager', 'director', 'chief', 'auditor'] as const;
export const LEAF_SPECIALIZATION_KINDS = ['venue', 'channel', 'product', 'population', 'task_focus', 'industry_context'] as const;
export const LEAF_RISK_LEVELS = ['low', 'medium', 'high'] as const;

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
