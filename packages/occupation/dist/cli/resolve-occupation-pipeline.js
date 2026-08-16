import { withConnection } from '../db/mysql.js';
import { DEFAULT_CANDIDATE_LIMIT, DEFAULT_ESCO_SOURCE_NAME, DEFAULT_MODEL_KEY, DEFAULT_RETRIEVAL_LOCALE, OccupationCandidateRetriever } from '../retrieval/occupation-candidates.js';
import { DEFAULT_SIBLING_LIMIT, OccupationCandidateBranchExpander } from '../retrieval/occupation-candidate-branches.js';
import { OccupationSearchPipeline } from '../search-pipeline/occupation-search-pipeline.js';
import { parseRetrievalBackend } from '../retrieval/retrieval-engine-factory.js';
import { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const runtime = await OccupationRuntimeContext.load({
        sourceName: options.sourceName,
        retrievalBackend: options.retrievalBackend ?? undefined,
        leafStructureRuntime: true
    });
    const engine = runtime.retrievalEngine;
    const result = options.evaluationQueryId === undefined
        ? await OccupationSearchPipeline.withRuntime(runtime).run(options)
        : await withConnection((connection) => new OccupationSearchPipeline(new OccupationCandidateBranchExpander(OccupationCandidateRetriever.withEngine(connection, engine)), engine.occupations).run(options));
    console.log(formatPipelineResult(result, options, runtime.retrievalBackend));
}
function parseCliOptions(args) {
    const options = {
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
function formatPipelineResult(result, options, retrievalBackend) {
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
        `retrieval_profile=${context.retrievalProfile}`,
        `model=${context.modelKey}`,
        `job_function=${context.jobFunction ?? 'none'}`
    ].join('  '));
    lines.push(`effective_query="${context.query}"  query_spans=${JSON.stringify(context.querySpans)}  kept_signals=${JSON.stringify(context.keptQuerySignals)}  dropped_signals=${context.querySignals.length - context.keptQuerySignals.length}  signal_cleaning_ms=${context.querySignalCleaningMs}`);
    if (context.roleSpanSelection?.selectedSpan) {
        lines.push(`role_query="${context.roleSpanSelection.roleQuery}"  context_query="${context.roleSpanSelection.contextQuery}"  role_span_score=${context.roleSpanSelection.selectedSpan.score}  role_span_evidence=${context.roleSpanSelection.selectedSpan.evidence.join(',') || 'none'}`);
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
            lines.push(formatFamily(family, color, options.debug));
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
            lines.push(formatLeaf(leaf, color, options.debug));
        }
    }
    if (options.debug) {
        lines.push('');
        lines.push(color.bold('Decision explanation'));
        lines.push(`role_tokens=${decision.explanation.roleTokens.join(',') || 'none'}  role_head_tokens=${decision.explanation.roleHeadTokens.join(',') || 'none'}  generic_tokens=${decision.explanation.genericTokens.join(',') || 'none'}`);
        lines.push(`final_decision_gate=${decision.explanation.finalDecisionGate}`);
        if (decision.explanation.candidateLeaf) {
            lines.push(`candidate_leaf="${decision.explanation.candidateLeaf.label}"  role_compatibility=${decision.explanation.candidateLeaf.roleCompatibility}  specialization_support=${decision.explanation.candidateLeaf.specializationSupport}`);
        }
        if (decision.explanation.rejectedCompetitors.length > 0) {
            lines.push('rejected_competitors:');
            for (const competitor of decision.explanation.rejectedCompetitors) {
                lines.push(`  - [${competitor.kind}] "${competitor.label}" ${competitor.reason}`);
            }
        }
        lines.push('');
        lines.push(color.bold('Ranking Pipeline debug'));
        lines.push(`stages=${result.debug.stages.join(' -> ')}`);
        lines.push(`attempts=${result.debug.attempts.map((attempt) => `${attempt.attempt}:${attempt.kind}:${attempt.status}:${attempt.decisionType}:${formatPercent(attempt.confidence)}`).join(' | ')}`);
        lines.push(`prepared.raw="${result.preparedQuery.raw}"  prepared.locale=${result.preparedQuery.locale}  prepared.normalized="${result.preparedQuery.normalized}"  prepared.folded="${result.preparedQuery.folded}"`);
        lines.push(`prepared.surface_tokens=${result.preparedQuery.surfaceTokens.join(',') || 'none'} prepared.tokens=${result.preparedQuery.tokens.join(',') || 'none'} prepared.folded_tokens=${result.preparedQuery.foldedTokens.join(',') || 'none'}`);
        lines.push(`prepared.useful_tokens=${result.preparedQuery.usefulTokens.join(',') || 'none'} prepared.useful_folded_tokens=${result.preparedQuery.usefulFoldedTokens.join(',') || 'none'}`);
        lines.push(`prepared.expanded_tokens=${result.preparedQuery.expandedTokens.join(',') || 'none'} prepared.expanded_folded_tokens=${result.preparedQuery.expandedFoldedTokens.join(',') || 'none'}`);
        lines.push(`prepared.generic_tokens=${result.preparedQuery.genericTokens.join(',') || 'none'} prepared.is_generic_shape=${formatBoolean(result.preparedQuery.isGenericShape)}`);
        lines.push(`prepared.stop_tokens=${result.preparedQuery.stopTokens.join(',') || 'none'} prepared.acronyms=${result.preparedQuery.acronymTokens.join(',') || 'none'}`);
        lines.push(`prepared.modifier_tokens=${result.preparedQuery.modifierTokens.join(',') || 'none'} prepared.noise_tokens=${result.preparedQuery.noiseTokens.join(',') || 'none'}`);
        lines.push(`prepared.compound_split_tokens=${result.preparedQuery.compoundSplitTokens.join(',') || 'none'} prepared.compound_split_folded_tokens=${result.preparedQuery.compoundSplitFoldedTokens.join(',') || 'none'}`);
        // Debug-only: classify every raw folded token into the bucket it landed in, so a place-name/qualifier
        // token (e.g. "harghita", "otopeni") can be confirmed as meaningful/useful rather than inferred by
        // diffing folded_tokens against the generic/stop/modifier/noise lists printed above.
        lines.push(`prepared.token_buckets=${formatTokenBuckets(result.preparedQuery)}`);
        lines.push(`prepared.common_role_phrase_match=${result.preparedQuery.commonRolePhraseMatch ? JSON.stringify(result.preparedQuery.commonRolePhraseMatch) : 'none'}`);
        lines.push(`prepared.family_alias_match=${result.preparedQuery.familyAliasMatch ? JSON.stringify(result.preparedQuery.familyAliasMatch) : 'none'}`);
        lines.push([
            `intent.role=${result.preparedQuery.intent.roleTokens.join(',') || 'none'}`,
            `intent.head=${result.preparedQuery.intent.roleHeadTokens.join(',') || 'none'}`,
            `intent.generic_head=${result.preparedQuery.intent.genericRoleHeadTokens.join(',') || 'none'}`,
            `intent.authoritative_head=${result.preparedQuery.intent.authoritativeRoleHeadTokens.join(',') || 'none'}`,
            `intent.domain=${result.preparedQuery.intent.domainTokens.join(',') || 'none'}`,
            `intent.confidence=${formatPercent(result.preparedQuery.intent.confidence)}`
        ].join(' '));
        lines.push([
            `intent.class_preference.preferred=${result.preparedQuery.intent.occupationClassPreference.preferredFamilyGroups.join(',') || 'none'}`,
            `intent.class_preference.disfavored=${result.preparedQuery.intent.occupationClassPreference.disfavoredFamilyGroups.join(',') || 'none'}`,
            `intent.head_requires_context=${formatBoolean(result.preparedQuery.intent.roleHeadRequiresContext)}`,
            `intent.head_has_context=${formatBoolean(result.preparedQuery.intent.roleHeadHasContext)}`,
            `intent.venue=${result.preparedQuery.intent.venueTokens.join(',') || 'none'}`,
            `intent.seniority=${result.preparedQuery.intent.seniorityTokens.join(',') || 'none'}`,
            `intent.credential=${result.preparedQuery.intent.credentialTokens.join(',') || 'none'}`,
            `intent.ambiguous=${result.preparedQuery.intent.ambiguousTokens.join(',') || 'none'}`,
            `intent.unresolved_modifier=${result.preparedQuery.intent.unresolvedModifierTokens.join(',') || 'none'}`
        ].join(' '));
        lines.push(`intent.diagnostics=${result.preparedQuery.intent.diagnostics.map((item) => `${item.token}:${item.kind}`).join(',') || 'none'}`);
        lines.push(`scanned alias hits=${context.scannedAliasHitCount}, lexical hits=${context.scannedOpenSearchHitCount}`);
        lines.push(`timings=${formatTimings(result.debug.timings)}`);
        const retrievalDebugLines = formatRetrievalDebugSections(result, color);
        if (retrievalDebugLines.length > 0) {
            lines.push('');
            lines.push(...retrievalDebugLines);
        }
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
        `debug.capability_by_leaf=${capabilityBreakdown || 'none'}`,
        `debug.evidence_detail=${formatEvidenceDetail(family.evidence)}`
    ].join('\n');
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
function formatRetrievalDebugSections(result, color) {
    const lines = [];
    if (result.debug.rawBranchExpansion) {
        lines.push(color.bold('Retrieval debug'));
        lines.push(...formatRetrievalDebug(result.debug.rawBranchExpansion, color));
    }
    for (const span of result.spanResults) {
        if (!span.debug.rawBranchExpansion) {
            continue;
        }
        if (lines.length > 0) {
            lines.push('');
        }
        lines.push(color.bold(`Retrieval debug span ${span.spanIndex}`));
        lines.push(...formatRetrievalDebug(span.debug.rawBranchExpansion, color));
    }
    return lines;
}
function formatRetrievalDebug(branchExpansion, color) {
    const lines = [];
    const topCandidates = branchExpansion.candidates.slice(0, Math.min(branchExpansion.limit, 8));
    const topBranches = branchExpansion.branches.slice(0, Math.min(6, branchExpansion.branches.length));
    lines.push([
        `query="${branchExpansion.query}"`,
        `locales=${branchExpansion.retrievalLocales.join(',')}`,
        `candidates=${branchExpansion.candidates.length}`,
        `branches=${branchExpansion.branches.length}`,
        `scanned_alias_hits=${branchExpansion.scannedAliasHitCount}`,
        `scanned_lexical_hits=${branchExpansion.scannedOpenSearchHitCount}`
    ].join('  '));
    lines.push(`timings=${formatTimings(branchExpansion.timings)}`);
    if (topCandidates.length === 0) {
        lines.push('top_candidates=none');
    }
    else {
        lines.push('top_candidates:');
        for (const [index, candidate] of topCandidates.entries()) {
            lines.push([
                `${index + 1}. ${color.green(candidate.canonicalLabel)} #${candidate.graphNodeId}`,
                `score=${formatScore(candidate.totalScore)}`,
                `branch=${candidate.branchKind}:${candidate.branchLabel}#${candidate.branchNodeId}`,
                `channels=${formatChannelScores(candidate.channelScores)}`,
                `signals=${summarizeCandidateRetrievalEvidence(candidate.evidence)}`
            ].join('  '));
        }
    }
    if (topBranches.length === 0) {
        lines.push('top_branches=none');
    }
    else {
        lines.push('top_branches:');
        for (const [index, branch] of topBranches.entries()) {
            lines.push([
                `${index + 1}. ${color.cyan(branch.branchKind)} "${branch.branchLabel}" #${branch.branchNodeId}`,
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
    return lines;
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
    const usefulFoldedTokens = new Set(preparedQuery.usefulFoldedTokens);
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
                        : usefulFoldedTokens.has(token)
                            ? 'useful'
                            : 'unclassified';
        return `${token}:${bucket}`;
    })
        .join(',') || 'none');
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
                candidate_pool_trace: span.debug.candidatePoolTrace
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
            candidate_pool_trace: result.debug.candidatePoolTrace
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
        `[--model-key=${DEFAULT_MODEL_KEY}]`,
        '[--job-function=skilled_trades]',
        `[--limit=${DEFAULT_CANDIDATE_LIMIT}]`,
        `[--sibling-limit=${DEFAULT_SIBLING_LIMIT}]`,
        '[--top-family-limit=3]',
        '[--top-leaves-per-family=5]',
        '[--format=text|json]',
        '[--debug]',
        '[--no-color]'
    ].join(' '));
}
await main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Occupation pipeline failed.');
    console.error(message);
    process.exitCode = 1;
});
