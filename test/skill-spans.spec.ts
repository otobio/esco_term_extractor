import { describe, expect, it } from 'vitest';
import { extractSkillSpans, processTextForEscoSkills } from '../src/derive/skill-spans.ts';
import type { EscoCandidate, Locale } from '../src/derive/skill-spans.ts';
import type { BucketName, DictionaryTerm, SupportedLanguage } from '../src/types.ts';
import { buildLexicalIndex } from './support/lexical.ts';

/** A candidate's span must round-trip to its own text — otherwise downstream
 *  consumers (highlighting, debug output) point at the wrong text. */
function assertValidSpan(candidate: EscoCandidate, source: string): void {
  expect(source.slice(candidate.start, candidate.end)).toBe(candidate.text);
}

function term(
  canonicalKey: string,
  bucket: BucketName,
  languageCode: SupportedLanguage,
  displayName: string,
  aliases: string[] = [],
  termType = 'skill',
): DictionaryTerm {
  return { canonicalKey, bucket, termType, displayName, value: displayName, languageCode, aliases };
}

const lexical = buildLexicalIndex([
  term('capability:skill:python', 'capabilities', 'en', 'Python', ['python', 'python programming']),
  term('capability:skill:project_management', 'capabilities', 'en', 'Project management', ['project management']),
  term('capability:skill:comunicare', 'capabilities', 'ro', 'Comunicare', ['comunicare']),
  term('capability:knowledge:accuracy', 'capabilities', 'en', 'Accuracy', ['accuracy'], 'knowledge'),
  term('capability:skill:team_coordination', 'capabilities', 'en', 'Team coordination', ['coordination']),
  term('capability:skill:event_coordination', 'capabilities', 'en', 'Event coordination', ['coordination']),
]);

describe('processTextForEscoSkills', () => {
  it('resolves an exact alias hit inside an experience clause', async () => {
    const results = await processTextForEscoSkills(
      'The candidate should have experience with Python and strong project management skills.',
      'en',
      lexical,
    );

    const python = results.find((r) => r.normalizedText.toLowerCase() === 'python');
    expect(python?.matchType).toBe('exact');
    expect(python?.escoUri).toBe('capability:skill:python');
  });

  it('keeps a single-word sub-span match when the alias covers a large share of the candidate', async () => {
    const results = await processTextForEscoSkills(
      'Hands-on experience with Python scripting for automation.',
      'en',
      lexical,
    );

    const hit = results.find((r) => r.escoUri === 'capability:skill:python');
    expect(hit?.matchType).toBe('fuzzy');
    expect(hit?.confidence).toBe(1);
  });

  it('drops a low-coverage single-word sub-span match as shaky by default', async () => {
    const results = await processTextForEscoSkills(
      'The role requires familiarity with a high level of accuracy in reporting.',
      'en',
      lexical,
    );

    expect(results.find((r) => r.escoUri === 'capability:knowledge:accuracy')).toBeUndefined();
  });

  it('surfaces the low-coverage shaky sub-span match in debug mode, scored low', async () => {
    const results = await processTextForEscoSkills(
      'The role requires familiarity with a high level of accuracy in reporting.',
      'en',
      lexical,
      { debug: true },
    );

    const hit = results.find((r) => r.escoUri === 'capability:knowledge:accuracy');
    expect(hit?.matchType).toBe('fuzzy');
    expect(hit?.confidence).toBeLessThan(0.5);
  });

  it('drops an ambiguous single-word candidate matching a non-knowledge alias', async () => {
    const results = await processTextForEscoSkills('Excellent coordination skills required.', 'en', lexical);

    expect(results.find((r) => r.normalizedText.toLowerCase() === 'coordination')).toBeUndefined();
  });

  it('surfaces the ambiguous single-word candidate in debug mode, scored low', async () => {
    const results = await processTextForEscoSkills('Excellent coordination skills required.', 'en', lexical, {
      debug: true,
    });

    const hit = results.find((r) => r.normalizedText.toLowerCase() === 'coordination');
    expect(hit?.matchType).toBe('exact');
    expect(hit?.confidence).toBeLessThan(0.5);
  });

  it('returns no results when no candidate resolves against the dictionary', async () => {
    const results = await processTextForEscoSkills(
      'Ability to juggle flaming chainsaws under pressure.',
      'en',
      lexical,
    );

    expect(results).toEqual([]);
  });

  it('exposes the "none" resolution in debug mode', async () => {
    const results = await processTextForEscoSkills(
      'Ability to juggle flaming chainsaws under pressure.',
      'en',
      lexical,
      { debug: true },
    );

    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => r.matchType === 'none')).toBe(true);
  });

  it('resolves locale-specific aliases for Romanian text', async () => {
    const results = await processTextForEscoSkills(
      'Abilități excelente de comunicare și lucru în echipă.',
      'ro',
      lexical,
    );

    const comunicare = results.find((r) => r.escoUri === 'capability:skill:comunicare');
    expect(comunicare).toBeDefined();
  });

  it('returns an empty array when no regex pattern matches the text at all', async () => {
    const results = await processTextForEscoSkills('Lorem ipsum dolor sit amet.', 'en', lexical);
    expect(results).toEqual([]);
  });

  it('resolves bare dictionary terms with no linguistic trigger phrase', async () => {
    const results = await processTextForEscoSkills('Required skills:\n- Python\n- Project management', 'en', lexical);

    expect(results.find((r) => r.escoUri === 'capability:skill:python')).toBeDefined();
    expect(results.find((r) => r.escoUri === 'capability:skill:project_management')).toBeDefined();
  });

  it('does not double-count a term found by both the pattern and direct-lexical passes', async () => {
    const results = await processTextForEscoSkills('Experience with Python required.', 'en', lexical);

    expect(results.filter((r) => r.escoUri === 'capability:skill:python')).toHaveLength(1);
  });

  it('tags a bullet-list mention as source "list"', async () => {
    const results = await processTextForEscoSkills('Skills:\n- Python\n- Project management', 'en', lexical);

    const python = results.find((r) => r.escoUri === 'capability:skill:python');
    expect(python?.source).toBe('list');
  });

  it('tags a bare dictionary hit in ordinary prose as source "lexical"', async () => {
    const results = await processTextForEscoSkills('Python required.', 'en', lexical);

    const python = results.find((r) => r.escoUri === 'capability:skill:python');
    expect(python?.source).toBe('lexical');
  });

  it('tags a trigger-phrase match as source "pattern"', async () => {
    const results = await processTextForEscoSkills('Hands-on experience with Python scripting for automation.', 'en', lexical);

    const python = results.find((r) => r.escoUri === 'capability:skill:python');
    expect(python?.source).toBe('pattern');
  });

  it('tags a bare heading with no colon and a blank line before its content as source "list"', async () => {
    const results = await processTextForEscoSkills('Skills\n\nPython, Project management', 'en', lexical);

    const python = results.find((r) => r.escoUri === 'capability:skill:python');
    expect(python?.source).toBe('list');
  });

  it('does not tag a sentence-ending line as a heading', async () => {
    const results = await processTextForEscoSkills('We use modern tools.\n\nPython required.', 'en', lexical);

    const python = results.find((r) => r.escoUri === 'capability:skill:python');
    expect(python?.source).toBe('lexical');
  });

  it('preserves the leading dot on a technical term like ".NET"', () => {
    const candidates = extractSkillSpans('Experience with .NET, C++ and Node.js.', 'en');
    expect(candidates.some((c) => c.normalizedText.startsWith('.NET'))).toBe(true);
  });

  describe('candidate spans round-trip to their own text', () => {
    const cases: Array<{ locale: Locale; text: string }> = [
      { locale: 'en', text: 'Experience with Python, Java and Docker.' },
      { locale: 'en', text: 'Manage customer relationships with clients.' },
      { locale: 'ro', text: 'Experiență în gestionarea proiectelor și utilizarea Python.' },
      { locale: 'ro', text: 'Responsabil de gestionarea relațiilor cu clienții.' },
      { locale: 'hu', text: 'Tapasztalat Python és SQL használatában.' },
    ];

    for (const { locale, text } of cases) {
      it(`${locale}: "${text}"`, () => {
        const candidates = extractSkillSpans(text, locale);
        expect(candidates.length).toBeGreaterThan(0);
        for (const candidate of candidates) assertValidSpan(candidate, text);
      });
    }
  });

  it('ro verbObject stops before a trailing prepositional phrase', async () => {
    const candidates = extractSkillSpans('Responsabil de gestionarea relațiilor cu clienții.', 'ro');
    const hit = candidates.find((c) => c.patterns.includes('verbObject'));
    expect(hit?.normalizedText.toLowerCase()).toBe('relațiilor');
  });
});
