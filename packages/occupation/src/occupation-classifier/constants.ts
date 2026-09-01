import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';

export const DEFAULT_CLASSIFIER_SOURCE_NAME = DEFAULT_ESCO_SOURCE_NAME;

export const EXACT_CANONICAL_LIMIT = 20;
export const EXACT_ALIAS_LIMIT = 20;
export const PRIMARY_RECALL_LIMIT = 80;
export const SECONDARY_RECALL_LIMIT = 40;
export const MIN_RECALL_CANDIDATES = 12;
export const MAX_MERGED_CANDIDATES = 250;
// Weak, bare-word-matchable channels (subphrase/ngram alias matches) can flood recall with generic
// overlaps ("manager", "designer") that all rank as real alias evidence. Capping how many of each
// channel's rows are promoted into evidence keeps only their strongest hits without discarding the
// channel entirely -- phrase-window subphrase matches still surface, just not at flood volume.
export const SUBPHRASE_ALIAS_EVIDENCE_LIMIT = 15;
export const NGRAM_ALIAS_EVIDENCE_LIMIT = 8;
export const MAX_FAMILIES_TO_VALIDATE = 16;
export const MAX_DEBUG_REJECTED = 30;

export const CLASSIFIER_RECALL_LIMITS = {
  exactCanonical: EXACT_CANONICAL_LIMIT,
  exactAlias: EXACT_ALIAS_LIMIT,
  primary: PRIMARY_RECALL_LIMIT,
  secondary: SECONDARY_RECALL_LIMIT,
  minPrimary: MIN_RECALL_CANDIDATES,
  maxMerged: MAX_MERGED_CANDIDATES
} as const;

export type ClassifierRecallLimits = typeof CLASSIFIER_RECALL_LIMITS;
