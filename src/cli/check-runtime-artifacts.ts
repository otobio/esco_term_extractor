import { loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';
import { loadOccupationSignalVocabularyArtifactRequired } from '../runtime/occupation-signal-vocabulary-artifact.js';
import { loadOccupationFamilyProfileArtifactRequired } from '../runtime/occupation-family-profile-artifact.js';
import { loadOccupationFamilyTokenRelevanceArtifactRequired } from '../runtime/occupation-family-token-relevance-artifact.js';
import { loadOccupationIntentVocabularyArtifactRequired } from '../runtime/occupation-intent-vocabulary-artifact.js';
import { loadOccupationSemanticBootstrapArtifactRequired } from '../runtime/occupation-semantic-bootstrap-artifact.js';
import { loadOccupationAliasNgramBinaryIfAvailable } from '../runtime/occupation-alias-ngram-binary-artifact.js';
import { loadOccupationRetrievalIndexRequired } from '../runtime/occupation-retrieval-index-artifact.js';
import { loadOccupationRoleHeadEquivalenceArtifactRequired } from '../runtime/occupation-role-head-equivalence-artifact.js';
import { loadOccupationReviewedFamilySignalsArtifactRequired } from '../runtime/occupation-reviewed-family-signals.js';
import { loadOccupationLeafStructureArtifactRequired } from '../runtime/occupation-leaf-structure-artifact.js';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';

type CliOptions = {
  sourceName: string;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const aliasNgramLocales = ['en', 'ro', 'hu', 'et'];
  const runtime = await OccupationRuntimeContext.load({
    sourceName: options.sourceName,
    retrievalBackend: 'binary-cache'
  });
  const [
    searchMetaArtifact,
    retrievalIndexArtifact,
    signalVocabularyArtifact,
    familyProfileArtifact,
    familyTokenRelevanceArtifact,
    intentVocabularyArtifact,
    semanticBootstrapArtifact,
    aliasNgramBinaryArtifacts,
    roleHeadEquivalenceArtifact,
    reviewedFamilySignalsArtifact,
    leafStructureArtifact
  ] = await Promise.all([
    loadOccupationSearchMetaArtifactRequired(options.sourceName),
    loadOccupationRetrievalIndexRequired(options.sourceName),
    loadOccupationSignalVocabularyArtifactRequired(options.sourceName),
    loadOccupationFamilyProfileArtifactRequired(options.sourceName),
    Promise.resolve(loadOccupationFamilyTokenRelevanceArtifactRequired(options.sourceName)),
    loadOccupationIntentVocabularyArtifactRequired(options.sourceName),
    loadOccupationSemanticBootstrapArtifactRequired('ro'),
    Promise.all(aliasNgramLocales.map((locale) => loadOccupationAliasNgramBinaryIfAvailable(options.sourceName, locale, true))),
    loadOccupationRoleHeadEquivalenceArtifactRequired(),
    Promise.resolve(loadOccupationReviewedFamilySignalsArtifactRequired()),
    loadOccupationLeafStructureArtifactRequired(options.sourceName)
  ]);

  console.log('Runtime artifacts OK.');
  console.log(
    [
      `runtime_context=loaded`,
      `source=${runtime.sourceName}`,
      `retrieval_backend=${runtime.retrievalBackend}`,
      `eager_alias_ngram_locales=${runtime.aliasNgramArtifacts.map((artifact) => artifact.locale).join(',') || 'none'}`,
      `leaf_structure_runtime_enabled=${runtime.leafStructureRuntimeEnabled ? 'yes' : 'no'}`,
      `leaf_structure_loaded=${runtime.leafStructureArtifact ? 'yes' : 'no'}`,
      `leaf_structure_records=${runtime.leafStructureArtifact?.manifest.count ?? 0}`
    ].join('  ')
  );
  console.log(
    [
      `occupation_search_meta_manifest=${searchMetaArtifact.manifestPath}`,
      `core_rows=${searchMetaArtifact.manifest.files.coreRows}`,
      `detail_rows=${searchMetaArtifact.manifest.files.detailRows}`,
      `alias_rows=${searchMetaArtifact.manifest.files.aliasRows}`,
      `capability_rows=${searchMetaArtifact.manifest.files.capabilityRows}`,
      `source=${searchMetaArtifact.artifact.sourceName}`,
      `count=${searchMetaArtifact.artifact.count}`,
      `strings=${searchMetaArtifact.manifest.stringCount}`,
      `aliases=${searchMetaArtifact.manifest.aliasCount}`,
      `capabilities=${searchMetaArtifact.manifest.capabilityCount}`
    ].join('  ')
  );
  console.log(
    [
      `occupation_retrieval_index_manifest=${retrievalIndexArtifact.manifestPath}`,
      `source=${retrievalIndexArtifact.manifest.sourceName}`,
      `locales=${retrievalIndexArtifact.manifest.locales.join(',')}`,
      `strings=${retrievalIndexArtifact.manifest.stringCount}`,
      `aliases=${retrievalIndexArtifact.manifest.aliasRowCount}`,
      `records=${retrievalIndexArtifact.manifest.textRecordCount}`,
      `field_posting_keys=${retrievalIndexArtifact.manifest.fieldPostingKeyCount}`
    ].join('  ')
  );
  console.log(
    [
      `occupation_signal_vocabulary_manifest=${signalVocabularyArtifact.manifestPath}`,
      `source=${signalVocabularyArtifact.artifact.sourceName}`,
      `tokens=${signalVocabularyArtifact.artifact.tokenCount}`,
      `anchors=${signalVocabularyArtifact.artifact.anchorCount}`,
      `phrases=${signalVocabularyArtifact.artifact.phraseFiles.map((file) => `${file.tokenCount}:${file.count}`).join(',')}`
    ].join('  ')
  );
  console.log(
    [
      `occupation_family_profiles_manifest=${familyProfileArtifact.manifestPath}`,
      `source=${familyProfileArtifact.artifact.sourceName}`,
      `count=${familyProfileArtifact.artifact.count}`,
      `strings=${familyProfileArtifact.artifact.stringCount}`,
      `locale_profiles=${familyProfileArtifact.artifact.localeProfileCount}`
    ].join('  ')
  );
  console.log(
    [
      `occupation_family_token_relevance_manifest=${familyTokenRelevanceArtifact.manifestPath}`,
      `source=${familyTokenRelevanceArtifact.artifact.sourceName}`,
      `strings=${familyTokenRelevanceArtifact.artifact.stringCount}`,
      `family_keys=${familyTokenRelevanceArtifact.artifact.familyKeyCount}`,
      `family_token_values=${familyTokenRelevanceArtifact.artifact.familyTokenValueCount}`
    ].join('  ')
  );
  console.log(
    [
      `occupation_intent_vocabulary_manifest=${intentVocabularyArtifact.manifestPath}`,
      `source=${intentVocabularyArtifact.artifact.sourceName}`,
      `locales=${intentVocabularyArtifact.artifact.localeCount}`,
      `strings=${intentVocabularyArtifact.artifact.stringCount}`,
      `term_ids=${intentVocabularyArtifact.artifact.termIdCount}`,
      `phrase_ids=${intentVocabularyArtifact.artifact.phraseIdCount}`
    ].join('  ')
  );
  console.log(
    [
      `occupation_semantic_bootstrap_manifest=${semanticBootstrapArtifact.manifestPath}`,
      `locale=${semanticBootstrapArtifact.artifact.locale}`,
      `head_rule=${semanticBootstrapArtifact.artifact.headRule}`,
      `token_rules=${semanticBootstrapArtifact.artifact.tokenRules.length}`,
      `phrase_rules=${semanticBootstrapArtifact.artifact.phraseRules.length}`
    ].join('  ')
  );
  for (const aliasNgramBinaryArtifact of aliasNgramBinaryArtifacts) {
    if (!aliasNgramBinaryArtifact) {
      throw new Error('Missing required binary alias-ngram runtime artifact.');
    }

    console.log(
      [
        `occupation_alias_ngrams_binary_manifest=${aliasNgramBinaryArtifact.manifestPath}`,
        `source=${aliasNgramBinaryArtifact.manifest.sourceName}`,
        `locale=${aliasNgramBinaryArtifact.manifest.locale}`,
        `family_support=${aliasNgramBinaryArtifact.manifest.includeFamilySupportingAliases ? 'yes' : 'no'}`,
        `count=${aliasNgramBinaryArtifact.manifest.count}`,
        `strings=${aliasNgramBinaryArtifact.manifest.stringCount}`,
        `feature_keys=${aliasNgramBinaryArtifact.manifest.featurePostingKeyCount}`
      ].join('  ')
    );
  }
  console.log(
    [
      `occupation_role_head_equivalents=${roleHeadEquivalenceArtifact.artifactPath}`,
      `classes=${roleHeadEquivalenceArtifact.manifest.classCount}`,
      `terms=${roleHeadEquivalenceArtifact.manifest.termCount}`
    ].join('  ')
  );
  console.log(
    [
      `occupation_reviewed_family_signals=${reviewedFamilySignalsArtifact.artifactPath}`,
      `rules=${reviewedFamilySignalsArtifact.artifact.rules.length}`
    ].join('  ')
  );
  console.log(
    [`occupation_leaf_structure=${leafStructureArtifact.artifactPath}`, `records=${leafStructureArtifact.manifest.count}`].join('  ')
  );
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    sourceName: DEFAULT_ESCO_SOURCE_NAME
  };

  for (const arg of args) {
    if (arg.startsWith('--source-name=')) {
      options.sourceName = arg.slice('--source-name='.length).trim();
      continue;
    }

    if (arg === '--help') {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function printHelp(): void {
  console.log(['Usage: node dist/cli/check-runtime-artifacts.js', `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`].join(' '));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Runtime artifact check failed.');
  console.error(message);
  process.exitCode = 1;
});
