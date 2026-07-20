import { describe, expect, it } from 'vitest';
import { numberVariants } from '../src/matchers/morphology.ts';

describe('numberVariants', () => {
  it('de-pluralizes Romanian -i plurals to reach the singular alias', () => {
    expect(numberVariants('excavatoristi')).toContain('excavatorist');
    expect(numberVariants('pavatori')).toContain('pavator');
    expect(numberVariants('soferi')).toContain('sofer');
  });

  it('de-pluralizes every token of a multi-word phrase', () => {
    expect(numberVariants('muncitori necalificati')).toContain('muncitor necalificat');
  });

  it('handles English -s both directions', () => {
    expect(numberVariants('developers')).toContain('developer');
    expect(numberVariants('developer')).toContain('developers');
  });

  it('always includes the original and dedupes', () => {
    const v = numberVariants('sofer');
    expect(v).toContain('sofer');
    expect(new Set(v).size).toBe(v.length);
  });

  it('leaves very short tokens untouched (no over-stripping)', () => {
    // "ai" is too short to strip; result should not include an empty token
    expect(numberVariants('ai').every((s) => s.length > 0)).toBe(true);
  });
});
