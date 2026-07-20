import { createOpenSearchClient } from '../src/matchers/os-client.ts';
import { resolveSurfaces } from '../src/matchers/resolve.ts';
import type { SurfaceQuery } from '../src/matchers/types.ts';

const items: SurfaceQuery[] = [
  { bucket: 'occupation', surface: 'pavator', locale: 'ro' },
  { bucket: 'occupation', surface: 'zidar', locale: 'ro' },
  { bucket: 'occupation', surface: 'excavatorist', locale: 'ro' },
  { bucket: 'occupation', surface: 'sofer', locale: 'ro' },
  { bucket: 'occupation', surface: 'muncitori necalificati', locale: 'ro' },
  { bucket: 'occupation', surface: 'software developer', locale: 'en' },
  { bucket: 'occupation', surface: 'fullstack python developer', locale: 'en' },
  { bucket: 'occupation', surface: 'field service engineer', locale: 'en' },
];

async function main() {
  const client = createOpenSearchClient();
  console.log('query model:', await client.queryModelId());
  const out = await resolveSurfaces(items, client);
  for (let i = 0; i < items.length; i++) {
    const r = out[i] as any;
    const detail =
      r.status === 'resolved'
        ? `${r.key.replace('occupation:', '')} (${r.score.toFixed(1)})`
        : r.status === 'ambiguous'
          ? r.candidates.map((c: string) => c.replace('occupation:', '')).join(' | ')
          : '-';
    console.log(`  ${items[i].surface.padEnd(28)} -> ${r.status.padEnd(10)} ${detail}`);
  }
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
