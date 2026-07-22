import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { createRetrievalEngine, configuredRetrievalBackend } from '../retrieval/retrieval-engine-factory.js';
import { loadOccupationIntentVocabularyArtifactRequired } from './occupation-intent-vocabulary-artifact.js';
import { loadOccupationRetrievalIndexRequired } from './occupation-retrieval-index-artifact.js';
import { loadOccupationSearchMetaArtifactRequired } from './occupation-search-meta-artifact.js';
import { loadOccupationSignalVocabularyArtifactRequired } from './occupation-signal-vocabulary-artifact.js';
import { loadOccupationRoleHeadEquivalenceArtifactRequired } from '../query/occupation-role-head-equivalence.js';
export const DEFAULT_RUNTIME_ALIAS_NGRAM_LOCALES = ['en', 'ro', 'hu', 'et'];
export class OccupationRuntimeContext {
    sourceName;
    retrievalBackend;
    retrievalEngine;
    aliasNgramArtifacts;
    constructor(sourceName, retrievalBackend, retrievalEngine, aliasNgramArtifacts) {
        this.sourceName = sourceName;
        this.retrievalBackend = retrievalBackend;
        this.retrievalEngine = retrievalEngine;
        this.aliasNgramArtifacts = aliasNgramArtifacts;
    }
    static async load(options = {}) {
        const sourceName = options.sourceName?.trim() || DEFAULT_ESCO_SOURCE_NAME;
        const retrievalBackend = options.retrievalBackend ?? configuredRetrievalBackend();
        const retrievalEngine = createRetrievalEngine(retrievalBackend);
        await Promise.all([
            loadOccupationSearchMetaArtifactRequired(sourceName),
            retrievalBackend === 'binary-cache' ? loadOccupationRetrievalIndexRequired(sourceName) : Promise.resolve(null),
            loadOccupationSignalVocabularyArtifactRequired(sourceName),
            loadOccupationIntentVocabularyArtifactRequired(sourceName),
            Promise.resolve(loadOccupationRoleHeadEquivalenceArtifactRequired())
        ]);
        return new OccupationRuntimeContext(sourceName, retrievalBackend, retrievalEngine, []);
    }
}
