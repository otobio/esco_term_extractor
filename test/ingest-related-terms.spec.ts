import { describe, expect, it, vi } from 'vitest';

vi.mock('occupation-search-engine', async () => {
  const actual = await vi.importActual<typeof import('occupation-search-engine')>('occupation-search-engine');
  return {
    ...actual,
    giveVerbSynonym: vi.fn(async () => [
      { relatedVerb: 'Manage' },
      { relatedVerb: 'manage' }, // duplicate, different case
      { relatedVerb: 'Management' }, // not a verb, filtered out
      { relatedVerb: 'oversee' },
      { relatedVerb: 'and' }, // stopword, filtered out
      { relatedVerb: 'analyze' },
      { relatedVerb: 'assess' },
      { relatedVerb: 'evaluate' },
      { relatedVerb: 'examine' },
      { relatedVerb: 'analysing' },
    ]),
    giveObjectRelated: vi.fn(async () => [
      { relatedObject: 'Staff' },
      { relatedObject: 'staff' }, // duplicate, different case
      { relatedObject: 'employee' },
    ]),
  };
});

const { getEnglishRelatedVerbs, getRelatedObjects } = await import('../src/ingest/index.ts');

describe('getEnglishRelatedVerbs', () => {
  it('dedupes case-insensitively and drops non-verb tokens, keeping order', async () => {
    const verbs = await getEnglishRelatedVerbs('run');
    expect(verbs).toEqual(['manage', 'oversee', 'analyse', 'assess', 'evaluate', 'examine']);
  });

  it('converts American spellings to British and reduces to root form, deduping analyze/analysing', async () => {
    const verbs = await getEnglishRelatedVerbs('run');
    expect(verbs).toContain('analyse');
    expect(verbs).not.toContain('analyze');
    expect(verbs).not.toContain('analysing');
    expect(verbs.filter((v) => v === 'analyse')).toHaveLength(1);
  });

  it('applies limit to the filtered/deduped result, not the raw call', async () => {
    const verbs = await getEnglishRelatedVerbs('run', { limit: 1 });
    expect(verbs).toEqual(['manage']);
  });
});

describe('getRelatedObjects', () => {
  it('dedupes case-insensitively, keeping order', async () => {
    const objects = await getRelatedObjects('worker');
    expect(objects).toEqual(['staff', 'employee']);
  });

  it('applies limit to the deduped result', async () => {
    const objects = await getRelatedObjects('worker', { limit: 1 });
    expect(objects).toEqual(['staff']);
  });
});
