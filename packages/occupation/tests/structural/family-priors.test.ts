import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getGenericHeadFamilyPriors } from '../../src/search-pipeline/generic-head-family-priors.js';
import { getJobFunctionFamilyPriors } from '../../src/search-pipeline/job-function-family-priors.js';

test('generic-head priors ignore inherited object property names', () => {
  assert.deepEqual(getGenericHeadFamilyPriors(['constructor'], ['constructor'], [], false), []);
  assert.deepEqual(getGenericHeadFamilyPriors(['toString'], ['toString'], [], false), []);
});

test('job-function priors ignore inherited object property names', () => {
  assert.deepEqual(getJobFunctionFamilyPriors('constructor'), []);
  assert.deepEqual(getJobFunctionFamilyPriors('toString'), []);
});
