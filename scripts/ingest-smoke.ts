#!/usr/bin/env tsx
/**
 * Live smoke for the ingest adapter — exercises the exposed API (createRuntime,
 * derive+profile, deriveMany, analyzeJobListing, explicitBuckets) against the
 * running canonical_runtime_terms cluster.
 *
 * Usage:
 *   npm run ingest:smoke
 *   LOCALE=ro BODY=$'Candidatul Ideal\nCerinte:\nPython' npm run ingest:smoke
 */
import { analyzeJobListing, createRuntime, derive, deriveMany, explicitBuckets } from '../src/ingest/index.ts';
import { parseDescriptionSections } from '../src/profiles/description.ts';

async function main(): Promise<void> {
  const runtime = createRuntime({ url: process.env.OPENSEARCH_URL ?? 'http://localhost:9201' });
  const locale = process.env.LOCALE ?? 'ro';
  const countryCode = process.env.COUNTRY_CODE ?? locale;
  const title = process.env.TITLE ?? 'Senior Sudor Constructii Cluj';
  const body =
    process.env.BODY ??
    [
      'Candidatul Ideal',
      'Cerinte:',
      'Studii medii finalizate',
      'Permis categoria B',
      '',
      'Descrierea jobului',
      'Vei verifica stocurile si disponibilitatea produselor.',
      '',
      'Ce iti oferim?',
      'Salariu 5000 - 7000 RON pe luna',
      'Tichete de masa',
      'Program de lucru flexibil',
    ].join('\n');

  const titleMatches = await derive(title, { runtime, profile: 'title', locale, countryCode });
  console.log(`\n=== derive("${title}", profile:title, ${locale}) ===`);
  for (const m of titleMatches)
    console.log(`  ${m.bucket.padEnd(13)} ${m.canonicalKey}  (conf ${m.confidence}) <- "${m.matchedAlias}"`);
  console.log('  explicitBuckets:', JSON.stringify(explicitBuckets(titleMatches)));

  const structured = await deriveMany(
    [
      { bucket: 'level', input: 'Senior', locale },
      { bucket: 'location', input: 'Cluj', locale },
      { bucket: 'employment', input: 'full time', locale: 'en' },
    ],
    { runtime },
  );
  console.log('\n=== deriveMany (structured) ===');
  for (const m of structured) console.log(`  ${m.bucket.padEnd(13)} ${m.canonicalKey}  (conf ${m.confidence})`);

  console.log(`\n=== parseDescriptionSections (${locale}) ===`);
  for (const section of parseDescriptionSections(body, locale)) {
    const meta = [
      section.header ? `header="${section.header}"` : '',
      section.confidence ? `score=${section.confidence}` : '',
    ]
      .filter(Boolean)
      .join('  ');
    console.log(`  ${section.kind.padEnd(16)} ${meta}`);
    for (const clause of section.clauses.slice(0, 5)) console.log(`    - ${clause}`);
  }

  const analysis = await analyzeJobListing(body, { runtime, locale, countryCode });
  console.log('\n=== analyzeJobListing (unstructured) ===');
  console.log(
    '  matches:',
    analysis.matches.length,
    'buckets:',
    [...new Set(analysis.matches.map((m) => m.bucket))].join(', '),
  );
  for (const match of analysis.matches)
    console.log(
      `  ${match.bucket.padEnd(13)} ${match.canonicalKey} <- "${match.matchedAlias}" (${match.evidenceSignal})`,
    );
  console.log('  explicitBuckets:', JSON.stringify(explicitBuckets(analysis.matches)));
  console.log('  salaryRanges:', JSON.stringify(analysis.salaryRanges));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
