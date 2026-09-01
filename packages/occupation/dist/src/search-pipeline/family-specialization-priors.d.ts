export type FamilySpecializationPriorStrength = 'primary' | 'supporting';
export type FamilySpecializationPrior = {
    familyNodeId: number;
    familyLabel: string;
    strength: FamilySpecializationPriorStrength;
};
export declare function getFamilySpecializationPriors(foldedTokens: Iterable<string>): readonly FamilySpecializationPrior[];
