/**
 * Default per-bucket tuning.
 *
 * These defaults govern lexical, controlled, and inference-led matching in the
 * shipped runtime. The embedding/vector extractor itself lives in dev-only code.
 */
const DEFAULTS = {
    occupation: {
        bucket: 'occupation',
        matchStrategy: 'hybrid',
        semanticThreshold: 0.5,
        lexicalConfidence: 0.95,
        unigramCorroboration: 0.68,
        maxPerBucket: 5,
        openEnded: true,
        titleAnchored: true,
    },
    capabilities: {
        bucket: 'capabilities',
        matchStrategy: 'hybrid',
        semanticThreshold: 0.47,
        lexicalConfidence: 0.93,
        unigramCorroboration: 0.68,
        maxPerBucket: 15,
        openEnded: true,
        titleAnchored: false,
    },
    // Location is a gazetteer: exact place names (lexical) are the signal; semantic
    // best-match against tens of thousands of tiny localities is noise, so we keep
    // the semantic bar high and demand near-exact (raw) corroboration for single-
    // token place names (which collide with common words after diacritic folding).
    location: {
        bucket: 'location',
        matchStrategy: 'gazetteer',
        semanticThreshold: 0.58,
        lexicalConfidence: 0.97,
        unigramCorroboration: 0.88,
        maxPerBucket: 8,
        openEnded: false,
        titleAnchored: false,
    },
    qualifications: {
        bucket: 'qualifications',
        matchStrategy: 'hybrid',
        semanticThreshold: 0.48,
        lexicalConfidence: 0.92,
        unigramCorroboration: 0.68,
        maxPerBucket: 10,
        openEnded: true,
        titleAnchored: false,
    },
    benefits: {
        bucket: 'benefits',
        matchStrategy: 'hybrid',
        semanticThreshold: 0.5,
        lexicalConfidence: 0.93,
        unigramCorroboration: 0.68,
        maxPerBucket: 10,
        openEnded: false,
        titleAnchored: false,
    },
    sector: {
        bucket: 'sector',
        matchStrategy: 'inferred',
        semanticThreshold: 0.5,
        lexicalConfidence: 0.93,
        unigramCorroboration: 0.7,
        maxPerBucket: 5,
        openEnded: false,
        titleAnchored: false,
    },
    job_function: {
        bucket: 'job_function',
        matchStrategy: 'inferred',
        semanticThreshold: 0.5,
        lexicalConfidence: 0.93,
        unigramCorroboration: 0.7,
        maxPerBucket: 5,
        openEnded: false,
        titleAnchored: false,
    },
    // company_size = the company_stage terms (startup/scaleup/enterprise) as their
    // own bucket. Small controlled vocab + employee-count inference.
    // inference-only: bare "enterprise"/"startup" aliases are ambiguous (enterprise
    // software, startup mindset), so the guarded inference is the sole path.
    company_size: {
        bucket: 'company_size',
        matchStrategy: 'inferred',
        semanticThreshold: 0.55,
        lexicalConfidence: 0.94,
        unigramCorroboration: 0.7,
        maxPerBucket: 2,
        openEnded: false,
        titleAnchored: false,
    },
    compensation: {
        bucket: 'compensation',
        matchStrategy: 'hybrid',
        semanticThreshold: 0.5,
        lexicalConfidence: 0.93,
        unigramCorroboration: 0.68,
        maxPerBucket: 8,
        openEnded: false,
        titleAnchored: false,
    },
    level: {
        bucket: 'level',
        matchStrategy: 'inferred',
        semanticThreshold: 0.48,
        lexicalConfidence: 0.94,
        unigramCorroboration: 0.68,
        maxPerBucket: 4,
        openEnded: false,
        titleAnchored: true,
    },
    workplace: {
        bucket: 'workplace',
        matchStrategy: 'controlled',
        semanticThreshold: 0.5,
        lexicalConfidence: 0.94,
        unigramCorroboration: 0.68,
        maxPerBucket: 3,
        openEnded: false,
        titleAnchored: false,
    },
    employment: {
        bucket: 'employment',
        matchStrategy: 'lexical',
        semanticThreshold: 0.5,
        lexicalConfidence: 0.94,
        unigramCorroboration: 0.68,
        maxPerBucket: 3,
        openEnded: false,
        titleAnchored: false,
    },
    schedule: {
        bucket: 'schedule',
        matchStrategy: 'lexical',
        semanticThreshold: 0.5,
        lexicalConfidence: 0.94,
        unigramCorroboration: 0.68,
        maxPerBucket: 3,
        openEnded: false,
        titleAnchored: false,
    },
    collar_kind: {
        bucket: 'collar_kind',
        matchStrategy: 'controlled',
        semanticThreshold: 0.52,
        lexicalConfidence: 0.95,
        unigramCorroboration: 0.68,
        maxPerBucket: 2,
        openEnded: false,
        titleAnchored: false,
    },
};
export function getDefaultBucketConfigs() {
    return structuredClone(DEFAULTS);
}
export function resolveBucketConfig(bucket, overrides) {
    return { ...DEFAULTS[bucket], ...(overrides ?? {}) };
}
