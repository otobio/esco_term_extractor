import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { createRetrievalEngine, configuredRetrievalBackend, type RetrievalBackendKind } from '../retrieval/retrieval-engine-factory.js';
import type { OccupationRetrievalEngine } from '../retrieval/retrieval-engine.js';
import type { BinaryAliasNgramIndex } from './occupation-alias-ngram-binary-artifact.js';
import { loadOccupationIntentVocabularyArtifactRequired } from './occupation-intent-vocabulary-artifact.js';
import { loadOccupationRetrievalIndexRequired } from './occupation-retrieval-index-artifact.js';
import { loadOccupationSearchMetaArtifactRequired } from './occupation-search-meta-artifact.js';
import { loadOccupationSignalVocabularyArtifactRequired } from './occupation-signal-vocabulary-artifact.js';
import { loadOccupationRoleHeadEquivalenceArtifactRequired } from '../query/occupation-role-head-equivalence.js';
import { loadOccupationReviewedFamilySignalsArtifactRequired } from './occupation-reviewed-family-signals.js';

export const DEFAULT_RUNTIME_ALIAS_NGRAM_LOCALES = ['en', 'ro', 'hu', 'et'] as const;

export type OccupationRuntimeContextOptions = {
  sourceName?: string;
  retrievalBackend?: RetrievalBackendKind;
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

export class OccupationRuntimeContext {
  private constructor(
    public readonly sourceName: string,
    public readonly retrievalBackend: RetrievalBackendKind,
    public readonly retrievalEngine: OccupationRetrievalEngine,
    public readonly aliasNgramArtifacts: LoadedAliasNgramRuntimeArtifact[]
  ) {}

  public static async load(options: OccupationRuntimeContextOptions = {}): Promise<OccupationRuntimeContext> {
    const sourceName = options.sourceName?.trim() || DEFAULT_ESCO_SOURCE_NAME;
    const retrievalBackend = options.retrievalBackend ?? configuredRetrievalBackend();
    const retrievalEngine = createRetrievalEngine(retrievalBackend);

    await Promise.all([
      loadOccupationSearchMetaArtifactRequired(sourceName),
      retrievalBackend === 'binary-cache' ? loadOccupationRetrievalIndexRequired(sourceName) : Promise.resolve(null),
      loadOccupationSignalVocabularyArtifactRequired(sourceName),
      loadOccupationIntentVocabularyArtifactRequired(sourceName),
      Promise.resolve(loadOccupationRoleHeadEquivalenceArtifactRequired()),
      Promise.resolve(loadOccupationReviewedFamilySignalsArtifactRequired())
    ]);

    return new OccupationRuntimeContext(sourceName, retrievalBackend, retrievalEngine, []);
  }
}
