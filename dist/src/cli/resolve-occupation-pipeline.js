import { withConnection } from '../db/mysql.js';
import { DEFAULT_CANDIDATE_LIMIT, DEFAULT_ESCO_SOURCE_NAME, DEFAULT_RETRIEVAL_LOCALE, OccupationCandidateRetriever } from '../retrieval/occupation-candidates.js';
import { DEFAULT_SIBLING_LIMIT, OccupationCandidateBranchRetriever } from '../retrieval/occupation-candidate-branches.js';
import { ADDITIVE_SCORING_PIPELINE_LEAF_RANKING_STRATEGY, CORE2_PIPELINE_FAMILY_RANKING_STRATEGY, OccupationSearchPipeline, createTop2V4PipelineFamilyRankingStrategy } from '../search-pipeline/occupation-search-pipeline.js';
import { preparedQueryIntentRetrievalSequences, prepareFamilyScopedQueryFromPrepared } from '../query/query-preparation.js';
import { parseRetrievalBackend } from '../retrieval/retrieval-engine-factory.js';
import { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
import { loadOccupationFamilyProfileArtifactRequired } from '../runtime/occupation-family-profile-artifact.js';
import { loadOccupationFamilyTokenRelevanceArtifactRequired } from '../runtime/occupation-family-token-relevance-artifact.js';
import { RetrievalBoundaryDebugCollector } from '../debug/retrieval-boundary-debug.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const debugCollector = options.debug === true ? new RetrievalBoundaryDebugCollector(true) : null;
    const runtime = await OccupationRuntimeContext.load({
        sourceName: options.sourceName,
        retrievalBackend: options.retrievalBackend ?? undefined,
        leafStructureRuntime: true
    });
    const engine = runtime.retrievalEngine;
    const debugOptions = await buildDebugPipelineOptions(options, runtime);
    const applyLeafRankingStrategy = (pipeline) => options.leafRankingStrategy === 'additive'
        ? pipeline.withLeafRankingStrategy(ADDITIVE_SCORING_PIPELINE_LEAF_RANKING_STRATEGY)
        : pipeline;
    const result = options.evaluationQueryId === undefined
        ? await applyLeafRankingStrategy(OccupationSearchPipeline.withRuntime(runtime)).run({ ...options, ...debugOptions, debugCollector })
        : await withConnection((connection) => applyLeafRankingStrategy(new OccupationSearchPipeline(new OccupationCandidateBranchRetriever(OccupationCandidateRetriever.withEngine(connection, engine)), engine.occupations)).run({ ...options, ...debugOptions, debugCollector }));
    console.log(formatPipelineResult(result, options, runtime.retrievalBackend, runtime.searchMetaArtifact, debugCollector?.snapshot() ?? null));
}
async function buildDebugPipelineOptions(options, runtime) {
    if (options.debug !== 'family-rank-output') {
        return {};
    }
    if (!runtime.leafStructureArtifact) {
        throw new Error('Cannot run --debug=family-rank-output without the occupation leaf-structure artifact.');
    }
    const [familyProfileArtifact, familyTokenRelevanceArtifact] = await Promise.all([
        loadOccupationFamilyProfileArtifactRequired(runtime.sourceName),
        Promise.resolve(loadOccupationFamilyTokenRelevanceArtifactRequired(runtime.sourceName))
    ]);
    return {
        debugFamilyRankComparisonStrategies: [
            {
                name: 'top2-v4',
                strategy: createTop2V4PipelineFamilyRankingStrategy({
                    familyProfileArtifact,
                    searchMetaArtifact: runtime.searchMetaArtifact,
                    leafStructureArtifact: runtime.leafStructureArtifact,
                    familyTokenRelevanceArtifact
                })
            },
            { name: 'core-2', strategy: CORE2_PIPELINE_FAMILY_RANKING_STRATEGY }
        ]
    };
}
function parseCliOptions(args) {
    const options = {
        format: 'text',
        debug: false,
        color: process.env.NO_COLOR === undefined,
        retrievalBackend: null,
        leafRankingStrategy: 'legacy'
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
        if (arg.startsWith('--retrieval-backend=')) {
            options.retrievalBackend = parseRetrievalBackend(arg.slice('--retrieval-backend='.length));
            continue;
        }
        if (arg.startsWith('--leaf-ranking-strategy=')) {
            const value = arg.slice('--leaf-ranking-strategy='.length).trim();
            if (value !== 'legacy' && value !== 'additive') {
                throw new Error(`Unknown --leaf-ranking-strategy value "${value}". Expected "legacy" or "additive".`);
            }
            options.leafRankingStrategy = value;
            continue;
        }
        if (arg.startsWith('--job-function=')) {
            options.jobFunction = arg.slice('--job-function='.length).trim();
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
        if (arg.startsWith('--debug=')) {
            options.debug = parseDebugMode(arg.slice('--debug='.length));
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
function parseDebugMode(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === 'full') {
        return true;
    }
    if (normalized === 'false' || normalized === 'off' || normalized === 'none') {
        return false;
    }
    if (normalized === 'family-rank-output' || normalized === 'familyrankoutput') {
        return 'family-rank-output';
    }
    throw new Error(`Unknown --debug value "${value}". Expected "full", "family-rank-output", or "off".`);
}
function formatPipelineResult(result, options, retrievalBackend, searchMetaArtifact, retrievalBoundaryDebug) {
    if (options.format === 'json') {
        return JSON.stringify(toJsonResult(result), null, 2);
    }
    const color = createColor(options.color);
    const lines = [];
    const context = result.queryContext;
    const decision = result.decision;
    lines.push(color.bold(`Occupation pipeline search: "${context.originalQuery}"`));
    lines.push([
        `locale=${context.locale}`,
        `source=${context.sourceName}`,
        `retrieval_backend=${retrievalBackend}`,
        `job_function=${context.jobFunction ?? 'none'}`
    ].join('  '));
    lines.push(`effective_query="${context.query}"  query_spans=${JSON.stringify(context.querySpans)}  kept_signals=${JSON.stringify(context.keptQuerySignals)}`);
    if (context.roleSpanSelection?.selectedSpan) {
        lines.push(`role_query="${context.roleSpanSelection.roleQuery}"  context_query="${context.roleSpanSelection.contextQuery}"  role_span_score=${context.roleSpanSelection.selectedSpan.score}  role_span_evidence=${context.roleSpanSelection.selectedSpan.evidence.join(',') || 'none'}`);
    }
    if (options.debug === 'family-rank-output') {
        lines.push('');
        lines.push(...formatFamilyRankOutputDebug(result));
        return lines.join('\n');
    }
    lines.push('');
    lines.push(color.bold('Selected result'));
    const topFamily = result.rankedFamilies[0] ?? null;
    const topLeaf = result.rankedLeaves[0] ?? topFamily?.leaves[0] ?? null;
    if (decision.decisionType === 'unresolved') {
        lines.push(`${color.yellow('unresolved')}  confidence=${formatPercent(decision.confidence)}`);
    }
    else if (decision.decisionType === 'multi_span') {
        lines.push(`${color.cyan('multi_span')}  spans=${result.spanResults.length}  confidence=${formatPercent(decision.confidence)}`);
    }
    else {
        lines.push(`${colorDecisionType(decision.decisionType, color)}  "${decision.selectedLabel ?? 'unknown'}" #${decision.selectedNodeId ?? 'unknown'}  confidence=${formatPercent(decision.confidence)}`);
    }
    if (topFamily || topLeaf) {
        lines.push([
            `top_family="${topFamily?.familyLabel ?? 'none'}" #${topFamily?.familyNodeId ?? 'none'}`,
            `top_leaf="${topLeaf?.canonicalLabel ?? 'none'}" #${topLeaf?.graphNodeId ?? 'none'}`,
            `top_leaf_family="${topLeaf?.familyLabel ?? 'none'}" #${topLeaf?.familyNodeId ?? 'none'}`
        ].join('  '));
    }
    lines.push(`reason=${decision.reason}`);
    const topCapabilities = decision.decisionType === 'leaf' && decision.selectedNodeId !== null
        ? formatTopCapabilities(searchMetaArtifact.getCapabilityLabels(decision.selectedNodeId))
        : [];
    if (topCapabilities.length > 0) {
        lines.push('');
        lines.push(color.bold('Top Capabilities'));
        lines.push(...topCapabilities);
    }
    lines.push('');
    lines.push(color.bold('Coverage status'));
    lines.push([
        `status=${result.coverageStatus.status}`,
        `exact_canonical=${formatBoolean(result.coverageStatus.exactCanonicalAvailable)}`,
        `closest_available=${formatBoolean(result.coverageStatus.closestMatchAvailable)}`,
        `likely_dictionary_gap=${formatBoolean(result.coverageStatus.likelyDictionaryGap)}`,
        `cross_locale=${formatBoolean(result.coverageStatus.crossLocaleBackboneSupported)}`,
        `family_only=${formatBoolean(result.coverageStatus.crossLocaleFamilyOnly)}`
    ].join('  '));
    lines.push(`summary=${result.coverageStatus.summary}`);
    if (result.coverageStatus.signals.topLeafCanonicalTerm || result.coverageStatus.signals.topFamilyCanonicalTerm) {
        lines.push([
            `top_leaf="${result.coverageStatus.signals.topLeafCanonicalTerm ?? 'none'}"`,
            `top_family="${result.coverageStatus.signals.topFamilyCanonicalTerm ?? 'none'}"`,
            `family_evidence=${result.coverageStatus.signals.topFamilyEvidenceTier ?? 'none'}`,
            `matched_label="${result.coverageStatus.signals.matchedLabel ?? 'none'}"`,
            `missing_terms=${result.coverageStatus.signals.missingUsefulTokens.join(',') || 'none'}`,
            `missing_role=${result.coverageStatus.signals.missingRoleTokens.join(',') || 'none'}`
        ].join('  '));
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
    }
    else {
        for (const family of result.rankedFamilies) {
            lines.push(formatFamily(family, color, options.debug === true));
        }
    }
    lines.push('');
    lines.push(color.bold('Top leaves within best family'));
    const bestFamilyLeaves = result.rankedFamilies[0]?.leaves ?? [];
    if (bestFamilyLeaves.length === 0) {
        lines.push('- none');
    }
    else {
        for (const leaf of bestFamilyLeaves) {
            lines.push(formatLeaf(leaf, color, options.debug === true));
        }
    }
    if (options.debug === true) {
        lines.push('');
        lines.push(color.bold('Debug flow'));
        lines.push('Query cleaning');
        lines.push(`  raw: "${context.originalQuery}"`);
        lines.push(`  effective: "${context.query}"`);
        lines.push(`  changed: ${formatBoolean(context.originalQuery !== context.query)}`);
        lines.push(`  spans: ${JSON.stringify(context.querySpans)}`);
        lines.push(`  kept_signals: ${JSON.stringify(context.keptQuerySignals)}`);
        lines.push('');
        lines.push('Query intent');
        lines.push(`  role: ${result.preparedQuery.intent.roleTokens.join(',') || 'none'}`);
        lines.push(`  head: ${result.preparedQuery.intent.roleHeadTokens.join(',') || 'none'}`);
        lines.push(`  authoritative_head: ${result.preparedQuery.intent.authoritativeRoleHeadTokens.join(',') || 'none'}`);
        lines.push(`  domain: ${result.preparedQuery.intent.domainTokens.join(',') || 'none'}`);
        lines.push(`  venue: ${result.preparedQuery.intent.venueTokens.join(',') || 'none'}`);
        lines.push(`  generic_head: ${result.preparedQuery.intent.genericRoleHeadTokens.join(',') || 'none'}`);
        lines.push(`  seniority: ${result.preparedQuery.intent.seniorityTokens.join(',') || 'none'}`);
        lines.push(`  credential: ${result.preparedQuery.intent.credentialTokens.join(',') || 'none'}`);
        lines.push(`  ambiguous: ${result.preparedQuery.intent.ambiguousTokens.join(',') || 'none'}`);
        lines.push(`  unresolved: ${result.preparedQuery.intent.unresolvedModifierTokens.join(',') || 'none'}`);
        lines.push(`  confidence: ${formatPercent(result.preparedQuery.intent.confidence)}`);
        lines.push(`  diagnostics: ${formatIntentDiagnostics(result.preparedQuery.intent.diagnostics)}`);
        const retrievalDebugLines = debugFormatRetrievalSections(result, color);
        if (retrievalDebugLines.length > 0) {
            lines.push('');
            lines.push(...retrievalDebugLines);
        }
        const retrievalBoundaryDebugLines = debugFormatRetrievalBoundarySections(retrievalBoundaryDebug);
        if (retrievalBoundaryDebugLines.length > 0) {
            lines.push('');
            lines.push(...retrievalBoundaryDebugLines);
        }
        const familyProfileDebugLines = debugFormatFamilyProfileSections(result);
        if (familyProfileDebugLines.length > 0) {
            lines.push('');
            lines.push(...familyProfileDebugLines);
        }
        const familyPriorDebugLines = debugFormatFamilyPriorSections(result);
        if (familyPriorDebugLines.length > 0) {
            lines.push('');
            lines.push(...familyPriorDebugLines);
        }
        const familyStructureDebugLines = debugFormatFamilyStructureSections(result);
        if (familyStructureDebugLines.length > 0) {
            lines.push('');
            lines.push(...familyStructureDebugLines);
        }
        const familyRecoveryDebugLines = debugFormatFamilyRecoverySections(result);
        if (familyRecoveryDebugLines.length > 0) {
            lines.push('');
            lines.push(...familyRecoveryDebugLines);
        }
        const leafFirstDebugLines = debugFormatLeafFirstSections(result);
        if (leafFirstDebugLines.length > 0) {
            lines.push('');
            lines.push(...leafFirstDebugLines);
        }
        const rankingDebugLines = debugFormatRankingSections(result, color);
        if (rankingDebugLines.length > 0) {
            lines.push('');
            lines.push(...rankingDebugLines);
        }
        lines.push('');
        lines.push('Decision explanation');
        lines.push(`  final_decision_gate: ${decision.explanation.finalDecisionGate}`);
        lines.push(`  role_tokens: ${decision.explanation.roleTokens.join(',') || 'none'}`);
        lines.push(`  role_head_tokens: ${decision.explanation.roleHeadTokens.join(',') || 'none'}`);
        lines.push(`  generic_tokens: ${decision.explanation.genericTokens.join(',') || 'none'}`);
        if (decision.explanation.candidateLeaf) {
            lines.push(`  candidate_leaf: "${decision.explanation.candidateLeaf.label}"`);
            lines.push(`  candidate_leaf_role_compatibility: ${decision.explanation.candidateLeaf.roleCompatibility}`);
            lines.push(`  candidate_leaf_specialization_support: ${decision.explanation.candidateLeaf.specializationSupport}`);
        }
        if (decision.explanation.rejectedCompetitors.length > 0) {
            lines.push('  rejected_competitors:');
            for (const competitor of decision.explanation.rejectedCompetitors) {
                lines.push(`    [${competitor.kind}] "${competitor.label}" ${competitor.reason}`);
            }
        }
        lines.push('');
        lines.push('Pipeline debug');
        lines.push(`  stages: ${result.debug.stages.join(' -> ')}`);
        lines.push(`  attempts: ${result.debug.attempts.map((attempt) => `${attempt.attempt}:${attempt.kind}:${attempt.status}:${attempt.decisionType}:${formatPercent(attempt.confidence)}`).join(' | ')}`);
        lines.push(`  scanned alias hits: ${context.scannedAliasHitCount}`);
        lines.push(`  scanned lexical hits: ${context.scannedOpenSearchHitCount}`);
        lines.push(`  timings: ${formatTimings(result.debug.timings)}`);
    }
    return lines.join('\n');
}
function formatFamily(family, color, debug) {
    const authority = family.selectionAuthority;
    const lines = [
        `${family.rank}. ${color.cyan(family.familyKind)} "${family.familyLabel}" #${family.familyNodeId}`,
        `confidence=${formatPercent(family.confidence)}`,
        `evidence_tier=${family.evidenceTier ?? 'none'}`,
        `branch_share=${formatPercent(family.branchShare)}`,
        `margin=${family.branchMarginRatio === null ? 'none' : formatScore(family.branchMarginRatio)}`,
        `supporting_leaves=${family.supportingLeafCount}`,
        ...(authority
            ? [
                `primary_exact=${authority.primaryExactAliasLeafCount}`,
                `role_exact=${authority.exactRoleLeafCount}`,
                `role_partial=${authority.partialRoleLeafCount}`,
                `capability=${formatPercent(authority.capabilityRoleCoverage)}:${authority.capabilityLeafCount}`
            ]
            : []),
        `evidence=${summarizeEvidence(family.evidence)}`
    ].join('  ');
    if (!debug) {
        return lines;
    }
    const capabilityBreakdown = family.leaves
        .filter((leaf) => leaf.capabilityFit && leaf.capabilityFit.tier !== 'none')
        .map((leaf) => `"${leaf.canonicalLabel}":${leaf.capabilityFit?.tier}:matched=${leaf.capabilityFit?.matchedCapabilityTerms.join('/') || 'none'}:missing=${leaf.capabilityFit?.missingCapabilityTerms.join('/') || 'none'}`)
        .join(' | ');
    return [
        lines,
        authority
            ? [
                `debug.family_authority=tier_rank=${family.evidenceTierRank}`,
                `role_grounded=${authority.roleGrounded}`,
                `structure_authority=${formatPercent(authority.familyStructureAuthority)}`,
                `role_coverage=${formatPercent(authority.roleCoverage)}`,
                `profile_role=${formatPercent(authority.profileRoleCoverage)}`,
                `exact_family=${authority.exactFamilyCanonical}`,
                `useful_exact=${formatScore(authority.usefulExact)}`,
                `confidence=${formatPercent(authority.confidence)}`
            ].join(' ')
            : `debug.family_authority=tier_rank=${family.evidenceTierRank}`,
        `debug.capability_by_leaf=${capabilityBreakdown || 'none'}`,
        `debug.evidence_detail=${formatEvidenceDetail(family.evidence)}`
    ].join('\n');
}
function formatFamilyRankOutputDebug(result) {
    const comparison = result.debug.familyRankComparison;
    const evidenceRows = comparison.filter((entry) => entry.strategy === 'evidence');
    const top2Rows = comparison.filter((entry) => entry.strategy === 'top2-v4');
    const core2Rows = comparison.filter((entry) => entry.strategy === 'core-2');
    const lines = ['Family rank output comparison', '  stopped_after=consolidate_families', `  top_family_limit=${evidenceRows.length}`, ''];
    if (comparison.length === 0) {
        lines.push('  - none');
        return lines;
    }
    lines.push('  evidence top families');
    lines.push(...formatFamilyRankOutputRows(evidenceRows));
    lines.push('');
    lines.push('  top2-v4 top families');
    lines.push(...formatFamilyRankOutputRows(top2Rows));
    lines.push('');
    lines.push('  core-2 top families');
    lines.push(...formatFamilyRankOutputRows(core2Rows));
    return lines;
}
function formatFamilyRankOutputRows(rows) {
    if (rows.length === 0) {
        return ['    - none'];
    }
    return rows.map((entry) => [
        `    ${entry.rank}. "${entry.familyLabel}" #${entry.familyNodeId}`,
        `confidence=${formatPercent(entry.confidence)}`,
        `survived=${formatBoolean(entry.survived)}`
    ].join('  '));
}
function formatLeaf(leaf, color, debug) {
    const line = [
        `${leaf.rank}. ${color.green('leaf')} "${leaf.canonicalLabel}" #${leaf.graphNodeId}`,
        `confidence=${formatPercent(leaf.confidence)}`,
        `family="${leaf.familyLabel}" #${leaf.familyNodeId}`,
        `selection=${leaf.selectionEvidence?.tier ?? 'none'}`,
        `fit=${leaf.familyScopedFit?.tier ?? 'none'}`,
        `capability_fit=${leaf.capabilityFit?.tier ?? 'none'}:${formatPercent(leaf.capabilityFit?.coverage ?? 0)}:labels=${leaf.capabilityFit?.capabilityLabelCount ?? 0}`,
        `closeness=${formatPercent(leaf.closeness?.score ?? 0)}:${leaf.closeness?.matchedLabelSource ?? 'none'}:"${leaf.closeness?.matchedLabel ?? 'none'}"`,
        `evidence=${summarizeEvidence(leaf.evidence)}`
    ].join('  ');
    if (!debug) {
        return line;
    }
    const debugLines = [
        `   debug.selection_reasons=${leaf.selectionEvidence?.reasons.join(' | ') || 'none'}`,
        `   debug.closeness.matched=${leaf.closeness?.matchedUsefulTokens.join(',') || 'none'} debug.closeness.missing=${leaf.closeness?.missingUsefulTokens.join(',') || 'none'} debug.closeness.extra_title=${leaf.closeness?.extraTitleTokens.join(',') || 'none'} debug.closeness.extra_generic=${leaf.closeness?.extraGenericModifiers.join(',') || 'none'} debug.closeness.title_extra_ratio=${formatPercent(leaf.closeness?.titleExtraTokenRatio ?? 0)}`,
        `   debug.family_fit.matched=${leaf.familyScopedFit?.matchedTerms.join(',') || 'none'} debug.family_fit.missing=${leaf.familyScopedFit?.missingTerms.join(',') || 'none'} debug.family_fit.matched_capability=${leaf.familyScopedFit?.matchedCapabilityTerms.join(',') || 'none'} debug.family_fit.reasons=${leaf.familyScopedFit?.reasons.join(' | ') || 'none'}`,
        `   debug.capability.matched=${leaf.capabilityFit?.matchedCapabilityTerms.join(',') || 'none'} debug.capability.missing=${leaf.capabilityFit?.missingCapabilityTerms.join(',') || 'none'}`,
        `   debug.leaf_structure=${leaf.leafStructure ? `base_role=${leaf.leafStructure.baseRoleKind} specialization_kinds=${leaf.leafStructure.specializationKinds.join(',') || 'none'} authority_kind=${leaf.leafStructure.authorityKind}` : 'none (base-vs-specialization signal inactive for this leaf)'}`,
        `   debug.evidence_detail=${formatEvidenceDetail(leaf.evidence)}`
    ];
    return [line, ...debugLines].join('\n');
}
function formatTopCapabilities(capabilities) {
    const sortedCapabilities = [...capabilities].sort((left, right) => capabilityKindOrder(left.hintKind) - capabilityKindOrder(right.hintKind) ||
        (right.weight ?? 0) - (left.weight ?? 0) ||
        left.label.localeCompare(right.label));
    if (sortedCapabilities.length === 0) {
        return [];
    }
    return sortedCapabilities
        .slice(0, 5)
        .map((capability, index) => [
        `${index + 1}. "${capability.label}"`,
        `type=${capability.capabilityType}`,
        `hint=${capability.hintKind}`,
        `weight=${formatScore(capability.weight ?? 0)}`
    ].join('  '));
}
function capabilityKindOrder(hintKind) {
    if (hintKind === 'essential') {
        return 1;
    }
    if (hintKind === 'knowledge') {
        return 2;
    }
    if (hintKind === 'tool') {
        return 3;
    }
    if (hintKind === 'software') {
        return 4;
    }
    if (hintKind === 'optional') {
        return 5;
    }
    return 6;
}
function formatSpanResult(span, color) {
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
function summarizeEvidence(evidence) {
    const counts = new Map();
    for (const record of evidence) {
        counts.set(record.channel, (counts.get(record.channel) ?? 0) + 1);
    }
    return (Array.from(counts.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([channel, count]) => `${channel}:${count}`)
        .join(',') || 'none');
}
function debugFormatRetrievalSections(result, color) {
    const lines = [];
    if (result.debug.rawBranchExpansion) {
        lines.push('Retrieval');
        lines.push(...debugFormatRetrieval(result.debug.rawBranchExpansion, result.preparedQuery, color));
    }
    for (const span of result.spanResults) {
        if (!span.debug.rawBranchExpansion) {
            continue;
        }
        if (lines.length > 0) {
            lines.push('');
        }
        lines.push(`Retrieval span ${span.spanIndex}`);
        lines.push(...debugFormatRetrieval(span.debug.rawBranchExpansion, span.preparedQuery, color));
    }
    return lines;
}
function debugFormatRetrieval(branchExpansion, preparedQuery, color) {
    const lines = [];
    const retrievalSequences = preparedQueryIntentRetrievalSequences(preparedQuery);
    const topCandidates = branchExpansion.candidates.slice(0, Math.min(branchExpansion.limit, 8));
    const topBranches = branchExpansion.branches.slice(0, Math.min(6, branchExpansion.branches.length));
    const aliasNgramPath = debugCollectAliasNgramPath(branchExpansion.candidates);
    lines.push('  Authority');
    lines.push(`    original_query: "${branchExpansion.originalQuery}"`);
    lines.push(`    effective_query: "${branchExpansion.query}"`);
    lines.push(`    locales: ${branchExpansion.retrievalLocales.join(',')}`);
    lines.push(`    primary_sequences: ${formatTokenSequences(retrievalSequences.primaryFoldedTokenSequences)}`);
    lines.push(`    contextual_sequences: ${formatTokenSequences(retrievalSequences.contextualFoldedTokenSequences)}`);
    lines.push(`    useful_folded: ${preparedQuery.usefulFoldedRecallTokens.join(',') || 'none'}`);
    lines.push(`    variants: ${preparedQuery.usefulFoldedVariantTokens.join(',') || 'none'}`);
    lines.push(`    compound: ${preparedQuery.compoundExpandedFoldedTokens.join(',') || 'none'}`);
    lines.push('');
    lines.push('  Results');
    lines.push(`    candidates: ${branchExpansion.candidates.length}`);
    lines.push(`    branches: ${branchExpansion.branches.length}`);
    lines.push(`    scanned_alias_hits: ${branchExpansion.scannedAliasHitCount}`);
    lines.push(`    scanned_lexical_hits: ${branchExpansion.scannedOpenSearchHitCount}`);
    lines.push(`    timings: ${formatTimings(branchExpansion.timings)}`);
    if (topCandidates.length === 0) {
        lines.push('    top_candidates: none');
    }
    else {
        lines.push('    top_candidates:');
        for (const [index, candidate] of topCandidates.entries()) {
            lines.push([
                `      ${index + 1}. ${color.green(candidate.canonicalLabel)} #${candidate.graphNodeId}`,
                `score=${formatScore(candidate.totalScore)}`,
                `branch=${candidate.branchKind}:${candidate.branchLabel}#${candidate.branchNodeId}`,
                `channels=${formatChannelScores(candidate.channelScores)}`,
                `signals=${summarizeCandidateRetrievalEvidence(candidate.evidence)}`
            ].join('  '));
        }
    }
    if (topBranches.length === 0) {
        lines.push('    top_branches: none');
    }
    else {
        lines.push('    top_branches:');
        for (const [index, branch] of topBranches.entries()) {
            lines.push([
                `      ${index + 1}. ${color.cyan(branch.branchKind)} "${branch.branchLabel}" #${branch.branchNodeId}`,
                `candidate_count=${branch.scoreSummary.candidateCount}`,
                `max_score=${formatScore(branch.scoreSummary.maxCandidateScore)}`,
                `total_score=${formatScore(branch.scoreSummary.totalCandidateScore)}`,
                `channels=${formatBranchChannelScores(branch.scoreSummary.channelScores)}`,
                `top_candidates=${branch.candidates
                    .slice(0, 3)
                    .map((candidate) => candidate.canonicalLabel)
                    .join(' | ') || 'none'}`
            ].join('  '));
        }
    }
    lines.push('');
    lines.push('  Alias ngram path');
    lines.push(`    retained_hits: ${aliasNgramPath.length}`);
    if (aliasNgramPath.length === 0) {
        lines.push('    top_hits: none');
    }
    else {
        for (const [index, hit] of aliasNgramPath.slice(0, 8).entries()) {
            lines.push([
                `      ${index + 1}. "${hit.label}"`,
                `alias="${hit.alias}"`,
                `alias_role=${hit.aliasRole}`,
                `matched=${hit.matchedTokens.join('/') || 'none'}`,
                `query_cov=${formatPercent(hit.queryCoverage)}`,
                `alias_cov=${formatPercent(hit.aliasCoverage)}`,
                `phrase=${hit.phraseDirection}`
            ].join('  '));
        }
    }
    return lines;
}
function debugFormatRankingSections(result, color) {
    const lines = [];
    if (result.debug.candidatePoolTrace.length > 0) {
        lines.push('Ranking');
        lines.push(...debugFormatRanking(result.debug.candidatePoolTrace));
    }
    for (const span of result.spanResults) {
        if (span.debug.candidatePoolTrace.length === 0) {
            continue;
        }
        if (lines.length > 0) {
            lines.push('');
        }
        lines.push(`Ranking span ${span.spanIndex}`);
        lines.push(...debugFormatRanking(span.debug.candidatePoolTrace));
    }
    return lines;
}
function debugFormatLeafFirstSections(result) {
    const lines = [];
    if (result.debug.leafFirstFamilies.length > 0) {
        lines.push('Leaf-first families');
        lines.push(...formatLeafFirstFamilies(result.debug.leafFirstFamilies));
    }
    for (const span of result.spanResults) {
        if (span.debug.leafFirstFamilies.length === 0) {
            continue;
        }
        if (lines.length > 0) {
            lines.push('');
        }
        lines.push(`Leaf-first families span ${span.spanIndex}`);
        lines.push(...formatLeafFirstFamilies(span.debug.leafFirstFamilies));
    }
    return lines;
}
function formatLeafFirstFamilies(families) {
    if (families.length === 0) {
        return ['  none'];
    }
    return families.map((family) => [
        `  ${family.rank}. "${family.familyLabel}" #${family.familyNodeId}`,
        `confidence=${formatPercent(family.confidence)}`,
        `supporting_leaves=${family.supportingLeafCount}`,
        `top_leaf="${family.topLeafLabel ?? 'none'}"`,
        `top_leaf_confidence=${family.topLeafConfidence === null ? 'none' : formatPercent(family.topLeafConfidence)}`,
        `selectable_leaf="${family.selectableLeafLabel ?? 'none'}"`,
        `selectable_leaf_confidence=${family.selectableLeafConfidence === null ? 'none' : formatPercent(family.selectableLeafConfidence)}`
    ].join('  '));
}
function debugFormatRanking(trace) {
    const lines = [];
    const familyEntries = trace.filter((entry) => entry.poolKind === 'family');
    const leafEntries = trace.filter((entry) => entry.poolKind === 'leaf');
    lines.push(...debugFormatRankingPool('  family_pool', familyEntries));
    lines.push(...debugFormatRankingPool('  leaf_pool', leafEntries));
    return lines;
}
function debugFormatRankingPool(label, entries) {
    if (entries.length === 0) {
        return [`${label}=none`];
    }
    const kept = entries.filter((entry) => entry.survived);
    const dropped = entries.filter((entry) => !entry.survived);
    return [
        `${label}: total=${entries.length} kept=${kept.length} dropped=${dropped.length}`,
        `${label} kept: ${debugFormatRankingPoolEntries(kept)}`,
        `${label} dropped: ${debugFormatRankingPoolEntries(dropped)}`
    ];
}
function debugFormatRankingPoolEntries(entries) {
    if (entries.length === 0) {
        return 'none';
    }
    return entries
        .slice(0, 8)
        .map((entry) => `${entry.rankBeforeTruncation}."${entry.label}"${entry.discardReason ? `:${entry.discardReason}` : ''}`)
        .join(' | ');
}
function debugFormatRetrievalBoundarySections(snapshot) {
    if (!snapshot) {
        return [];
    }
    const lines = [];
    lines.push('Retrieval boundary');
    lines.push('  Alias ngram audit');
    lines.push(`    retained: ${snapshot.aliasNgram.retained.length}`);
    if (snapshot.aliasNgram.retained.length === 0) {
        lines.push('    retained_hits: none');
    }
    else {
        lines.push('    retained_hits:');
        for (const [index, hit] of snapshot.aliasNgram.retained.slice(0, 8).entries()) {
            lines.push([
                `      ${index + 1}. "${hit.canonicalLabel}"`,
                `alias="${hit.alias}"`,
                `alias_role=${hit.aliasRole}`,
                `matched=${hit.matchedTokens.join('/') || 'none'}`,
                `matched_role=${hit.matchedRoleTokens.join('/') || 'none'}`,
                `matched_domain=${hit.matchedDomainTokens.join('/') || 'none'}`,
                `role_grounded=${formatBoolean(hit.roleGrounded)}`,
                `context_only=${formatBoolean(hit.contextOnly)}`,
                `query_cov=${formatPercent(hit.queryCoverage)}`,
                `alias_cov=${formatPercent(hit.aliasCoverage)}`,
                `phrase=${hit.phraseDirection}`
            ].join('  '));
        }
    }
    lines.push(`    suppressed: ${snapshot.aliasNgram.suppressed.length}`);
    if (snapshot.aliasNgram.suppressed.length === 0) {
        lines.push('    suppressed_hits: none');
    }
    else {
        lines.push('    suppressed_hits:');
        for (const [index, hit] of snapshot.aliasNgram.suppressed.slice(0, 8).entries()) {
            lines.push([
                `      ${index + 1}. "${hit.canonicalLabel}"`,
                `alias="${hit.alias}"`,
                `alias_role=${hit.aliasRole}`,
                `matched=${hit.matchedTokens.join('/') || 'none'}`,
                `matched_role=${hit.matchedRoleTokens.join('/') || 'none'}`,
                `matched_domain=${hit.matchedDomainTokens.join('/') || 'none'}`,
                `role_grounded=${formatBoolean(hit.roleGrounded)}`,
                `context_only=${formatBoolean(hit.contextOnly)}`,
                `reason=${hit.suppressionReason ?? 'none'}`
            ].join('  '));
        }
    }
    lines.push('  Candidate admission audit');
    lines.push(`    context_only_lexical_admissions: ${snapshot.lexicalAdmissions.contextOnly.length}`);
    if (snapshot.lexicalAdmissions.contextOnly.length === 0) {
        lines.push('    top_admissions: none');
    }
    else {
        lines.push('    top_admissions:');
        for (const [index, entry] of snapshot.lexicalAdmissions.contextOnly.slice(0, 8).entries()) {
            lines.push([
                `      ${index + 1}. "${entry.canonicalLabel}"`,
                `matched=${entry.matchedTokens.join('/') || 'none'}`,
                `matched_role=${entry.matchedRoleTokens.join('/') || 'none'}`,
                `matched_domain=${entry.matchedDomainTokens.join('/') || 'none'}`,
                `role_grounded=${formatBoolean(entry.roleGrounded)}`,
                `context_only=${formatBoolean(entry.contextOnly)}`,
                `fields=${entry.fields.join('/') || 'none'}`,
                `support_fields=${entry.supportFields.join('/') || 'none'}`
            ].join('  '));
        }
    }
    return lines;
}
function debugFormatFamilyProfileSections(result) {
    const lines = [];
    const familyScopedPreparedQuery = prepareFamilyScopedQueryFromPrepared(result.preparedQuery);
    const profileHits = debugCollectFamilyProfileHits(result);
    if (profileHits.length === 0) {
        return lines;
    }
    lines.push('Family profile');
    lines.push(`  query_tokens: ${familyScopedPreparedQuery.familyScopedFoldedTokens.join(',') || 'none'}`);
    lines.push(`  role_tokens: ${familyScopedPreparedQuery.intent.roleTokens.join(',') || 'none'}`);
    lines.push(`  role_head_tokens: ${familyScopedPreparedQuery.intent.authoritativeRoleHeadTokens.join(',') || familyScopedPreparedQuery.intent.roleHeadTokens.join(',') || 'none'}`);
    lines.push(`  domain_tokens: ${familyScopedPreparedQuery.intent.domainTokens.join(',') || 'none'}`);
    lines.push(`  hit_count: ${profileHits.length}`);
    lines.push('  scored_families:');
    for (const [index, hit] of profileHits.slice(0, 6).entries()) {
        const label = hit.survivedFamilyPool ? `"${hit.familyLabel}"` : `~~"${hit.familyLabel}"~~`;
        lines.push([
            `    ${index + 1}. ${label}`,
            `survived_family_pool=${formatBoolean(hit.survivedFamilyPool)}`,
            `score=${formatScore(hit.score)}`,
            `exact=${formatBoolean(hit.exactFamilyLabelPhrase)}`,
            `useful_exact=${formatBoolean(hit.usefulFamilyLabelPhrase)}`,
            `coverage=${formatPercent(hit.coverage)}`,
            `role=${formatPercent(hit.roleCoverage)}`,
            `domain=${formatPercent(hit.domainCoverage)}`,
            `sources=${hit.matchedSources.join('/') || 'none'}`,
            `matched_role=${hit.matchedRoleTerms.join('/') || 'none'}`,
            `matched_domain=${hit.matchedDomainTerms.join('/') || 'none'}`
        ].join('  '));
    }
    return lines;
}
function debugFormatFamilyPriorSections(result) {
    const lines = [];
    const priorRows = debugCollectFamilyPriorRows(result.rankedFamilies);
    const hasRows = Object.values(priorRows).some((rows) => rows.length > 0);
    if (!hasRows) {
        return lines;
    }
    lines.push('Family priors');
    for (const [channel, rows] of Object.entries(priorRows)) {
        if (rows.length === 0) {
            continue;
        }
        lines.push(`  ${channel}:`);
        for (const [index, row] of rows.slice(0, 6).entries()) {
            lines.push(`    ${index + 1}. "${row.familyLabel}"  score=${formatScore(row.score)}  detail=${row.detail}`);
        }
    }
    return lines;
}
function debugFormatFamilyStructureSections(result) {
    if (result.debug.familyStructure.length === 0) {
        return [];
    }
    const lines = ['Family structure'];
    for (const row of result.debug.familyStructure.slice(0, 12)) {
        lines.push([
            `  ${row.rank}. "${row.familyLabel}" #${row.familyNodeId}`,
            `support=${formatScore(row.structuralSupport)}`,
            `contradiction=${formatScore(row.structuralContradiction)}`,
            `rejected=${formatBoolean(row.structuralRejected)}`,
            `raw=${formatScore(row.rawStructuralScore)}`,
            `aligned=${row.alignedDimensions.join('/') || 'none'}`,
            `contradicted=${row.contradictedDimensions.join('/') || 'none'}`,
            `reasons=${row.rejectionReasons.join(' | ') || 'none'}`
        ].join('  '));
    }
    return lines;
}
function debugCollectFamilyProfileHits(result) {
    const survivingFamilyIds = new Set([
        ...result.debug.candidatePoolTrace
            .filter((entry) => entry.poolKind === 'family' && entry.survived)
            .map((entry) => Number(entry.identifier)),
        ...result.rankedFamilies.map((family) => family.familyNodeId)
    ].filter((value) => Number.isFinite(value)));
    return result.debug.familyProfileHits
        .map((hit) => ({
        familyNodeId: hit.familyNodeId,
        familyLabel: hit.familyLabel,
        score: hit.score,
        coverage: hit.coverage,
        roleCoverage: hit.roleCoverage,
        domainCoverage: hit.domainCoverage,
        matchedSources: hit.matchedSources,
        matchedRoleTerms: hit.matchedRoleTerms,
        matchedDomainTerms: hit.matchedDomainTerms,
        exactFamilyLabelPhrase: hit.exactFamilyLabelPhrase,
        usefulFamilyLabelPhrase: hit.usefulFamilyLabelPhrase,
        survivedFamilyPool: survivingFamilyIds.has(hit.familyNodeId)
    }))
        .sort((left, right) => right.score - left.score);
}
function debugCollectFamilyPriorRows(families) {
    const rows = {
        job_function_family_prior: [],
        generic_head_family_prior: [],
        reviewed_family_signal: [],
        reviewed_family_penalty: []
    };
    for (const family of families) {
        for (const record of family.evidence) {
            if (!(record.channel in rows)) {
                continue;
            }
            rows[record.channel].push({
                familyLabel: family.familyLabel,
                score: record.score,
                detail: summarizeFamilyPriorDetail(record)
            });
        }
    }
    for (const key of Object.keys(rows)) {
        rows[key].sort((left, right) => right.score - left.score);
    }
    return rows;
}
function summarizeFamilyPriorDetail(record) {
    if (record.channel === 'job_function_family_prior') {
        const jobFunction = typeof record.details.job_function === 'string' ? record.details.job_function : 'none';
        const strength = typeof record.details.prior_strength === 'string' ? record.details.prior_strength : 'none';
        return `job_function=${jobFunction} strength=${strength}`;
    }
    if (record.channel === 'generic_head_family_prior') {
        const roleHead = typeof record.details.role_head === 'string' ? record.details.role_head : 'none';
        const strength = typeof record.details.prior_strength === 'string' ? record.details.prior_strength : 'none';
        return `role_head=${roleHead} strength=${strength}`;
    }
    if (record.channel === 'reviewed_family_signal' || record.channel === 'reviewed_family_penalty') {
        const ruleId = typeof record.details.rule_id === 'string' ? record.details.rule_id : 'none';
        const action = typeof record.details.action === 'string' ? record.details.action : 'none';
        const matched = extractStringArray(record.details.matched_query_terms);
        return `rule=${ruleId} action=${action} matched=${matched.join('/') || 'none'}`;
    }
    return 'none';
}
function debugFormatFamilyRecoverySections(result) {
    const lines = [];
    const familyScopedPreparedQuery = prepareFamilyScopedQueryFromPrepared(result.preparedQuery);
    const recoveryFamilies = result.rankedFamilies.filter((family) => family.familyKind === 'family');
    const familyIds = recoveryFamilies.map((family) => family.familyNodeId);
    const recoveredLeaves = result.rankedLeaves.filter((leaf) => leaf.evidence.some((record) => record.sourceStage === 'family_constrained_recovery' || record.channel === 'graph_family_recovery'));
    if (familyIds.length === 0 && recoveredLeaves.length === 0) {
        return lines;
    }
    lines.push('Family recovery');
    lines.push(`  selected_family_ids: ${familyIds.join(',') || 'none'}`);
    lines.push('  selected_families:');
    for (const [index, family] of recoveryFamilies.entries()) {
        lines.push(`    ${index + 1}. "${family.familyLabel}"  confidence=${formatPercent(family.confidence)}  evidence_tier=${family.evidenceTier ?? 'none'}`);
    }
    lines.push('  allowed_by: ranked family selection -> recover_leaves_inside_top_families');
    lines.push(`  family_scoped_tokens: ${familyScopedPreparedQuery.familyScopedFoldedTokens.join(',') || 'none'}`);
    lines.push(`  capability_additions: ${familyScopedPreparedQuery.capabilityVerbFoldedAdditionTokens.join(',') || 'none'}`);
    lines.push(`  recovered_leaves: ${recoveredLeaves.length}`);
    if (recoveredLeaves.length === 0) {
        lines.push('  top_recovered: none');
        return lines;
    }
    lines.push('  top_recovered:');
    for (const [index, leaf] of recoveredLeaves.slice(0, 6).entries()) {
        lines.push([
            `    ${index + 1}. "${leaf.canonicalLabel}"`,
            `family="${leaf.familyLabel}"`,
            `recovery_channels=${Array.from(new Set(leaf.evidence.map((record) => record.channel).filter((channel) => channel === 'graph_family_recovery' || channel === 'lexical'))).join('/') || 'none'}`,
            `recovery_reason=${debugDescribeRecoveryReason(leaf)}`
        ].join('  '));
    }
    return lines;
}
function debugDescribeRecoveryReason(leaf) {
    if (leaf.evidence.some((record) => record.channel === 'lexical' && record.sourceStage === 'family_constrained_recovery')) {
        return 'family_scoped_lexical_hit';
    }
    if (leaf.evidence.some((record) => record.channel === 'graph_family_recovery')) {
        return 'family_graph_sweep_in';
    }
    return 'none';
}
function formatChannelScores(channelScores) {
    return (Object.entries(channelScores)
        .filter(([, score]) => (score ?? 0) > 0)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([channel, score]) => `${channel}:${formatScore(score ?? 0)}`)
        .join(',') || 'none');
}
function formatBranchChannelScores(channelScores) {
    return (Object.entries(channelScores)
        .filter(([, score]) => score > 0)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([channel, score]) => `${channel}:${formatScore(score)}`)
        .join(',') || 'none');
}
function summarizeCandidateRetrievalEvidence(evidence) {
    return (evidence
        .slice(0, 4)
        .map((record) => {
        const alias = typeof record.alias === 'string' && record.alias ? ` alias="${record.alias}"` : '';
        const textRole = typeof record.textRole === 'string' && record.textRole ? ` role=${record.textRole}` : '';
        const matchedFields = extractStringArray(record.details?.matched_fields);
        const matchedTokens = extractStringArray(record.details?.matched_tokens);
        const matchType = typeof record.details?.match_type === 'string' && record.details.match_type ? ` match_type=${record.details.match_type}` : '';
        const aliasWeight = typeof record.details?.alias_weight === 'number' ? ` alias_weight=${formatScore(record.details.alias_weight)}` : '';
        const fields = matchedFields.length > 0 ? ` fields=${matchedFields.join('/')}` : '';
        const tokens = matchedTokens.length > 0 ? ` tokens=${matchedTokens.slice(0, 4).join('/')}` : '';
        const fieldSignals = formatFieldSignals(record.details?.field_signals);
        const signals = fieldSignals ? ` field_signals=[${fieldSignals}]` : '';
        return `${record.channel}${alias}${textRole}${matchType}${aliasWeight}${fields}${tokens}${signals}`;
    })
        .join(' | ') || 'none');
}
function extractStringArray(value) {
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item.length > 0) : [];
}
function formatFieldSignals(value) {
    if (!Array.isArray(value) || value.length === 0) {
        return '';
    }
    return value
        .map((raw) => {
        if (typeof raw !== 'object' || raw === null) {
            return '';
        }
        const signal = raw;
        const field = typeof signal.field === 'string' ? signal.field : 'unknown';
        const aliasRole = typeof signal.aliasRole === 'string' ? signal.aliasRole : null;
        const phraseMatch = signal.phraseMatch === true;
        const phraseMatchDirection = typeof signal.phraseMatchDirection === 'string' ? signal.phraseMatchDirection : 'none';
        const usefulMatchedTokens = extractStringArray(signal.usefulMatchedTokens);
        const usefulTokenCoverage = typeof signal.usefulTokenCoverage === 'number' ? signal.usefulTokenCoverage : 0;
        return `${field}${aliasRole ? `/${aliasRole}` : ''}${phraseMatch ? `:phrase(${phraseMatchDirection})` : ''}:coverage=${formatPercent(usefulTokenCoverage)}:tokens=${usefulMatchedTokens.join('/') || 'none'}`;
    })
        .filter((entry) => entry.length > 0)
        .join(' | ');
}
function formatEvidenceRecordDetail(record) {
    const details = record.details ?? {};
    const parts = [`${record.channel}:score=${formatScore(record.score)}`];
    const alias = typeof details.alias === 'string' && details.alias ? details.alias : null;
    const aliasRole = typeof details.alias_role === 'string' && details.alias_role ? details.alias_role : null;
    const aliasWeight = typeof details.alias_weight === 'number' ? details.alias_weight : null;
    const matchType = typeof details.match_type === 'string' && details.match_type ? details.match_type : null;
    const matchedTokens = extractStringArray(details.matched_tokens);
    const fieldSignals = formatFieldSignals(details.field_signals);
    const queryUsefulTokenCoverage = typeof details.query_useful_token_coverage === 'number' ? details.query_useful_token_coverage : null;
    const aliasUsefulTokenCoverage = typeof details.alias_useful_token_coverage === 'number' ? details.alias_useful_token_coverage : null;
    const phraseDirection = typeof details.phrase_direction === 'string' && details.phrase_direction ? details.phrase_direction : null;
    if (alias) {
        parts.push(`alias="${alias}"`);
    }
    if (aliasRole) {
        parts.push(`alias_role=${aliasRole}`);
    }
    if (aliasWeight !== null) {
        parts.push(`alias_weight=${formatScore(aliasWeight)}`);
    }
    if (matchType) {
        parts.push(`match_type=${matchType}`);
    }
    if (matchedTokens.length > 0) {
        parts.push(`matched_tokens=${matchedTokens.join('/')}`);
    }
    if (queryUsefulTokenCoverage !== null || aliasUsefulTokenCoverage !== null) {
        parts.push(`coverage(query=${formatPercent(queryUsefulTokenCoverage ?? 0)},alias=${formatPercent(aliasUsefulTokenCoverage ?? 0)})`);
    }
    if (phraseDirection) {
        parts.push(`phrase_direction=${phraseDirection}`);
    }
    if (fieldSignals) {
        parts.push(`field_signals=[${fieldSignals}]`);
    }
    return parts.join(' ');
}
function formatTokenBuckets(preparedQuery) {
    const genericTokens = new Set(preparedQuery.genericTokens);
    const stopTokens = new Set(preparedQuery.stopTokens);
    const modifierTokens = new Set(preparedQuery.modifierTokens);
    const noiseTokens = new Set(preparedQuery.noiseTokens);
    const usefulFoldedRecallTokens = new Set(preparedQuery.usefulFoldedRecallTokens);
    return (preparedQuery.foldedTokens
        .map((token) => {
        const bucket = noiseTokens.has(token)
            ? 'noise'
            : stopTokens.has(token)
                ? 'stop'
                : genericTokens.has(token)
                    ? 'generic'
                    : modifierTokens.has(token)
                        ? 'modifier'
                        : usefulFoldedRecallTokens.has(token)
                            ? 'useful'
                            : 'unclassified';
        return `${token}:${bucket}`;
    })
        .join(',') || 'none');
}
function formatIntentDiagnostics(diagnostics) {
    return diagnostics.map((item) => `${item.token}:${item.kind}`).join(',') || 'none';
}
function formatTokenSequences(sequences) {
    if (sequences.length === 0) {
        return 'none';
    }
    return sequences.map((sequence) => sequence.join(' ')).join(' | ');
}
function debugCollectAliasNgramPath(candidates) {
    return candidates
        .flatMap((candidate) => candidate.evidence
        .filter((record) => record.channel === 'ngram_alias')
        .map((record) => ({
        label: candidate.canonicalLabel,
        alias: typeof record.alias === 'string' && record.alias ? record.alias : candidate.canonicalLabel,
        aliasRole: typeof record.aliasRole === 'string' && record.aliasRole
            ? record.aliasRole
            : typeof record.details?.alias_role === 'string' && record.details.alias_role
                ? record.details.alias_role
                : 'unknown',
        matchedTokens: extractStringArray(record.details?.matched_tokens),
        queryCoverage: typeof record.details?.query_useful_token_coverage === 'number' ? record.details.query_useful_token_coverage : 0,
        aliasCoverage: typeof record.details?.alias_useful_token_coverage === 'number' ? record.details.alias_useful_token_coverage : 0,
        phraseDirection: typeof record.details?.phrase_direction === 'string' && record.details.phrase_direction
            ? record.details.phrase_direction
            : 'none',
        score: typeof record.score === 'number' ? record.score : 0
    })))
        .sort((left, right) => right.score - left.score)
        .slice(0, 24);
}
function formatEvidenceDetail(evidence) {
    return evidence.map((record) => formatEvidenceRecordDetail(record)).join(' | ') || 'none';
}
function toJsonResult(result) {
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
                timings: span.debug.timings,
                raw_branch_expansion: span.debug.rawBranchExpansion,
                candidate_pool_trace: span.debug.candidatePoolTrace,
                family_profile_hits: span.debug.familyProfileHits,
                leaf_first_families: span.debug.leafFirstFamilies,
                family_rank_comparison: span.debug.familyRankComparison,
                family_structure: span.debug.familyStructure
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
            timings: result.debug.timings,
            raw_branch_expansion: result.debug.rawBranchExpansion,
            candidate_pool_trace: result.debug.candidatePoolTrace,
            family_profile_hits: result.debug.familyProfileHits,
            leaf_first_families: result.debug.leafFirstFamilies,
            family_rank_comparison: result.debug.familyRankComparison,
            family_structure: result.debug.familyStructure
        }
    };
}
function formatTimings(timings) {
    const entries = Object.entries(timings)
        .filter(([, elapsedMs]) => elapsedMs > 0)
        .sort(([, leftMs], [, rightMs]) => rightMs - leftMs);
    if (entries.length === 0) {
        return 'none';
    }
    return entries.map(([ref, elapsedMs]) => `${ref}=${formatScore(elapsedMs)}ms`).join('  ');
}
function parseFormat(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'text' || normalized === 'json') {
        return normalized;
    }
    throw new Error(`Unsupported format "${value}". Use --format=text or --format=json.`);
}
function parsePositiveInteger(flagName, value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--${flagName} must be a positive integer. Received "${value}".`);
    }
    return parsed;
}
function parseNonNegativeInteger(flagName, value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error(`--${flagName} must be a non-negative integer. Received "${value}".`);
    }
    return parsed;
}
function formatPercent(value) {
    return `${Math.round(value * 100)}%`;
}
function formatScore(value) {
    return value.toFixed(6).replace(/0+$/u, '').replace(/\.$/u, '');
}
function formatBoolean(value) {
    return value ? 'yes' : 'no';
}
function createColor(enabled) {
    const wrap = (open, close) => (value) => (enabled ? `${open}${value}${close}` : value);
    return {
        bold: wrap('\u001b[1m', '\u001b[22m'),
        green: wrap('\u001b[32m', '\u001b[39m'),
        yellow: wrap('\u001b[33m', '\u001b[39m'),
        cyan: wrap('\u001b[36m', '\u001b[39m')
    };
}
function colorDecisionType(decisionType, color) {
    if (decisionType === 'leaf') {
        return color.green(decisionType);
    }
    if (decisionType === 'family' || decisionType === 'group') {
        return color.cyan(decisionType);
    }
    return color.yellow(decisionType);
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/resolve-occupation-pipeline.js',
        '--query="software developer"',
        `[--locale=${DEFAULT_RETRIEVAL_LOCALE}]`,
        `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
        '[--job-function=skilled_trades]',
        `[--limit=${DEFAULT_CANDIDATE_LIMIT}]`,
        `[--sibling-limit=${DEFAULT_SIBLING_LIMIT}]`,
        '[--top-family-limit=3]',
        '[--top-leaves-per-family=5]',
        '[--format=text|json]',
        '[--debug|--debug=family-rank-output]',
        '[--no-color]'
    ].join(' '));
}
await main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Occupation pipeline failed.');
    console.error(message);
    process.exitCode = 1;
});
