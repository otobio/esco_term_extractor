/**
 * Threshold calibration probe. Prints raw top-k semantic scores (minScore 0) for
 * a set of labelled probes so we can see the score distribution of correct vs
 * incorrect matches under the loaded model, then set src/buckets.ts thresholds.
 *
 *   tsx scripts/calibrate.ts --data-dir data-ml
 */
import { parseArgs } from 'node:util';
import { TermExtractor } from '../src/extractor.ts';
import type { BucketName } from '../src/types.ts';

const { values } = parseArgs({ options: { 'data-dir': { type: 'string', default: 'data-ml' } } });

// [bucket, phrase, note] — CORRECT probes should score high, NEG should score low.
const PROBES: [BucketName, string, string][] = [
  ['occupation', 'Arhitect Senior', 'ro→architect'],
  ['occupation', 'contabil', 'ro→accountant'],
  ['occupation', 'asistent farmacie', 'ro→pharmacy'],
  ['occupation', 'sofer de camion', 'ro→truck driver'],
  ['occupation', 'kinetoterapeut', 'ro→physiotherapist'],
  ['occupation', 'software developer', 'en→software developer'],
  ['occupation', 'atasament fata de valorile europene', 'NEG (unrelated ro)'],
  ['occupation', 'we value teamwork and honesty', 'NEG (unrelated en)'],
  ['capabilities', 'comunicare si redactare', 'ro→communication/writing'],
  ['capabilities', 'experienta in vanzari', 'ro→sales'],
  ['capabilities', 'project management', 'en→project management'],
  ['capabilities', 'atmosfera placuta de lucru', 'NEG (unrelated ro)'],
  ['company_type', 'agentie de comunicare si publicitate', 'ro→media/advertising'],
];

async function main() {
  const extractor = await TermExtractor.load({ dataDir: values['data-dir']!, defaultLanguages: ['ro', 'en'] });
  console.log(`Model: ${extractor.model}\n`);
  for (const [bucket, phrase, note] of PROBES) {
    const r = await extractor.resolveStructured(bucket, phrase, { minScore: 0, topK: 3, semanticFallback: true });
    const shown = r.terms.map((t) => `${t.displayName}=${t.score.toFixed(3)}${t.method[0]}`).join('  ');
    console.log(`[${bucket}] "${phrase}"  (${note})`);
    console.log(`   ${shown || '(none)'}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
