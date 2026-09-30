import type { TimingMap } from '../utils/timing.js';
import type { EscoApiClient } from './client.js';
import type { ESCO_API_LOCALES } from './config.js';

export type EscoApiLocale = (typeof ESCO_API_LOCALES)[number];

export type EscoApiClassificationInput = {
  query: string;
  locale: string;
  client?: EscoApiClient;
};

export type EscoSearchHit = {
  uri: string;
  code: string;
  title: string;
  preferredLabels: Record<string, string>;
  searchHit: string | null;
};

export type EscoLabelSource = 'preferred' | 'alternative' | 'hidden';

export type EscoTerm = {
  conceptUri: string;
  literalForm: string;
  labelSource: EscoLabelSource;
};

export type EscoIscoGroup = {
  uri: string;
  code: string;
  label: string;
  localLabel: string;
};

export type PreparedSpan = {
  text: string;
  folded: string;
  tokens: string[];
};

export type LabelRelation = 'equal' | 'query_contains_label' | 'label_contains_query' | 'partial';

export type LabelMatch = {
  label: string;
  source: EscoLabelSource;
  relation: LabelRelation;
  literalEqual: boolean;
  overlap: number;
  matchedTokens: string[];
  missingTokens: string[];
};

export type OccupationCandidate = {
  uri: string;
  code: string;
  familyUri: string | null;
  label: string;
  localLabel: string;
  searchRank: number;
  searchHit: string | null;
  match: LabelMatch | null;
};

export type FamilyLabelCandidate = {
  uri: string;
  code: string;
  familyUri: string;
  match: LabelMatch;
};

export type SpanEvidence = {
  candidates: OccupationCandidate[];
  familyLabelCandidates: FamilyLabelCandidate[];
};

export type EscoDecisionReason =
  | 'empty_query'
  | 'multi_span'
  | 'exact_preferred_label_leaf'
  | 'exact_alternative_label_leaf'
  | 'exact_hidden_label_leaf'
  | 'exact_family_label'
  | 'family_dictionary_gap'
  | 'family_leaf_ambiguity'
  | 'unresolved_weak_evidence'
  | 'unresolved_no_candidates';

export type EscoDecision = {
  type: 'leaf' | 'family' | 'multi_span' | 'unresolved';
  reason: EscoDecisionReason;
  confidence: number;
};

export type EscoCoverage = {
  matchedTokens: string[];
  missingTokens: string[];
};

export type SpanDecision = {
  decision: EscoDecision;
  leaf: OccupationCandidate | null;
  familyUri: string | null;
  altLeaves: OccupationCandidate[];
  altFamilies: FamilyShare[];
  coverage: EscoCoverage;
};

export type FamilyShare = { familyUri: string; confidence: number };

export type EscoLeaf = {
  uri: string;
  code: string;
  label: string;
  localLabel: string;
  familyUri: string | null;
  matchedLabel: string | null;
  matchedLabelSource: EscoLabelSource | null;
  confidence: number;
};

export type EscoFamily = {
  uri: string;
  code: string;
  label: string;
  localLabel: string;
  confidence: number;
};

export type EscoApiClassification = {
  decision: EscoDecision;
  leaf: EscoLeaf | null;
  family: EscoFamily | null;
  altLeaves: EscoLeaf[];
  altFamilies: EscoFamily[];
  coverage: EscoCoverage;
  evidenceLanguage: EscoApiLocale | null;
  spans?: Array<{ query: string; result: EscoApiClassification }>;
};

export type EscoApiSpanDebug = {
  query: string;
  evidenceLanguage: EscoApiLocale;
  candidates: OccupationCandidate[];
  familyLabelCandidates: FamilyLabelCandidate[];
  timings: TimingMap;
};

export type EscoApiClassificationDebug = {
  result: EscoApiClassification;
  spans: EscoApiSpanDebug[];
};
