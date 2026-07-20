import type { GazetteerResolver } from '@term-extractor/gazetteer';
import { CollarMap } from '../derive/collar.js';
import { LexicalIndex } from '../lexical-index.js';
import { type OpenSearchClientOptions } from '../matchers/os-client.js';
import type { OpenSearchClient } from '../matchers/types.js';
import { type BucketName } from '../types.js';
export type SearchBucket = BucketName;
export { defaultTierOf, type MergePolicy, type MergeTier, mergeSignals, } from './merge.js';
export interface CanonicalMatch {
    canonicalKey: string;
    bucket: SearchBucket;
    termType: string;
    matchedAlias: string;
    sourceText: string;
    evidenceSignal: string;
    evidenceMatchText: string;
    itemIndex: number;
    propositionIndex: number;
    confidence: number;
    source: 'lexical' | 'fuzzy' | 'fallback' | 'neural' | 'derived';
    isConditional: boolean;
    isPreferred: boolean;
    isOffered: boolean;
    structuralTrust: number;
    legitimacyScore: number;
}
export interface SalaryRangeMatch {
    minAmount: number | null;
    maxAmount: number | null;
    currency: 'RON' | 'EUR' | 'USD' | 'HUF' | null;
    period: 'hour' | 'day' | 'week' | 'month' | 'year' | null;
    taxMode: 'gross' | 'net' | null;
    rawText: string;
    normalizedText: string;
    confidence: number;
}
export interface IngestJobAnalysisResult {
    matches: CanonicalMatch[];
    salaryRanges: SalaryRangeMatch[];
}
export interface DeriveRequest {
    bucket?: SearchBucket;
    input: string;
    /** `lexical` forces the exact/fuzzy strategy; `neural`/`hybrid` force additive-hybrid. */
    mode?: string;
    /** Custom analysis pipeline for a free-text field (currently only `title`). */
    profile?: string;
    /** Text language — lexical scan / OS surface filter. */
    locale?: string;
    /** Gazetteer COUNTRY gate (ro/ng/hu/ee), distinct from `locale`. Used by the
     *  gazetteer-backed title profile; a Nigerian listing is country `ng` even when
     *  its text is English. Defaults to `locale` when omitted. */
    countryCode?: string;
}
export interface RuntimeConfig extends OpenSearchClientOptions {
    /** Directory holding the lexical + gazetteer snapshots (defaults to the packaged data). */
    dataDir?: string;
}
export interface Runtime {
    readonly client: OpenSearchClient;
    lexical(): Promise<LexicalIndex>;
    gazetteer(): Promise<GazetteerResolver | undefined>;
    /** occupation→collar_kind graph edges; used by the title profile to derive collar. */
    collar(): Promise<CollarMap | undefined>;
}
export interface DeriveOptions {
    runtime: Runtime;
    /** Text language — lexical scan / OS surface filter. */
    locale?: string;
    /** Gazetteer COUNTRY gate (ro/ng/hu/ee), distinct from `locale`; defaults to `locale`. */
    countryCode?: string;
    bucket?: SearchBucket;
    profile?: string;
    mode?: string;
}
export interface BatchOptions {
    runtime: Runtime;
    locale?: string;
    /** Gazetteer COUNTRY gate (ro/ng/hu/ee), distinct from `locale`; defaults to `locale`. */
    countryCode?: string;
}
export declare function createRuntime(config?: RuntimeConfig): Runtime;
/** Resolve one structured field, or run a custom `profile` (e.g. `title`) over free text. */
export declare function derive(input: string, opts: DeriveOptions): Promise<CanonicalMatch[]>;
/** Resolve a batch of structured fields in a single `_msearch` (profile requests delegate to `derive`). */
export declare function deriveMany(requests: DeriveRequest[], opts: BatchOptions): Promise<CanonicalMatch[]>;
/** Unstructured body: every clause probed against every bucket, deduped per key, plus salary parsing. */
export declare function analyzeJobListing(text: string, opts: BatchOptions): Promise<IngestJobAnalysisResult>;
/** Group matches into per-bucket canonical-key lists, deduped, highest confidence winning. */
export declare function explicitBuckets(matches: CanonicalMatch[]): Record<SearchBucket, string[]>;
