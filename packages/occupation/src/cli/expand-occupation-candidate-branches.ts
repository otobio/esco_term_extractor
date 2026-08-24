import type { Connection, RowDataPacket } from 'mysql2/promise';
import { withConnection } from '../db/mysql.js';
import {
  DEFAULT_CANDIDATE_LIMIT,
  DEFAULT_ESCO_SOURCE_NAME,
  DEFAULT_RETRIEVAL_LOCALE,
  OccupationCandidateRetriever
} from '../retrieval/occupation-candidates.js';
import {
  DEFAULT_SIBLING_LIMIT,
  OccupationCandidateBranchRetriever,
  type OccupationCandidateBranchRetrievalResult,
  type ExpandedOccupationCandidate,
  type OccupationCandidateBranch
} from '../retrieval/occupation-candidate-branches.js';
import { prepareOccupationRetrievalQuery, type PreparedOccupationRetrievalQuery } from '../query/occupation-retrieval-query.js';
import { loadOccupationIntentVocabularyArtifactRequired } from '../runtime/occupation-intent-vocabulary-artifact.js';

type OutputFormat = 'text' | 'json';

type CliOptions = {
  query?: string;
  locale?: string;
  sourceName?: string;
  limit?: number;
  siblingLimit?: number;
  format: OutputFormat;
  evaluationQueryId?: number;
};

type EvaluationQueryLookupRow = RowDataPacket & {
  id: number;
  locale_code: string;
  query_text: string;
};

type BranchRetrievalCliResult = {
  retrievalQuery: PreparedOccupationRetrievalQuery;
  result: OccupationCandidateBranchRetrievalResult;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const sourceName = options.sourceName?.trim() || DEFAULT_ESCO_SOURCE_NAME;

  const result =
    options.evaluationQueryId === undefined
      ? await runWithRawQuery(options, sourceName)
      : await withConnection((connection) => runWithEvaluationQuery(connection, options, sourceName));

  console.log(formatBranchExpansionResult(result, options.format));
}

async function runWithRawQuery(options: CliOptions, sourceName: string): Promise<BranchRetrievalCliResult> {
  if (!options.query) {
    throw new Error('Provide --query="..." or --evaluation-query-id=N.');
  }

  const locale = options.locale?.trim() || DEFAULT_RETRIEVAL_LOCALE;
  const retrievalQuery = await buildRetrievalQuery(sourceName, locale, options.query);

  const result = await new OccupationCandidateBranchRetriever().run({
    locale,
    sourceName,
    limit: options.limit,
    siblingLimit: options.siblingLimit,
    retrievalQuery
  });

  return { retrievalQuery, result };
}

async function runWithEvaluationQuery(connection: Connection, options: CliOptions, sourceName: string): Promise<BranchRetrievalCliResult> {
  const evaluationQueryId = options.evaluationQueryId as number;
  const [rows] = await connection.query<EvaluationQueryLookupRow[]>(
    'SELECT id, locale_code, query_text FROM ose_evaluation_queries WHERE id = ? LIMIT 1',
    [evaluationQueryId]
  );
  const evaluationQuery = rows[0];

  if (!evaluationQuery) {
    throw new Error(`No evaluation query found for --evaluation-query-id=${evaluationQueryId}.`);
  }

  const retrievalQuery = await buildRetrievalQuery(sourceName, evaluationQuery.locale_code, evaluationQuery.query_text);

  const result = await new OccupationCandidateBranchRetriever(new OccupationCandidateRetriever(connection)).run({
    locale: evaluationQuery.locale_code,
    sourceName,
    limit: options.limit,
    evaluationQueryId,
    siblingLimit: options.siblingLimit,
    retrievalQuery
  });

  return { retrievalQuery, result };
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

    if (arg.startsWith('--sibling-limit=')) {
      options.siblingLimit = parseNonNegativeInteger('sibling-limit', arg.slice('--sibling-limit='.length));
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

function formatBranchExpansionResult(cliResult: BranchRetrievalCliResult, format: OutputFormat): string {
  if (format === 'json') {
    return JSON.stringify(toJsonResult(cliResult), null, 2);
  }

  const result = cliResult.result;
  const retrievalQuery = cliResult.retrievalQuery;
  const preparedQuery = retrievalQuery.preparedQuery;
  const lines: string[] = [];
  const evaluationSummary = result.evaluationQueryId ? `, evaluation_query_id=${result.evaluationQueryId}` : '';

  lines.push(
    `Candidate hierarchy branches for "${result.originalQuery}" (locale=${result.locale}, source_name=${result.sourceName}${evaluationSummary})`
  );
  lines.push(`effective_query="${result.query}", kept_signals=${JSON.stringify(result.keptQuerySignals)}`);
  lines.push(
    `normalized_query="${preparedQuery.normalized}", folded_query="${preparedQuery.folded}", retrieval_profile=${result.retrievalProfile}`
  );
  lines.push(
    `scanned alias hits=${result.scannedAliasHitCount}, scanned lexical hits=${result.scannedOpenSearchHitCount}, candidates=${result.candidates.length}, branches=${result.branches.length}, sibling_limit=${result.siblingLimit}`
  );
  lines.push('Inspection output only: no occupation winner or final resolution is produced.');

  if (result.branches.length === 0) {
    lines.push('No candidate branches found.');
    return lines.join('\n');
  }

  for (const [branchIndex, branch] of result.branches.entries()) {
    lines.push('');
    lines.push(formatBranchHeader(branchIndex, branch));

    for (const [candidateIndex, candidate] of branch.candidates.entries()) {
      lines.push(formatCandidateHeader(candidateIndex, candidate));
      lines.push(
        `      hierarchy: family=${formatNode(candidate.familyNodeId, candidate.familyLabel)}, group=${formatNode(candidate.groupNodeId, candidate.groupLabel)}, parent=${formatNode(candidate.parentNodeId, candidate.parentLabel)}`
      );

      if (candidate.ancestors.length > 0) {
        lines.push(
          `      ancestors: ${candidate.ancestors
            .map((ancestor) => `${ancestor.distanceFromLeaf}:${ancestor.ancestorRole}:${ancestor.canonicalLabel}#${ancestor.graphNodeId}`)
            .join(' > ')}`
        );
      } else {
        lines.push('      ancestors: none');
      }

      if (candidate.siblings.length > 0) {
        lines.push(
          `      siblings: ${candidate.siblings
            .map((sibling) => `${sibling.siblingKind}:${sibling.canonicalLabel}#${sibling.graphNodeId}`)
            .join('; ')}`
        );
      } else {
        lines.push('      siblings: none');
      }

      for (const evidence of candidate.evidence) {
        if (evidence.channel === 'lexical') {
          lines.push(
            `      evidence: channel=lexical score=${formatScore(evidence.score)} matched_fields=${formatStringArray(evidence.details?.matched_fields)} raw_score=${formatUnknownScore(evidence.details?.raw_score)}`
          );
          continue;
        }

        if (evidence.channel === 'capability_task') {
          lines.push(
            `      evidence: channel=capability_task score=${formatScore(evidence.score)} matched_tokens=${formatStringArray(evidence.details?.matched_tokens)} useful_token_coverage=${formatUnknownScore(evidence.details?.max_useful_token_coverage)}`
          );
          continue;
        }

        const folded = evidence.foldedAlias ? ` folded_alias="${evidence.foldedAlias}"` : '';
        lines.push(
          `      evidence: channel=${evidence.channel} score=${formatScore(evidence.score)} alias="${evidence.alias ?? ''}" normalized_alias="${evidence.normalizedAlias ?? ''}"${folded} alias_role=${evidence.aliasRole ?? ''} alias_weight=${formatScore(evidence.aliasWeight)}`
        );
      }
    }
  }

  return lines.join('\n');
}

function formatBranchHeader(index: number, branch: OccupationCandidateBranch): string {
  const scores = branch.scoreSummary.channelScores;

  return `${index + 1}. branch_key=${branch.branchKey} branch_node_id=${branch.branchNodeId} branch_kind=${branch.branchKind} branch_label="${branch.branchLabel}" candidate_count=${branch.scoreSummary.candidateCount} max_candidate_score=${formatScore(branch.scoreSummary.maxCandidateScore)} total_candidate_score=${formatScore(branch.scoreSummary.totalCandidateScore)} channel_maxes: exact_alias=${formatScore(scores.exactAlias)}, folded_alias=${formatScore(scores.foldedAlias)}, lexical=${formatScore(scores.openSearchLexical)}, capability_task=${formatScore(scores.capabilityTask)}`;
}

function formatCandidateHeader(index: number, candidate: ExpandedOccupationCandidate): string {
  const channelScores = [
    `exact_alias=${formatScore(candidate.channelScores.exact_alias)}`,
    `folded_alias=${formatScore(candidate.channelScores.folded_alias)}`,
    `lexical=${formatScore(candidate.channelScores.lexical)}`,
    `capability_task=${formatScore(candidate.channelScores.capability_task)}`
  ].join(', ');

  return `   ${index + 1}) graph_node_id=${candidate.graphNodeId} canonical_label="${candidate.canonicalLabel}" total_score=${formatScore(candidate.totalScore)} generic_risk=${candidate.genericRisk ?? 'unknown'} has_hierarchy=${formatBoolean(candidate.hasHierarchy)} has_capability_support=${formatBoolean(candidate.hasCapabilitySupport)} branch_key=${candidate.branchKey} channel_scores: ${channelScores}`;
}

function toJsonResult(cliResult: BranchRetrievalCliResult): Record<string, unknown> {
  const result = cliResult.result;
  const preparedQuery = cliResult.retrievalQuery.preparedQuery;

  return {
    query: result.query,
    original_query: result.originalQuery,
    locale: result.locale,
    normalized_query: preparedQuery.normalized,
    folded_query: preparedQuery.folded,
    kept_query_signals: result.keptQuerySignals,
    source_name: result.sourceName,
    retrieval_profile: result.retrievalProfile,
    limit: result.limit,
    sibling_limit: result.siblingLimit,
    evaluation_query_id: result.evaluationQueryId,
    scanned_alias_hit_count: result.scannedAliasHitCount,
    scanned_opensearch_hit_count: result.scannedOpenSearchHitCount,
    candidates: result.candidates.map((candidate) => toJsonCandidate(candidate)),
    branches: result.branches.map((branch) => ({
      branch_key: branch.branchKey,
      branch_kind: branch.branchKind,
      branch_node_id: branch.branchNodeId,
      branch_label: branch.branchLabel,
      score_summary: {
        candidate_count: branch.scoreSummary.candidateCount,
        max_candidate_score: branch.scoreSummary.maxCandidateScore,
        total_candidate_score: branch.scoreSummary.totalCandidateScore,
        channel_scores: {
          exact_alias: branch.scoreSummary.channelScores.exactAlias,
          folded_alias: branch.scoreSummary.channelScores.foldedAlias,
          lexical: branch.scoreSummary.channelScores.openSearchLexical,
          capability_task: branch.scoreSummary.channelScores.capabilityTask
        }
      },
      candidates: branch.candidates.map((candidate) => toJsonCandidate(candidate))
    }))
  };
}

function toJsonCandidate(candidate: ExpandedOccupationCandidate): Record<string, unknown> {
  return {
    graph_node_id: candidate.graphNodeId,
    canonical_label: candidate.canonicalLabel,
    total_score: candidate.totalScore,
    channel_scores: {
      exact_alias: candidate.channelScores.exact_alias ?? 0,
      folded_alias: candidate.channelScores.folded_alias ?? 0,
      lexical: candidate.channelScores.lexical ?? 0,
      capability_task: candidate.channelScores.capability_task ?? 0
    },
    generic_risk: candidate.genericRisk,
    has_hierarchy: candidate.hasHierarchy,
    has_capability_support: candidate.hasCapabilitySupport,
    family_node_id: candidate.familyNodeId,
    family_label: candidate.familyLabel,
    group_node_id: candidate.groupNodeId,
    group_label: candidate.groupLabel,
    parent_node_id: candidate.parentNodeId,
    parent_label: candidate.parentLabel,
    ancestors: candidate.ancestors.map((ancestor) => ({
      graph_node_id: ancestor.graphNodeId,
      canonical_label: ancestor.canonicalLabel,
      node_level: ancestor.nodeLevel,
      distance_from_leaf: ancestor.distanceFromLeaf,
      ancestor_role: ancestor.ancestorRole
    })),
    siblings: candidate.siblings.map((sibling) => ({
      graph_node_id: sibling.graphNodeId,
      canonical_label: sibling.canonicalLabel,
      node_level: sibling.nodeLevel,
      sibling_kind: sibling.siblingKind,
      weight: sibling.weight
    })),
    branch_key: candidate.branchKey,
    branch_kind: candidate.branchKind,
    branch_node_id: candidate.branchNodeId,
    branch_label: candidate.branchLabel,
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

function parseNonNegativeInteger(flagName: string, value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${flagName} must be a non-negative integer. Received "${value}".`);
  }

  return parsed;
}

function formatNode(graphNodeId: number | null, label: string | null): string {
  if (!graphNodeId || !label) {
    return 'none';
  }

  return `"${label}"#${graphNodeId}`;
}

function formatBoolean(value: boolean): string {
  return value ? 'yes' : 'no';
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

function formatUnknownScore(value: unknown): string {
  return typeof value === 'number' ? formatScore(value) : '0';
}

function printHelp(): void {
  console.log(
    `Usage: node dist/cli/expand-occupation-candidate-branches.js --query="software developer" [--locale=${DEFAULT_RETRIEVAL_LOCALE}] [--source-name=${DEFAULT_ESCO_SOURCE_NAME}] [--limit=${DEFAULT_CANDIDATE_LIMIT}] [--sibling-limit=${DEFAULT_SIBLING_LIMIT}] [--format=text|json] [--evaluation-query-id=N]`
  );
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Occupation candidate branch expansion failed.');
  console.error(message);
  if (process.env.OSE_DEBUG_ERRORS === '1' && error instanceof Error && error.stack) {
    console.error(error.stack);
  }
  process.exitCode = 1;
});
