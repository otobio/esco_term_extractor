import type { Connection } from 'mysql2/promise';
import type { PreparedOccupationRetrievalQuery } from '../query/occupation-retrieval-query.js';
import type { AliasRetrievalEngine, OccupationRetrievalEngine, OccupationTextRetrievalEngine } from './retrieval-engine.js';
import { type TimingMap } from '../utils/timing.js';
import type { RetrievalBoundaryDebugCollector } from '../debug/retrieval-boundary-debug.js';
export declare const DEFAULT_ESCO_SOURCE_NAME = "esco_1_2_1";
export declare const DEFAULT_RETRIEVAL_LOCALE = "en";
export declare const DEFAULT_MODEL_KEY = "none";
export declare const DEFAULT_CANDIDATE_LIMIT = 10;
export declare const DEFAULT_RETRIEVAL_PROFILE: "occupation_hybrid_v1";
export declare const LEGACY_LEXICAL_BACKEND_LABEL: "hybrid";
export declare function retrievalSurfaceLocales(locale: string): string[];
export type RetrievalChannel = 'exact_canonical' | 'exact_alias' | 'folded_alias' | 'ngram_alias' | 'lexical' | 'capability_task';
export type RetrievalProfile = typeof DEFAULT_RETRIEVAL_PROFILE;
export type RetrieveOccupationCandidatesOptions = {
    locale?: string;
    sourceName?: string;
    limit?: number;
    evaluationQueryId?: number;
    retrievalQuery?: PreparedOccupationRetrievalQuery;
    debugCollector?: RetrievalBoundaryDebugCollector | null;
};
export type CandidateEvidenceRecord = {
    channel: RetrievalChannel;
    score: number;
    alias?: string;
    normalizedAlias?: string;
    foldedAlias?: string;
    aliasRole?: string;
    aliasWeight?: number | null;
    cosine?: number;
    dot?: number;
    textRole?: string;
    details?: Record<string, unknown>;
};
export type RetrievedOccupationCandidate = {
    graphNodeId: number;
    canonicalLabel: string;
    totalScore: number;
    channelScores: Partial<Record<RetrievalChannel, number>>;
    evidence: CandidateEvidenceRecord[];
};
export type RetrieveOccupationCandidatesResult = {
    retrievalLocales: string[];
    retrievalProfile: RetrievalProfile;
    scannedAliasHitCount: number;
    scannedOpenSearchHitCount: number;
    timings: TimingMap;
    candidates: RetrievedOccupationCandidate[];
};
export declare class OccupationCandidateRetriever {
    private readonly connection;
    private readonly occupationRetriever;
    private readonly aliasRetriever;
    constructor(connection?: Connection | null, occupationRetriever?: OccupationTextRetrievalEngine, aliasRetriever?: AliasRetrievalEngine);
    static withEngine(connection: Connection | null, engine: OccupationRetrievalEngine): OccupationCandidateRetriever;
    run(options: RetrieveOccupationCandidatesOptions): Promise<RetrieveOccupationCandidatesResult>;
    private retrieveAliasNgramMatches;
    private buildCandidates;
}
export declare function isAliasNgramRetrievalEnabled(): boolean;
export declare function isAliasNgramFamilySupportEnabled(): boolean;
