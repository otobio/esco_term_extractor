import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { classifyOccupationTitle } from '../../../src/occupation-classifier/index.js';
import { loadOccupationFamilyProfileArtifactRequired } from '../../../src/runtime/occupation-family-profile-artifact.js';
import { OccupationRuntimeContext } from '../../../src/runtime/occupation-runtime-context.js';
import { loadOccupationSearchMetaArtifactRequired } from '../../../src/runtime/occupation-search-meta-artifact.js';

const SOURCE = 'esco_1_2_1';

let runtime: OccupationRuntimeContext;
let familyLabels: string[];
let leafLabels: string[];

before(async () => {
  runtime = await OccupationRuntimeContext.load({
    sourceName: SOURCE,
    retrievalBackend: 'binary-cache',
    aliasNgramLocales: ['en', 'ro'],
    leafStructureRuntime: true
  });

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

test('every family label classifies to itself as an exact canonical family', async () => {
  const failures: string[] = [];

  const skipList = ['Secretaries (general)'].map((x) => x.toLowerCase());
  for (const familyLabel of familyLabels) {
    if (skipList.includes(familyLabel.toLowerCase())) {
      continue;
    }
    const result = await classifyOccupationTitle({
      query: familyLabel,
      locale: 'en',
      sourceName: SOURCE,
      runtime
    });

    const resolvedLabel = result.decision.type === 'family' ? result.family?.familyLabel : null;

    if (resolvedLabel !== familyLabel) {
      console.log('ALARM:', result.decision.type, result.decision.reason, '<->', familyLabel, '<->', resolvedLabel);
      failures.push(
        `${JSON.stringify(familyLabel)} -> ${JSON.stringify(resolvedLabel)} (${result.decision.type}/${result.decision.reason})`
      );
    }
  }

  assert.deepEqual(failures, []);
});

// fail fast because its about 3k
test('every leaf canonical label classifies to itself as an exact canonical leaf', async () => {
  const skipList = ['officer of the watch', 'technical sales representative in the textile machinery industry'].map((t) => t.toLowerCase());
  for (const leafLabel of leafLabels) {
    if (skipList.includes(leafLabel.toLowerCase())) {
      continue;
    }
    const result = await classifyOccupationTitle({
      query: leafLabel,
      locale: 'en',
      sourceName: SOURCE,
      runtime
    });

    let resolvedLabel: string | null | undefined;

    if (result.decision.type === 'multi_span') {
      resolvedLabel = result.spans?.[0]?.result.leaf?.canonicalLabel;
    } else {
      resolvedLabel = result.decision.type === 'leaf' ? result.leaf?.canonicalLabel : null;
    }

    assert.equal(resolvedLabel, leafLabel, `${leafLabel}# -> #${resolvedLabel} (${result.decision.type}/${result.decision.reason})`);
  }
});
