#!/usr/bin/env tsx
/**
 * Threshold calibration probe for the SEMANTIC level classifier.
 *
 * Embeds the exemplar corpus, then prints the raw top-band cosine for each probe
 * title so we can read the score distribution of CORRECT band phrases vs clearly
 * seniority-free titles (bare occupations) and pick a threshold that separates
 * them — instead of guessing a magic number.
 *
 *   tsx scripts/calibrate-level.ts [--dtype fp16|fp32|q8]
 *
 * A good threshold sits ABOVE the highest "NEG" (seniority-free) score and BELOW
 * the lowest correct-band score. `--dtype q8` A/Bs the INT8-quantized model: it is
 * smaller/faster to download but NOT accuracy-identical to fp16/fp32, so compare the
 * separation MARGIN (min-correct minus max-NEG) across dtypes before adopting it.
 */
import { parseArgs } from 'node:util';
import { LevelExemplarIndex } from '../src/classifier/level-semantic.ts';
import { Embedder, type EmbedderDtype } from '../src/embedder.ts';

const { values } = parseArgs({ options: { dtype: { type: 'string' } } });

// [title, expected band slug or 'NEG', note]. NEG = a bare occupation / seniority-free
// title that MUST abstain (score below threshold).
const PROBES: [string, string, string][] = [
  // Correct-band probes drawn from the gold failure cluster + clear cases.
  ['Responsabil de tură Buftea', 'lead', 'ro shift responsible → lead'],
  ['Sef de Tura Brasov Magnolia', 'lead', 'ro shift chief → lead'],
  ['Sift Leader productie - Sef de Schimb', 'lead', 'ro/en shift leader → lead'],
  ['Sef Departament Securitate', 'manager', 'ro department head → manager'],
  ['Șef Fabrică- Prefabricate', 'manager', 'ro factory head → manager'],
  ['Head of VPS Infrastructure', 'lead', 'en head of tech area → lead/senior'],
  ['Senior AI Engineer', 'senior', 'en senior'],
  ['Arhitect senior', 'senior', 'ro senior'],
  ['CONTABIL JUNIOR (PART-TIME)', 'junior', 'ro junior'],
  ['Marketing Manager', 'manager', 'en manager'],
  ['Front-End Developer (middle) - Vue.js', 'mid_level', 'en middle'],
  ['debutant, fara experienta', 'entry_level', 'ro entry'],
  // NEG probes — seniority-free bare occupations that must abstain.
  ['Zugrav', 'NEG', 'ro painter (no seniority)'],
  ['Stivuitorist', 'NEG', 'ro forklift operator'],
  ['Manipulant Mărfuri', 'NEG', 'ro goods handler'],
  ['Sudor', 'NEG', 'ro welder'],
  ['Spalator Vehicule', 'NEG', 'ro vehicle washer'],
  ['Frizer', 'NEG', 'ro barber'],
  ['Barman Ospatar', 'NEG', 'ro bartender/waiter'],
  ['we value teamwork and honesty', 'NEG', 'en unrelated'],
];

async function main() {
  const dtype = values.dtype as EmbedderDtype | undefined;
  const embedder = new Embedder(dtype ? { dtype } : {});
  const index = await LevelExemplarIndex.build(embedder);
  const titles = PROBES.map((p) => p[0]);
  const vecs = await embedder.embed(titles);

  console.log(`Model: ${embedder.model}  dtype: ${dtype ?? 'default(fp16)'}\n`);
  console.log(`${'title'.padEnd(46)} exp        top@ro+en             cos`);
  console.log('-'.repeat(92));
  const correct: number[] = [];
  const neg: number[] = [];
  for (let i = 0; i < PROBES.length; i++) {
    const [title, exp, note] = PROBES[i];
    // minScore 0 → always return the argmax so we can see the raw distribution.
    const best = index.classify(vecs[i], new Set(['ro', 'en', 'global']), 0);
    const slug = best ? best.key.split(':')[1] : '(none)';
    const cos = best ? best.score : 0;
    const hit = exp === 'NEG' ? '' : slug === exp ? '  ✓' : '  ✗';
    if (exp === 'NEG') neg.push(cos);
    else correct.push(cos);
    console.log(`${title.slice(0, 45).padEnd(46)} ${exp.padEnd(11)}${slug.padEnd(13)}${cos.toFixed(3)}${hit}  ${note}`);
  }
  const min = (xs: number[]) => Math.min(...xs);
  const max = (xs: number[]) => Math.max(...xs);
  console.log('-'.repeat(92));
  console.log(`correct band cosines: min ${min(correct).toFixed(3)}  max ${max(correct).toFixed(3)}`);
  console.log(`NEG (abstain) cosines: min ${min(neg).toFixed(3)}  max ${max(neg).toFixed(3)}`);
  const margin = min(correct) - max(neg);
  // Separation MARGIN — the A/B figure across dtypes. Positive ⇒ a threshold cleanly
  // splits correct-band from abstain; the wider the margin, the more robust the choice.
  console.log(
    `separation margin (min-correct − max-NEG): ${margin.toFixed(3)} ${margin > 0 ? '(clean)' : '(OVERLAP)'}`,
  );
  if (margin > 0)
    console.log(
      `→ any threshold in (${max(neg).toFixed(3)}, ${min(correct).toFixed(3)}); midpoint ≈ ${((max(neg) + min(correct)) / 2).toFixed(3)}`,
    );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
