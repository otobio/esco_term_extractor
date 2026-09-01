export type GenericHeadFamilyPriorStrength = 'primary' | 'supporting';
export type GenericHeadFamilyPrior = {
    familyNodeId: number;
    familyLabel: string;
    strength: GenericHeadFamilyPriorStrength;
};
export declare function getGenericHeadFamilyPriors(roleHeadTokens: string[], roleTokens: string[], venueTokens: string[], hasCuratedRolePhrase: boolean): readonly GenericHeadFamilyPrior[];
export declare function hasGenericHeadVenueContext(roleTokens: string[], venueTokens: string[]): boolean;
export declare function getGenericHeadFamilyContradiction(roleHeadTokens: string[], roleTokens: string[], venueTokens: string[], hasCuratedRolePhrase: boolean, familyNodeId: number): boolean;
