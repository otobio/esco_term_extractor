/**
 * Core types for the ESCO-style term extractor.
 *
 * The extractor mirrors the approach of KonstantinosPetrakis/esco-skill-extractor:
 * every canonical term is embedded once with a sentence-transformer, the input
 * text is split into clauses, each clause is embedded, and a clause is matched to
 * a term when their cosine similarity crosses a per-bucket threshold. On top of
 * the semantic path we add a high-precision lexical (exact normalized alias) path.
 */
/** Languages present in the canonical_runtime_terms dictionary. */
export type SupportedLanguage = 'ro' | 'en' | 'hu' | 'et' | 'ng' | 'global';
/** The canonical buckets carried by the dictionary. */
export type BucketName = 'occupation' | 'capabilities' | 'location' | 'sector' | 'job_function' | 'company_size' | 'benefits' | 'qualifications' | 'compensation' | 'level' | 'workplace' | 'employment' | 'schedule' | 'collar_kind';
export declare const ALL_BUCKETS: BucketName[];
/** One canonical term as stored in the dictionary snapshot. */
export interface DictionaryTerm {
    canonicalKey: string;
    bucket: BucketName;
    termType: string;
    displayName: string;
    value: string;
    languageCode: SupportedLanguage;
    aliases: string[];
}
/**
 * How a bucket is matched:
 * - 'hybrid'    : semantic (embedding) + lexical alias (default for open buckets)
 * - 'semantic'  : embedding only
 * - 'lexical'   : exact alias only (no embeddings)
 * - 'controlled': controlled vocabulary — lexical-led + strict semantic backstop +
 *                 structured-field fusion + negation (small closed enumerations)
 * - 'inferred'  : rule-based inference + structured only, no lexical/semantic
 *                 (buckets whose aliases are too ambiguous, e.g. level)
 * - 'gazetteer' : dedicated location resolver (no embeddings)
 */
export type MatchStrategy = 'hybrid' | 'semantic' | 'lexical' | 'controlled' | 'inferred' | 'gazetteer';
/** Per-bucket retrieval tuning. Thresholds are raw cosine on MiniLM vectors. */
export interface BucketConfig {
    bucket: BucketName;
    /** Matching strategy for this bucket. */
    matchStrategy: MatchStrategy;
    /** Minimum cosine similarity for a semantic (embedding) match. */
    semanticThreshold: number;
    /** Confidence assigned to an exact normalized-alias (lexical) hit. */
    lexicalConfidence: number;
    /**
     * Minimum clause↔term cosine for a *single-word* lexical hit to be trusted.
     * Multi-word alias hits bypass this. Higher for gazetteer buckets (location)
     * where single-token place names collide with common words.
     */
    unigramCorroboration: number;
    /** Maximum number of terms returned for this bucket. */
    maxPerBucket: number;
    /** Open-ended buckets (occupation/capabilities/...) vs finite controlled lists. */
    openEnded: boolean;
    /**
     * When true, this bucket's signal lives primarily in the title (occupation,
     * level). Semantic matches from non-title clauses must clear a higher bar,
     * which removes weak description-driven false positives.
     */
    titleAnchored: boolean;
}
/** Where a match came from. */
export type MatchMethod = 'semantic' | 'lexical' | 'both' | 'gazetteer' | 'structured' | 'inferred' | 'derived';
/** A single piece of evidence supporting a match. */
export interface MatchEvidence {
    clause: string;
    method: 'semantic' | 'lexical' | 'gazetteer' | 'structured' | 'inferred' | 'derived';
    score: number;
}
/** A canonical term extracted from the input. */
export interface ExtractedTerm {
    bucket: BucketName;
    canonicalKey: string;
    displayName: string;
    termType: string;
    languageCode: SupportedLanguage;
    /** Best confidence in [0, 1] across all supporting evidence. */
    score: number;
    method: MatchMethod;
    evidence: MatchEvidence[];
}
/** Structured or free-text input to extract from. */
export type JobPostInput = string | {
    title?: string;
    description?: string;
    sections?: {
        name: string;
        text: string;
    }[];
    /** Structured field values, keyed by bucket. E.g. `{ location: 'Cluj' }`. */
    structured?: Partial<Record<BucketName, string>>;
    /** Pre-known salary ranges (structured) — passed through, skips text parsing. */
    salary?: SalaryRange[];
};
export interface ExtractOptions {
    /** Restrict extraction to these buckets (default: all). */
    targetBuckets?: BucketName[];
    /** Restrict the dictionary languages considered (default: all indexed). */
    languages?: SupportedLanguage[];
    /** Per-bucket overrides for thresholds / caps. */
    bucketOverrides?: Partial<Record<BucketName, Partial<BucketConfig>>>;
}
/** Salary is a structured numeric value, not a canonical term — its own channel. */
export type SalaryPeriod = 'hour' | 'day' | 'week' | 'month' | 'year';
export type Currency = 'RON' | 'EUR' | 'USD' | 'HUF';
export interface SalaryRange {
    minAmount?: number;
    maxAmount?: number;
    currency?: Currency;
    period?: SalaryPeriod;
    taxMode?: 'gross' | 'net';
    /** true when the period was inferred from magnitude rather than stated. */
    periodInferred?: boolean;
    evidence: string;
    confidence: number;
}
export interface ExtractionResult {
    matchesByBucket: Partial<Record<BucketName, ExtractedTerm[]>>;
    /** Parsed salary ranges (separate from the term buckets). */
    salary?: SalaryRange[];
    diagnostics: {
        clausesAnalyzed: number;
        clausesSkipped: number;
        languagesConsidered: SupportedLanguage[];
        bucketsConsidered: BucketName[];
    };
}
/** Options for resolving a structured keyword to a canonical term in one bucket. */
export interface StructuredResolveOptions {
    /** Restrict to these dictionary languages (default: the extractor default / all). */
    languages?: SupportedLanguage[];
    /** Maximum canonical candidates to return (default: 3). */
    topK?: number;
    /** Minimum semantic score for the fallback path (default: the bucket threshold). */
    minScore?: number;
    /** Whether to fall back to embeddings when no exact alias matches (default: true). */
    semanticFallback?: boolean;
}
/** Result of resolving a single structured keyword against one bucket. */
export interface StructuredResolution {
    bucket: BucketName;
    input: string;
    matched: boolean;
    /** How the top result was obtained. */
    method: 'lexical' | 'semantic' | 'gazetteer' | 'structured' | 'none';
    terms: ExtractedTerm[];
}
