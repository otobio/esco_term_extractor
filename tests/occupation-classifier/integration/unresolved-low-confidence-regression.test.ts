import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { OccupationRuntimeContext } from '../../../src/runtime/occupation-runtime-context.js';
import { classifyOccupationTitleDebug } from '../../../src/occupation-classifier/index.js';
import type { DebugResult } from '../../../src/occupation-classifier/types.js';

const LOW_CONFIDENCE_CASES = [
  'Procurement Specialist/Purchase Specialist',
  'Specialist Contabilitate Clienți (Accounts Receivable)',
  'Administrator retea calculatoare (Service Desk)',
  'SUPORT TEHNIC VÂNZĂRI (m/f/d)',
  'Payroll Manager- HYBRID- Bucharest / Brasov',
  'Deputy IT Systems Engineer (Information Management Asst.)',
  'Medici – Buzău',
  'Stivuitoristi in Timisoara'
];

let runtime: OccupationRuntimeContext;

before(async () => {
  runtime = await OccupationRuntimeContext.load({
    sourceName: 'esco_1_2_1',
    retrievalBackend: 'binary-cache',
    aliasNgramLocales: ['en', 'ro'],
    leafStructureRuntime: true
  });
});

for (const query of LOW_CONFIDENCE_CASES) {
  test(`classifier keeps reviewed low-confidence row unresolved: ${query}`, async () => {
    const result = await classify(query);

    assert.equal(result.runtime.decision.type, 'unresolved');
    assert.equal(result.runtime.decision.reason, 'unresolved_low_confidence');
    assert.equal(result.runtime.family, null);
    assert.equal(result.runtime.leaf, null);
  });
}

test('reviewed electromechanic machinery row resolves to machinery mechanics family', async () => {
  const result = await classify('Electromecanic utilaje agricole - Constanta');

  assert.equal(result.runtime.family?.familyNodeId, 22442);
  assert.equal(result.runtime.family?.familyLabel, 'Machinery mechanics and repairers');
  assert.equal(result.runtime.leaf?.familyNodeId, 22442);
  assertFamilyAssessment(result, 22442, 'accept', true);
});

test('reviewed senior accountant row resolves to finance professionals family', async () => {
  const result = await classify('Senior Accountant (Financial Analysis & Reporting)');

  assert.equal(result.runtime.family?.familyNodeId, 22115);
  assert.equal(result.runtime.family?.familyLabel, 'Finance professionals');
  assert.equal(result.runtime.leaf?.familyNodeId, 22115);
  assertFamilyAssessment(result, 22115, 'accept', true);
  assert.ok(result.candidates.some((candidate) => candidate.familyNodeId === 22115 && candidate.canonicalLabel === 'accountant'));
});

test('reviewed Romanian medical assistant sampling row keeps the nursing family despite noisy harvesting translation', async () => {
  const result = await classify('Asistent medical generalist - recoltare probe biologice');

  assert.equal(result.runtime.family?.familyNodeId, 22078);
  assert.equal(result.runtime.family?.familyLabel, 'Nursing and midwifery professionals');
  assert.equal(result.runtime.leaf?.familyNodeId ?? 22078, 22078);
  assertFamilyAssessment(result, 22078, 'accept', true);
});

test('reviewed Romanian thermal sanitary installer row resolves to the building-finisher family', async () => {
  const result = await classify('Instalator Termic Sanitar');

  assert.equal(result.runtime.family?.familyNodeId, 22418);
  assert.equal(result.runtime.family?.familyLabel, 'Building finishers and related trades workers');
  assert.equal(result.runtime.leaf?.familyNodeId ?? 22418, 22418);
  assertFamilyAssessment(result, 22418, 'partial', true);
});

async function classify(query: string): Promise<DebugResult> {
  return classifyOccupationTitleDebug({ query, locale: 'ro', runtime });
}

function assertFamilyAssessment(
  result: DebugResult,
  familyNodeId: number,
  structureDecision: 'accept' | 'partial' | 'reject',
  roleGrounded: boolean
): void {
  const assessment = result.familyAssessments.find((family) => family.familyNodeId === familyNodeId);

  assert.ok(assessment, `expected family ${familyNodeId} to appear in family assessments`);
  assert.equal(assessment.structureDecision, structureDecision);
  assert.equal(assessment.roleGrounded, roleGrounded);
}
