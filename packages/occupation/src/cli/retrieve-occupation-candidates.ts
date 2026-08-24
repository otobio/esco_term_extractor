import type { Connection, RowDataPacket } from 'mysql2/promise';
import { withConnection } from '../db/mysql.js';
import {
  DEFAULT_CANDIDATE_LIMIT,
  DEFAULT_ESCO_SOURCE_NAME,
  DEFAULT_RETRIEVAL_LOCALE,
  OccupationCandidateRetriever,
  type RetrieveOccupationCandidatesResult
} from '../retrieval/occupation-candidates.js';
import { prepareOccupationRetrievalQuery, type PreparedOccupationRetrievalQuery } from '../query/occupation-retrieval-query.js';
import { loadOccupationIntentVocabularyArtifactRequired } from '../runtime/occupation-intent-vocabulary-artifact.js';

type OutputFormat = 'text' | 'json';

type CliOptions = {
  query?: string;
  locale?: string;
  sourceName?: string;
  limit?: number;
  format: OutputFormat;
  evaluationQueryId?: number;
};

type EvaluationQueryLookupRow = RowDataPacket & {
  id: number;
  locale_code: string;
  query_text: string;
};

type CandidateRetrievalCliResult = {
  retrievalQuery: PreparedOccupationRetrievalQuery;
  sourceName: string;
  locale: string;
  limit: number;
  evaluationQueryId: number | null;
  result: RetrieveOccupationCandidatesResult;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const sourceName = options.sourceName?.trim() || DEFAULT_ESCO_SOURCE_NAME;

  const result =
    options.evaluationQueryId === undefined
      ? await runWithRawQuery(options, sourceName)
      : await withConnection((connection) => runWithEvaluationQuery(connection, options, sourceName));

  console.log(formatRetrievalResult(result, options.format));
}

async function runWithRawQuery(options: CliOptions, sourceName: string): Promise<CandidateRetrievalCliResult> {
  if (!options.query) {
    throw new Error('Provide --query="..." or --evaluation-query-id=N.');
  }

  const locale = options.locale?.trim() || DEFAULT_RETRIEVAL_LOCALE;
  const retrievalQuery = await buildRetrievalQuery(sourceName, locale, options.query);

  const result = await new OccupationCandidateRetriever().run({
    locale,
    sourceName,
    limit: options.limit,
    retrievalQuery
  });

  return {
    retrievalQuery,
    sourceName,
    locale,
    limit: options.limit ?? DEFAULT_CANDIDATE_LIMIT,
    evaluationQueryId: null,
    result
  };
}

async function runWithEvaluationQuery(
  connection: Connection,
  options: CliOptions,
  sourceName: string
): Promise<CandidateRetrievalCliResult> {
  const evaluationQueryId = options.evaluationQueryId as number;
  const [rows] = await connection.query<EvaluationQueryLookupRow[]>(
    'SELECT id, locale_code, query_text FROM ose_evaluation_queries WHERE id = ? LIMIT 1',
    [evaluationQueryId]
  );
  const evaluationQuery = rows[0];

  if (!evaluationQuery) {
    throw new Error(`No evaluation query found for --evaluation-query-id=${evaluationQueryId}.`);
  }

  const locale = evaluationQuery.locale_code;
  const retrievalQuery = await buildRetrievalQuery(sourceName, locale, evaluationQuery.query_text);

  const result = await new OccupationCandidateRetriever(connection).run({
    locale,
    sourceName,
    limit: options.limit,
    evaluationQueryId,
    retrievalQuery
  });

  return {
    retrievalQuery,
    sourceName,
    locale,
    limit: options.limit ?? DEFAULT_CANDIDATE_LIMIT,
    evaluationQueryId,
    result
  };
}

async function buildRetrievalQuery(sourceName: string, locale: string, originalQuery: string): Promise<PreparedOccupationRetrievalQuery> {
  const intentVocabularyArtifact = await loadOccupationIntentVocabularyArtifactRequired(sourceName);

  return prepareOccupationRetrievalQuery(
    {
      sourceName,
      locale,
      originalQuery
    },
    intentVocabularyArtifact.artifact
  );
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

function formatRetrievalResult(cliResult: CandidateRetrievalCliResult, format: OutputFormat): string {
  if (format === 'json') {
    return JSON.stringify(toJsonResult(cliResult), null, 2);
  }

  const result = cliResult.result;
  const retrievalQuery = cliResult.retrievalQuery;
  const preparedQuery = retrievalQuery.preparedQuery;
  const lines: string[] = [];
  const evaluationSummary = cliResult.evaluationQueryId ? `, evaluation_query_id=${cliResult.evaluationQueryId}` : '';

  lines.push(
    `Retrieval candidates for "${retrievalQuery.originalQuery}" (locale=${cliResult.locale}, source_name=${cliResult.sourceName}${evaluationSummary})`
  );
  lines.push(`effective_query="${retrievalQuery.query}", kept_signals=${JSON.stringify(retrievalQuery.keptQuerySignals)}`);
  lines.push(
    `normalized_query="${preparedQuery.normalized}", folded_query="${preparedQuery.folded}", retrieval_profile=${result.retrievalProfile}`
  );
  lines.push(
    `scanned alias hits=${result.scannedAliasHitCount}, scanned lexical hits=${result.scannedOpenSearchHitCount}, returned candidates=${result.candidates.length}`
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
      `lexical=${formatScore(candidate.channelScores.lexical)}`,
      `capability_task=${formatScore(candidate.channelScores.capability_task)}`
    ].join(', ');

    lines.push('');
    lines.push(
      `${index + 1}. graph_node_id=${candidate.graphNodeId} canonical_label="${candidate.canonicalLabel}" total_score=${formatScore(candidate.totalScore)}`
    );
    lines.push(`   channel_scores: ${channelScores}`);

    for (const evidence of candidate.evidence) {
      if (evidence.channel === 'lexical') {
        const matchType = typeof evidence.details?.match_type === 'string' ? evidence.details.match_type : '';

        if (matchType) {
          const aliasAuthority = formatAliasAuthority(evidence.details);
          lines.push(
            `   evidence: channel=lexical score=${formatScore(evidence.score)} source=alias_subphrase match_type=${matchType} matched_tokens=${formatStringArray(evidence.details?.matched_tokens)} alias="${evidence.alias ?? ''}" normalized_alias="${evidence.normalizedAlias ?? ''}" alias_role=${evidence.aliasRole ?? ''} alias_weight=${formatScore(evidence.aliasWeight)}${aliasAuthority}`
          );
          continue;
        }

        lines.push(
          `   evidence: channel=lexical score=${formatScore(evidence.score)} lexical_signal=${formatUnknownScore(evidence.details?.lexical_signal_score)} normalized_raw=${formatUnknownScore(evidence.details?.normalized_raw_score)} matched_queries=${formatStringArray(evidence.details?.matched_queries)} matched_fields=${formatStringArray(evidence.details?.matched_fields)} matched_tokens=${formatStringArray(evidence.details?.matched_tokens)} phrase_match=${formatBoolean(evidence.details?.phrase_match)} useful_token_coverage=${formatUnknownScore(evidence.details?.max_useful_token_coverage)} raw_score=${formatUnknownScore(evidence.details?.raw_score)}`
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

function toJsonResult(cliResult: CandidateRetrievalCliResult): Record<string, unknown> {
  const result = cliResult.result;
  const retrievalQuery = cliResult.retrievalQuery;
  const preparedQuery = retrievalQuery.preparedQuery;

  return {
    query: retrievalQuery.query,
    original_query: retrievalQuery.originalQuery,
    locale: cliResult.locale,
    normalized_query: preparedQuery.normalized,
    folded_query: preparedQuery.folded,
    kept_query_signals: retrievalQuery.keptQuerySignals,
    source_name: cliResult.sourceName,
    retrieval_profile: result.retrievalProfile,
    limit: cliResult.limit,
    evaluation_query_id: cliResult.evaluationQueryId,
    scanned_alias_hit_count: result.scannedAliasHitCount,
    scanned_opensearch_hit_count: result.scannedOpenSearchHitCount,
    candidates: result.candidates.map((candidate) => ({
      graph_node_id: candidate.graphNodeId,
      canonical_label: candidate.canonicalLabel,
      total_score: candidate.totalScore,
      channel_scores: {
        exact_alias: candidate.channelScores.exact_alias ?? 0,
        folded_alias: candidate.channelScores.folded_alias ?? 0,
        ngram_alias: candidate.channelScores.ngram_alias ?? 0,
        lexical: candidate.channelScores.lexical ?? 0,
        capability_task: candidate.channelScores.capability_task ?? 0
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
    `Usage: node dist/cli/retrieve-occupation-candidates.js --query="software developer" [--locale=${DEFAULT_RETRIEVAL_LOCALE}] [--source-name=${DEFAULT_ESCO_SOURCE_NAME}] [--limit=${DEFAULT_CANDIDATE_LIMIT}] [--format=text|json] [--evaluation-query-id=N]`
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
