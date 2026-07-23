export type JobFunctionFamilyPriorStrength = 'primary' | 'supporting';
export type JobFunctionFamilyPrior = {
    familyNodeId: number;
    familyLabel: string;
    strength: JobFunctionFamilyPriorStrength;
};
export declare function normalizeJobFunction(value: string | undefined): string | null;
export declare function getJobFunctionFamilyPriors(value: string | undefined): readonly JobFunctionFamilyPrior[];
export declare function isKnownJobFunction(value: string | undefined): boolean;
