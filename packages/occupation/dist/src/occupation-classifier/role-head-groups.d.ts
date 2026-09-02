import { type LeafLevelKind } from '../runtime/occupation-leaf-structure-rules.js';
export declare const STRICTLY_RANK_ONLY_ROLE_HEAD_GROUPS: Record<string, readonly string[]>;
export declare const BROAD_SIMILARITY_ROLE_HEAD_GROUPS: Record<string, readonly string[]>;
export declare const RETRIEVAL_ONLY_NOISY_ROLE_HEAD_TOKENS: Set<string>;
export declare const VAGUE_ROLE_HEAD_TOKENS: Set<string>;
export declare function isRankRoleHead(token: string, mode: 'authority' | 'non-authority' | 'pure'): boolean;
export declare function isAuthorityTier(levelKind: LeafLevelKind): boolean;
export declare function leafAuthorityLevelKindsContradict(queryLevelKind: LeafLevelKind, leafLevelKind: LeafLevelKind): boolean;
export declare const ROLE_HEAD_SPELLING_VARIANTS: readonly (readonly string[])[];
type StructuralContextRoleHeadInferenceRule = {
    familyNodeId: number;
    familyLabel: string;
    roleHeads: readonly string[];
    authorityLevels: readonly LeafLevelKind[];
    conceptsByDimension: ReadonlyMap<string, readonly string[]>;
};
export type InferredRoleHeadFromStructuralContext = {
    roleHead: string;
    familyNodeId: number;
    familyLabel: string;
    matchedConceptIds: readonly string[];
    matchScore: number;
};
export declare function expandRoleHeadSpellingVariants(tokens: readonly string[]): string[];
export declare function selectStrongRoleHeads(roleHeads: readonly string[]): string[];
export declare function inferRoleHeadsFromStructuralContext(input: {
    authority: LeafLevelKind;
    roleHeads: readonly string[];
    conceptIdsByDimension: ReadonlyMap<string, readonly string[]>;
    familyRules: readonly StructuralContextRoleHeadInferenceRule[];
}): InferredRoleHeadFromStructuralContext[];
export declare function isKnownRoleHeadWord(token: string): boolean;
export declare function roleHeadsAreBroadlySimilar(left: string, right: string): boolean;
export declare function sharesRoleHeadGroup(queryTokens: readonly string[], candidateTokens: readonly string[]): boolean;
export declare function expandRoleHeadGroupTerms(tokens: readonly string[]): string[];
export {};
