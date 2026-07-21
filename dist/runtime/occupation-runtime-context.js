import { isAliasNgramFamilySupportEnabled, isAliasNgramRetrievalEnabled, DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { createRetrievalEngine, configuredRetrievalBackend } from '../retrieval/retrieval-engine-factory.js';
import { loadOccupationAliasNgramBinaryIfAvailable } from './occupation-alias-ngram-binary-artifact.js';
import { loadOccupationFamilyProfileArtifactRequired } from './occupation-family-profile-artifact.js';
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
        const aliasNgramLocales = normalizeAliasNgramLocales(options.aliasNgramLocales);
        await Promise.all([
            loadOccupationSearchMetaArtifactRequired(sourceName),
            retrievalBackend === 'binary-cache' ? loadOccupationRetrievalIndexRequired(sourceName) : Promise.resolve(null),
            loadOccupationSignalVocabularyArtifactRequired(sourceName),
            loadOccupationFamilyProfileArtifactRequired(sourceName),
            loadOccupationIntentVocabularyArtifactRequired(sourceName),
            Promise.resolve(loadOccupationRoleHeadEquivalenceArtifactRequired())
        ]);
        const aliasNgramArtifacts = isAliasNgramRetrievalEnabled()
            ? await loadAliasNgramRuntimeArtifacts(sourceName, aliasNgramLocales)
            : [];
        return new OccupationRuntimeContext(sourceName, retrievalBackend, retrievalEngine, aliasNgramArtifacts);
    }
}
async function loadAliasNgramRuntimeArtifacts(sourceName, locales) {
    const includeFamilySupportingAliases = isAliasNgramFamilySupportEnabled();
    return Promise.all(locales.map(async (locale) => {
        const binary = await loadOccupationAliasNgramBinaryIfAvailable(sourceName, locale, includeFamilySupportingAliases);
        if (!binary) {
            throw new Error([
                `Missing required binary alias-ngram artifact for source="${sourceName}" locale="${locale}".`,
                `family_support=${includeFamilySupportingAliases ? 'yes' : 'no'}`,
                'Run `npm run retrieval:aliases:ngram:export -- --locales=en,ro,hu,et --include-family-supporting` or `npm run runtime:artifacts-build`.'
            ].join(' '));
        }
        return { locale, binary };
    }));
}
function normalizeAliasNgramLocales(locales) {
    const values = locales && locales.length > 0 ? locales : Array.from(DEFAULT_RUNTIME_ALIAS_NGRAM_LOCALES);
    return Array.from(new Set(values.map((locale) => locale.trim()).filter(Boolean))).sort();
}
