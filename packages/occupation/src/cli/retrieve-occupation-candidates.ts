import { withConnection } from '../db/mysql.js';
import {
  DEFAULT_CANDIDATE_LIMIT,
  DEFAULT_ESCO_SOURCE_NAME,
  DEFAULT_MODEL_KEY,
  DEFAULT_RETRIEVAL_LOCALE,
  OccupationCandidateRetriever,
  type RetrieveOccupationCandidatesResult
} from '../retrieval/occupation-candidates.js';

type OutputFormat = 'text' | 'json';

type CliOptions = {
  query?: string;
  locale?: string;
  sourceName?: string;
  modelKey?: string;
  limit?: number;
  format: OutputFormat;
  evaluationQueryId?: number;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));

  const runOptions = {
    query: options.query,
    locale: options.locale,
    sourceName: options.sourceName,
    modelKey: options.modelKey,
    limit: options.limit,
    evaluationQueryId: options.evaluationQueryId
  };
  const result = options.evaluationQueryId === undefined
    ? await new OccupationCandidateRetriever().run(runOptions)
    : await withConnection((connection) => new OccupationCandidateRetriever(connection).run(runOptions));


  console.log(formatRetrievalResult(result, options.format));
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    format: 'text'
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

    if (arg.startsWith('--model-key=')) {
      options.modelKey = arg.slice('--model-key='.length).trim();
      continue;
    }

    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger('limit', arg.slice('--limit='.length));
      continue;
    }

    if (arg.startsWith('--format=')) {
      options.format = parseFormat(arg.slice('--format='.length));
      continue;
    }

    if (arg.startsWith('--evaluation-query-id=')) {
      options.evaluationQueryId = parsePositiveInteger('evaluation-query-id', arg.slice('--evaluation-query-id='.length));
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

function formatRetrievalResult(result: RetrieveOccupationCandidatesResult, format: OutputFormat): string {
  if (format === 'json') {
    return JSON.stringify(toJsonResult(result), null, 2);
  }

  const lines: string[] = [];
  const evaluationSummary = result.evaluationQueryId ? `, evaluation_query_id=${result.evaluationQueryId}` : '';
  const modelSummary =
    result.modelDimensions === null
      ? `model_key=${result.modelKey} (not registered; dense channel skipped)`
      : `model_key=${result.modelKey}, dimensions=${result.modelDimensions}`;

  lines.push(
    `Retrieval candidates for "${result.originalQuery}" (locale=${result.locale}, source_name=${result.sourceName}${evaluationSummary})`
  );
  lines.push(
    `effective_query="${result.query}", kept_signals=${JSON.stringify(result.keptQuerySignals)}, dropped_signals=${result.querySignals.length - result.keptQuerySignals.length}, signal_cleaning_ms=${result.querySignalCleaningMs}`
  );
  lines.push(
    `normalized_query="${result.normalizedQuery}", folded_query="${result.foldedQuery}", retrieval_profile=${result.retrievalProfile}, ${modelSummary}`
  );
  lines.push(
    `scanned alias hits=${result.scannedAliasHitCount}, scanned lexical hits=${result.scannedOpenSearchHitCount}, scanned dense embeddings=${result.scannedDenseEmbeddingCount}, returned candidates=${result.candidates.length}`
  );

  if (result.candidates.length === 0) {
    lines.push('No candidate evidence found.');
    return lines.join('\n');
  }

  for (const [index, candidate] of result.candidates.entries()) {
    const channelScores = [
      `exact_alias=${formatScore(candidate.channelScores.exact_alias)}`,
      `folded_alias=${formatScore(candidate.channelScores.folded_alias)}`,
      `ngram_alias=${formatScore(candidate.channelScores.ngram_alias)}`,
      `opensearch_lexical=${formatScore(candidate.channelScores.opensearch_lexical)}`,
      `capability_task=${formatScore(candidate.channelScores.capability_task)}`,
      `dense_embedding=${formatScore(candidate.channelScores.dense_embedding)}`
    ].join(', ');

    lines.push('');
    lines.push(
      `${index + 1}. graph_node_id=${candidate.graphNodeId} canonical_label="${candidate.canonicalLabel}" total_score=${formatScore(candidate.totalScore)}`
    );
    lines.push(`   channel_scores: ${channelScores}`);

    for (const evidence of candidate.evidence) {
      if (evidence.channel === 'dense_embedding') {
        lines.push(
          `   evidence: channel=dense_embedding score=${formatScore(evidence.score)} cosine=${formatScore(evidence.cosine)} text_role=${evidence.textRole ?? 'dense_text'}`
        );
        continue;
      }

      if (evidence.channel === 'opensearch_lexical') {
        const matchType = typeof evidence.details?.match_type === 'string' ? evidence.details.match_type : '';

        if (matchType) {
          const aliasAuthority = formatAliasAuthority(evidence.details);
          lines.push(
            `   evidence: channel=opensearch_lexical score=${formatScore(evidence.score)} source=alias_subphrase match_type=${matchType} matched_tokens=${formatStringArray(evidence.details?.matched_tokens)} alias="${evidence.alias ?? ''}" normalized_alias="${evidence.normalizedAlias ?? ''}" alias_role=${evidence.aliasRole ?? ''} alias_weight=${formatScore(evidence.aliasWeight)}${aliasAuthority}`
          );
          continue;
        }

        lines.push(
          `   evidence: channel=opensearch_lexical score=${formatScore(evidence.score)} lexical_signal=${formatUnknownScore(evidence.details?.lexical_signal_score)} normalized_raw=${formatUnknownScore(evidence.details?.normalized_raw_score)} matched_queries=${formatStringArray(evidence.details?.matched_queries)} matched_fields=${formatStringArray(evidence.details?.matched_fields)} matched_tokens=${formatStringArray(evidence.details?.matched_tokens)} phrase_match=${formatBoolean(evidence.details?.phrase_match)} useful_token_coverage=${formatUnknownScore(evidence.details?.max_useful_token_coverage)} raw_score=${formatUnknownScore(evidence.details?.raw_score)}`
        );
        continue;
      }

      if (evidence.channel === 'ngram_alias') {
        lines.push(
          `   evidence: channel=ngram_alias score=${formatScore(evidence.score)} cosine=${formatScore(evidence.cosine)} matched_tokens=${formatStringArray(evidence.details?.matched_tokens)} useful_token_coverage=${formatUnknownScore(evidence.details?.useful_token_coverage)} alias="${evidence.alias ?? ''}" normalized_alias="${evidence.normalizedAlias ?? ''}" alias_role=${evidence.aliasRole ?? ''} alias_weight=${formatScore(evidence.aliasWeight)}`
        );
        continue;
      }

      if (evidence.channel === 'capability_task') {
        lines.push(
          `   evidence: channel=capability_task score=${formatScore(evidence.score)} opensearch_score=${formatUnknownScore(evidence.details?.opensearch_score)} matched_tokens=${formatStringArray(evidence.details?.matched_tokens)} useful_token_coverage=${formatUnknownScore(evidence.details?.max_useful_token_coverage)}`
        );
        continue;
      }

      const folded = evidence.foldedAlias ? ` folded_alias="${evidence.foldedAlias}"` : '';
      const aliasAuthority = formatAliasAuthority(evidence.details);
      lines.push(
        `   evidence: channel=${evidence.channel} score=${formatScore(evidence.score)} alias="${evidence.alias ?? ''}" normalized_alias="${evidence.normalizedAlias ?? ''}"${folded} alias_role=${evidence.aliasRole ?? ''} alias_weight=${formatScore(evidence.aliasWeight)}${aliasAuthority}`
      );
    }
  }

  return lines.join('\n');
}

function toJsonResult(result: RetrieveOccupationCandidatesResult): Record<string, unknown> {
  return {
    query: result.query,
    original_query: result.originalQuery,
    locale: result.locale,
    normalized_query: result.normalizedQuery,
    folded_query: result.foldedQuery,
    query_signals: result.querySignals,
    kept_query_signals: result.keptQuerySignals,
    query_signal_cleaning_ms: result.querySignalCleaningMs,
    source_name: result.sourceName,
    retrieval_profile: result.retrievalProfile,
    model_key: result.modelKey,
    model_dimensions: result.modelDimensions,
    limit: result.limit,
    evaluation_query_id: result.evaluationQueryId,
    scanned_alias_hit_count: result.scannedAliasHitCount,
    scanned_opensearch_hit_count: result.scannedOpenSearchHitCount,
    scanned_dense_embedding_count: result.scannedDenseEmbeddingCount,
    candidates: result.candidates.map((candidate) => ({
      graph_node_id: candidate.graphNodeId,
      canonical_label: candidate.canonicalLabel,
      total_score: candidate.totalScore,
      channel_scores: {
        exact_alias: candidate.channelScores.exact_alias ?? 0,
        folded_alias: candidate.channelScores.folded_alias ?? 0,
        ngram_alias: candidate.channelScores.ngram_alias ?? 0,
        opensearch_lexical: candidate.channelScores.opensearch_lexical ?? 0,
        capability_task: candidate.channelScores.capability_task ?? 0,
        dense_embedding: candidate.channelScores.dense_embedding ?? 0
      },
      evidence: candidate.evidence.map((evidence) => ({
        channel: evidence.channel,
        score: evidence.score,
        alias: evidence.alias,
        normalized_alias: evidence.normalizedAlias,
        folded_alias: evidence.foldedAlias,
        alias_role: evidence.aliasRole,
        alias_weight: evidence.aliasWeight,
        cosine: evidence.cosine,
        dot: evidence.dot,
        text_role: evidence.textRole,
        details: evidence.details
      }))
    }))
  };
}

function parseFormat(value: string): OutputFormat {
  const normalized = value.trim().toLowerCase();

  if (normalized === 'text' || normalized === 'json') {
    return normalized;
  }

  throw new Error(`Unsupported format "${value}". Use --format=text or --format=json.`);
}

function parsePositiveInteger(flagName: string, value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${flagName} must be a positive integer. Received "${value}".`);
  }

  return parsed;
}

function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '0';
  }

  return value.toFixed(6).replace(/0+$/u, '').replace(/\.$/u, '');
}

function formatStringArray(value: unknown): string {
  return Array.isArray(value) ? value.join(',') : '';
}

function formatAliasAuthority(details: Record<string, unknown> | undefined): string {
  if (!details) {
    return '';
  }

  const parts = [
    formatAliasAuthorityPart('alias_role_rank', details.alias_role_rank),
    formatAliasAuthorityPart('alias_authority', details.alias_authority_score),
    formatAliasAuthorityPart('indexed_alias_tokens', details.indexed_alias_token_count)
  ].filter(Boolean);

  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

function formatAliasAuthorityPart(label: string, value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${label}=${formatScore(value)}` : '';
}

function formatBoolean(value: unknown): string {
  return value === true ? 'yes' : 'no';
}

function formatUnknownScore(value: unknown): string {
  return typeof value === 'number' ? formatScore(value) : '0';
}

function printHelp(): void {
  console.log(
    `Usage: node dist/cli/retrieve-occupation-candidates.js --query="software developer" [--locale=${DEFAULT_RETRIEVAL_LOCALE}] [--source-name=${DEFAULT_ESCO_SOURCE_NAME}] [--model-key=${DEFAULT_MODEL_KEY}] [--limit=${DEFAULT_CANDIDATE_LIMIT}] [--format=text|json] [--evaluation-query-id=N]`
  );
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Occupation candidate retrieval failed.');
  console.error(message);
  if (process.env.OSE_DEBUG_ERRORS === '1' && error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exitCode = 1;
});
