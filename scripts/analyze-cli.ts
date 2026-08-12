#!/usr/bin/env tsx
/**
 * CLI for the production `analyzeJobListing` pipeline (src/ingest/index.ts) —
 * lets you check real extraction output against a job description without
 * writing a test.
 *
 * Usage:
 *   npm run analyze -- "<job description text>"
 *   npm run analyze -- --file posting.txt
 *   cat posting.txt | npm run analyze --
 *
 *   npm run analyze -- --file posting.txt --locale ro --country ro
 *   npm run analyze -- --file posting.txt --buckets benefits,compensation
 *   npm run analyze -- --file posting.txt --json
 *
 *   # Debug the skill/capability span extractor directly (src/derive/skill-spans.ts):
 *   # shows every regex-selected candidate span and how it resolved — exact,
 *   # fuzzy, shaky (dropped from real output), or unmatched — so patterns and
 *   # the shaky-match threshold can be tightened against real postings.
 *   npm run analyze -- --file posting.txt --locale en --debug-skills
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import {
  extractSkillSpans,
  isHeadingLine,
  MATCH_ACCEPT_THRESHOLD,
  previousNonBlankLine,
  processTextForEscoSkills,
} from '../src/derive/skill-spans.ts';
import { analyzeJobListing, createRuntime, explicitBuckets, type SearchBucket } from '../src/ingest/index.ts';

const SKILL_SPAN_LOCALES = new Set(['en', 'ro', 'hu']);

/** Every heading-like line in the text, in order of appearance — uses the
 *  same `isHeadingLine` heuristic skill-spans.ts's `looksLikeListItem` does,
 *  so "sections found" here always matches what actually drives `source:
 *  'list'` tagging. */
function sectionsFound(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(isHeadingLine);
}

/** The heading line above `pos`'s line, skipping blank lines in between —
 *  same rule as `looksLikeListItem`, so this stays consistent with what
 *  actually drove the `source: 'list'` tag on a candidate. */
function sectionForPosition(text: string, pos: number): string | undefined {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const prevLine = previousNonBlankLine(text, lineStart);
  return prevLine !== undefined && isHeadingLine(prevLine) ? prevLine.trim() : undefined;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

function parseBuckets(v?: string): SearchBucket[] | undefined {
  return v
    ?.split(',')
    .map((s) => s.trim() as SearchBucket)
    .filter(Boolean);
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      file: { type: 'string', short: 'f' },
      locale: { type: 'string' },
      country: { type: 'string' },
      buckets: { type: 'string' },
      url: { type: 'string' },
      json: { type: 'boolean', default: false },
      'debug-skills': { type: 'boolean', default: false },
    },
  });

  let text = values.file ? await readFile(resolve(values.file), 'utf8') : positionals.join(' ');
  if (!text.trim() && !process.stdin.isTTY) text = await readStdin();
  if (!text.trim()) {
    console.error('No input text. Pass text as an argument, use --file <path>, or pipe via stdin.');
    process.exit(1);
  }

  if (values['debug-skills']) {
    const locale = values.locale ?? 'en';
    if (!SKILL_SPAN_LOCALES.has(locale)) {
      console.error(`--debug-skills only supports locale en/ro/hu, got "${locale}".`);
      process.exit(1);
    }
    const spans = extractSkillSpans(text, locale as 'en' | 'ro' | 'hu');
    const resolved = await processTextForEscoSkills(text, locale as 'en' | 'ro' | 'hu', undefined, { debug: true });

    const found = sectionsFound(text);
    console.log(
      `\n${found.length} section heading(s) found: ${found.length ? found.map((h) => `"${h}"`).join(', ') : '(none)'}`,
    );

    console.log(`\n${spans.length} candidate span(s) extracted (pattern pass only):\n`);
    for (const span of spans) {
      console.log(`  [${span.patterns.join('+').padEnd(18)}] "${span.text}" (${span.start}-${span.end})`);
    }

    console.log(`\n${resolved.length} resolved candidate(s) (accept threshold: ${MATCH_ACCEPT_THRESHOLD}):\n`);
    const selectedSections = new Set<string>();
    for (const r of resolved) {
      const conf = (r.confidence ?? 1).toFixed(2);
      const accepted = r.matchType !== 'none' && (r.confidence ?? 1) >= MATCH_ACCEPT_THRESHOLD;
      const status = accepted ? 'ACCEPTED' : 'dropped ';
      const section = sectionForPosition(text, r.start);
      if (accepted && section) selectedSections.add(section);
      console.log(
        `  ${status}  ${(r.matchType ?? 'none').padEnd(6)} conf=${conf}  [${r.source.padEnd(7)}]  "${r.normalizedText}"` +
          (r.escoUri ? `  -> ${r.escoUri}` : '') +
          (section ? `  (section: "${section}")` : ''),
      );
    }

    console.log(
      `\n${selectedSections.size} section(s) selected (contributed at least one accepted match): ` +
        (selectedSections.size ? [...selectedSections].map((h) => `"${h}"`).join(', ') : '(none)'),
    );
    return;
  }

  const runtime = createRuntime({ url: values.url ?? process.env.OPENSEARCH_URL ?? 'http://localhost:9201' });
  const analysis = await analyzeJobListing(text, {
    runtime,
    locale: values.locale,
    countryCode: values.country,
    buckets: parseBuckets(values.buckets),
  });

  if (values.json) {
    console.log(JSON.stringify(analysis, null, 2));
    return;
  }

  console.log(
    `\n${analysis.matches.length} match(es) across ${new Set(analysis.matches.map((m) => m.bucket)).size} bucket(s)\n`,
  );
  for (const match of analysis.matches) {
    console.log(
      `  ${match.bucket.padEnd(13)} ${match.canonicalKey.padEnd(35)} <- "${match.matchedAlias}"  ` +
        `(conf ${match.confidence.toFixed(2)}, ${match.evidenceSignal})`,
    );
  }

  if (analysis.salaryRanges.length) {
    console.log('\nsalary ranges:');
    for (const r of analysis.salaryRanges) {
      console.log(
        `  ${r.minAmount ?? '?'}-${r.maxAmount ?? '?'} ${r.currency ?? ''} ${r.period ?? ''} <- "${r.rawText}"`,
      );
    }
  }

  console.log('\nexplicit buckets:', JSON.stringify(explicitBuckets(analysis.matches), null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
