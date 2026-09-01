import { type LeafAuthorityKind } from '../runtime/occupation-leaf-structure-contract.js';
import type { CanonicalComparisonQuery } from './types.js';
export type AuthorityKind = LeafAuthorityKind;
export declare function detectAuthorityKind(tokens: readonly string[]): AuthorityKind;
export declare function detectQueryAuthorityKind(comparisonQuery: CanonicalComparisonQuery): AuthorityKind;
export declare function detectCandidateAuthorityKind(canonicalWeakFolded: string): AuthorityKind;
export declare function authorityContradicts(queryAuthority: AuthorityKind, candidateAuthority: AuthorityKind): boolean;
