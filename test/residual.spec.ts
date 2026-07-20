import { describe, expect, it } from 'vitest';
import { computeResidual } from '../src/profiles/lookups.ts';
import type { BucketName } from '../src/types.ts';

const clause = (text: string) => ({ text, source: 'text' });
const hit = (gram: string, bucket: BucketName) => ({ gram, words: gram.split(' ').length, entry: { bucket } as any });
const PEEL = new Set<BucketName>(['level', 'workplace']);

describe('computeResidual', () => {
  it('peels a leading modifier and drops boundary stopwords', () => {
    // "head of vps infrastructure": peel level "head" → residual "vps infrastructure" ("of" dropped)
    const scan = [[hit('head', 'level')]];
    expect(computeResidual([clause('Head of VPS Infrastructure')], scan, PEEL)).toEqual([['vps infrastructure']]);
  });

  it('peels a workplace modifier', () => {
    const scan = [[hit('remote', 'workplace')]];
    expect(computeResidual([clause('Remote Customer Support')], scan, PEEL)).toEqual([['customer support']]);
  });

  it('returns [] when nothing peeled (residual would equal the clause)', () => {
    const scan = [[hit('python', 'capabilities')]]; // not a peel bucket
    expect(computeResidual([clause('Fullstack Python Developer')], scan, PEEL)).toEqual([[]]);
  });

  it('splits into multiple segments around an interior modifier', () => {
    // peel "senior" in the middle → two residual runs
    const scan = [[hit('senior', 'level')]];
    expect(computeResidual([clause('Java Senior Developer')], scan, PEEL)).toEqual([['java', 'developer']]);
  });
});
