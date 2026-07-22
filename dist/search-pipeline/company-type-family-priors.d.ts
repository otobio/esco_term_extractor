export type CompanyTypeFamilyPriorStrength = 'primary' | 'supporting';
export type CompanyTypeFamilyPrior = {
    familyNodeId: number;
    familyLabel: string;
    strength: CompanyTypeFamilyPriorStrength;
};
export declare function normalizeCompanyType(value: string | undefined): string | null;
export declare function getCompanyTypeFamilyPriors(value: string | undefined): readonly CompanyTypeFamilyPrior[];
export declare function isKnownCompanyType(value: string | undefined): boolean;
