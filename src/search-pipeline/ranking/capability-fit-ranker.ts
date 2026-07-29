import { foldSearchText, tokenizeNormalizedText, type FamilyScopedPreparedQuery } from '../../query/query-preparation.js';

export type CapabilityFitTier = 'strong' | 'partial' | 'none';

export type CapabilityFit = {
  tier: CapabilityFitTier;
  tierRank: number;
  coverage: number;
  matchedCapabilityTerms: string[];
  missingCapabilityTerms: string[];
};

export type CapabilityFitRankerInput = {
  preparedQuery: FamilyScopedPreparedQuery;
  capabilityLabels: string[];
};

export class CapabilityFitRanker {
  public rank(input: CapabilityFitRankerInput): CapabilityFit {
    const queryTokens = input.preparedQuery.familyScopedFoldedTokens;
    const capabilityTokenSets = input.capabilityLabels.map((label) => tokenizeNormalizedText(foldSearchText(label)));
    const matchedCapabilityTerms = unique(queryTokens.filter((token) => capabilityTokenSets.some((tokens) => tokens.includes(token))));
    const missingCapabilityTerms = unique(queryTokens.filter((token) => !matchedCapabilityTerms.includes(token)));
    const coverage = queryTokens.length > 0 ? matchedCapabilityTerms.length / queryTokens.length : 0;

    if (queryTokens.length > 0 && matchedCapabilityTerms.length === queryTokens.length) {
      return fit('strong', coverage, matchedCapabilityTerms, missingCapabilityTerms);
    }

    if (matchedCapabilityTerms.length > 0) {
      return fit('partial', coverage, matchedCapabilityTerms, missingCapabilityTerms);
    }

    return fit('none', 0, matchedCapabilityTerms, missingCapabilityTerms);
  }
}

function fit(tier: CapabilityFitTier, coverage: number, matchedCapabilityTerms: string[], missingCapabilityTerms: string[]): CapabilityFit {
  return {
    tier,
    tierRank: tierRank(tier),
    coverage: clampScore(coverage),
    matchedCapabilityTerms,
    missingCapabilityTerms
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
