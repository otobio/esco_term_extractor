import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeInput,
  prepareClassifierSurface,
  selectClassifierLocale,
  splitIndependentSpans
} from '../../../src/occupation-classifier/preparation.js';

test('prepareClassifierSurface builds one weak-folded runtime surface', () => {
  assert.deepEqual(prepareClassifierSurface({ text: 'Secretaries (general)' }), {
    spanText: 'Secretaries (general)',
    weakFolded: 'secretaries general',
    weakFoldedTokens: ['secretaries', 'general']
  });
});

test('splitIndependentSpans separates slash-delimited occupation contexts', () => {
  const input = {
    rawTitle: 'LUCRATOR COMERCIAL / AJUTOR BUCATAR FAST FOOD',
    cleanedTitle: 'LUCRATOR COMERCIAL / AJUTOR BUCATAR FAST FOOD',
    locale: 'ro' as const
  };

  assert.deepEqual(splitIndependentSpans(input, 'ro'), [{ text: 'LUCRATOR COMERCIAL' }, { text: 'AJUTOR BUCATAR FAST FOOD' }]);
});

test('splitIndependentSpans splits on a slash with ragged (one-sided) whitespace, as real pasted titles use', () => {
  // rawTitle carries the user's original, un-rejoined spacing -- "Generalist/ Kinetoterapeut" has a
  // space only on the right of the slash. cleanedTitle has already been rejoined with uniform spacing
  // by the cleaning pipeline, so it alone can't tell a real separator apart from a bare compound.
  const input = {
    rawTitle: 'Asistent Medical Generalist/ Kinetoterapeut/ Cosmetician',
    cleanedTitle: 'Asistent Medical Generalist / Kinetoterapeut / Cosmetician',
    locale: 'ro' as const
  };

  assert.deepEqual(splitIndependentSpans(input, 'ro'), [
    { text: 'Asistent Medical Generalist' },
    { text: 'Kinetoterapeut' },
    { text: 'Cosmetician' }
  ]);
});

test('splitIndependentSpans keeps a bare, unspaced slash as one compound span', () => {
  const input = {
    rawTitle: 'steward/stewardess',
    cleanedTitle: 'steward / stewardess',
    locale: 'en' as const
  };

  assert.deepEqual(splitIndependentSpans(input, 'en'), [{ text: 'steward/stewardess' }]);
});

test('splitIndependentSpans treats semicolons and bullet glyphs as hard separators regardless of spacing', () => {
  const semicolonInput = {
    rawTitle: 'Asistent Medical Generalist;Kinetoterapeut',
    cleanedTitle: 'Asistent Medical Generalist ; Kinetoterapeut',
    locale: 'ro' as const
  };

  assert.deepEqual(splitIndependentSpans(semicolonInput, 'ro'), [{ text: 'Asistent Medical Generalist' }, { text: 'Kinetoterapeut' }]);

  const bulletInput = {
    rawTitle: 'Asistent Medical Generalist•Kinetoterapeut',
    cleanedTitle: 'Asistent Medical Generalist • Kinetoterapeut',
    locale: 'ro' as const
  };

  assert.deepEqual(splitIndependentSpans(bulletInput, 'ro'), [{ text: 'Asistent Medical Generalist' }, { text: 'Kinetoterapeut' }]);
});

test('normalizeInput keeps only public input defaults', () => {
  assert.deepEqual(normalizeInput({ query: '  Zxfrq Blorptak Vunnifel  ' }), {
    query: 'Zxfrq Blorptak Vunnifel',
    locale: 'unknown',
    sourceName: 'esco_1_2_1',
    runtime: undefined
  });
});

test('selectClassifierLocale switches non-English requested locale to English for English query text', async () => {
  assert.equal(await selectClassifierLocale('software developer', 'ro', 'esco_1_2_1'), 'en');
});

test('selectClassifierLocale preserves non-English locale for non-English or empty text', async () => {
  assert.equal(await selectClassifierLocale('Zxfrq Blorptak Vunnifel', 'ro', 'esco_1_2_1'), 'ro');
  assert.equal(await selectClassifierLocale('', 'ro', 'esco_1_2_1'), 'ro');
});
