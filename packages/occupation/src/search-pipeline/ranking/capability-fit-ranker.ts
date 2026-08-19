import type { FamilyScopedPreparedQuery } from '../../query/query-preparation.js';
import { foldSearchText, tokenizeNormalizedText } from '../../utils/texts.js';

export type CapabilityFitTier = 'strong' | 'partial' | 'none';

export type CapabilityFit = {
  tier: CapabilityFitTier;
  tierRank: number;
  coverage: number;
  matchedCapabilityTerms: string[];
  missingCapabilityTerms: string[];
  // Debug-only: how many capability labels were available for this leaf, so tier=none/coverage=0 can be
  // told apart as "no capability data existed" vs "capability data existed but didn't match the query".
  capabilityLabelCount: number;
};

export type CapabilityFitRankerInput = {
  preparedQuery: FamilyScopedPreparedQuery;
  capabilityLabels: string[];
};

export class CapabilityFitRanker {
  public rank(input: CapabilityFitRankerInput): CapabilityFit {
    const queryTokens =
      input.preparedQuery.capabilityVerbFoldedAdditionTokens.length > 0
        ? input.preparedQuery.capabilityVerbFoldedAdditionTokens
        : input.preparedQuery.familyScopedFoldedTokens;
    const capabilityTokenSets = input.capabilityLabels.map((label) => tokenizeNormalizedText(foldSearchText(label)));
    const matchedCapabilityTerms = unique(queryTokens.filter((token) => capabilityTokenSets.some((tokens) => tokens.includes(token))));
    const missingCapabilityTerms = unique(queryTokens.filter((token) => !matchedCapabilityTerms.includes(token)));
    const coverage = queryTokens.length > 0 ? matchedCapabilityTerms.length / queryTokens.length : 0;

    if (queryTokens.length > 0 && matchedCapabilityTerms.length === queryTokens.length) {
      return fit('strong', coverage, matchedCapabilityTerms, missingCapabilityTerms, input.capabilityLabels.length);
    }

    if (matchedCapabilityTerms.length > 0) {
      return fit('partial', coverage, matchedCapabilityTerms, missingCapabilityTerms, input.capabilityLabels.length);
    }

    return fit('none', 0, matchedCapabilityTerms, missingCapabilityTerms, input.capabilityLabels.length);
  }
}

function fit(
  tier: CapabilityFitTier,
  coverage: number,
  matchedCapabilityTerms: string[],
  missingCapabilityTerms: string[],
  capabilityLabelCount: number
): CapabilityFit {
  return {
    tier,
    tierRank: tierRank(tier),
    coverage: clampScore(coverage),
    matchedCapabilityTerms,
    missingCapabilityTerms,
    capabilityLabelCount
  };
}

function tierRank(tier: CapabilityFitTier): number {
  if (tier === 'strong') {
    return 1;
  }

  if (tier === 'partial') {
    return 2;
  }

  return 3;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function clampScore(value: number): number {
  const rounded = Number(Math.max(0, Math.min(1, value)).toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
}
