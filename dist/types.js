/**
 * Core types for the ESCO-style term extractor.
 *
 * The extractor mirrors the approach of KonstantinosPetrakis/esco-skill-extractor:
 * every canonical term is embedded once with a sentence-transformer, the input
 * text is split into clauses, each clause is embedded, and a clause is matched to
 * a term when their cosine similarity crosses a per-bucket threshold. On top of
 * the semantic path we add a high-precision lexical (exact normalized alias) path.
 */
export const ALL_BUCKETS = [
    'occupation',
    'capabilities',
    'location',
    'company_type',
    'company_size',
    'benefits',
    'qualifications',
    'compensation',
    'level',
    'workplace',
    'employment',
    'schedule',
    'collar_kind',
];
