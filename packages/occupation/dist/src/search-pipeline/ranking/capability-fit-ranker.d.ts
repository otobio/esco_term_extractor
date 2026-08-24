export type CapabilityFitTier = 'strong' | 'partial' | 'none';
export type CapabilityFit = {
    tier: CapabilityFitTier;
    tierRank: number;
    coverage: number;
    matchedCapabilityTerms: string[];
    missingCapabilityTerms: string[];
    capabilityLabelCount: number;
};
export type CapabilityFitRankerInput = {
    familyScopedFoldedTokens: string[];
    capabilityVerbFoldedAdditionTokens: string[];
    capabilityLabels: string[];
};
export declare class CapabilityFitRanker {
    rank(input: CapabilityFitRankerInput): CapabilityFit;
}
