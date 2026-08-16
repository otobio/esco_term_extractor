export declare const OPENSEARCH_AUTHORITY_SCORE: {
    readonly PREPARED_PRIMARY_PHRASE: 1000;
    readonly PREPARED_CANONICAL_PHRASE: 900;
    readonly PREPARED_SUPPORTING_PHRASE: 800;
    readonly PREPARED_REVIEWED_PHRASE: 700;
    readonly PREPARED_FAMILY_SUPPORT_PHRASE: 650;
    readonly PREPARED_BACKBONE_PHRASE: 600;
    readonly RAW_PRIMARY_OR_CANONICAL_PHRASE: 500;
    readonly RAW_SUPPORTING_OR_REVIEWED_PHRASE: 400;
    readonly PREPARED_ALL_TERMS: 250;
    readonly STRICT_FUZZY: 80;
    readonly RAW_ALL_TERMS: 60;
};
export declare const OPENSEARCH_PHRASE_WINDOW_POLICY: {
    readonly TOKEN_AUTHORITY_INCREMENT: 10;
    readonly MAX_TOKEN_AUTHORITY_BONUS: 90;
};
export declare const OPENSEARCH_LEXICAL_SIGNAL_POLICY: {
    readonly BASE_SIGNAL: 0.1;
    readonly USEFUL_COVERAGE_WEIGHT: 0.65;
    readonly FIELD_STRENGTH_WEIGHT: 0.2;
    readonly PHRASE_MATCH_BONUS: 0.18;
    readonly SHORT_NON_PHRASE_CAP: 0.35;
    readonly MIN_SIGNAL: 0.05;
};
export declare const OPENSEARCH_FIELD_STRENGTH: {
    readonly TITLE: 1;
    readonly ALIAS: 0.9;
    readonly SEARCH_TEXT: 0.75;
    readonly CAPABILITY: 0.7;
    readonly FAMILY_ALIAS: 0.6;
    readonly ANCESTOR: 0.45;
};
export declare const RETRIEVAL_CANDIDATE_CHANNEL_WEIGHT: {
    readonly EXACT_CANONICAL: 12;
    readonly EXACT_ALIAS: 10;
    readonly FOLDED_ALIAS: 7;
    readonly NGRAM_ALIAS: 5;
    readonly OPENSEARCH_LEXICAL: 4;
    readonly CAPABILITY_TASK: 2;
    readonly DENSE_EMBEDDING: 2;
};
export declare const ALIAS_MATCH_POLICY: {
    readonly FOLDED_EXACT_DISCOUNT: 0.85;
    readonly ALTERNATIVE_EXACT_SUBPHRASE_SCORE: 0.82;
    readonly MULTI_TOKEN_PHRASE_BASE: 0.66;
    readonly SINGLE_TOKEN_PHRASE_BASE: 0.5;
    readonly COVERAGE_CONTRIBUTION: 0.1;
    readonly LONGEST_MATCH_TOKEN_BONUS: 0.08;
    readonly MAX_LONGEST_MATCH_TOKENS: 4;
    readonly MAX_SUBPHRASE_SCORE: 0.9;
};
export declare const CAPABILITY_TASK_POLICY: {
    readonly BASE_ALIGNMENT: 0.35;
    readonly COVERAGE_ALIGNMENT_WEIGHT: 0.65;
};
export declare const PIPELINE_DECISION_GATE: {
    readonly FAMILY_CONFIDENCE: 0.5;
    readonly LEAF_STANDARD_CONFIDENCE: 0.72;
    readonly LEAF_STANDARD_DIRECT_EVIDENCE: 0.55;
    readonly LEAF_STANDARD_FAMILY_CONFIDENCE: 0.58;
    readonly LEAF_EXACT_USEFUL_CONFIDENCE: 0.8;
    readonly LEAF_EXACT_USEFUL_DIRECT_EVIDENCE: 0.55;
    readonly LEAF_EXACT_USEFUL_FAMILY_CONFIDENCE: 0.5;
    readonly LEAF_EXACT_USEFUL_MAX_EXTRA_TOKEN_RATIO: 0.2;
    readonly SYNONYM_FALLBACK_FAMILY_CONFIDENCE: 0.55;
    readonly SYNONYM_FALLBACK_LEAF_CONFIDENCE: 0.72;
    readonly FALLBACK_REPLACEMENT_MARGIN: 0.08;
    readonly AMBIGUOUS_ALIAS_TIE_MARGIN: 0.03;
    readonly LEAF_FIRST_FAMILY_STRENGTH_MARGIN: 0.05;
    readonly LEAF_SEPARATION_MARGIN: 0.05;
};
export declare const FAMILY_SCORING_POLICY: {
    readonly PRIMARY_USEFUL_EXACT_ALIAS_FLOOR: 0.95;
    readonly EXACT_FAMILY_CANONICAL_FLOOR: 0.95;
    readonly RECOVERED_EXACT_ROLE_CAPABILITY_FLOOR: 0.56;
    readonly RECOVERED_EXACT_ROLE_FLOOR: 0.51;
    readonly REVIEWED_SIGNAL_WEIGHT: 0.38;
    readonly REVIEWED_SIGNAL_PENALTY_WEIGHT: 0.22;
    readonly EXACT_ALIAS_BASE_CONTRIBUTION: 0.06;
    readonly EXACT_FAMILY_CANONICAL_WEIGHT: 0.18;
    readonly EXACT_ALIAS_LEAF_FIT_WEIGHT: 0.12;
    readonly MYSQL_BRANCH_STRENGTH_WEIGHT: 0.34;
    readonly MYSQL_SUPPORT_BREADTH_WEIGHT: 0.12;
    readonly HYBRID_BRANCH_STRENGTH_WEIGHT: 0.24;
    readonly HYBRID_SUPPORT_BREADTH_WEIGHT: 0.1;
    readonly LEXICAL_EVIDENCE_WEIGHT: 0.12;
    readonly GENERIC_HEAD_PRIOR_WEIGHT: 0.38;
    readonly ROLE_COVERAGE_WEIGHT: 0.16;
    readonly DOMAIN_SUPPORT_WEIGHT: 0.04;
    readonly GROUP_ALIGNMENT_WEIGHT: 0.08;
    readonly GROUP_MISMATCH_PENALTY_WEIGHT: 0.05;
    readonly CAPABILITY_SUPPORT_WEIGHT: 0.1;
    readonly LEAF_FIT_WEIGHT: 0.2;
    readonly GENERIC_PENALTY_WEIGHT: 0.08;
    readonly MAX_BREADTH_LEAVES: 5;
};
export declare const FAMILY_PROFILE_SCORING_POLICY: {
    readonly EXACT_FAMILY_OR_ALIAS_PHRASE: 1;
    readonly ALL_TERMS_FAMILY_OR_ALIAS: 0.92;
    readonly ALL_TERMS_LEAF_OR_CAPABILITY: 0.84;
    readonly PARTIAL_BASE: 0.32;
    readonly PARTIAL_COVERAGE_WEIGHT: 0.42;
    readonly DOMAIN_SUPPORT_WEIGHT: 0.06;
    readonly CLUSTER_AGREEMENT_WEIGHT: 0.16;
    readonly MAX_CLUSTER_LEAVES: 5;
    readonly MIN_SCORE: 0.4;
};
export declare const LEAF_SCORING_POLICY: {
    readonly DIRECT_EVIDENCE_WEIGHT: 0.34;
    readonly CLOSENESS_WEIGHT: 0.22;
    readonly ROLE_COVERAGE_WEIGHT: 0.12;
    readonly DOMAIN_SUPPORT_WEIGHT: 0.03;
    readonly FAMILY_SUPPORT_WEIGHT: 0.16;
    readonly HIERARCHY_SUPPORT_WEIGHT: 0.08;
    readonly CAPABILITY_SUPPORT_WEIGHT: 0.1;
    readonly EXTRA_TOKEN_RATIO_PENALTY_WEIGHT: 0.14;
    readonly HIERARCHY_SUPPORTED: 0.9;
    readonly HIERARCHY_UNSUPPORTED: 0.35;
    readonly CAPABILITY_SUPPORTED: 1;
    readonly CAPABILITY_UNSUPPORTED: 0.35;
};
export declare const EVIDENCE_NORMALIZATION_POLICY: {
    readonly FOLDED_ALIAS_DISCOUNT: 0.9;
    readonly OPENSEARCH_LEXICAL_BOOST: 1.25;
    readonly DENSE_GLOBAL_EVIDENCE_BOOST: 2;
    readonly DENSE_FAMILY_CONSTRAINED_EVIDENCE_BOOST: 2;
};
export declare const GENERIC_RISK_PENALTY: {
    readonly HIGH: 0.75;
    readonly MEDIUM: 0.35;
    readonly LOW: 0;
};
export declare const BRANCH_MARGIN_POLICY: {
    readonly WEAK_RATIO: 1.5;
    readonly STRONG_RATIO: 5;
    readonly MIN_SCORE: 0.25;
    readonly SCORE_RANGE: 0.75;
};
export declare const NUMERIC_COMPARISON_POLICY: {
    readonly TIE_EPSILON: 0.000001;
};
export declare const EVIDENCE_AUTHORITY_TIER: readonly ["exact_canonical", "raw_primary_exact_alias", "raw_exact_alias", "folded_alias", "role_aligned_phrase", "role_aligned_lexical", "capability_aligned", "profile_related", "weak"];
export type EvidenceAuthorityTier = (typeof EVIDENCE_AUTHORITY_TIER)[number];
export declare function evidenceAuthorityRank(tier: EvidenceAuthorityTier): number;
