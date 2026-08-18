import { type RetrievalBackendKind } from '../retrieval/retrieval-engine-factory.js';
import type { OccupationRetrievalEngine } from '../retrieval/retrieval-engine.js';
import type { BinaryAliasNgramIndex } from './occupation-alias-ngram-binary-artifact.js';
import type { OccupationLeafStructureArtifact } from './occupation-leaf-structure-artifact.js';
import { type SearchMetaArtifactCacheEntry } from './occupation-search-meta-artifact.js';
export declare const DEFAULT_RUNTIME_ALIAS_NGRAM_LOCALES: readonly ["en", "ro", "hu", "et"];
export type OccupationRuntimeContextOptions = {
    sourceName?: string;
    retrievalBackend?: RetrievalBackendKind;
    leafStructureRuntime?: boolean;
    /**
     * Retained for CLI/test compatibility. Runtime context no longer preloads
     * alias-ngram artifacts; query execution loads only the requested locale.
     */
    aliasNgramLocales?: string[];
};
export type LoadedAliasNgramRuntimeArtifact = {
    locale: string;
    binary: BinaryAliasNgramIndex | null;
};
export declare function isLeafStructureRuntimeEnabled(): boolean;
export declare class OccupationRuntimeContext {
    readonly sourceName: string;
    readonly retrievalBackend: RetrievalBackendKind;
    readonly retrievalEngine: OccupationRetrievalEngine;
    readonly aliasNgramArtifacts: LoadedAliasNgramRuntimeArtifact[];
    readonly leafStructureRuntimeEnabled: boolean;
    readonly leafStructureArtifact: OccupationLeafStructureArtifact | null;
    readonly searchMetaArtifact: SearchMetaArtifactCacheEntry;
    private constructor();
    static load(options?: OccupationRuntimeContextOptions): Promise<OccupationRuntimeContext>;
}
