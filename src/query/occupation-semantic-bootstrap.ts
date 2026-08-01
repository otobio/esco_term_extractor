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

export const DEFAULT_OCCUPATION_SEMANTIC_BOOTSTRAP_THRESHOLDS: OccupationSemanticBootstrapThresholds = {
  tokenHelpMinOccupationSignal: 0.65,
  tokenHelpMaxPenaltySignal: 0.35,
  tokenHurtMinPenaltySignal: 0.75,
  tokenHurtMaxOccupationSignal: 0.25,
  tokenNeutralNetBand: 0.15,
  phraseHelpMinOccupationSignal: 0.72,
  phraseHelpMaxPenaltySignal: 0.28,
  phraseHurtMinPenaltySignal: 0.68,
  phraseHurtMaxOccupationSignal: 0.25,
  phraseNeutralNetBand: 0.15
};

export function computeOccupationBootstrapNetSignal(occupationSignal: number, penaltySignal: number): number {
  return occupationSignal - penaltySignal;
}

export function classifyOccupationBootstrapTokenContribution(
  occupationSignal: number,
  penaltySignal: number,
  thresholds: OccupationSemanticBootstrapThresholds = DEFAULT_OCCUPATION_SEMANTIC_BOOTSTRAP_THRESHOLDS
): OccupationSemanticBootstrapContribution {
  const netSignal = computeOccupationBootstrapNetSignal(occupationSignal, penaltySignal);

  if (
    penaltySignal >= thresholds.tokenHurtMinPenaltySignal &&
    occupationSignal <= thresholds.tokenHurtMaxOccupationSignal &&
    netSignal <= -thresholds.tokenNeutralNetBand
  ) {
    return 'hurt';
  }

  if (occupationSignal >= thresholds.tokenHelpMinOccupationSignal && penaltySignal <= thresholds.tokenHelpMaxPenaltySignal) {
    return 'help';
  }

  return 'neutral';
}

export function classifyOccupationBootstrapPhraseContribution(
  occupationSignal: number,
  penaltySignal: number,
  thresholds: OccupationSemanticBootstrapThresholds = DEFAULT_OCCUPATION_SEMANTIC_BOOTSTRAP_THRESHOLDS
): OccupationSemanticBootstrapContribution {
  const netSignal = computeOccupationBootstrapNetSignal(occupationSignal, penaltySignal);

  if (
    penaltySignal >= thresholds.phraseHurtMinPenaltySignal &&
    occupationSignal <= thresholds.phraseHurtMaxOccupationSignal &&
    netSignal <= -thresholds.phraseNeutralNetBand
  ) {
    return 'hurt';
  }

  if (occupationSignal >= thresholds.phraseHelpMinOccupationSignal && penaltySignal <= thresholds.phraseHelpMaxPenaltySignal) {
    return 'help';
  }

  return 'neutral';
}

