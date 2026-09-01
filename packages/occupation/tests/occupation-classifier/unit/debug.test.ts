import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createClassifierDebugTrace, createNoopClassifierTrace } from '../../../src/occupation-classifier/debug.js';

test('noop trace calls the real function without retaining pipeline data', async () => {
  const trace = createNoopClassifierTrace();
  const result = await trace.call((value) => value * 3, [2], 'normalizeInput');

  assert.equal(result, 6);
  assert.deepEqual(trace.trace().pipeline, []);
});

test('debug trace records args, output, and supports argument injection before the real call', async () => {
  const trace = createClassifierDebugTrace({
    beforeCall({ args }) {
      return [Number(args[0]) + 1];
    },
    afterCall({ output }) {
      return Number(output) + 1;
    }
  });

  const result = await trace.call((value) => value * 3, [2], 'normalizeInput');

  assert.equal(result, 10);
  assert.equal(trace.trace().pipeline.length, 1);
  assert.equal(trace.trace().pipeline[0]?.name, 'normalizeInput');
  assert.deepEqual(trace.trace().pipeline[0]?.args, [3]);
  assert.equal(trace.trace().pipeline[0]?.output, 10);
  assert.equal(typeof trace.trace().pipeline[0]?.durationMs, 'number');
});
