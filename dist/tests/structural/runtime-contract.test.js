import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parse } from 'csv-parse/sync';
import { isSearchAliasRole } from '../../src/query/alias-role-policy.js';
import { isAliasNgramFamilySupportEnabled, isAliasNgramRetrievalEnabled, retrievalSurfaceLocales } from '../../src/retrieval/occupation-candidates.js';
import { configuredRetrievalBackend, parseRetrievalBackend } from '../../src/retrieval/retrieval-engine-factory.js';
import { OccupationRuntimeContext } from '../../src/runtime/occupation-runtime-context.js';
import { loadOccupationSearchMetaArtifactRequired } from '../../src/runtime/occupation-search-meta-artifact.js';
import { loadOccupationSignalVocabularyArtifactRequired } from '../../src/runtime/occupation-signal-vocabulary-artifact.js';
import { isEnglishQuery, isEnglishWord } from '../../src/utils/lang.js';
import { reviewedLeafSubFamilyOverrides, reviewedSubFamilyFamilyOverrides } from '../../src/runtime/occupation-taxonomy-family-overrides.js';
import { OccupationSearchPipeline } from '../../src/search-pipeline/occupation-search-pipeline.js';
import { getCachedRuntimeArtifact } from '../../src/utils/runtime-artifact-cache.js';
const ENGLISH_OCCUPATION_PHRASES = [
    'software developer',
    'data engineer',
    'primary school teacher',
    'financial accountant',
    'graphic designer',
    'internal auditor',
    'field technician',
    'forklift operator',
    'kitchen assistant',
    'data analyst',
    'business consultant',
    'project director',
    'logistics coordinator',
    'marketing specialist',
    'restaurant supervisor',
    'frontend developer',
    'backend programmer',
    'fullstack developer',
    'cloud architect',
    'truck driver',
    'maintenance electrician',
    'diesel mechanic',
    'industrial plumber',
    'site carpenter',
    'pastry chef',
    'head waiter',
    'cocktail bartender',
    'bread baker',
    'meat butcher',
    'retail cashier',
    'front desk receptionist',
    'hospital pharmacist',
    'dental hygienist',
    'registered nurse',
    'staff midwife',
    'physical therapist',
    'clinical psychologist',
    'labor economist',
    'research statistician',
    'school librarian',
    'news journalist',
    'legal translator',
    'court interpreter',
    'arc welder',
    'tile roofer',
    'stone bricklayer',
    'master locksmith',
    'land surveyor',
    'senior actuary',
    'wine sommelier',
    'podcast producer',
    'technical recruiter',
    'office cleaner',
    'landscape gardener',
    'shop florist',
    'warehouse picker',
    'frontend developer and backend developer',
    'frontend developer or backend developer',
    'frontend developer or backend developer',
    'Head of Engineering'
];
const NON_ENGLISH_OCCUPATION_PHRASES = [
    'constructor inginer',
    'magazin vanzator',
    'lucrator comercial',
    'restaurant supervizor',
    'ajutor bucatar',
    'senior contabil',
    'autobuz sofer',
    'medicala asistenta',
    'date analist',
    'software dezvoltator'
];
test('package runtime artifact build excludes model artifact workflow', async () => {
    const packageJson = JSON.parse(await readFile('package.json', 'utf8'));
    const scripts = packageJson.scripts ?? {};
    assert.match(scripts['runtime:artifacts-build'] ?? '', /retrieval:index:export/u);
    assert.match(scripts['runtime:artifacts-build'] ?? '', /retrieval:aliases:ngram:export/u);
    assert.match(scripts['runtime:artifacts-build'] ?? '', /query:reviewed-family-signals:export/u);
    assert.match(scripts['runtime:artifacts-build'] ?? '', /query:family-token-relevance:export/u);
});
test('search alias role policy includes english backbone aliases', () => {
    assert.equal(isSearchAliasRole('english_backbone', false), true);
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
test('non-English retrieval surfaces include English fallback', () => {
    assert.deepEqual(retrievalSurfaceLocales('en'), ['en']);
    assert.deepEqual(retrievalSurfaceLocales('ro'), ['ro', 'en']);
    assert.deepEqual(retrievalSurfaceLocales('hu'), ['hu', 'en']);
    assert.deepEqual(retrievalSurfaceLocales('et'), ['et', 'en']);
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
    }
    finally {
        restoreEnv('OSE_RETRIEVAL_BACKEND', previousBackend);
    }
});
test('memory-heavy runtime-cache backend is not selectable', () => {
    assert.throws(() => parseRetrievalBackend('runtime-cache'), /Expected "opensearch" or "binary-cache"/u);
});
test('runtime artifact cache is bounded and invalidates when the manifest changes', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'ose-runtime-cache-'));
    const manifestPath = path.join(directory, 'manifest.json');
    const otherManifestPath = path.join(directory, 'other-manifest.json');
    const cache = new Map();
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
test('signal vocabulary runtime artifact carries an english-token bitset', async () => {
    const artifact = await loadOccupationSignalVocabularyArtifactRequired('esco_1_2_1');
    assert.equal(artifact.artifact.schemaVersion, 2);
    assert.equal(artifact.artifact.englishTokenBits.count, artifact.artifact.tokenCount);
    for (const phrase of ENGLISH_OCCUPATION_PHRASES) {
        assert.equal(await isEnglishQuery(phrase, 'esco_1_2_1'), true, `expected English query bit coverage for ${phrase}`);
    }
    for (const phrase of NON_ENGLISH_OCCUPATION_PHRASES) {
        assert.equal(await isEnglishQuery(phrase, 'esco_1_2_1'), false, `expected non-English query rejection for ${phrase}`);
    }
});
test('reviewed taxonomy family overrides remap sub-family leaves consistently', async () => {
    const artifact = await loadOccupationSearchMetaArtifactRequired('esco_1_2_1');
    const webDesigner = artifact.getCoreRecord(15902);
    assert.ok(webDesigner);
    assert.equal(webDesigner.canonicalLabel, 'web designer');
    assert.equal(webDesigner.groupNodeId, 14805);
    assert.equal(webDesigner.groupLabel, 'Web and multimedia developers');
    assert.equal(webDesigner.familyNodeId, 14802);
    assert.equal(webDesigner.familyLabel, 'Software and applications developers and analysts');
    assert.ok(webDesigner.ancestors.some((ancestor) => ancestor.ancestorRole === 'family' &&
        ancestor.graphNodeId === 14802 &&
        ancestor.canonicalLabel === 'Software and applications developers and analysts'));
    assert.equal(webDesigner.ancestors.some((ancestor) => ancestor.ancestorRole === 'family' && ancestor.graphNodeId === 14739), false);
    const oldFamilyLeaves = artifact.getLeafCoreRecordsForFamilies([14739]);
    const newFamilyLeaves = artifact.getLeafCoreRecordsForFamilies([14802]);
    assert.equal(oldFamilyLeaves.some((record) => record.graphNodeId === 15902), false);
    assert.equal(newFamilyLeaves.some((record) => record.graphNodeId === 15902), true);
    const psychologist = artifact.getCoreRecord(16310);
    assert.ok(psychologist);
    assert.equal(psychologist.groupNodeId, 14825);
    assert.equal(psychologist.groupLabel, 'Psychologists');
    assert.equal(psychologist.familyNodeId, 14759);
    assert.equal(psychologist.familyLabel, 'Other health professionals');
});
test('reviewed leaf sub-family overrides mirror the review CSV actions', async () => {
    const csvText = await readFile('data/taxonomy-review/esco-leaf-subfamily-overrides.csv', 'utf8');
    const rows = parse(csvText, {
        columns: true,
        skip_empty_lines: true
    });
    const csvMoves = rows
        .map((row) => ({
        sourceName: row.source_name,
        leafNodeId: Number.parseInt(row.leaf_node_id, 10),
        leafLabel: row.leaf_label,
        targetSubFamilyNodeId: Number.parseInt(row.target_sub_family_node_id, 10),
        targetSubFamilyLabel: row.target_sub_family_label,
        targetFamilyNodeId: Number.parseInt(row.target_family_node_id, 10),
        targetFamilyLabel: row.target_family_label,
        note: row.review_note
    }))
        .sort((left, right) => left.leafNodeId - right.leafNodeId);
    const codeMoves = [...reviewedLeafSubFamilyOverrides()]
        .map((override) => ({ ...override }))
        .sort((left, right) => left.leafNodeId - right.leafNodeId);
    assert.deepEqual(codeMoves, csvMoves);
});
test('reviewed sub-family family overrides mirror the review CSV actions', async () => {
    const csvText = await readFile('data/taxonomy-review/esco-subfamily-family-overrides.csv', 'utf8');
    const rows = parse(csvText, {
        columns: true,
        skip_empty_lines: true
    });
    const csvMoves = rows
        .map((row) => ({
        sourceName: row.source_name,
        subFamilyNodeId: Number.parseInt(row.sub_family_node_id, 10),
        subFamilyLabel: row.sub_family_label,
        targetFamilyNodeId: Number.parseInt(row.target_family_node_id, 10),
        targetFamilyLabel: row.target_family_label,
        note: row.review_note
    }))
        .sort((left, right) => left.subFamilyNodeId - right.subFamilyNodeId);
    const codeMoves = [...reviewedSubFamilyFamilyOverrides()]
        .map((override) => ({ ...override }))
        .sort((left, right) => left.subFamilyNodeId - right.subFamilyNodeId);
    assert.deepEqual(codeMoves, csvMoves);
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
test('offline runtime pipeline applies taxonomy override to web designer family', async () => {
    const runtime = await OccupationRuntimeContext.load({
        sourceName: 'esco_1_2_1',
        retrievalBackend: 'binary-cache'
    });
    const pipeline = OccupationSearchPipeline.withRuntime(runtime);
    const result = await pipeline.run({
        query: 'website designer',
        locale: 'en',
        sourceName: 'esco_1_2_1',
        limit: 20
    });
    assert.equal(result.decision.decisionType, 'leaf');
    assert.equal(result.decision.selectedLabel, 'web designer');
    assert.equal(result.rankedFamilies[0]?.familyNodeId, 14802);
    assert.equal(result.rankedFamilies[0]?.familyLabel, 'Software and applications developers and analysts');
});
test('signal vocabulary bitset identifies English occupation phrases directly', async () => {
    for (const phrase of ENGLISH_OCCUPATION_PHRASES) {
        assert.equal(await isEnglishQuery(phrase, 'esco_1_2_1'), true, `expected English phrase: ${phrase}`);
    }
    for (const phrase of NON_ENGLISH_OCCUPATION_PHRASES) {
        assert.equal(await isEnglishQuery(phrase, 'esco_1_2_1'), false, `expected non-English phrase: ${phrase}`);
    }
});
test('signal vocabulary bitset stays word-scoped for multi-word phrases', async () => {
    for (const phrase of ENGLISH_OCCUPATION_PHRASES.slice(0, 10)) {
        assert.equal(await isEnglishWord(phrase, 'esco_1_2_1'), false, `expected phrase to be rejected: ${phrase}`);
    }
});
test('high-confidence English titles use the English surface as the primary retrieval', async () => {
    const runtime = await OccupationRuntimeContext.load({
        sourceName: 'esco_1_2_1',
        retrievalBackend: 'binary-cache'
    });
    const pipeline = OccupationSearchPipeline.withRuntime(runtime);
    const result = await pipeline.run({
        query: 'data engineer',
        locale: 'ro',
        sourceName: 'esco_1_2_1',
        limit: 20
    });
    assert.equal(result.decision.decisionType, 'leaf');
    assert.equal(result.decision.selectedLabel, 'data engineer');
    assert.equal(result.debug.attempts.length, 1);
    assert.equal(result.debug.attempts[0]?.kind, 'primary');
    assert.equal(result.debug.attempts[0]?.status, 'used');
    assert.equal(result.debug.attempts[0]?.decisionType, 'leaf');
});
test('weak English-looking noise stays on the primary retrieval path', async () => {
    const runtime = await OccupationRuntimeContext.load({
        sourceName: 'esco_1_2_1',
        retrievalBackend: 'binary-cache'
    });
    const pipeline = OccupationSearchPipeline.withRuntime(runtime);
    const result = await pipeline.run({
        query: 'Sales Personnel',
        locale: 'ro',
        sourceName: 'esco_1_2_1',
        limit: 20
    });
    assert.equal(result.debug.attempts.length, 1);
    assert.equal(result.debug.attempts[0]?.kind, 'primary');
});
test('sure English titles resolve through the primary English surface', async () => {
    const runtime = await OccupationRuntimeContext.load({
        sourceName: 'esco_1_2_1',
        retrievalBackend: 'binary-cache'
    });
    const pipeline = OccupationSearchPipeline.withRuntime(runtime);
    const result = await pipeline.run({
        query: 'English teacher',
        locale: 'ro',
        sourceName: 'esco_1_2_1',
        limit: 20
    });
    assert.equal(result.debug.attempts.length, 1);
    assert.equal(result.debug.attempts[0]?.kind, 'primary');
});
test('English-looking queries under non-English locales can prefer the English full-branch result', async () => {
    const runtime = await OccupationRuntimeContext.load({
        sourceName: 'esco_1_2_1',
        retrievalBackend: 'binary-cache'
    });
    const pipeline = OccupationSearchPipeline.withRuntime(runtime);
    const englishResult = await pipeline.run({
        query: 'Sales Personnel',
        locale: 'en',
        sourceName: 'esco_1_2_1',
        limit: 20
    });
    const romanianLocaleResult = await pipeline.run({
        query: 'Sales Personnel',
        locale: 'ro',
        sourceName: 'esco_1_2_1',
        limit: 20
    });
    assert.equal(romanianLocaleResult.queryContext.locale, 'en');
    assert.equal(romanianLocaleResult.decision.decisionType, englishResult.decision.decisionType);
    assert.equal(romanianLocaleResult.rankedFamilies[0]?.familyNodeId, englishResult.rankedFamilies[0]?.familyNodeId);
    assert.equal(romanianLocaleResult.rankedFamilies[0]?.familyLabel, englishResult.rankedFamilies[0]?.familyLabel);
});
test('mixed non-English locale query does not override to English unless the whole query is English', async () => {
    const runtime = await OccupationRuntimeContext.load({
        sourceName: 'esco_1_2_1',
        retrievalBackend: 'binary-cache'
    });
    const pipeline = OccupationSearchPipeline.withRuntime(runtime);
    const romanianResult = await pipeline.run({
        query: 'Fundamental Productivity Technologies',
        locale: 'ro',
        sourceName: 'esco_1_2_1',
        limit: 20
    });
    assert.equal(await isEnglishQuery('Fundamental Productivity Technologies', 'esco_1_2_1'), false);
    assert.equal(romanianResult.queryContext.locale, 'ro');
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
test('alias phrase-window fallback resolves a head word whose modifier never appears adjacent in any alias', async () => {
    const runtime = await OccupationRuntimeContext.load({
        sourceName: 'esco_1_2_1',
        retrievalBackend: 'binary-cache'
    });
    const pipeline = OccupationSearchPipeline.withRuntime(runtime);
    const result = await pipeline.run({
        query: 'Security Personnel',
        locale: 'en',
        sourceName: 'esco_1_2_1',
        limit: 20
    });
    assert.equal(result.decision.decisionType, 'family');
    assert.equal(result.decision.selectedLabel, 'Protective services workers');
    assert.ok(result.decision.confidence >= 0.6);
});
test('alias phrase-window fallback does not let a generic wrapper token override the true role head', async () => {
    const runtime = await OccupationRuntimeContext.load({
        sourceName: 'esco_1_2_1',
        retrievalBackend: 'binary-cache'
    });
    const pipeline = OccupationSearchPipeline.withRuntime(runtime);
    const result = await pipeline.run({
        query: 'Media Personnel',
        locale: 'en',
        sourceName: 'esco_1_2_1',
        limit: 20
    });
    assert.equal(result.decision.decisionType, 'family');
    assert.equal(result.decision.selectedLabel, 'Sales, marketing and public relations professionals');
});
function restoreEnv(key, value) {
    if (value === undefined) {
        delete process.env[key];
        return;
    }
    process.env[key] = value;
}
