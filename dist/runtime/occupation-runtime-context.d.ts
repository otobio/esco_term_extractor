import { type RetrievalBackendKind } from '../retrieval/retrieval-engine-factory.js';
import type { OccupationRetrievalEngine } from '../retrieval/retrieval-engine.js';
import { type BinaryAliasNgramIndex } from './occupation-alias-ngram-binary-artifact.js';
export declare const DEFAULT_RUNTIME_ALIAS_NGRAM_LOCALES: readonly ["en", "ro", "hu", "et"];
export type OccupationRuntimeContextOptions = {
    sourceName?: string;
    retrievalBackend?: RetrievalBackendKind;
    aliasNgramLocales?: string[];
};
export type LoadedAliasNgramRuntimeArtifact = {
    locale: string;
    binary: BinaryAliasNgramIndex | null;
};
export declare class OccupationRuntimeContext {
    readonly sourceName: string;
    readonly retrievalBackend: RetrievalBackendKind;
    readonly retrievalEngine: OccupationRetrievalEngine;
    readonly aliasNgramArtifacts: LoadedAliasNgramRuntimeArtifact[];
    private constructor();
    static load(options?: OccupationRuntimeContextOptions): Promise<OccupationRuntimeContext>;
}
