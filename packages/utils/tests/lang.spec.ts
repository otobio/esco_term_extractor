import { describe, expect, it } from 'vitest';
import { isLikelyEnglishVerb, toEnglishVerbRootForm } from '../src/lang.ts';

describe('isLikelyEnglishVerb', () => {
  it('accepts common regular and irregular verbs', () => {
    expect(isLikelyEnglishVerb('manage')).toBe(true);
    expect(isLikelyEnglishVerb('be')).toBe(true);
    expect(isLikelyEnglishVerb('take')).toBe(true);
  });

  it('rejects tokens with noun/adjective suffixes', () => {
    expect(isLikelyEnglishVerb('management')).toBe(false);
    expect(isLikelyEnglishVerb('happiness')).toBe(false);
    expect(isLikelyEnglishVerb('careful')).toBe(false);
    expect(isLikelyEnglishVerb('creative')).toBe(false);
  });

  it('rejects stopwords, empty, and non-alphabetic input', () => {
    expect(isLikelyEnglishVerb('and')).toBe(false);
    expect(isLikelyEnglishVerb('')).toBe(false);
    expect(isLikelyEnglishVerb('   ')).toBe(false);
    expect(isLikelyEnglishVerb('a')).toBe(false);
    expect(isLikelyEnglishVerb('123')).toBe(false);
    expect(isLikelyEnglishVerb('co-ordinate')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isLikelyEnglishVerb('MANAGE')).toBe(true);
    expect(isLikelyEnglishVerb('Management')).toBe(false);
  });
});

describe('toEnglishVerbRootForm', () => {
  it('leaves already-root verbs unchanged', () => {
    expect(toEnglishVerbRootForm('assess')).toBe('assess');
    expect(toEnglishVerbRootForm('evaluate')).toBe('evaluate');
    expect(toEnglishVerbRootForm('examine')).toBe('examine');
  });

  it('restores a dropped silent e from -ing/-ed forms', () => {
    expect(toEnglishVerbRootForm('analysing')).toBe('analyse');
    expect(toEnglishVerbRootForm('managing')).toBe('manage');
    expect(toEnglishVerbRootForm('noticed')).toBe('notice');
  });

  it('undoubles a doubled consonant', () => {
    expect(toEnglishVerbRootForm('running')).toBe('run');
    expect(toEnglishVerbRootForm('stopped')).toBe('stop');
  });

  it('strips regular -ing/-ed suffixes with no e to restore', () => {
    expect(toEnglishVerbRootForm('walking')).toBe('walk');
    expect(toEnglishVerbRootForm('walked')).toBe('walk');
  });

  it('handles third-person singular and -y verbs', () => {
    expect(toEnglishVerbRootForm('applies')).toBe('apply');
    expect(toEnglishVerbRootForm('applied')).toBe('apply');
    expect(toEnglishVerbRootForm('manages')).toBe('manage');
  });
});
