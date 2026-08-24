import type { PreparedQuery } from '../query/query-preparation.js';
import type { LeafAuthorityKind, LeafSpecializationKind } from './occupation-leaf-structure-contract.js';
import type { RuntimeCapabilityRecord } from './occupation-search-meta-artifact.js';
export declare const LEAF_LEVEL_KINDS: readonly ["none", "assistant", "junior", "senior", "lead", "supervisor", "manager", "director", "chief"];
export type LeafLevelKind = (typeof LEAF_LEVEL_KINDS)[number];
export declare const LEAF_STRUCTURE_AUTHORITY_ORDER: Array<{
    token: string;
    kind: LeafAuthorityKind;
}>;
export declare const LEVEL_SPECIALIZATION_SYNONYMS: Record<LeafLevelKind, string[]>;
export declare const ATOMIC_SPECIALIZATION_SYNONYMS: Record<LeafSpecializationKind, Record<string, string[]>>;
export declare const __ATOMIC_SPECIALIZATION_SYNONYMS: Record<LeafSpecializationKind, Record<string, string[]>>;
export declare const LEAF_STRUCTURE_TOKENS_BY_KIND: Record<"channel" | "venue" | "product" | "population" | "task_focus" | "industry_context", Set<string>>;
export declare const LEAF_STRUCTURE_VENUE_TOKENS: Set<string>;
export declare const LEAF_STRUCTURE_CHANNEL_TOKENS: Set<string>;
export declare const LEAF_STRUCTURE_PRODUCT_TOKENS: Set<string>;
export declare const LEAF_STRUCTURE_POPULATION_TOKENS: Set<string>;
export declare const LEAF_STRUCTURE_TASK_FOCUS_TOKENS: Set<string>;
export declare const LEAF_STRUCTURE_INDUSTRY_CONTEXT_TOKENS: Set<string>;
export declare function specializationKindAlignedWithQuery(kind: LeafSpecializationKind, canonicalTokens: Set<string>, preparedQuery: PreparedQuery): boolean;
export declare function specializationKindImpliedByQueryVenue(kind: LeafSpecializationKind, canonicalTokens: Set<string>, preparedQuery: PreparedQuery): boolean;
export declare function specializationKindSupportedByCapabilities(kind: LeafSpecializationKind, preparedQuery: PreparedQuery, capabilityLabels: RuntimeCapabilityRecord[]): boolean;
export declare function detectLeafAuthorityKind(tokens: string[]): LeafAuthorityKind;
export declare function detectLeafSpecializationKinds(tokens: Set<string>): LeafSpecializationKind[];
export declare function detectLeafLevelKind(tokens: Set<string>): LeafLevelKind;
export declare function resolveLeafSpecializationKindsFromTokens(cache: Map<number, LeafSpecializationKind[]>, graphNodeId: number, structure: {
    specializationKinds: LeafSpecializationKind[];
} | null, tokens: Set<string>): LeafSpecializationKind[];
export declare function resolveLeafSpecializationKinds(cache: Map<number, LeafSpecializationKind[]>, graphNodeId: number, structure: {
    specializationKinds: LeafSpecializationKind[];
} | null, canonicalLabel: string): LeafSpecializationKind[];
export declare function preparedQueryStructuralTokenSet(preparedQuery: PreparedQuery): Set<string>;
export declare function preparedQueryRequestsAuthority(preparedQuery: PreparedQuery, authorityKind: LeafAuthorityKind): boolean;
export declare function preparedQuerySpecializationTokensForFamily(preparedQuery: PreparedQuery, familySharedTokens: Set<string>): Set<string>;
export declare function preparedQuerySupportsSpecializationKind(preparedQuery: PreparedQuery, kind: LeafSpecializationKind, familySharedTokens?: Set<string>): boolean;
export declare function canonicalTokenSet(label: string): Set<string>;
