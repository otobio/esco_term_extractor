export declare const CANONICAL_ALIAS_ROLE = "canonical_label";
export declare const FAMILY_SUPPORTING_ALIAS_ROLE = "family_supporting";
export declare const DEFAULT_SEARCH_ALIAS_ROLES: Set<string>;
export declare function isSearchAliasRole(aliasRole: string, includeFamilySupportingAliases: boolean): boolean;
export declare function aliasRoleScoreFactor(aliasRole: string): number;
