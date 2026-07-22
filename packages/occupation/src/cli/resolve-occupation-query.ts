import { withConnection } from '../db/mysql.js';
import {
  DEFAULT_CANDIDATE_LIMIT,
  DEFAULT_ESCO_SOURCE_NAME,
  DEFAULT_MODEL_KEY,
  DEFAULT_RETRIEVAL_LOCALE,
  OccupationCandidateRetriever
} from '../retrieval/occupation-candidates.js';
import { DEFAULT_SIBLING_LIMIT, OccupationCandidateBranchExpander } from '../retrieval/occupation-candidate-branches.js';
import {
  OccupationResolver,
  type BranchResolutionScore,
  type CandidateResolutionScore,
  type OccupationResolutionOutcome,
  type ResolveOccupationQueryResult
} from '../resolution/occupation-resolver.js';

type OutputFormat = 'text' | 'json';

type CliOptions = {
  query?: string;
  locale?: string;
  sourceName?: string;
  modelKey?: string;
  limit?: number;
  siblingLimit?: number;
  format: OutputFormat;
  evaluationQueryId?: number;
  debug: boolean;
  color: boolean;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const runOptions = {
    query: options.query,
    locale: options.locale,
    sourceName: options.sourceName,
    modelKey: options.modelKey,
    limit: options.limit,
    evaluationQueryId: options.evaluationQueryId,
    siblingLimit: options.siblingLimit
  };
  const result = options.evaluationQueryId === undefined
    ? await new OccupationResolver().run(runOptions)
    : await withConnection((connection) =>
        new OccupationResolver(
          new OccupationCandidateBranchExpander(new OccupationCandidateRetriever(connection))
        ).run(runOptions)
      );

  console.log(formatResolutionResult(result, options));
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    format: 'text',
    debug: false,
    color: process.env.NO_COLOR === undefined
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

    if (arg === '--debug') {
      options.debug = true;
      continue;
    }

    if (arg === '--no-color') {
      options.color = false;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function formatResolutionResult(result: ResolveOccupationQueryResult, options: CliOptions): string {
  if (options.format === 'json') {
    return JSON.stringify(toJsonResult(result), null, 2);
  }

  return options.debug ? formatDebugResolutionResult(result, options.color) : formatCleanResolutionResult(result, options.color);
}

function formatCleanResolutionResult(result: ResolveOccupationQueryResult, useColor: boolean): string {
  const lines: string[] = [];
  const color = createColor(useColor);
  const context = result.queryContext;
  const outcome = result.selectedOutcome;
  const topLeaves = result.rankedResults.topLeaves.slice(0, 3);
  const bestBranch = result.rankedResults.bestBroaderBranch;

  lines.push(color.bold(`Occupation search: "${context.originalQuery}"`));
  lines.push(
    [
      `locale=${context.locale}`,
      `source=${context.sourceName}`,
      `retrieval_profile=${context.retrievalProfile}`,
      `model=${context.modelKey}`
    ].join('  ')
  );
  lines.push(
    `effective_query="${context.query}"  kept_signals=${JSON.stringify(context.keptQuerySignals)}  dropped_signals=${context.querySignals.length - context.keptQuerySignals.length}  signal_cleaning_ms=${context.querySignalCleaningMs}`
  );
  lines.push('');
  lines.push(color.bold('Selected result'));

  if (outcome.decisionType === 'unresolved') {
    lines.push(`${color.yellow('unresolved')}  confidence=${formatPercent(outcome.confidence)}`);
  } else {
    const label = outcome.selectedLabel ?? 'unknown';
    const id = outcome.selectedNodeId ?? 'unknown';
    lines.push(
      `${color.green(outcome.decisionType)}  "${label}" #${id}  confidence=${formatPercent(outcome.confidence)}`
    );
  }

  lines.push('');
  lines.push(color.bold('Top occupation leaves'));

  if (topLeaves.length === 0) {
    lines.push('- none');
  } else {
    for (const leaf of topLeaves) {
      lines.push(
        [
          `${leaf.rank}. "${leaf.canonicalLabel}" #${leaf.graphNodeId}`,
          `confidence=${formatPercent(leaf.score)}`,
          `evidence=${formatEvidenceTier(leaf.evidenceTier, color)}`,
          `family="${leaf.branchLabel}" #${leaf.branchNodeId}`
        ].join('  ')
      );
    }
  }

  lines.push('');
  lines.push(color.bold('Best broader match'));

  if (!bestBranch) {
    lines.push('- none');
  } else {
    lines.push(
      [
        `${bestBranch.branchKind} "${bestBranch.branchLabel}" #${bestBranch.branchNodeId}`,
        `confidence=${formatPercent(bestBranch.score)}`,
        `evidence=${formatEvidenceTier(bestBranch.evidenceTier, color)}`,
        `supporting_leaves=${bestBranch.supportingLeaves.length}`
      ].join('  ')
    );
  }

  const usefulNotes = buildUsefulNotes(result);

  if (usefulNotes.length > 0) {
    lines.push('');
    lines.push(color.bold('Notes'));

    for (const note of usefulNotes) {
      lines.push(`- ${note}`);
    }
  }

  lines.push('');
  lines.push(color.dim('Use --debug for resolver internals, branch scores, scanned counts, and explanation facts.'));

  return lines.join('\n');
}

function formatDebugResolutionResult(result: ResolveOccupationQueryResult, useColor: boolean): string {
  const lines: string[] = [];
  const color = createColor(useColor);
  const context = result.queryContext;
  const evaluationSummary = context.evaluationQueryId ? `, evaluation_query_id=${context.evaluationQueryId}` : '';
  const modelSummary =
    context.modelDimensions === null
      ? `model_key=${context.modelKey}`
      : `model_key=${context.modelKey}, dimensions=${context.modelDimensions}`;

  lines.push(
    `${color.bold('Occupation resolution')} for "${context.originalQuery}" (locale=${context.locale}, source_name=${context.sourceName}${evaluationSummary})`
  );
  lines.push(
    `effective_query="${context.query}", kept_signals=${JSON.stringify(context.keptQuerySignals)}, dropped_signals=${context.querySignals.length - context.keptQuerySignals.length}, signal_cleaning_ms=${context.querySignalCleaningMs}`
  );
  lines.push(
    `normalized_query="${context.normalizedQuery}", folded_query="${context.foldedQuery}", retrieval_profile=${context.retrievalProfile}, ${modelSummary}`
  );
  lines.push(
    `scanned alias hits=${context.scannedAliasHitCount}, scanned lexical hits=${context.scannedOpenSearchHitCount}, branches=${result.candidateBranchesConsidered.length}, sibling_limit=${context.siblingLimit}`
  );
  lines.push('Phase 11 heuristic resolver only: no search run persistence or manual-review writes are performed.');
  lines.push('');
  lines.push(formatOutcome(result.selectedOutcome, useColor));

  lines.push('');
  lines.push('Ranked answer view:');
  lines.push(formatRankedResults(result));

  if (result.candidateBranchesConsidered.length === 0) {
    return lines.join('\n');
  }

  lines.push('');
  lines.push('Branches considered:');

  for (const [branchIndex, branch] of result.candidateBranchesConsidered.entries()) {
    lines.push(formatBranch(branchIndex, branch));

    for (const [candidateIndex, candidate] of branch.candidates.entries()) {
      lines.push(formatCandidate(candidateIndex, candidate));
    }
  }

  return lines.join('\n');
}

function formatRankedResults(result: ResolveOccupationQueryResult): string {
  const lines: string[] = [];
  const bestBranch = result.rankedResults.bestBroaderBranch;

  if (bestBranch) {
    const margin = bestBranch.branchMarginRatio === null ? 'none' : formatScore(bestBranch.branchMarginRatio);
    lines.push(
      `  best_broader_branch: ${bestBranch.branchKind}="${bestBranch.branchLabel}"#${bestBranch.branchNodeId} score=${formatScore(bestBranch.score)} share=${formatScore(bestBranch.branchShare)} margin=${margin} evidence_tier=${bestBranch.evidenceTier}`
    );

    for (const leaf of bestBranch.supportingLeaves) {
      lines.push(
        `    supporting_leaf ${leaf.rank}: "${leaf.canonicalLabel}"#${leaf.graphNodeId} retrieval_score=${formatScore(leaf.retrievalScore)} resolver_score=${formatScore(leaf.score)} evidence_tier=${leaf.evidenceTier}`
      );
    }
  } else {
    lines.push('  best_broader_branch: none');
  }

  if (result.rankedResults.topLeaves.length === 0) {
    lines.push('  top_leaves: none');
    return lines.join('\n');
  }

  for (const leaf of result.rankedResults.topLeaves) {
    const margin = leaf.leafMarginRatio === null ? 'none' : formatScore(leaf.leafMarginRatio);
    lines.push(
      `  top_leaf ${leaf.rank}: "${leaf.canonicalLabel}"#${leaf.graphNodeId} retrieval_score=${formatScore(leaf.retrievalScore)} resolver_score=${formatScore(leaf.score)} evidence_tier=${leaf.evidenceTier} leaf_share=${formatScore(leaf.leafShareWithinBranch)} leaf_margin=${margin} branch="${leaf.branchLabel}"#${leaf.branchNodeId}`
    );
  }

  return lines.join('\n');
}

function formatOutcome(outcome: OccupationResolutionOutcome, useColor: boolean): string {
  const color = createColor(useColor);
  const selected =
    outcome.selectedNodeId && outcome.selectedLabel ? `"${outcome.selectedLabel}"#${outcome.selectedNodeId}` : 'none';
  const lines = [
    `Decision: type=${colorDecisionType(outcome.decisionType, color)} selected=${selected} confidence=${formatScore(outcome.confidence)} safety_score=${formatScore(outcome.safetyScore)}`
  ];

  for (const fact of outcome.explanationFacts) {
    lines.push(`  fact: ${fact}`);
  }

  return lines.join('\n');
}

function formatBranch(index: number, branch: BranchResolutionScore): string {
  const margin = branch.branchMarginRatio === null ? 'none' : formatScore(branch.branchMarginRatio);

  return `${index + 1}. branch_key=${branch.branchKey} branch_node_id=${branch.branchNodeId} branch_kind=${branch.branchKind} branch_label="${branch.branchLabel}" score=${formatScore(branch.score)} evidence_tier=${branch.evidenceTier} branch_share=${formatScore(branch.branchShare)} branch_margin=${margin} lexical=${formatScore(branch.lexicalScore)} hierarchy=${formatScore(branch.hierarchyConsistencyScore)} capability=${formatScore(branch.capabilitySupportScore)} generic_penalty=${formatScore(branch.genericRiskPenalty)} unrelated_penalty=${formatScore(branch.unrelatedBranchPenalty)}`;
}

function formatCandidate(index: number, candidate: CandidateResolutionScore): string {
  const margin = candidate.leafMarginRatio === null ? 'none' : formatScore(candidate.leafMarginRatio);

  return `   ${index + 1}) graph_node_id=${candidate.graphNodeId} canonical_label="${candidate.canonicalLabel}" score=${formatScore(candidate.score)} evidence_tier=${candidate.evidenceTier} leaf_share=${formatScore(candidate.leafShareWithinBranch)} leaf_margin=${margin} exactness=${formatScore(candidate.exactnessScore)} specificity=${formatScore(candidate.specificityScore)} hierarchy=${formatScore(candidate.hierarchyConsistencyScore)} capability=${formatScore(candidate.capabilitySupportScore)} generic_penalty=${formatScore(candidate.genericRiskPenalty)} unrelated_penalty=${formatScore(candidate.unrelatedBranchPenalty)}`;
}

function toJsonResult(result: ResolveOccupationQueryResult): Record<string, unknown> {
  return {
    query_context: {
      query: result.queryContext.query,
      original_query: result.queryContext.originalQuery,
      locale: result.queryContext.locale,
      normalized_query: result.queryContext.normalizedQuery,
      folded_query: result.queryContext.foldedQuery,
      query_signals: result.queryContext.querySignals,
      kept_query_signals: result.queryContext.keptQuerySignals,
      query_signal_cleaning_ms: result.queryContext.querySignalCleaningMs,
      source_name: result.queryContext.sourceName,
      retrieval_profile: result.queryContext.retrievalProfile,
      model_key: result.queryContext.modelKey,
      model_dimensions: result.queryContext.modelDimensions,
      limit: result.queryContext.limit,
      sibling_limit: result.queryContext.siblingLimit,
      evaluation_query_id: result.queryContext.evaluationQueryId,
      scanned_alias_hit_count: result.queryContext.scannedAliasHitCount,
      scanned_opensearch_hit_count: result.queryContext.scannedOpenSearchHitCount
    },
    selected_outcome: {
      decision_type: result.selectedOutcome.decisionType,
      selected_node_id: result.selectedOutcome.selectedNodeId,
      selected_label: result.selectedOutcome.selectedLabel,
      confidence: result.selectedOutcome.confidence,
      safety_score: result.selectedOutcome.safetyScore,
      explanation_facts: result.selectedOutcome.explanationFacts
    },
    ranked_results: {
      top_leaves: result.rankedResults.topLeaves.map((leaf) => ({
        rank: leaf.rank,
        graph_node_id: leaf.graphNodeId,
        canonical_label: leaf.canonicalLabel,
        resolver_score: leaf.score,
        retrieval_score: leaf.retrievalScore,
        evidence_tier: leaf.evidenceTier,
        leaf_share_within_branch: leaf.leafShareWithinBranch,
        leaf_margin_ratio: leaf.leafMarginRatio,
        branch_key: leaf.branchKey,
        branch_kind: leaf.branchKind,
        branch_node_id: leaf.branchNodeId,
        branch_label: leaf.branchLabel,
        branch_score: leaf.branchScore,
        branch_share: leaf.branchShare,
        branch_margin_ratio: leaf.branchMarginRatio,
        channel_scores: {
          exact_alias: leaf.channelScores.exact_alias ?? 0,
          folded_alias: leaf.channelScores.folded_alias ?? 0,
          opensearch_lexical: leaf.channelScores.opensearch_lexical ?? 0,
          capability_task: leaf.channelScores.capability_task ?? 0
        }
      })),
      best_broader_branch: result.rankedResults.bestBroaderBranch
        ? {
            branch_key: result.rankedResults.bestBroaderBranch.branchKey,
            branch_kind: result.rankedResults.bestBroaderBranch.branchKind,
            branch_node_id: result.rankedResults.bestBroaderBranch.branchNodeId,
            branch_label: result.rankedResults.bestBroaderBranch.branchLabel,
            score: result.rankedResults.bestBroaderBranch.score,
            evidence_tier: result.rankedResults.bestBroaderBranch.evidenceTier,
            branch_share: result.rankedResults.bestBroaderBranch.branchShare,
            branch_margin_ratio: result.rankedResults.bestBroaderBranch.branchMarginRatio,
            candidate_count: result.rankedResults.bestBroaderBranch.candidateCount,
            channel_scores: {
              exact_alias: result.rankedResults.bestBroaderBranch.channelScores.exactAlias,
              folded_alias: result.rankedResults.bestBroaderBranch.channelScores.foldedAlias,
              opensearch_lexical: result.rankedResults.bestBroaderBranch.channelScores.openSearchLexical,
              capability_task: result.rankedResults.bestBroaderBranch.channelScores.capabilityTask
            },
            supporting_leaves: result.rankedResults.bestBroaderBranch.supportingLeaves.map((leaf) => ({
              rank: leaf.rank,
              graph_node_id: leaf.graphNodeId,
              canonical_label: leaf.canonicalLabel,
              resolver_score: leaf.score,
              retrieval_score: leaf.retrievalScore,
              evidence_tier: leaf.evidenceTier,
              leaf_share_within_branch: leaf.leafShareWithinBranch,
              leaf_margin_ratio: leaf.leafMarginRatio
            }))
          }
        : null
    },
    scoring_weights: {
      exactness: result.scoringWeights.exactness,
      specificity: result.scoringWeights.specificity,
      hierarchy_consistency: result.scoringWeights.hierarchyConsistency,
      capability_support: result.scoringWeights.capabilitySupport,
      generic_risk_suppression: result.scoringWeights.genericRiskSuppression,
      unrelated_branch_penalty: result.scoringWeights.unrelatedBranchPenalty
    },
    candidate_branches_considered: result.candidateBranchesConsidered.map((branch) => toJsonBranch(branch))
  };
}

function toJsonBranch(branch: BranchResolutionScore): Record<string, unknown> {
  return {
    branch_key: branch.branchKey,
    branch_kind: branch.branchKind,
    branch_node_id: branch.branchNodeId,
    branch_label: branch.branchLabel,
    score: branch.score,
    evidence_tier: branch.evidenceTier,
    branch_share: branch.branchShare,
    branch_margin_ratio: branch.branchMarginRatio,
    lexical_score: branch.lexicalScore,
    hierarchy_consistency_score: branch.hierarchyConsistencyScore,
    capability_support_score: branch.capabilitySupportScore,
    generic_risk_penalty: branch.genericRiskPenalty,
    unrelated_branch_penalty: branch.unrelatedBranchPenalty,
    facts: branch.facts,
    candidates: branch.candidates.map((candidate) => toJsonCandidate(candidate))
  };
}

function toJsonCandidate(candidate: CandidateResolutionScore): Record<string, unknown> {
  return {
    graph_node_id: candidate.graphNodeId,
    canonical_label: candidate.canonicalLabel,
    score: candidate.score,
    retrieval_score: candidate.retrievalScore,
    evidence_tier: candidate.evidenceTier,
    exactness_score: candidate.exactnessScore,
    specificity_score: candidate.specificityScore,
    hierarchy_consistency_score: candidate.hierarchyConsistencyScore,
    capability_support_score: candidate.capabilitySupportScore,
    generic_risk_penalty: candidate.genericRiskPenalty,
    unrelated_branch_penalty: candidate.unrelatedBranchPenalty,
    leaf_share_within_branch: candidate.leafShareWithinBranch,
    leaf_margin_ratio: candidate.leafMarginRatio,
    facts: candidate.facts
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

function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '0';
  }

  return value.toFixed(6).replace(/0+$/u, '').replace(/\.$/u, '');
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return '0%';
  }

  return `${Math.round(value * 100)}%`;
}

function buildUsefulNotes(result: ResolveOccupationQueryResult): string[] {
  const notes: string[] = [];
  const outcome = result.selectedOutcome;
  const topLeaf = result.rankedResults.topLeaves[0] ?? null;

  if ((outcome.decisionType === 'family' || outcome.decisionType === 'group') && topLeaf) {
    notes.push(`Broader ${outcome.decisionType} selected; closest displayed leaves are suggestions within that broader match.`);
  } else if (outcome.decisionType === 'leaf' && topLeaf && outcome.selectedNodeId !== topLeaf.graphNodeId) {
    notes.push(`Selected result differs from top ranked leaf "${topLeaf.canonicalLabel}" #${topLeaf.graphNodeId}.`);
  }

  if (outcome.decisionType === 'unresolved' && topLeaf) {
    notes.push(`Closest leaf candidate is "${topLeaf.canonicalLabel}" #${topLeaf.graphNodeId}.`);
  }

  return notes;
}

type Colorizer = {
  bold: (value: string) => string;
  dim: (value: string) => string;
  green: (value: string) => string;
  yellow: (value: string) => string;
  cyan: (value: string) => string;
  magenta: (value: string) => string;
};

function createColor(enabled: boolean): Colorizer {
  const wrap = (open: string, close: string) => (value: string) => (enabled ? `${open}${value}${close}` : value);

  return {
    bold: wrap('\u001b[1m', '\u001b[22m'),
    dim: wrap('\u001b[2m', '\u001b[22m'),
    green: wrap('\u001b[32m', '\u001b[39m'),
    yellow: wrap('\u001b[33m', '\u001b[39m'),
    cyan: wrap('\u001b[36m', '\u001b[39m'),
    magenta: wrap('\u001b[35m', '\u001b[39m')
  };
}

function colorDecisionType(decisionType: OccupationResolutionOutcome['decisionType'], color: Colorizer): string {
  if (decisionType === 'leaf') {
    return color.green(decisionType);
  }

  if (decisionType === 'family' || decisionType === 'group') {
    return color.cyan(decisionType);
  }

  return color.yellow(decisionType);
}

function formatEvidenceTier(evidenceTier: string, color: Colorizer): string {
  if (evidenceTier === 'exact_alias') {
    return color.green(evidenceTier);
  }

  if (evidenceTier === 'folded_alias') {
    return color.cyan(evidenceTier);
  }

  if (evidenceTier === 'weak_signal') {
    return color.magenta(evidenceTier);
  }

  return evidenceTier;
}

function printHelp(): void {
  console.log(
    `Usage: node dist/cli/resolve-occupation-query.js --query="software developer" [--locale=${DEFAULT_RETRIEVAL_LOCALE}] [--source-name=${DEFAULT_ESCO_SOURCE_NAME}] [--model-key=${DEFAULT_MODEL_KEY}] [--limit=${DEFAULT_CANDIDATE_LIMIT}] [--sibling-limit=${DEFAULT_SIBLING_LIMIT}] [--format=text|json] [--evaluation-query-id=N] [--debug] [--no-color]`
  );
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Occupation resolution failed.');
  console.error(message);
  process.exitCode = 1;
});
