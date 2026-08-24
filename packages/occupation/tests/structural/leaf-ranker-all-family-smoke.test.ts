import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { cliRankFamilyLeaves } from '../../src/cli/rank-family-leaves-core.js';
import { cleanOccupationQuerySurface } from '../../src/query/occupation-query-cleaning.js';
import { prepareQuery } from '../../src/query/query-preparation.js';
import { loadOccupationLeafStructureArtifactRequired } from '../../src/runtime/occupation-leaf-structure-artifact.js';
import { loadOccupationSearchMetaArtifactRequired } from '../../src/runtime/occupation-search-meta-artifact.js';
import { foldSearchText } from '../../src/utils/texts.js';

const SOURCE = 'esco_1_2_1';
const LOCALE = 'ro';

const ALL_FAMILY_RANKER_SMOKE_CASES = [
  ['FARMACIST', 'pharmacist'],
  ['_Agent Servicii Clienti_Limba Italiana', 'customer service representative'],
  ['Manager Resurse Umane', 'human resources manager'],
  ['Sales Advisor Nespresso Boutique Afi Cotroceni 8h', 'specialised seller'],
  ['Junior Back Office with German', 'back office specialist']
] as const;

let searchMetaArtifact: Awaited<ReturnType<typeof loadOccupationSearchMetaArtifactRequired>>;
let leafStructureArtifact: Awaited<ReturnType<typeof loadOccupationLeafStructureArtifactRequired>>;
let allFamilyNodeIds: number[];

before(async () => {
  const [loadedSearchMeta, loadedLeafStructure] = await Promise.all([
    loadOccupationSearchMetaArtifactRequired(SOURCE),
    loadOccupationLeafStructureArtifactRequired(SOURCE)
  ]);

  searchMetaArtifact = loadedSearchMeta;
  leafStructureArtifact = loadedLeafStructure;
  allFamilyNodeIds = Array.from(
    new Set(
      searchMetaArtifact
        .getAllCoreRecords()
        .map((record) => record.familyNodeId)
        .filter((familyNodeId): familyNodeId is number => familyNodeId !== null)
    )
  ).sort((left, right) => left - right);
});

test('all-family leaf ranker preserves stable top-leaf smoke cases', async () => {
  for (const [jobTitle, expectedLeaf] of ALL_FAMILY_RANKER_SMOKE_CASES) {
    const result = await rankAcrossAllFamilies(jobTitle);

    assert.equal(
      foldSearchText(result.topLeaf),
      foldSearchText(expectedLeaf),
      `${jobTitle} ranked "${result.topLeaf}" (${result.topFamily}) score=${result.topScore} leaves=${result.leafCount}`
    );
  }
});

async function rankAcrossAllFamilies(jobTitle: string) {
  const cleanedQuery = await cleanOccupationQuerySurface(jobTitle, LOCALE);
  const effectiveQuery = cleanedQuery || jobTitle;
  const preparedQuery = await prepareQuery(effectiveQuery, LOCALE, { sourceName: SOURCE });
  const leaves = searchMetaArtifact.getLeafCoreRecordsForFamilies(allFamilyNodeIds);
  const rankedLeaves = cliRankFamilyLeaves(
    searchMetaArtifact,
    leafStructureArtifact,
    leaves,
    preparedQuery,
    effectiveQuery,
    LOCALE,
    jobTitle
  );
  const topLeaf = rankedLeaves[0] ?? null;
  const topLeafRecord = topLeaf ? (leaves.find((leaf) => leaf.graphNodeId === topLeaf.graphNodeId) ?? null) : null;

  return {
    topLeaf: topLeaf?.canonicalLabel ?? 'none',
    topFamily: topLeafRecord?.familyLabel ?? 'none',
    topScore: topLeaf?.totalScore ?? 'n/a',
    leafCount: leaves.length
  };
}
