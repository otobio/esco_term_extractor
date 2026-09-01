export type SpecializationConceptRule = {
    conceptId: string;
    canonical: string;
};
export type SpecializationConceptAliasRule = {
    conceptId: string;
    alias: string;
    weakFoldedAlias: string;
    aliasTokens: readonly string[];
    priority: number;
    concept: SpecializationConceptRule;
};
export type SpecializationSchemaLookup = {
    conceptAliasesByFirstToken: ReadonlyMap<string, readonly SpecializationConceptAliasRule[]>;
    roleHeadAliasesByLocalToken: ReadonlyMap<string, readonly string[]>;
    maxConceptAliasTokenCount: number;
    maxRoleHeadAliasTokenCount: number;
};
export declare function loadSpecializationSchemaLookup(locale?: string): Promise<SpecializationSchemaLookup>;
