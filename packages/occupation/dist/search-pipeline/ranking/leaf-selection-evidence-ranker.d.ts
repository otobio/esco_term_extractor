import type { FamilyScopedLeafFitTier } from './family-scoped-leaf-ranker.js';
import type { CapabilityFitTier } from './capability-fit-ranker.js';
export type LeafSelectionEvidenceTier = 'exact_canonical' | 'exact_alias' | 'useful_exact' | 'folded_alias' | 'strong_phrase' | 'alias_aligned' | 'capability_aligned' | 'weak';
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
    matchedLabelSource: 'canonical' | 'alias';
    exactNormalizedLabel: boolean;
    exactFoldedLabel: boolean;
};
export type LeafSelectionFamilyScopedFit = {
    tier: FamilyScopedLeafFitTier;
    matchedTerms?: string[];
};
export type LeafSelectionCapabilityFit = {
    tier: CapabilityFitTier;
};
export type LeafSelectionEvidenceRankerInput = {
    evidence: LeafSelectionEvidenceRecord[];
    closeness: LeafSelectionCloseness | null;
    usefulExactLabel: boolean;
    familyScopedFit: LeafSelectionFamilyScopedFit | null;
    capabilityFit: LeafSelectionCapabilityFit | null;
};
export declare class LeafSelectionEvidenceRanker {
    rank(input: LeafSelectionEvidenceRankerInput): LeafSelectionEvidence;
}
export declare function leafSelectionEvidenceTierRank(tier: LeafSelectionEvidenceTier): number;
