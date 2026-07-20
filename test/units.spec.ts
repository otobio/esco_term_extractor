import { describe, expect, it } from 'vitest';
import { classifyClause } from '../src/noise-guard.ts';
import { normalizeText, words } from '../src/normalize.ts';
import { splitClauses } from '../src/tokenizer.ts';

describe('normalizeText', () => {
  it('lowercases, strips diacritics and punctuation', () => {
    expect(normalizeText('Cluj-Napoca, ROMÂNIA!')).toBe('cluj napoca romania');
  });
  it('collapses whitespace', () => {
    expect(normalizeText('  a   b\t c ')).toBe('a b c');
  });
  it('words() splits normalized tokens', () => {
    expect(words(normalizeText('Spring Boot'))).toEqual(['spring', 'boot']);
  });
});

describe('splitClauses', () => {
  it('splits on punctuation and and/or', () => {
    const clauses = splitClauses('Java and Python, SQL; Docker or Kubernetes', 'text').map((c) => c.text);
    expect(clauses).toEqual(['Java', 'Python', 'SQL', 'Docker', 'Kubernetes']);
  });
  it('splits multilingual conjunctions', () => {
    const clauses = splitClauses('remote și full-time', 'text').map((c) => c.text);
    expect(clauses).toContain('remote');
    expect(clauses).toContain('full-time');
  });
  it('drops empty fragments', () => {
    expect(splitClauses('...,,,', 'text')).toEqual([]);
  });
});

describe('classifyClause', () => {
  it('drops emails and application boilerplate', () => {
    expect(classifyClause('send your CV to jobs@acme.com').keep).toBe(false);
    expect(classifyClause('https://acme.com/careers').keep).toBe(false);
  });
  it('keeps real content', () => {
    expect(classifyClause('Senior Java Developer').keep).toBe(true);
  });
});
