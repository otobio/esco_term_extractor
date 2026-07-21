import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { isAliasNgramFamilySupportEnabled, isAliasNgramRetrievalEnabled } from '../../retrieval/occupation-candidates.js';
import { configuredRetrievalBackend } from '../../retrieval/retrieval-engine-factory.js';
import { OccupationRuntimeContext } from '../../runtime/occupation-runtime-context.js';
import { OccupationSearchPipeline } from '../../search-pipeline/occupation-search-pipeline.js';
test('package runtime artifact build excludes dense embedding workflow', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
    const scripts = packageJson.scripts ?? {};
    assert.equal(scripts['embeddings:occupations'], undefined);
    assert.equal(scripts['embeddings:export-runtime'], undefined);
    assert.match(scripts['runtime:artifacts-build'] ?? '', /retrieval:index:export/u);
    assert.match(scripts['runtime:artifacts-build'] ?? '', /retrieval:aliases:ngram:export/u);
    assert.doesNotMatch(scripts['runtime:artifacts-build'] ?? '', /embedding|vector/iu);
    assert.equal(packageJson.dependencies?.['@huggingface/transformers'], undefined);
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
    }
    finally {
        restoreEnv('OSE_DISABLE_NGRAM_ALIAS_RETRIEVAL', previousRetrievalDisable);
        restoreEnv('OSE_ENABLE_NGRAM_ALIAS_RETRIEVAL', previousRetrievalEnable);
        restoreEnv('OSE_DISABLE_NGRAM_ALIAS_FAMILY_SUPPORT', previousFamilyDisable);
        restoreEnv('OSE_ENABLE_NGRAM_ALIAS_FAMILY_SUPPORT', previousFamilyEnable);
    }
});
test('runtime context boots deterministic binary-cache artifacts centrally', async () => {
    const runtime = await OccupationRuntimeContext.load({
        sourceName: 'esco_1_2_1',
        retrievalBackend: 'binary-cache',
        aliasNgramLocales: ['en']
    });
    assert.equal(runtime.sourceName, 'esco_1_2_1');
    assert.equal(runtime.retrievalBackend, 'binary-cache');
    assert.equal(runtime.aliasNgramArtifacts.length, 1);
    assert.equal(runtime.aliasNgramArtifacts[0]?.locale, 'en');
    assert.ok(runtime.aliasNgramArtifacts[0]?.binary);
});
test('binary-cache is the default runtime retrieval backend', () => {
    const previousBackend = process.env.OSE_RETRIEVAL_BACKEND;
    try {
        delete process.env.OSE_RETRIEVAL_BACKEND;
        assert.equal(configuredRetrievalBackend(), 'binary-cache');
    }
    finally {
        restoreEnv('OSE_RETRIEVAL_BACKEND', previousBackend);
    }
});
test('offline runtime pipeline resolves an exact title through binary-cache', async () => {
    const runtime = await OccupationRuntimeContext.load({
        sourceName: 'esco_1_2_1',
        retrievalBackend: 'binary-cache',
        aliasNgramLocales: ['en']
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
    assert.equal(result.queryContext.scannedDenseEmbeddingCount, 0);
    assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'ngram_alias'));
});
function restoreEnv(key, value) {
    if (value === undefined) {
        delete process.env[key];
        return;
    }
    process.env[key] = value;
}
