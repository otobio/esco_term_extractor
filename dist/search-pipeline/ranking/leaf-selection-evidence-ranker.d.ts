export type LeafSelectionEvidenceTier = 'exact_alias' | 'folded_alias' | 'strong_phrase' | 'alias_aligned' | 'capability_aligned' | 'semantic_aligned' | 'dense_only' | 'weak';
export type LeafSelectionEvidence = {
    tier: LeafSelectionEvidenceTier;
    tierRank: number;
    reasons: string[];
};
export type LeafSelectionEvidenceRecord = {
    channel: string;
    details: Record<string, unknown>;
};
export type LeafSelectionCloseness = {
    exactNormalizedLabel: boolean;
    exactFoldedLabel: boolean;
};
export type LeafSelectionFamilyScopedFit = {
    tier: string;
    matchedTerms?: string[];
};
export type LeafSelectionCapabilityFit = {
    tier: string;
};
export type LeafSelectionEvidenceRankerInput = {
    evidence: LeafSelectionEvidenceRecord[];
    closeness: LeafSelectionCloseness | null;
    familyScopedFit: LeafSelectionFamilyScopedFit | null;
    capabilityFit: LeafSelectionCapabilityFit | null;
};
export declare class LeafSelectionEvidenceRanker {
    rank(input: LeafSelectionEvidenceRankerInput): LeafSelectionEvidence;
}
