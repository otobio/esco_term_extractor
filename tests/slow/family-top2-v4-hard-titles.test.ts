import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { cleanOccupationQuerySurface } from '../../src/query/occupation-query-cleaning.js';
import { prepareQuery } from '../../src/query/query-preparation.js';
import { loadOccupationFamilyProfileArtifactRequired } from '../../src/runtime/occupation-family-profile-artifact.js';
import { loadOccupationFamilyTokenRelevanceArtifactRequired } from '../../src/runtime/occupation-family-token-relevance-artifact.js';
import { loadOccupationLeafStructureArtifactRequired } from '../../src/runtime/occupation-leaf-structure-artifact.js';
import { loadOccupationSearchMetaArtifactRequired } from '../../src/runtime/occupation-search-meta-artifact.js';
import { rankFamilyTop2V4, type FamilyTop2V4ClassifierQuery } from '../../src/cli/rank-family-top2-v4-core.js';

const SOURCE = 'esco_1_2_1';
const LOCALE = 'ro';

const CASES = [
  ['Consilier de vânzări (m/f)', 'Shop salespersons'],
  ['TEHNICIAN-ALPINIST TELECOMUNICATII', 'Electronics and telecommunications installers and repairers'],
  ['Operator calculator - Magazin Online', 'Process control technicians'],
  ['Manager Resurse Umane', 'Business services and administration managers'],
  ['Consultant Vanzari - Mobexpert Baia Mare', 'Sales and purchasing agents and brokers'],
  ['Reprezentant Tehnic si Receptioner Tura de Noapte', 'Sales, marketing and public relations professionals'],
  ['Asistent Medical Generalist/ Kinetoterapeut/ Cosmetician', 'Personal care workers in health services'],
  ['Lacatus mecanic asamblare', 'Assemblers'],
  ['Inginer proiectant instalații', 'Engineering professionals (excluding electrotechnology)'],
  ['Sales Network Specialist -  Divizia Suport Vanzari', 'Sales, marketing and public relations professionals'],
  ['Tehnician Service', 'Physical and engineering science technicians'],
  ['Tehnician pe teren zona Harghita', 'Physical and engineering science technicians'],
  ['Tehnician audit de produs', 'Physical and engineering science technicians'],
  ['Inginer Tehnolog-Industria Cărnii (Experienta min. 5 ani)', 'Engineering professionals (excluding electrotechnology)'],
  ['Lucrator comercial / vanzator  mall - produse din inghetata', 'Shop salespersons'],
  ['Consultant Financiar', 'Finance professionals'],
  ['Merchants Sales Account Manager', 'Retail and wholesale trade managers'],
  ['Product Strategist (Engine & Sealing) [hybrid work schedule]', 'Sales, marketing and public relations professionals'],
  ['Electrical Site Manager', 'Manufacturing, mining, construction, and distribution managers'],
  ['Operator dezinfectie – Mediu Spitalicesc', 'Social and religious professionals']
] as const;

let familyProfileArtifact: Awaited<ReturnType<typeof loadOccupationFamilyProfileArtifactRequired>>;
let familyTokenRelevanceArtifact: Awaited<ReturnType<typeof loadOccupationFamilyTokenRelevanceArtifactRequired>>;
let searchMetaArtifact: Awaited<ReturnType<typeof loadOccupationSearchMetaArtifactRequired>>;
let leafStructureArtifact: Awaited<ReturnType<typeof loadOccupationLeafStructureArtifactRequired>>;

before(async () => {
  const [loadedFamilyProfiles, loadedFamilyTokenRelevance, loadedSearchMeta, loadedLeafStructure] = await Promise.all([
    loadOccupationFamilyProfileArtifactRequired(SOURCE),
    Promise.resolve(loadOccupationFamilyTokenRelevanceArtifactRequired(SOURCE)),
    loadOccupationSearchMetaArtifactRequired(SOURCE),
    loadOccupationLeafStructureArtifactRequired(SOURCE)
  ]);

  familyProfileArtifact = loadedFamilyProfiles;
  familyTokenRelevanceArtifact = loadedFamilyTokenRelevance;
  searchMetaArtifact = loadedSearchMeta;
  leafStructureArtifact = loadedLeafStructure;
});

test('v4 family top-2 classifier still misses a realistic 20-title hard set', async () => {
  const misses: string[] = [];

  for (const [jobTitle, expectedFamily] of CASES) {
    const result = await classify(jobTitle);
    const topFamily = result.rankedFamilies[0]?.familyLabel ?? 'none';

    if (topFamily !== expectedFamily) {
      misses.push(`${jobTitle} -> ${topFamily} (expected ${expectedFamily})`);
    }
  }

  console.log([`v4 eJobs hard sample (${CASES.length} titles)`, `misses=${misses.length}/${CASES.length}`].join('  '));

  for (const miss of misses.slice(0, 10)) {
    console.log(`  ${miss}`);
  }

  assert.deepEqual(misses, []);
});

async function classify(jobTitle: string) {
  const cleanedQuery = await cleanOccupationQuerySurface(jobTitle, LOCALE);
  const effectiveQuery = cleanedQuery || jobTitle;
  const preparedQuery = await prepareQuery(effectiveQuery, LOCALE, { sourceName: SOURCE });
  const query: FamilyTop2V4ClassifierQuery = {
    preparedQuery,
    rawQuery: jobTitle,
    effectiveQuery,
    locale: LOCALE,
    sourceName: SOURCE
  };

  return rankFamilyTop2V4({
    familyProfileArtifact,
    searchMetaArtifact,
    leafStructureArtifact,
    familyTokenRelevanceArtifact,
    query,
    limit: 2
  });
}
