import type { PreparedQuery } from '../query/query-preparation.js';
export type AliasEvidenceRow = {
    graph_node_id: number;
    canonical_label: string;
    alias: string;
    normalized_alias: string;
    alias_role: string;
    alias_role_rank: number | null;
    weight: number | null;
    alias_authority_score: number | null;
    alias_token_count: number | null;
};
export type AliasRetrievalOptions = {
    sourceName: string;
    locale: string;
    preparedQuery: PreparedQuery;
    exactAliasQueries: string[];
    foldedAliasQueries: string[];
    limit: number;
};
/**
 * Alias retrieval returns rows separated by evidence strength. Implementations must keep
 * exact/folded/subphrase rows distinct because candidate scoring weights those channels differently.
 */
export type AliasRetrievalResult = {
    exactRows: AliasEvidenceRow[];
    foldedRows: AliasEvidenceRow[];
    subphraseRows: AliasEvidenceRow[];
    scannedAliasHitCount: number;
};
export type OccupationTextRetrievalOptions = {
    query: string;
    locale: string;
    sourceName: string;
    limit: number;
    /**
     * Optional pre-computed PreparedQuery for this exact (query, locale, sourceName). When supplied,
     * implementations should reuse it instead of re-running query preparation, since callers that
     * already have it (e.g. multi-surface/multi-family retrieval loops) would otherwise pay for the
     * same locale-aware preparation work repeatedly for an identical input.
     */
    preparedQuery?: PreparedQuery;
};
export type FamilyOccupationTextRetrievalOptions = OccupationTextRetrievalOptions & {
    familyNodeId: number;
};
export type OccupationTextField = 'canonical_label' | 'locale_primary_aliases_text' | 'locale_supporting_aliases_text' | 'reviewed_crosswalk_aliases_text' | 'family_supporting_aliases_text' | 'english_backbone_aliases_text' | 'aliases_text' | 'search_text' | 'capability_text' | 'ancestor_text';
export type OccupationTextFieldSignal = {
    field: OccupationTextField;
    fieldClass: 'title' | 'alias' | 'family_alias' | 'search_text' | 'capability' | 'ancestor';
    aliasRole?: 'locale_primary' | 'locale_supporting' | 'reviewed_crosswalk' | 'family_supporting' | 'english_backbone' | 'combined';
    phraseMatch: boolean;
    matchedTokens: string[];
    usefulMatchedTokens: string[];
    matchedTokenCount: number;
    usefulMatchedTokenCount: number;
    queryTokenCount: number;
    usefulQueryTokenCount: number;
    tokenCoverage: number;
    usefulTokenCoverage: number;
};
/**
 * Backend-neutral lexical occupation hit. Scores must be comparable within a single retrieval call,
 * sorted by descending relevance by the implementation, and stable for the same artifact/index state.
 */
export type OccupationTextHit = {
    graphNodeId: number;
    canonicalLabel: string;
    score: number;
    rawScore: number;
    normalizedRawScore: number;
    lexicalSignalScore: number;
    matchedQueries: string[];
    matchedFields: string[];
    fieldSignals: OccupationTextFieldSignal[];
    matchedTokens: string[];
    phraseMatch: boolean;
    maxUsefulTokenCoverage: number;
    queryTokenCount: number;
    usefulQueryTokenCount: number;
};
export type CanonicalLabelHit = {
    graphNodeId: number;
    canonicalLabel: string;
    normalizedLabel: string;
};
export type AliasRetrievalEngine = {
    /**
     * Returns alias evidence for the prepared query. The engine owns retrieval only;
     * downstream candidate scoring still owns cross-channel weighting and merging.
     */
    retrieve(options: AliasRetrievalOptions): Promise<AliasRetrievalResult>;
};
export type OccupationTextRetrievalEngine = {
    /**
     * Returns global lexical occupation hits for the query. Implementations should apply the
     * requested locale/source filters and return at least `limit` candidates when available.
     */
    retrieve(options: OccupationTextRetrievalOptions): Promise<OccupationTextHit[]>;
    /**
     * Returns exact normalized canonical-label matches for the provided folded query values.
     * This is intentionally separate from fuzzy lexical retrieval because it carries stronger evidence.
     */
    retrieveCanonicalLabels(options: OccupationTextRetrievalOptions & {
        foldedQueries: string[];
    }): Promise<CanonicalLabelHit[]>;
    /**
     * Returns lexical occupation hits constrained to one family node. Used by family-first recovery
     * after top families are known, so implementations must not return rows outside `familyNodeId`.
     */
    retrieveWithinFamily(options: FamilyOccupationTextRetrievalOptions): Promise<OccupationTextHit[]>;
};
export type OccupationRetrievalEngine = {
    aliases: AliasRetrievalEngine;
    occupations: OccupationTextRetrievalEngine;
};
