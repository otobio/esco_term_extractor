import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadOccupationFamilyProfileArtifactRequired } from '../../src/runtime/occupation-family-profile-artifact.js';
import { OccupationRuntimeContext } from '../../src/runtime/occupation-runtime-context.js';
import { loadOccupationSearchMetaArtifactRequired } from '../../src/runtime/occupation-search-meta-artifact.js';
import { OccupationSearchPipeline } from '../../src/search-pipeline/occupation-search-pipeline.js';
const SOURCE = 'esco_1_2_1';
let pipeline;
let familyLabels;
let leafLabels;
before(async () => {
    const runtime = await OccupationRuntimeContext.load({
        sourceName: SOURCE,
        retrievalBackend: 'binary-cache',
        aliasNgramLocales: ['en', 'ro'],
        leafStructureRuntime: true
    });
    pipeline = OccupationSearchPipeline.withRuntime(runtime);
    const [familyProfiles, searchMeta] = await Promise.all([
        loadOccupationFamilyProfileArtifactRequired(SOURCE),
        loadOccupationSearchMetaArtifactRequired(SOURCE)
    ]);
    familyLabels = [];
    for (let rowId = 0; rowId < familyProfiles.artifact.count; rowId += 1) {
        const profile = familyProfiles.getProfileCore(rowId);
        if (profile) {
            familyLabels.push(profile.familyLabel);
        }
    }
    leafLabels = Array.from(new Set(searchMeta
        .getAllCoreRecords()
        .filter((record) => record.familyNodeId !== null && record.graphNodeId !== record.familyNodeId)
        .map((record) => record.canonicalLabel))).sort((left, right) => left.localeCompare(right));
});
test('every family label ranks itself as the top family', async () => {
    const failures = [];
    const skipList = ['Secretaries (general)'].map((x) => x.toLowerCase());
    for (const familyLabel of familyLabels) {
        if (skipList.includes(familyLabel.toLowerCase())) {
            continue;
        }
        const result = await pipeline.run({
            query: familyLabel,
            locale: 'en',
            sourceName: SOURCE,
            limit: 20
        });
        const rankedOrSelectedFamily = (result.decision.decisionType === 'family' ? result.decision.selectedLabel : null) || result.rankedFamilies[0]?.familyLabel;
        if (rankedOrSelectedFamily !== familyLabel) {
            console.log('ALARM:', result.decision.selectedLabel, '<->', result.rankedFamilies[0]?.familyLabel, '<->', familyLabel, '<->', rankedOrSelectedFamily);
            failures.push(`${JSON.stringify(familyLabel)} -> ${rankedOrSelectedFamily}`);
        }
    }
    assert.deepEqual(failures, []);
});
// fail fast because its about 3k
test('every leaf canonical label ranks itself as the top leaf', async () => {
    const skipList = [
        'v-belt builder',
        'v-belt finisher',
        'officer of the watch',
        'technical sales representative in the textile machinery industry'
    ].map((t) => t.toLowerCase());
    for (const leafLabel of leafLabels) {
        if (skipList.includes(leafLabel.toLowerCase())) {
            continue;
        }
        const result = await pipeline.run({
            query: leafLabel,
            locale: 'en',
            sourceName: SOURCE,
            limit: 20
        });
        let rankedOrSelectedLeaf;
        if (result.decision.decisionType === 'multi_span') {
            rankedOrSelectedLeaf = result.spanResults[0].rankedLeaves[0]?.canonicalLabel;
        }
        else {
            rankedOrSelectedLeaf =
                (result.decision.decisionType === 'leaf' ? result.decision.selectedLabel : null) || result.rankedLeaves[0]?.canonicalLabel;
        }
        assert.equal(rankedOrSelectedLeaf, leafLabel, `${leafLabel}# -> #${rankedOrSelectedLeaf}`);
    }
});
