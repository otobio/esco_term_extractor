import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_RUNTIME_ALIAS_NGRAM_LOCALES, OccupationRuntimeContext } from '../../runtime/occupation-runtime-context.js';
import { loadOccupationAliasNgramBinaryIfAvailable } from '../../runtime/occupation-alias-ngram-binary-artifact.js';
import {
  FAMILY_PROFILE_BINARY_SCHEMA_VERSION,
  loadOccupationFamilyProfileArtifactRequired
} from '../../runtime/occupation-family-profile-artifact.js';
import {
  FAMILY_TOKEN_RELEVANCE_BINARY_SCHEMA_VERSION,
  loadOccupationFamilyTokenRelevanceArtifactRequired
} from '../../runtime/occupation-family-token-relevance-artifact.js';
import { loadOccupationRetrievalIndexRequired } from '../../runtime/occupation-retrieval-index-artifact.js';
import {
  SEARCH_META_BINARY_SCHEMA_VERSION,
  loadOccupationSearchMetaArtifactRequired
} from '../../runtime/occupation-search-meta-artifact.js';
import { loadOccupationReviewedFamilySignalsArtifactRequired } from '../../runtime/occupation-reviewed-family-signals.js';

const SOURCE = 'esco_1_2_1';

test('runtime context leaves deployed alias-ngram artifacts lazy', async () => {
  assert.deepEqual(Array.from(DEFAULT_RUNTIME_ALIAS_NGRAM_LOCALES).sort(), ['en', 'et', 'hu', 'ro']);

  const runtime = await OccupationRuntimeContext.load({
    sourceName: SOURCE,
    retrievalBackend: 'binary-cache'
  });

  assert.equal(runtime.aliasNgramArtifacts.length, 0);
});

test('binary retrieval index manifest is internally consistent with search-meta source', async () => {
  const [searchMeta, retrievalIndex] = await Promise.all([
    loadOccupationSearchMetaArtifactRequired(SOURCE),
    loadOccupationRetrievalIndexRequired(SOURCE)
  ]);

  assert.equal(retrievalIndex.manifest.sourceName, searchMeta.artifact.sourceName);
  assert.equal(retrievalIndex.manifest.textRecordCount, searchMeta.artifact.count);
  assert.ok(retrievalIndex.manifest.aliasRowCount > searchMeta.artifact.count);
  assert.ok(retrievalIndex.manifest.stringCount > retrievalIndex.manifest.textRecordCount);
  assert.ok(retrievalIndex.manifest.locales.includes('en'));
  assert.ok(retrievalIndex.manifest.locales.includes('ro'));
});

test('binary search-meta artifact exposes core, detail, and family accessors', async () => {
  const searchMeta = await loadOccupationSearchMetaArtifactRequired(SOURCE);
  const softwareDeveloper = searchMeta.getAllCoreRecords().find((record) => record.canonicalLabel === 'software developer');

  assert.ok(softwareDeveloper);

  const softwareDeveloperDetails = searchMeta.getDetails(softwareDeveloper.graphNodeId);
  const softwareFamilyId = softwareDeveloper.familyNodeId;

  assert.ok(softwareFamilyId);

  const softwareFamilyLeaves = searchMeta.getLeafCoreRecordsForFamilies([softwareFamilyId]);

  assert.equal(searchMeta.manifest.schemaVersion, SEARCH_META_BINARY_SCHEMA_VERSION);
  assert.equal(searchMeta.coreRows.count, searchMeta.manifest.count);
  assert.equal(searchMeta.detailRows.count, searchMeta.manifest.detailCount);
  assert.equal(searchMeta.aliasRows.count, searchMeta.manifest.aliasCount);
  assert.equal(searchMeta.capabilityRows.count, searchMeta.manifest.capabilityCount);
  assert.ok(searchMeta.manifest.capabilityCount > 0);
  assert.equal(softwareDeveloper?.canonicalLabel, 'software developer');
  assert.ok((softwareDeveloperDetails?.aliases.length ?? 0) > 0);
  assert.ok((softwareDeveloperDetails?.capabilityLabels.length ?? 0) > 0);
  assert.ok(softwareFamilyLeaves.some((record) => record.graphNodeId === softwareDeveloper.graphNodeId));
});

test('binary family-profile artifact exposes table accessors without JSONL records', async () => {
  const artifact = await loadOccupationFamilyProfileArtifactRequired(SOURCE);
  const firstProfile = artifact.getProfileCore(0);

  assert.equal(artifact.artifact.schemaVersion, FAMILY_PROFILE_BINARY_SCHEMA_VERSION);
  assert.equal(artifact.profileRows.count, artifact.artifact.count);
  assert.equal(artifact.localeRows.count, artifact.artifact.localeProfileCount);
  assert.equal(artifact.sourceRows.count, artifact.artifact.sourceRowCount);
  assert.equal(artifact.profileTokenIndex.count, artifact.artifact.profileTokenKeyCount);
  assert.ok(firstProfile);
  assert.ok(firstProfile.familyNodeId > 0);
  assert.ok(firstProfile.familyLabel.length > 0);
  assert.ok(artifact.getLocaleProfile(firstProfile, 'en') ?? artifact.getLocaleProfile(firstProfile, 'unknown'));
  assert.ok(artifact.profileRowIdsForTokens('en', ['developer']).length > 0);
});

test('binary alias-ngram artifacts are present for runtime locales and use family support', async () => {
  for (const locale of DEFAULT_RUNTIME_ALIAS_NGRAM_LOCALES) {
    const artifact = await loadOccupationAliasNgramBinaryIfAvailable(SOURCE, locale, true);

    assert.ok(artifact, `missing binary alias-ngram artifact for ${locale}`);
    assert.equal(artifact.manifest.sourceName, SOURCE);
    assert.equal(artifact.manifest.locale, locale);
    assert.equal(artifact.manifest.includeFamilySupportingAliases, true);
    assert.ok(artifact.manifest.count > 0);
    assert.ok(artifact.manifest.featurePostingKeyCount > 0);
    assert.equal(artifact.rows.count, artifact.manifest.count);
  }
});

test('binary family-token relevance artifact exposes lazy lookup accessors', () => {
  const artifact = loadOccupationFamilyTokenRelevanceArtifactRequired(SOURCE);

  assert.equal(artifact.artifact.schemaVersion, FAMILY_TOKEN_RELEVANCE_BINARY_SCHEMA_VERSION);
  assert.equal(artifact.familyRows.count, artifact.artifact.familyKeyCount);
  assert.equal(artifact.genericityLocaleRows.count, artifact.artifact.genericityLocaleCount);
  assert.ok(artifact.familyTokenRows.count > 0);
  assert.ok(artifact.genericityTokenRows.count > 0);
  assert.ok(artifact.maxTokenRelevance('en', 'developer') > 0);
  assert.ok(artifact.familyTokenRelevance('en', 14802, 'developer') > 0);
});

test('reviewed family signal artifact exposes bounded support and suppression rules', () => {
  const artifact = loadOccupationReviewedFamilySignalsArtifactRequired();

  assert.ok(artifact.artifact.rules.length >= 4);
  assert.ok(artifact.artifact.rules.some((rule) => rule.action === 'support'));
  assert.ok(artifact.artifact.rules.some((rule) => rule.action === 'suppress'));
  assert.ok(artifact.artifact.rules.some((rule) => rule.familyNodeId === 15139));
  assert.ok(artifact.artifact.rules.some((rule) => rule.familyNodeId === 15204));
});
