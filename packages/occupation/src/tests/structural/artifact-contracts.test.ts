import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_RUNTIME_ALIAS_NGRAM_LOCALES, OccupationRuntimeContext } from '../../runtime/occupation-runtime-context.js';
import { loadOccupationAliasNgramBinaryIfAvailable } from '../../runtime/occupation-alias-ngram-binary-artifact.js';
import { loadOccupationRetrievalIndexRequired } from '../../runtime/occupation-retrieval-index-artifact.js';
import { loadOccupationSearchMetaArtifactRequired } from '../../runtime/occupation-search-meta-artifact.js';

const SOURCE = 'esco_1_2_1';

test('runtime context default locales match deployed alias-ngram artifacts', async () => {
  assert.deepEqual(Array.from(DEFAULT_RUNTIME_ALIAS_NGRAM_LOCALES).sort(), ['en', 'et', 'hu', 'ro']);

  const runtime = await OccupationRuntimeContext.load({
    sourceName: SOURCE,
    retrievalBackend: 'binary-cache'
  });

  assert.deepEqual(runtime.aliasNgramArtifacts.map((artifact) => artifact.locale), ['en', 'et', 'hu', 'ro']);
  assert.ok(runtime.aliasNgramArtifacts.every((artifact) => artifact.binary !== null));
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
