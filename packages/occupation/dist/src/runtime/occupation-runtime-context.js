import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { readOptionalEnv } from '../config/env.js';
import { createRetrievalEngine, configuredRetrievalBackend } from '../retrieval/retrieval-engine-factory.js';
import { loadOccupationIntentVocabularyArtifactRequired } from './occupation-intent-vocabulary-artifact.js';
import { loadOccupationLeafStructureArtifactIfAvailable } from './occupation-leaf-structure-artifact.js';
import { loadOccupationRetrievalIndexRequired } from './occupation-retrieval-index-artifact.js';
import { loadOccupationSearchMetaArtifactRequired } from './occupation-search-meta-artifact.js';
import { loadOccupationSignalVocabularyArtifactRequired } from './occupation-signal-vocabulary-artifact.js';
import { loadOccupationRoleHeadEquivalenceArtifactRequired } from './occupation-role-head-equivalence-artifact.js';
import { loadOccupationReviewedFamilySignalsArtifactRequired } from './occupation-reviewed-family-signals.js';
export const DEFAULT_RUNTIME_ALIAS_NGRAM_LOCALES = ['en', 'ro', 'hu', 'et'];
const ENABLED_ENV_VALUES = new Set(['1', 'true', 'yes', 'on']);
export function isLeafStructureRuntimeEnabled() {
    const rawValue = readOptionalEnv('OSE_ENABLE_LEAF_STRUCTURE_RUNTIME')?.toLowerCase();
    return rawValue ? ENABLED_ENV_VALUES.has(rawValue) : false;
}
export class OccupationRuntimeContext {
    sourceName;
    retrievalBackend;
    retrievalEngine;
    aliasNgramArtifacts;
    leafStructureRuntimeEnabled;
    leafStructureArtifact;
    constructor(sourceName, retrievalBackend, retrievalEngine, aliasNgramArtifacts, leafStructureRuntimeEnabled, leafStructureArtifact) {
        this.sourceName = sourceName;
        this.retrievalBackend = retrievalBackend;
        this.retrievalEngine = retrievalEngine;
        this.aliasNgramArtifacts = aliasNgramArtifacts;
        this.leafStructureRuntimeEnabled = leafStructureRuntimeEnabled;
        this.leafStructureArtifact = leafStructureArtifact;
    }
    static async load(options = {}) {
        const sourceName = options.sourceName?.trim() || DEFAULT_ESCO_SOURCE_NAME;
        const retrievalBackend = options.retrievalBackend ?? configuredRetrievalBackend();
        const retrievalEngine = createRetrievalEngine(retrievalBackend);
        const leafStructureRuntimeEnabled = options.leafStructureRuntime ?? isLeafStructureRuntimeEnabled();
        const leafStructureArtifactPromise = loadOccupationLeafStructureArtifactIfAvailable(sourceName);
        const [, , , , leafStructureArtifact] = await Promise.all([
            loadOccupationSearchMetaArtifactRequired(sourceName),
            retrievalBackend === 'binary-cache' ? loadOccupationRetrievalIndexRequired(sourceName) : Promise.resolve(null),
            loadOccupationSignalVocabularyArtifactRequired(sourceName),
            loadOccupationIntentVocabularyArtifactRequired(sourceName),
            leafStructureArtifactPromise,
            Promise.resolve(loadOccupationRoleHeadEquivalenceArtifactRequired()),
            Promise.resolve(loadOccupationReviewedFamilySignalsArtifactRequired())
        ]);
        return new OccupationRuntimeContext(sourceName, retrievalBackend, retrievalEngine, [], leafStructureRuntimeEnabled, leafStructureArtifact);
    }
}
