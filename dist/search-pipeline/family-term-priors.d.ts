export type FamilyTermPriorStrength = 'primary' | 'supporting';
export type FamilyTermPrior = {
    familyNodeId: number;
    familyLabel: string;
    strength: FamilyTermPriorStrength;
};
export declare function getFamilyTermPriors(foldedTokens: Iterable<string>): readonly FamilyTermPrior[];
