import { longestContiguousTokenMatch, type FamilyScopedPreparedQuery } from '../../query/query-preparation.js';
import { evidenceAuthorityRank, type EvidenceAuthorityTier } from '../../scoring/scoring-policy.js';
import { foldSearchText, tokenizeNormalizedText } from '../../utils/texts.js';

export type FamilyScopedLeafFitTier = 'exact' | 'alias_aligned' | 'capability_aligned' | 'lexical_related' | 'weak';

export type FamilyScopedLeafFit = {
  tier: FamilyScopedLeafFitTier;
  tierRank: number;
  reasons: string[];
  matchedTerms: string[];
  missingTerms: string[];
  matchedCapabilityTerms: string[];
};

export type FamilyScopedLeafRankerInput = {
  preparedQuery: FamilyScopedPreparedQuery;
  canonicalLabel: string;
  aliases: string[];
  capabilityLabels: string[];
};

export class FamilyScopedLeafRanker {
  public rank(input: FamilyScopedLeafRankerInput): FamilyScopedLeafFit {
    const queryTokens = input.preparedQuery.familyScopedFoldedTokens;
    const labels = [input.canonicalLabel, ...input.aliases].filter((label) => label.trim().length > 0);
    const labelTokenSets = labels.map((label) => tokenizeNormalizedText(foldSearchText(label)));
    const capabilityTokenSets = input.capabilityLabels.map((label) => tokenizeNormalizedText(foldSearchText(label)));
    const matchedTerms = unique(queryTokens.filter((token) => labelTokenSets.some((labelTokens) => labelTokens.includes(token))));
    const missingTerms = unique(queryTokens.filter((token) => !matchedTerms.includes(token)));
    const matchedCapabilityTerms = unique(
      queryTokens.filter((token) => capabilityTokenSets.some((capabilityTokens) => capabilityTokens.includes(token)))
    );
    const exactLabel = labels.some((label) => foldSearchText(label) === input.preparedQuery.folded);
    const longestLabelMatch = Math.max(
      ...labelTokenSets.map((labelTokens) => longestContiguousTokenMatch(labelTokens, queryTokens, input.preparedQuery.locale).length),
      0
    );
    const reasons: string[] = [];

    if (exactLabel) {
      reasons.push('exact family-scoped canonical or alias match');
      return fit('exact', reasons, matchedTerms, missingTerms, matchedCapabilityTerms);
    }

    if (queryTokens.length > 0 && matchedTerms.length === queryTokens.length) {
      reasons.push('all family-scoped query terms matched canonical or alias text');
      return fit('alias_aligned', reasons, matchedTerms, missingTerms, matchedCapabilityTerms);
    }

    if (matchedCapabilityTerms.length > 0 && matchedTerms.length > 0) {
      reasons.push('family-scoped query terms matched both title/alias and capability text');
      return fit('capability_aligned', reasons, matchedTerms, missingTerms, matchedCapabilityTerms);
    }

    if (longestLabelMatch > 0 || matchedTerms.length > 0 || matchedCapabilityTerms.length > 0) {
      reasons.push('some family-scoped lexical overlap found');
      return fit('lexical_related', reasons, matchedTerms, missingTerms, matchedCapabilityTerms);
    }

    reasons.push('no family-scoped leaf fit evidence found');
    return fit('weak', reasons, matchedTerms, missingTerms, matchedCapabilityTerms);
  }
}

function fit(
  tier: FamilyScopedLeafFitTier,
  reasons: string[],
  matchedTerms: string[],
  missingTerms: string[],
  matchedCapabilityTerms: string[]
): FamilyScopedLeafFit {
  return {
    tier,
    tierRank: tierRank(tier),
    reasons,
    matchedTerms,
    missingTerms,
    matchedCapabilityTerms
  };
}

// Each local tier maps onto the shared authority hierarchy so cross-file comparisons stay
// consistent (resolution.md #1) instead of each ranker hand-rolling its own numeric scale.
const AUTHORITY_TIER_BY_LOCAL_TIER: Record<FamilyScopedLeafFitTier, EvidenceAuthorityTier> = {
  exact: 'exact_canonical',
  alias_aligned: 'raw_exact_alias',
  capability_aligned: 'capability_aligned',
  lexical_related: 'role_aligned_lexical',
  weak: 'weak'
};

function tierRank(tier: FamilyScopedLeafFitTier): number {
  return evidenceAuthorityRank(AUTHORITY_TIER_BY_LOCAL_TIER[tier]);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}
