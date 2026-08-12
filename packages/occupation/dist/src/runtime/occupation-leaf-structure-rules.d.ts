import { type PreparedQuery } from '../query/query-preparation.js';
import type { LeafAuthorityKind, LeafSpecializationKind } from './occupation-leaf-structure-contract.js';
export declare const LEAF_STRUCTURE_AUTHORITY_ORDER: Array<{
    token: string;
    kind: LeafAuthorityKind;
}>;
export declare const LEAF_STRUCTURE_VENUE_TOKENS: Set<string>;
export declare const LEAF_STRUCTURE_CHANNEL_TOKENS: Set<string>;
export declare const LEAF_STRUCTURE_PRODUCT_TOKENS: Set<string>;
export declare const LEAF_STRUCTURE_POPULATION_TOKENS: Set<string>;
export declare const LEAF_STRUCTURE_TASK_FOCUS_TOKENS: Set<string>;
export declare const LEAF_STRUCTURE_INDUSTRY_CONTEXT_TOKENS: Set<string>;
export declare function detectLeafAuthorityKind(tokens: string[]): LeafAuthorityKind;
export declare function detectLeafSpecializationKinds(tokens: Set<string>): LeafSpecializationKind[];
export declare function preparedQueryStructuralTokenSet(preparedQuery: PreparedQuery): Set<string>;
export declare function preparedQueryRequestsAuthority(preparedQuery: PreparedQuery, authorityKind: LeafAuthorityKind): boolean;
export declare function preparedQuerySupportsSpecializationKind(preparedQuery: PreparedQuery, kind: LeafSpecializationKind): boolean;
export declare function canonicalTokenSet(label: string): Set<string>;
