import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { packOccupationCollars, CollarBin } from '../src/derive/collar-bin.ts';
import { CollarMap } from '../src/derive/collar.ts';

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'term-extractor-collar-'));
}

describe('collar runtime artifact', () => {
  it('packs and loads a binary collar map', () => {
    const bin = CollarBin.fromBuffer(
      packOccupationCollars([
        {
          occupationKey: 'occupation:software_developer',
          collar: 'collar_kind:white_collar',
          confidence: 0.95,
        },
        {
          occupationKey: 'occupation:store_manager',
          collar: 'collar_kind:grey_collar',
          confidence: 0.8,
        },
      ]),
    );

    expect(bin.size).toBe(2);
    expect(bin.lookup('occupation:software_developer')).toMatchObject({
      collar: 'collar_kind:white_collar',
    });
    expect(bin.lookup('occupation:software_developer')?.confidence).toBeCloseTo(0.95, 6);
    expect(bin.lookup('occupation:missing')).toBeUndefined();
  });

  it('prefers the binary snapshot when both binary and JSON are present', async () => {
    const dir = await makeTempDir();
    try {
      await writeFile(
        join(dir, 'occupation_collar.ocb'),
        packOccupationCollars([
          {
            occupationKey: 'occupation:software_developer',
            collar: 'collar_kind:white_collar',
            confidence: 0.95,
          },
        ]),
      );
      await writeFile(
        join(dir, 'occupation_collar.json'),
        JSON.stringify({
          'occupation:software_developer': {
            collar: 'collar_kind:blue_collar',
            confidence: 0.1,
          },
        }),
      );

      const map = await CollarMap.load(dir);
      expect(map?.lookup('occupation:software_developer')).toMatchObject({
        collar: 'collar_kind:white_collar',
      });
      expect(map?.lookup('occupation:software_developer')?.confidence).toBeCloseTo(0.95, 6);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('ignores a JSON-only snapshot directory at runtime', async () => {
    const dir = await makeTempDir();
    try {
      await writeFile(
        join(dir, 'occupation_collar.json'),
        JSON.stringify({
          'occupation:store_manager': {
            collar: 'collar_kind:grey_collar',
            confidence: 0.8,
          },
        }),
      );

      const map = await CollarMap.load(dir);
      expect(map).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
