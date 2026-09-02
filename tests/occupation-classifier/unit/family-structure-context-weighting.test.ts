import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assessFamilyStructureCompatibility } from '../../../src/occupation-classifier/family-structure/family-structure.js';

// Pins the three context-weighting fixes made to assessFamilyStructureCompatibility this session. Each
// mechanism only downgrades a match to 'partial' when the query actually had a chance to supply
// disambiguating evidence and didn't -- a bare query with zero concept evidence must still reach
// 'accept' (vacuous-true), never get penalized for evidence it was never able to provide.

test('an ambiguous role head accepts with no evidence, but needs real support once some evidence exists', () => {
  // "nurse" is shared across 4 families (Nursing And Midwifery Professionals, Veterinary Technicians
  // And Assistants, Personal Care Workers In Health Services, ...) -- ambiguous, but the bare query
  // supplies no concept evidence at all, so the vacuous-true path must still accept.
  const bareAmbiguous = assessFamilyStructureCompatibility(14750, 'nurse');
  assert.equal(bareAmbiguous.decision, 'accept');
  assert.equal(bareAmbiguous.roleHeadMatched, true);

  // "supervisor" is ambiguous too, and "machine operator supervisor" DOES supply concept evidence
  // (a work_object), but it's only the broad "machine" concept -- not specific enough to satisfy the
  // context requirement, so this must stay 'partial', not 'accept'.
  const ambiguousWithWeakContext = assessFamilyStructureCompatibility(14852, 'machine operator supervisor');
  assert.equal(ambiguousWithWeakContext.decision, 'partial');
  assert.equal(ambiguousWithWeakContext.roleHeadMatched, true);
});

test('a bridge-matched role head accepts with a specific concept, but not with only broad context', () => {
  // "operator" bridges to Machinery Mechanics And Repairers (15114) via the operator_technical bridge.
  // "engine operator" supplies a specific work_object (engine), so the bridge match is well-supported.
  const bridgeWithSpecificContext = assessFamilyStructureCompatibility(15114, 'engine operator');
  assert.equal(bridgeWithSpecificContext.decision, 'accept');
  assert.equal(bridgeWithSpecificContext.roleHeadMatched, false);

  // "machine operator supervisor" also bridges into 15114, but "machine" is a broad-context-only
  // concept -- an indirect bridge match needs the same real evidence a direct ambiguous match does,
  // so this must stay 'partial'.
  const bridgeWithBroadContextOnly = assessFamilyStructureCompatibility(15114, 'machine operator supervisor');
  assert.equal(bridgeWithBroadContextOnly.decision, 'partial');
  assert.equal(bridgeWithBroadContextOnly.roleHeadMatched, false);
});

test('a residual (catch-all) family accepts real leaf titles and bare queries, but not weak partial context', () => {
  // Other Teaching Professionals (14778, residual_when_no_specific_family) matches a real leaf title
  // with genuine venue/population concept support.
  const residualWithRealSupport = assessFamilyStructureCompatibility(14778, 'special educational needs teacher secondary school');
  assert.equal(residualWithRealSupport.decision, 'accept');

  // A bare, information-free query against a residual family's ambiguous role head must still accept
  // (vacuous-true) -- there is no evidence to fail against.
  const residualBareQuery = assessFamilyStructureCompatibility(14711, 'manager');
  assert.equal(residualBareQuery.decision, 'accept');

  // "construction manager" supplies real context, but "construction" doesn't match Other Services
  // Managers' own concept data -- an ambiguous role head with unrelated context must not accept.
  const residualWithUnrelatedContext = assessFamilyStructureCompatibility(14711, 'construction manager');
  assert.equal(residualWithUnrelatedContext.decision, 'partial');
});
