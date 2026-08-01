export type OccupationSemanticBootstrapContribution = 'help' | 'neutral' | 'hurt';
export type OccupationSemanticBootstrapThresholds = {
    tokenHelpMinOccupationSignal: number;
    tokenHelpMaxPenaltySignal: number;
    tokenHurtMinPenaltySignal: number;
    tokenHurtMaxOccupationSignal: number;
    tokenNeutralNetBand: number;
    phraseHelpMinOccupationSignal: number;
    phraseHelpMaxPenaltySignal: number;
    phraseHurtMinPenaltySignal: number;
    phraseHurtMaxOccupationSignal: number;
    phraseNeutralNetBand: number;
};
export declare const DEFAULT_OCCUPATION_SEMANTIC_BOOTSTRAP_THRESHOLDS: OccupationSemanticBootstrapThresholds;
export declare function computeOccupationBootstrapNetSignal(occupationSignal: number, penaltySignal: number): number;
export declare function classifyOccupationBootstrapTokenContribution(occupationSignal: number, penaltySignal: number, thresholds?: OccupationSemanticBootstrapThresholds): OccupationSemanticBootstrapContribution;
export declare function classifyOccupationBootstrapPhraseContribution(occupationSignal: number, penaltySignal: number, thresholds?: OccupationSemanticBootstrapThresholds): OccupationSemanticBootstrapContribution;
