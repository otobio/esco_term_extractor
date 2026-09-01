import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyOccupationTitleDebug } from '../../../src/occupation-classifier/index.js';
import { OccupationRuntimeContext } from '../../../src/runtime/occupation-runtime-context.js';

test('debug classifier returns stage trace without requiring runtime for empty input', async () => {
  const result = await classifyOccupationTitleDebug({ query: '' });

  assert.equal(result.runtime.decision.type, 'unresolved');
  assert.equal(result.runtime.decision.reason, 'empty_after_cleaning');
  assert.deepEqual(
    result.trace.pipeline.map((step) => step.name),
    ['normalizeInput', 'buildCoreResult']
  );
});

test('debug classifier records every nonempty skeleton stage from the same pass', async () => {
  const runtime = await OccupationRuntimeContext.load({
    sourceName: 'esco_1_2_1',
    retrievalBackend: 'binary-cache'
  });

  const result = await classifyOccupationTitleDebug({
    query: 'blorptastic wizard',
    locale: 'en',
    runtime
  });

  assert.equal(result.runtime.decision.type, 'unresolved');
  assert.deepEqual(
    result.trace.pipeline.map((step) => step.name),
    [
      'normalizeInput',
      'cleanOccupationQuerySurface',
      'selectClassifierLocale',
      'loadOrUseRuntime',
      'splitIndependentSpans',
      'buildQueryStructuralProfile',
      'loadOccupationLeafStructureArtifact',
      'translateTitleForClassifier',
      'prepareClassifierSurface',
      'buildRetrievalRequest',
      'findExactCanonicalLeaves',
      'selectUniqueExactCanonicalLeaf',
      'findExactAliasLeaves',
      'selectUniqueExactAliasLeaf',
      'findExactCanonicalFamilies',
      'selectUniqueExactCanonicalFamily',
      'retrieveRecallCandidates',
      'mergeCandidateEvidence',
      'hydrateCandidateCores',
      'assessCandidatesThroughFilterFunnel',
      'validateFamilies',
      'rankPromotableLeaves',
      'selectDecision',
      'buildCoreResult'
    ]
  );
});
