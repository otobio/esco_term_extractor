import { performance } from 'node:perf_hooks';
import { prepareOccupationRetrievalQuery } from '../query/occupation-retrieval-query.js';
import { DEFAULT_ESCO_SOURCE_NAME, DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import { buildAliasNgramIndex, retrieveAliasNgramHits } from '../retrieval/alias-ngram-retriever.js';

type OutputFormat = 'text' | 'json';
type QueryMode = 'effective' | 'role';

type CliOptions = {
  query?: string;
  locale: string;
  sourceName: string;
  limit: number;
  format: OutputFormat;
  queryMode: QueryMode;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  if (!options.query?.trim()) {
    throw new Error('Provide --query="...".');
  }

  const timings: Record<string, number> = {};
  const prepareStart = performance.now();
  const retrievalQuery = await prepareOccupationRetrievalQuery({
    sourceName: options.sourceName,
    locale: options.locale,
    originalQuery: options.query
  });
  const scoringQueryText = scoringQueryForMode(options.queryMode, retrievalQuery.preparedQuery);
  const scoringPreparedQuery =
    scoringQueryText === retrievalQuery.preparedQuery.raw
      ? retrievalQuery.preparedQuery
      : await prepareOccupationRetrievalQuery({
          sourceName: options.sourceName,
          locale: options.locale,
          originalQuery: scoringQueryText
        }).then((query) => query.preparedQuery);
  timings.prepare_ms = roundMs(performance.now() - prepareStart);

  const indexStart = performance.now();
  const index = await buildAliasNgramIndex({
    sourceName: options.sourceName,
    locale: retrievalQuery.locale
  });
  timings.index_load_ms = roundMs(performance.now() - indexStart);

  const scoreStart = performance.now();
  const hits = retrieveAliasNgramHits(index, scoringPreparedQuery, {
    limit: options.limit
  });
  timings.score_ms = roundMs(performance.now() - scoreStart);

  const result = {
    originalQuery: retrievalQuery.originalQuery,
    effectiveQuery: retrievalQuery.query,
    scoringQuery: scoringQueryText,
    queryMode: options.queryMode,
    intent: retrievalQuery.preparedQuery.intent,
    querySpans: retrievalQuery.querySpans,
    roleSpanSelection: retrievalQuery.roleSpanSelection,
    locale: retrievalQuery.locale,
    sourceName: options.sourceName,
    aliasCount: index.aliasCount,
    timings,
    hits
  };

  if (options.format === 'json') {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(`Alias ngram retrieval: "${result.originalQuery}"`);
  console.log(
    `effective_query="${result.effectiveQuery}" scoring_query="${result.scoringQuery}" mode=${result.queryMode} locale=${result.locale} source=${result.sourceName}`
  );
  console.log(
    `intent role=${result.intent.roleTokens.join(',') || 'none'} head=${result.intent.roleHeadTokens.join(',') || 'none'} domain=${result.intent.domainTokens.join(',') || 'none'}`
  );
  console.log(`spans=${result.querySpans.length} aliases=${result.aliasCount}`);
  console.log(`timings prepare=${timings.prepare_ms}ms index=${timings.index_load_ms}ms score=${timings.score_ms}ms`);
  console.log('');
  console.log('Hits');

  for (const [index, hit] of hits.entries()) {
    console.log(
      `${index + 1}. ${hit.canonicalLabel} score=${hit.score} cosine=${hit.cosine} coverage=${hit.usefulTokenCoverage} alias="${hit.alias}" role=${hit.aliasRole} family="${hit.familyLabel ?? 'n/a'}"`
    );
    console.log(`   tokens=${hit.matchedTokens.join(', ') || 'none'} features=${hit.matchedFeatures.join(', ') || 'none'}`);
  }
}

function scoringQueryForMode(
  queryMode: QueryMode,
  preparedQuery: { raw: string; normalized: string; usefulFoldedRecallTokens: string[]; intent: { roleTokens: string[] } }
): string {
  if (queryMode === 'effective') {
    return preparedQuery.raw;
  }

  return (
    preparedQuery.intent.roleTokens.join(' ').trim() || preparedQuery.usefulFoldedRecallTokens.join(' ').trim() || preparedQuery.normalized
  );
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    locale: DEFAULT_RETRIEVAL_LOCALE,
    sourceName: DEFAULT_ESCO_SOURCE_NAME,
    limit: 10,
    format: 'text',
    queryMode: 'role'
  };

  for (const arg of args) {
    if (arg.startsWith('--query=')) {
      options.query = arg.slice('--query='.length).trim();
      continue;
    }

    if (arg.startsWith('--locale=')) {
      options.locale = arg.slice('--locale='.length).trim();
      continue;
    }

    if (arg.startsWith('--source-name=')) {
      options.sourceName = arg.slice('--source-name='.length).trim();
      continue;
    }

    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
      continue;
    }

    if (arg.startsWith('--format=')) {
      options.format = parseFormat(arg.slice('--format='.length));
      continue;
    }

    if (arg.startsWith('--query-mode=')) {
      options.queryMode = parseQueryMode(arg.slice('--query-mode='.length));
      continue;
    }

    if (arg === '--help') {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

function parseFormat(value: string): OutputFormat {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'text' || normalized === 'json') {
    return normalized;
  }

  throw new Error(`Unsupported format "${value}". Use --format=text or --format=json.`);
}

function parseQueryMode(value: string): QueryMode {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'effective' || normalized === 'role') {
    return normalized;
  }

  throw new Error(`Unsupported query mode "${value}". Use --query-mode=role or --query-mode=effective.`);
}

function roundMs(value: number): number {
  return Number(value.toFixed(2));
}

function printHelp(): void {
  console.log(
    [
      'Usage: node dist/cli/probe-alias-ngram-retrieval.js --query="Senior Java Backend Engineer"',
      `[--locale=${DEFAULT_RETRIEVAL_LOCALE}]`,
      `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
      '[--limit=10]',
      '[--query-mode=role|effective]',
      '[--format=text|json]'
    ].join(' ')
  );
}

main().catch((error) => {
  console.error('Alias ngram retrieval probe failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
