import { foldWeakPunctuationLookupText } from '../utils/texts.js';
import { ESCO_FAMILY_ISCO_DIGITS, ESCO_ISCO_URI_PREFIX } from './config.js';
import { comparisonTokens, labelVariants } from './preparation.js';
import type {
  EscoApiLocale,
  EscoLabelSource,
  EscoSearchHit,
  EscoTerm,
  FamilyLabelCandidate,
  LabelMatch,
  LabelRelation,
  OccupationCandidate,
  PreparedSpan,
  SpanEvidence
} from './types.js';

type TypedLabel = { label: string; source: EscoLabelSource };

export const RELATION_RANK: Record<LabelRelation, number> = {
  equal: 4,
  query_contains_label: 3,
  label_contains_query: 2,
  partial: 1
};

export const LABEL_SOURCE_RANK: Record<EscoLabelSource, number> = {
  preferred: 3,
  alternative: 2,
  hidden: 1
};

export function buildSpanEvidence(
  span: PreparedSpan,
  language: EscoApiLocale,
  hits: EscoSearchHit[],
  terms: EscoTerm[]
): SpanEvidence {
  const termLabelsByConcept = new Map<string, TypedLabel[]>();

  for (const term of terms) {
    const labels = termLabelsByConcept.get(term.conceptUri) ?? [];
    labels.push({ label: term.literalForm, source: term.labelSource });
    termLabelsByConcept.set(term.conceptUri, labels);
  }

  const candidates = hits.map((hit, searchRank): OccupationCandidate => {
    const labels: TypedLabel[] = [
      { label: hit.title, source: 'preferred' },
      ...(hit.preferredLabels[language] ? [{ label: hit.preferredLabels[language], source: 'preferred' as const }] : []),
      ...(termLabelsByConcept.get(hit.uri) ?? [])
    ];

    return {
      uri: hit.uri,
      code: hit.code,
      familyUri: familyUriFromCode(hit.code),
      label: hit.preferredLabels.en ?? hit.title,
      localLabel: hit.title,
      searchRank,
      searchHit: hit.searchHit,
      match: bestLabelMatch(span, language, labels)
    };
  });

  const familyLabelCandidates = terms.flatMap((term): FamilyLabelCandidate[] => {
    if (!term.conceptUri.startsWith(ESCO_ISCO_URI_PREFIX)) {
      return [];
    }

    const code = term.conceptUri.slice(ESCO_ISCO_URI_PREFIX.length);
    const familyUri = familyUriFromCode(code);
    const match = bestLabelMatch(span, language, [{ label: term.literalForm, source: term.labelSource }]);

    return familyUri && match ? [{ uri: term.conceptUri, code, familyUri, match }] : [];
  });

  return { candidates, familyLabelCandidates };
}

export function familyUriFromCode(code: string): string | null {
  const iscoDigits = code.split('.')[0] ?? '';

  if (!/^\d+$/u.test(iscoDigits) || iscoDigits.length < ESCO_FAMILY_ISCO_DIGITS) {
    return null;
  }

  return `${ESCO_ISCO_URI_PREFIX}${iscoDigits.slice(0, ESCO_FAMILY_ISCO_DIGITS)}`;
}

export function compareLabelMatches(left: LabelMatch, right: LabelMatch): number {
  return (
    RELATION_RANK[right.relation] - RELATION_RANK[left.relation] ||
    Number(right.literalEqual) - Number(left.literalEqual) ||
    right.overlap - left.overlap ||
    LABEL_SOURCE_RANK[right.source] - LABEL_SOURCE_RANK[left.source]
  );
}

function bestLabelMatch(span: PreparedSpan, language: EscoApiLocale, labels: TypedLabel[]): LabelMatch | null {
  let best: LabelMatch | null = null;

  for (const { label, source } of labels) {
    for (const variant of labelVariants(label)) {
      const match = matchLabel(span, language, variant, source);

      if (match && (!best || compareLabelMatches(match, best) < 0)) {
        best = match;
      }
    }
  }

  return best;
}

function matchLabel(span: PreparedSpan, language: EscoApiLocale, label: string, source: EscoLabelSource): LabelMatch | null {
  const foldedLabel = foldWeakPunctuationLookupText(label);
  const labelTokens = new Set(comparisonTokens(foldedLabel, language));
  const queryTokens = new Set(span.tokens);
  const matchedTokens = [...queryTokens].filter((token) => labelTokens.has(token));

  if (matchedTokens.length === 0) {
    return null;
  }

  const missingTokens = [...queryTokens].filter((token) => !labelTokens.has(token));
  const extraTokenCount = labelTokens.size - matchedTokens.length;

  return {
    label,
    source,
    relation: labelRelation(missingTokens.length, extraTokenCount),
    literalEqual: foldedLabel === span.folded,
    overlap: matchedTokens.length / (queryTokens.size + extraTokenCount),
    matchedTokens,
    missingTokens
  };
}

function labelRelation(missingTokenCount: number, extraTokenCount: number): LabelRelation {
  if (missingTokenCount === 0 && extraTokenCount === 0) {
    return 'equal';
  }

  if (extraTokenCount === 0) {
    return 'query_contains_label';
  }

  if (missingTokenCount === 0) {
    return 'label_contains_query';
  }

  return 'partial';
}
