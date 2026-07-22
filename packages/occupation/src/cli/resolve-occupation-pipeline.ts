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
  OccupationSearchPipeline,
  type OccupationSearchPipelineOptions,
  type OccupationSearchPipelineResult,
  type PipelineEvidenceRecord,
  type RankedPipelineFamily,
  type RankedPipelineLeaf
} from '../search-pipeline/occupation-search-pipeline.js';
import {
  parseRetrievalBackend,
  type RetrievalBackendKind
} from '../retrieval/retrieval-engine-factory.js';
import { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';

type OutputFormat = 'text' | 'json';

type CliOptions = OccupationSearchPipelineOptions & {
  format: OutputFormat;
  debug: boolean;
  color: boolean;
  retrievalBackend: RetrievalBackendKind | null;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const runtime = await OccupationRuntimeContext.load({
    sourceName: options.sourceName,
    retrievalBackend: options.retrievalBackend ?? undefined
  });
  const engine = runtime.retrievalEngine;
  const result = options.evaluationQueryId === undefined
    ? await OccupationSearchPipeline.withRuntime(runtime).run(options)
    : await withConnection((connection) =>
        new OccupationSearchPipeline(
          new OccupationCandidateBranchExpander(OccupationCandidateRetriever.withEngine(connection, engine)),
          engine.occupations
        ).run(options)
      );

  console.log(formatPipelineResult(result, options));
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    format: 'text',
    debug: false,
    color: process.env.NO_COLOR === undefined,
    retrievalBackend: null
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

    if (arg.startsWith('--retrieval-backend=')) {
      options.retrievalBackend = parseRetrievalBackend(arg.slice('--retrieval-backend='.length));
      continue;
    }

    if (arg.startsWith('--company-type=')) {
      options.companyType = arg.slice('--company-type='.length).trim();
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

    if (arg.startsWith('--top-family-limit=')) {
      options.topFamilyLimit = parsePositiveInteger('top-family-limit', arg.slice('--top-family-limit='.length));
      continue;
    }

    if (arg.startsWith('--top-leaves-per-family=')) {
      options.topLeavesPerFamily = parsePositiveInteger('top-leaves-per-family', arg.slice('--top-leaves-per-family='.length));
      continue;
    }

    if (arg.startsWith('--evaluation-query-id=')) {
      options.evaluationQueryId = parsePositiveInteger('evaluation-query-id', arg.slice('--evaluation-query-id='.length));
      continue;
    }

    if (arg.startsWith('--format=')) {
      options.format = parseFormat(arg.slice('--format='.length));
      continue;
    }

    if (arg === '--debug') {
      options.debug = true;
      continue;
    }

    if (arg === '--no-color') {
      options.color = false;
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

function formatPipelineResult(result: OccupationSearchPipelineResult, options: CliOptions): string {
  if (options.format === 'json') {
    return JSON.stringify(toJsonResult(result), null, 2);
  }

  const color = createColor(options.color);
  const lines: string[] = [];
  const context = result.queryContext;
  const decision = result.decision;

  lines.push(color.bold(`Occupation pipeline search: "${context.originalQuery}"`));
  lines.push(
    [
      `locale=${context.locale}`,
      `source=${context.sourceName}`,
      `retrieval_profile=${context.retrievalProfile}`,
      `model=${context.modelKey}`,
      `company_type=${context.companyType ?? 'none'}`
    ].join('  ')
  );
  lines.push(
    `effective_query="${context.query}"  query_spans=${JSON.stringify(context.querySpans)}  kept_signals=${JSON.stringify(context.keptQuerySignals)}  dropped_signals=${context.querySignals.length - context.keptQuerySignals.length}  signal_cleaning_ms=${context.querySignalCleaningMs}`
  );
  if (context.roleSpanSelection?.selectedSpan) {
    lines.push(
      `role_query="${context.roleSpanSelection.roleQuery}"  context_query="${context.roleSpanSelection.contextQuery}"  role_span_score=${context.roleSpanSelection.selectedSpan.score}  role_span_evidence=${context.roleSpanSelection.selectedSpan.evidence.join(',') || 'none'}`
    );
  }
  lines.push('');
  lines.push(color.bold('Selected result'));

  if (decision.decisionType === 'unresolved') {
    lines.push(`${color.yellow('unresolved')}  confidence=${formatPercent(decision.confidence)}`);
  } else if (decision.decisionType === 'multi_span') {
    lines.push(`${color.cyan('multi_span')}  spans=${result.spanResults.length}  confidence=${formatPercent(decision.confidence)}`);
  } else {
    lines.push(
      `${colorDecisionType(decision.decisionType, color)}  "${decision.selectedLabel ?? 'unknown'}" #${decision.selectedNodeId ?? 'unknown'}  confidence=${formatPercent(decision.confidence)}`
    );
  }

  lines.push(`reason=${decision.reason}`);
  lines.push('');
  lines.push(color.bold('Coverage status'));
  lines.push(
    [
      `status=${result.coverageStatus.status}`,
      `exact_canonical=${formatBoolean(result.coverageStatus.exactCanonicalAvailable)}`,
      `closest_available=${formatBoolean(result.coverageStatus.closestMatchAvailable)}`,
      `likely_dictionary_gap=${formatBoolean(result.coverageStatus.likelyDictionaryGap)}`,
      `cross_locale=${formatBoolean(result.coverageStatus.crossLocaleBackboneSupported)}`,
      `family_only=${formatBoolean(result.coverageStatus.crossLocaleFamilyOnly)}`
    ].join('  ')
  );
  lines.push(`summary=${result.coverageStatus.summary}`);

  if (result.coverageStatus.signals.topLeafCanonicalTerm || result.coverageStatus.signals.topFamilyCanonicalTerm) {
    lines.push(
      [
        `top_leaf="${result.coverageStatus.signals.topLeafCanonicalTerm ?? 'none'}"`,
        `top_family="${result.coverageStatus.signals.topFamilyCanonicalTerm ?? 'none'}"`,
        `family_evidence=${result.coverageStatus.signals.topFamilyEvidenceTier ?? 'none'}`,
        `matched_label="${result.coverageStatus.signals.matchedLabel ?? 'none'}"`,
        `missing_terms=${result.coverageStatus.signals.missingUsefulTokens.join(',') || 'none'}`,
        `missing_role=${result.coverageStatus.signals.missingRoleTokens.join(',') || 'none'}`
      ].join('  ')
    );
  }

  if (result.spanResults.length > 0) {
    lines.push('');
    lines.push(color.bold('Span results'));

    for (const span of result.spanResults) {
      lines.push(formatSpanResult(span, color));
    }
  }

  lines.push('');
  lines.push(color.bold('Top families'));

  if (result.rankedFamilies.length === 0) {
    lines.push('- none');
  } else {
    for (const family of result.rankedFamilies) {
      lines.push(formatFamily(family, color));
    }
  }

  lines.push('');
  lines.push(color.bold('Top leaves within best family'));
  const bestFamilyLeaves = result.rankedFamilies[0]?.leaves ?? [];

  if (bestFamilyLeaves.length === 0) {
    lines.push('- none');
  } else {
    for (const leaf of bestFamilyLeaves) {
      lines.push(formatLeaf(leaf, color));
    }
  }

  if (options.debug) {
    lines.push('');
    lines.push(color.bold('Pipeline debug'));
    lines.push(`stages=${result.debug.stages.join(' -> ')}`);
    lines.push(
      `attempts=${result.debug.attempts.map((attempt) => `${attempt.attempt}:${attempt.kind}:${attempt.status}:${attempt.decisionType}:${formatPercent(attempt.confidence)}`).join(' | ')}`
    );
    lines.push(
      `prepared.useful_tokens=${result.preparedQuery.usefulTokens.join(',') || 'none'} prepared.useful_folded_tokens=${result.preparedQuery.usefulFoldedTokens.join(',') || 'none'}`
    );
    lines.push(
      `prepared.expanded_tokens=${result.preparedQuery.expandedTokens.join(',') || 'none'} prepared.expanded_folded_tokens=${result.preparedQuery.expandedFoldedTokens.join(',') || 'none'}`
    );
    lines.push(
      `prepared.stop_tokens=${result.preparedQuery.stopTokens.join(',') || 'none'} prepared.acronyms=${result.preparedQuery.acronymTokens.join(',') || 'none'}`
    );
    lines.push(
      `prepared.modifier_tokens=${result.preparedQuery.modifierTokens.join(',') || 'none'} prepared.noise_tokens=${result.preparedQuery.noiseTokens.join(',') || 'none'}`
    );
    lines.push(
      `prepared.compound_split_tokens=${result.preparedQuery.compoundSplitTokens.join(',') || 'none'} prepared.compound_split_folded_tokens=${result.preparedQuery.compoundSplitFoldedTokens.join(',') || 'none'}`
    );
    lines.push(
      [
        `intent.role=${result.preparedQuery.intent.roleTokens.join(',') || 'none'}`,
        `intent.head=${result.preparedQuery.intent.roleHeadTokens.join(',') || 'none'}`,
        `intent.domain=${result.preparedQuery.intent.domainTokens.join(',') || 'none'}`,
        `intent.confidence=${formatPercent(result.preparedQuery.intent.confidence)}`
      ].join(' ')
    );
    lines.push(
      `intent.diagnostics=${result.preparedQuery.intent.diagnostics.map((item) => `${item.token}:${item.kind}`).join(',') || 'none'}`
    );
    lines.push(
      `scanned alias hits=${context.scannedAliasHitCount}, lexical hits=${context.scannedOpenSearchHitCount}`
    );
    lines.push(`timings=${formatTimings(result.debug.timings)}`);
  }

  return lines.join('\n');
}

function formatFamily(family: RankedPipelineFamily, color: Colorizer): string {
  const authority = family.selectionAuthority;

  return [
    `${family.rank}. ${color.cyan(family.familyKind)} "${family.familyLabel}" #${family.familyNodeId}`,
    `confidence=${formatPercent(family.confidence)}`,
    `evidence_tier=${family.evidenceTier ?? 'none'}`,
    `branch_share=${formatPercent(family.branchShare)}`,
    `margin=${family.branchMarginRatio === null ? 'none' : formatScore(family.branchMarginRatio)}`,
    `supporting_leaves=${family.supportingLeafCount}`,
    ...(authority ? [
      `primary_exact=${authority.primaryExactAliasLeafCount}`,
      `role_exact=${authority.exactRoleLeafCount}`,
      `role_partial=${authority.partialRoleLeafCount}`,
      `capability=${formatPercent(authority.capabilityRoleCoverage)}:${authority.capabilityLeafCount}`
    ] : []),
    `evidence=${summarizeEvidence(family.evidence)}`
  ].join('  ');
}

function formatLeaf(leaf: RankedPipelineLeaf, color: Colorizer): string {
  return [
    `${leaf.rank}. ${color.green('leaf')} "${leaf.canonicalLabel}" #${leaf.graphNodeId}`,
    `confidence=${formatPercent(leaf.confidence)}`,
    `family="${leaf.familyLabel}" #${leaf.familyNodeId}`,
    `selection=${leaf.selectionEvidence?.tier ?? 'none'}`,
    `fit=${leaf.familyScopedFit?.tier ?? 'none'}`,
    `capability_fit=${leaf.capabilityFit?.tier ?? 'none'}:${formatPercent(leaf.capabilityFit?.coverage ?? 0)}`,
    `closeness=${formatPercent(leaf.closeness?.score ?? 0)}:${leaf.closeness?.matchedLabelSource ?? 'none'}:"${leaf.closeness?.matchedLabel ?? 'none'}"`,
    `evidence=${summarizeEvidence(leaf.evidence)}`
  ].join('  ');
}

function formatSpanResult(
  span: OccupationSearchPipelineResult['spanResults'][number],
  color: Colorizer
): string {
  const decision = span.decision;
  const topFamily = span.rankedFamilies[0] ?? null;
  const topLeaf = topFamily?.leaves[0] ?? null;
  const target = decision.decisionType === 'unresolved'
    ? 'unresolved'
    : `"${decision.selectedLabel ?? 'unknown'}" #${decision.selectedNodeId ?? 'unknown'}`;

  return [
    `${span.spanIndex}. "${span.query}"`,
    `${colorDecisionType(decision.decisionType, color)} ${target}`,
    `confidence=${formatPercent(decision.confidence)}`,
    `top_family="${topFamily?.familyLabel ?? 'none'}"`,
    `top_leaf="${topLeaf?.canonicalLabel ?? 'none'}"`,
    `coverage=${span.coverageStatus.status}`
  ].join('  ');
}

function summarizeEvidence(evidence: PipelineEvidenceRecord[]): string {
  const counts = new Map<string, number>();

  for (const record of evidence) {
    counts.set(record.channel, (counts.get(record.channel) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([channel, count]) => `${channel}:${count}`)
    .join(',') || 'none';
}

function toJsonResult(result: OccupationSearchPipelineResult): Record<string, unknown> {
  return {
    query_context: result.queryContext,
    prepared_query: result.preparedQuery,
    decision: result.decision,
    coverage_status: result.coverageStatus,
    span_results: result.spanResults.map((span) => ({
      span_index: span.spanIndex,
      query: span.query,
      prepared_query: span.preparedQuery,
      decision: span.decision,
      coverage_status: span.coverageStatus,
      ranked_families: span.rankedFamilies.map((family) => ({
        ...family,
        evidence: family.evidence,
        leaves: family.leaves
      })),
      ranked_leaves: span.rankedLeaves,
      debug: {
        stages: span.debug.stages,
        attempts: span.debug.attempts,
        timings: span.debug.timings
      }
    })),
    ranked_families: result.rankedFamilies.map((family) => ({
      ...family,
      evidence: family.evidence,
      leaves: family.leaves
    })),
    ranked_leaves: result.rankedLeaves,
    debug: {
      stages: result.debug.stages,
      attempts: result.debug.attempts,
      timings: result.debug.timings
    }
  };
}

function formatTimings(timings: Record<string, number>): string {
  const entries = Object.entries(timings)
    .filter(([, elapsedMs]) => elapsedMs > 0)
    .sort(([, leftMs], [, rightMs]) => rightMs - leftMs);

  if (entries.length === 0) {
    return 'none';
  }

  return entries.map(([ref, elapsedMs]) => `${ref}=${formatScore(elapsedMs)}ms`).join('  ');
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

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatScore(value: number): string {
  return value.toFixed(6).replace(/0+$/u, '').replace(/\.$/u, '');
}

function formatBoolean(value: boolean): string {
  return value ? 'yes' : 'no';
}

type Colorizer = {
  bold: (value: string) => string;
  green: (value: string) => string;
  yellow: (value: string) => string;
  cyan: (value: string) => string;
};

function createColor(enabled: boolean): Colorizer {
  const wrap = (open: string, close: string) => (value: string) => (enabled ? `${open}${value}${close}` : value);

  return {
    bold: wrap('\u001b[1m', '\u001b[22m'),
    green: wrap('\u001b[32m', '\u001b[39m'),
    yellow: wrap('\u001b[33m', '\u001b[39m'),
    cyan: wrap('\u001b[36m', '\u001b[39m')
  };
}

function colorDecisionType(decisionType: OccupationSearchPipelineResult['decision']['decisionType'], color: Colorizer): string {
  if (decisionType === 'leaf') {
    return color.green(decisionType);
  }

  if (decisionType === 'family' || decisionType === 'group') {
    return color.cyan(decisionType);
  }

  return color.yellow(decisionType);
}

function printHelp(): void {
  console.log(
    [
      'Usage: node dist/cli/resolve-occupation-pipeline.js',
      '--query="software developer"',
      `[--locale=${DEFAULT_RETRIEVAL_LOCALE}]`,
      `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
      `[--model-key=${DEFAULT_MODEL_KEY}]`,
      '[--company-type=company_type:construction]',
      `[--limit=${DEFAULT_CANDIDATE_LIMIT}]`,
      `[--sibling-limit=${DEFAULT_SIBLING_LIMIT}]`,
      '[--top-family-limit=3]',
      '[--top-leaves-per-family=5]',
      '[--format=text|json]',
      '[--debug]',
      '[--no-color]'
    ].join(' ')
  );
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Occupation pipeline failed.');
  console.error(message);
  process.exitCode = 1;
});
