import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { loadOccupationFamilyProfileArtifactRequired } from '../../runtime/occupation-family-profile-artifact.js';
import { OccupationRuntimeContext } from '../../runtime/occupation-runtime-context.js';
import { loadOccupationSearchMetaArtifactRequired } from '../../runtime/occupation-search-meta-artifact.js';
import { OccupationSearchPipeline } from '../../search-pipeline/occupation-search-pipeline.js';

const SOURCE = 'esco_1_2_1';

let pipeline: OccupationSearchPipeline;
let familyLabels: string[];
let leafLabels: string[];

before(async () => {
  const runtime = await OccupationRuntimeContext.load({
    sourceName: SOURCE,
    retrievalBackend: 'binary-cache',
    aliasNgramLocales: ['en', 'ro']
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

  leafLabels = Array.from(
    new Set(
      searchMeta
        .getAllCoreRecords()
        .filter((record) => record.familyNodeId !== null && record.graphNodeId !== record.familyNodeId)
        .map((record) => record.canonicalLabel)
    )
  ).sort((left, right) => left.localeCompare(right));
});

// test('every family label ranks itself as the top family', async () => {
//   const failures: string[] = [];

//   for (const familyLabel of familyLabels) {
//     const result = await pipeline.run({
//       query: familyLabel,
//       locale: 'en',
//       sourceName: SOURCE,
//       limit: 20
//     });

//     if (result.rankedFamilies[0]?.familyLabel !== familyLabel) {
//       failures.push(`${JSON.stringify(familyLabel)} -> ${JSON.stringify(result.rankedFamilies[0]?.familyLabel ?? null)}`);
//     }
//   }

//   assert.deepEqual(failures, []);
// });

// fail fast because its about 3k
test('every leaf canonical label ranks itself as the top leaf', async () => {
  for (const leafLabel of leafLabels) {
    const result = await pipeline.run({
      query: leafLabel,
      locale: 'en',
      sourceName: SOURCE,
      limit: 20
    });

    assert.equal(
      result.rankedLeaves[0]?.canonicalLabel,
      leafLabel,
      `${JSON.stringify(leafLabel)} -> ${JSON.stringify(result.rankedLeaves[0]?.canonicalLabel ?? null)}`
    );
  }
});
