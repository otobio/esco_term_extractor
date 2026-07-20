#!/usr/bin/env tsx
/**
 * Live smoke for the ingest adapter — exercises the exposed API (createRuntime,
 * derive+profile, deriveMany, analyzeJobListing, explicitBuckets) against the
 * running canonical_runtime_terms cluster. Usage: npm run ingest:smoke
 */
import { analyzeJobListing, createRuntime, derive, deriveMany, explicitBuckets } from '../src/ingest/index.ts';

async function main(): Promise<void> {
  const runtime = createRuntime({ url: process.env.OPENSEARCH_URL ?? 'http://localhost:9201' });

  const title = 'Senior Sudor Constructii Cluj';
  const titleMatches = await derive(title, { runtime, profile: 'title', locale: 'ro' });
  console.log(`\n=== derive("${title}", profile:title, ro) ===`);
  for (const m of titleMatches)
    console.log(`  ${m.bucket.padEnd(13)} ${m.canonicalKey}  (conf ${m.confidence}) <- "${m.matchedAlias}"`);
  console.log('  explicitBuckets:', JSON.stringify(explicitBuckets(titleMatches)));

  const structured = await deriveMany(
    [
      { bucket: 'level', input: 'Senior', locale: 'ro' },
      { bucket: 'location', input: 'Cluj', locale: 'ro' },
      { bucket: 'employment', input: 'full time', locale: 'en' },
    ],
    { runtime },
  );
  console.log('\n=== deriveMany (structured) ===');
  for (const m of structured) console.log(`  ${m.bucket.padEnd(13)} ${m.canonicalKey}  (conf ${m.confidence})`);

  const body = 'We are hiring a welder. Salariu 5000 - 7000 RON pe luna. Project management experience required.';
  const analysis = await analyzeJobListing(body, { runtime, locale: 'ro' });
  console.log('\n=== analyzeJobListing (unstructured) ===');
  console.log(
    '  matches:',
    analysis.matches.length,
    'buckets:',
    [...new Set(analysis.matches.map((m) => m.bucket))].join(', '),
  );
  console.log('  salaryRanges:', JSON.stringify(analysis.salaryRanges));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
