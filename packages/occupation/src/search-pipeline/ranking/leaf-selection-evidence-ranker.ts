import { evidenceAuthorityRank, type EvidenceAuthorityTier } from '../../scoring/scoring-policy.js';
import type { FamilyScopedLeafFitTier } from './family-scoped-leaf-ranker.js';
import type { CapabilityFitTier } from './capability-fit-ranker.js';

export type LeafSelectionEvidenceTier =
  | 'exact_canonical'
  | 'exact_alias'
  | 'folded_alias'
  | 'strong_phrase'
  | 'alias_aligned'
  | 'capability_aligned'
  | 'weak';

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
  familyScopedFit: LeafSelectionFamilyScopedFit | null;
  capabilityFit: LeafSelectionCapabilityFit | null;
};

export class LeafSelectionEvidenceRanker {
  public rank(input: LeafSelectionEvidenceRankerInput): LeafSelectionEvidence {
    const reasons: string[] = [];
    const exactCanonical = hasEvidence(input.evidence, 'exact_canonical');
    const exactAlias = hasEvidence(input.evidence, 'exact_alias');
    const foldedAlias = hasEvidence(input.evidence, 'folded_alias');
    const strongPhrase = hasStrongPreparedPhraseEvidence(input.evidence) || hasEvidence(input.evidence, 'ngram_alias');
    const capabilityTask = hasEvidence(input.evidence, 'capability_task');

    if (exactCanonical || hasExactCanonical(input.closeness)) {
      reasons.push(exactCanonical ? 'leaf has exact canonical evidence' : 'leaf canonical label exactly matches query');
      return evidence('exact_canonical', reasons);
    }

    if (exactAlias) {
      reasons.push('leaf has exact alias evidence');
      return evidence('exact_alias', reasons);
    }

    if (foldedAlias || hasFoldedCanonical(input.closeness)) {
      reasons.push(foldedAlias ? 'leaf has folded alias evidence' : 'leaf canonical label exactly matches folded query');
      return evidence('folded_alias', reasons);
    }

    if (strongPhrase) {
      reasons.push(
        hasEvidence(input.evidence, 'ngram_alias')
          ? 'leaf has ngram alias evidence'
          : 'leaf has prepared multi-token phrase-window evidence'
      );
      return evidence('strong_phrase', reasons);
    }

    if (input.familyScopedFit?.tier === 'exact' || input.familyScopedFit?.tier === 'alias_aligned') {
      reasons.push(`family-scoped leaf fit is ${input.familyScopedFit.tier}`);
      return evidence('alias_aligned', reasons);
    }

    if (
      capabilityTask ||
      input.familyScopedFit?.tier === 'capability_aligned' ||
      ((input.capabilityFit?.tier === 'strong' || input.capabilityFit?.tier === 'partial') &&
        (input.familyScopedFit?.matchedTerms?.length ?? 0) > 0)
    ) {
      reasons.push(capabilityAlignmentReason(capabilityTask, input.capabilityFit?.tier ?? null));
      return evidence('capability_aligned', reasons);
    }

    reasons.push('leaf has no trusted selection evidence');
    return evidence('weak', reasons);
  }
}

function capabilityAlignmentReason(capabilityTask: boolean, capabilityFitTier: string | null): string {
  if (capabilityFitTier === 'strong') {
    return 'leaf capability labels cover all family-scoped query terms';
  }

  if (capabilityFitTier === 'partial') {
    return 'leaf capability labels cover some family-scoped query terms';
  }

  return capabilityTask ? 'leaf has capability/task retrieval evidence' : 'family-scoped capability labels align with query';
}

function hasEvidence(evidenceRecords: LeafSelectionEvidenceRecord[], channel: string): boolean {
  return evidenceRecords.some((record) => record.channel === channel);
}

function hasStrongPreparedPhraseEvidence(evidenceRecords: LeafSelectionEvidenceRecord[]): boolean {
  return evidenceRecords.some((record) => {
    if (record.channel !== 'lexical') {
      return false;
    }

    const matchedQueries = Array.isArray(record.details.matched_queries) ? record.details.matched_queries : [];

    return matchedQueries.some((query) => typeof query === 'string' && isPreparedPhraseWindowQuery(query));
  });
}

function hasExactCanonical(closeness: LeafSelectionCloseness | null): boolean {
  return Boolean(closeness && closeness.matchedLabelSource === 'canonical' && closeness.exactNormalizedLabel);
}

function hasFoldedCanonical(closeness: LeafSelectionCloseness | null): boolean {
  return Boolean(closeness && closeness.matchedLabelSource === 'canonical' && closeness.exactFoldedLabel);
}

function isPreparedPhraseWindowQuery(value: string): boolean {
  const match = value.match(/^authority_(?:010|020|030|040|050)_prepared_.+_phrase_window_len_(\d+)_idx_\d+$/u);

  return match ? Number.parseInt(match[1] ?? '0', 10) >= 2 : false;
}

function evidence(tier: LeafSelectionEvidenceTier, reasons: string[]): LeafSelectionEvidence {
  return {
    tier,
    tierRank: tierRank(tier),
    reasons
  };
}

// Each local tier maps onto the shared authority hierarchy so cross-file comparisons stay
// consistent (resolution.md #1) instead of each ranker hand-rolling its own numeric scale.
const AUTHORITY_TIER_BY_LOCAL_TIER: Record<LeafSelectionEvidenceTier, EvidenceAuthorityTier> = {
  exact_canonical: 'exact_canonical',
  exact_alias: 'raw_exact_alias',
  folded_alias: 'folded_alias',
  strong_phrase: 'role_aligned_phrase',
  alias_aligned: 'role_aligned_lexical',
  capability_aligned: 'capability_aligned',
  weak: 'weak'
};

function tierRank(tier: LeafSelectionEvidenceTier): number {
  return evidenceAuthorityRank(AUTHORITY_TIER_BY_LOCAL_TIER[tier]);
}

export function leafSelectionEvidenceTierRank(tier: LeafSelectionEvidenceTier): number {
  return tierRank(tier);
}
