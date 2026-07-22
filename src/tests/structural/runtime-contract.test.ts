import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  isAliasNgramFamilySupportEnabled,
  isAliasNgramRetrievalEnabled
} from '../../retrieval/occupation-candidates.js';
import { configuredRetrievalBackend, parseRetrievalBackend } from '../../retrieval/retrieval-engine-factory.js';
import { OccupationRuntimeContext } from '../../runtime/occupation-runtime-context.js';
import { OccupationSearchPipeline } from '../../search-pipeline/occupation-search-pipeline.js';
import {
  getCachedRuntimeArtifact,
  type RuntimeArtifactCacheEntry
} from '../../utils/runtime-artifact-cache.js';

test('package runtime artifact build excludes model artifact workflow', async () => {
  const packageJson = JSON.parse(await readFile('package.json', 'utf8')) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
  };
  const scripts = packageJson.scripts ?? {};

  assert.match(scripts['runtime:artifacts-build'] ?? '', /retrieval:index:export/u);
  assert.match(scripts['runtime:artifacts-build'] ?? '', /retrieval:aliases:ngram:export/u);
});

test('alias ngram retrieval and family support default on with explicit disable switches', () => {
  const previousRetrievalDisable = process.env.OSE_DISABLE_NGRAM_ALIAS_RETRIEVAL;
  const previousRetrievalEnable = process.env.OSE_ENABLE_NGRAM_ALIAS_RETRIEVAL;
  const previousFamilyDisable = process.env.OSE_DISABLE_NGRAM_ALIAS_FAMILY_SUPPORT;
  const previousFamilyEnable = process.env.OSE_ENABLE_NGRAM_ALIAS_FAMILY_SUPPORT;

  try {
    delete process.env.OSE_DISABLE_NGRAM_ALIAS_RETRIEVAL;
    delete process.env.OSE_ENABLE_NGRAM_ALIAS_RETRIEVAL;
    delete process.env.OSE_DISABLE_NGRAM_ALIAS_FAMILY_SUPPORT;
    delete process.env.OSE_ENABLE_NGRAM_ALIAS_FAMILY_SUPPORT;

    assert.equal(isAliasNgramRetrievalEnabled(), true);
    assert.equal(isAliasNgramFamilySupportEnabled(), true);

    process.env.OSE_DISABLE_NGRAM_ALIAS_RETRIEVAL = '1';
    process.env.OSE_DISABLE_NGRAM_ALIAS_FAMILY_SUPPORT = '1';

    assert.equal(isAliasNgramRetrievalEnabled(), false);
    assert.equal(isAliasNgramFamilySupportEnabled(), false);

    delete process.env.OSE_DISABLE_NGRAM_ALIAS_RETRIEVAL;
    delete process.env.OSE_DISABLE_NGRAM_ALIAS_FAMILY_SUPPORT;
    process.env.OSE_ENABLE_NGRAM_ALIAS_RETRIEVAL = '0';
    process.env.OSE_ENABLE_NGRAM_ALIAS_FAMILY_SUPPORT = 'false';

    assert.equal(isAliasNgramRetrievalEnabled(), false);
    assert.equal(isAliasNgramFamilySupportEnabled(), false);
  } finally {
    restoreEnv('OSE_DISABLE_NGRAM_ALIAS_RETRIEVAL', previousRetrievalDisable);
    restoreEnv('OSE_ENABLE_NGRAM_ALIAS_RETRIEVAL', previousRetrievalEnable);
    restoreEnv('OSE_DISABLE_NGRAM_ALIAS_FAMILY_SUPPORT', previousFamilyDisable);
    restoreEnv('OSE_ENABLE_NGRAM_ALIAS_FAMILY_SUPPORT', previousFamilyEnable);
  }
});

test('runtime context boots deterministic binary-cache artifacts centrally', async () => {
  const runtime = await OccupationRuntimeContext.load({
    sourceName: 'esco_1_2_1',
    retrievalBackend: 'binary-cache'
  });

  assert.equal(runtime.sourceName, 'esco_1_2_1');
  assert.equal(runtime.retrievalBackend, 'binary-cache');
  assert.equal(runtime.aliasNgramArtifacts.length, 0);
});

test('binary-cache is the default runtime retrieval backend', () => {
  const previousBackend = process.env.OSE_RETRIEVAL_BACKEND;

  try {
    delete process.env.OSE_RETRIEVAL_BACKEND;

    assert.equal(configuredRetrievalBackend(), 'binary-cache');
  } finally {
    restoreEnv('OSE_RETRIEVAL_BACKEND', previousBackend);
  }
});

test('memory-heavy runtime-cache backend is not selectable', () => {
  assert.throws(
    () => parseRetrievalBackend('runtime-cache'),
    /Expected "opensearch" or "binary-cache"/u
  );
});

test('runtime artifact cache is bounded and invalidates when the manifest changes', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'ose-runtime-cache-'));
  const manifestPath = path.join(directory, 'manifest.json');
  const otherManifestPath = path.join(directory, 'other-manifest.json');
  const cache = new Map<string, RuntimeArtifactCacheEntry<{ loadId: number }>>();
  let loadCount = 0;

  await writeFile(manifestPath, '{"version":1}\n');
  await writeFile(otherManifestPath, '{"version":1}\n');

  const first = await getCachedRuntimeArtifact(cache, 'primary', manifestPath, {
    maxSize: 1,
    load: async () => ({ loadId: ++loadCount })
  });
  const second = await getCachedRuntimeArtifact(cache, 'primary', manifestPath, {
    maxSize: 1,
    load: async () => ({ loadId: ++loadCount })
  });

  assert.equal(first?.loadId, 1);
  assert.equal(second?.loadId, 1);

  await writeFile(manifestPath, '{"version":2,"changed":true}\n');
  const reloaded = await getCachedRuntimeArtifact(cache, 'primary', manifestPath, {
    maxSize: 1,
    load: async () => ({ loadId: ++loadCount })
  });

  assert.equal(reloaded?.loadId, 2);

  await getCachedRuntimeArtifact(cache, 'secondary', otherManifestPath, {
    maxSize: 1,
    load: async () => ({ loadId: ++loadCount })
  });

  assert.equal(cache.has('primary'), false);
  assert.equal(cache.has('secondary'), true);
});

test('offline runtime pipeline resolves an exact title through binary-cache', async () => {
  const runtime = await OccupationRuntimeContext.load({
    sourceName: 'esco_1_2_1',
    retrievalBackend: 'binary-cache'
  });
  const pipeline = OccupationSearchPipeline.withRuntime(runtime);
  const result = await pipeline.run({
    query: 'software developer',
    locale: 'en',
    sourceName: 'esco_1_2_1',
    limit: 20
  });

  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.decision.selectedLabel, 'software developer');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'exact_alias'));
});

test('pipeline keeps heavy debug internals opt-in and caps production result breadth', async () => {
  const runtime = await OccupationRuntimeContext.load({
    sourceName: 'esco_1_2_1',
    retrievalBackend: 'binary-cache'
  });
  const pipeline = OccupationSearchPipeline.withRuntime(runtime);
  const productionResult = await pipeline.run({
    query: 'Fullstack developer',
    locale: 'en',
    sourceName: 'esco_1_2_1',
    topFamilyLimit: 20,
    topLeavesPerFamily: 20
  });

  assert.equal(productionResult.debug.rawBranchExpansion, null);
  assert.equal(productionResult.debug.stages.length, 0);
  assert.ok(productionResult.rankedFamilies.length <= 3);
  assert.ok(productionResult.rankedFamilies.every((family) => family.leaves.length <= 3));

  const debugResult = await pipeline.run({
    query: 'Fullstack developer',
    locale: 'en',
    sourceName: 'esco_1_2_1',
    topFamilyLimit: 5,
    topLeavesPerFamily: 5,
    debug: true
  });

  assert.ok(debugResult.debug.rawBranchExpansion);
  assert.ok(debugResult.debug.stages.length > 0);
  assert.ok(debugResult.rankedFamilies.length > productionResult.rankedFamilies.length);
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
