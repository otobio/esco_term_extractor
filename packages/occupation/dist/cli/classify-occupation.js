import { classifyOccupationTitle, classifyOccupationTitleDebug } from '../occupation-classifier/index.js';
import { DEFAULT_CLASSIFIER_SOURCE_NAME } from '../occupation-classifier/constants.js';
import { DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    if (!options.query?.trim()) {
        throw new Error('Provide --query="...".');
    }
    // ANSI escape codes for terminal styling
    const BOLD = '\x1b[1m';
    const RESET = '\x1b[0m';
    const result = options.debug
        ? await classifyOccupationTitleDebug({
            query: options.query,
            locale: options.locale,
            sourceName: options.sourceName
        })
        : await classifyOccupationTitle({
            query: options.query,
            locale: options.locale,
            sourceName: options.sourceName
        });
    if (options.format === 'json') {
        console.log(JSON.stringify(result, null, 2));
        return;
    }
    if (options.debug) {
        const debugResult = result;
        printRuntimeSummary(debugResult.runtime);
        console.log('pipeline:');
        for (const step of debugResult.trace.pipeline) {
            console.log(`- ${step.name} (${step.durationMs.toFixed(1)}ms)`);
        }
        printRecallStage(debugResult);
        if (debugResult.candidates.length > 0) {
            console.log(`candidates (${debugResult.candidates.length}):`);
            for (const candidate of debugResult.candidates.sort((a, b) => {
                // 1. Sort by status first (alphabetically)
                const statusCompare = String(a.status || '').localeCompare(String(b.status || ''));
                if (statusCompare !== 0) {
                    return statusCompare;
                }
                // 2. If statuses are identical, sort by score descending (highest first)
                const scoreA = a.canonical?.score ?? 0;
                const scoreB = b.canonical?.score ?? 0;
                return scoreB - scoreA;
            })) {
                console.log(`- [${candidate.status}] ${BOLD}${candidate.canonicalLabel}${RESET} (node=${candidate.graphNodeId} family=${candidate.familyLabel ?? 'none'} score=${candidate.canonical.score.toFixed(2)})`);
                console.log(`    role=${candidate.canonical.roleResemblanceTier} requestedCoverage=${candidate.canonical.requestedCoverage.toFixed(2)}` +
                    ` wildDimensions=${candidate.canonical.wildDimensionCount} tokenCoverage=${candidate.canonical.tokenCoverage.toFixed(2)}`);
                if (candidate.structuralGate.judgments.length > 0) {
                    const judgmentSummary = candidate.structuralGate.judgments
                        .map((judgment) => `${judgment.dimension}:${judgment.kind}`)
                        .join(', ');
                    console.log(`    dimensions: ${judgmentSummary}`);
                }
                if (candidate.rejectReason) {
                    console.log(`    rejectReason=${candidate.rejectReason}`);
                }
                if (candidate.nearMissReason) {
                    console.log(`    nearMissReason=${candidate.nearMissReason}`);
                }
            }
        }
        if (debugResult.familyAssessments.length > 0) {
            console.log(`families (${debugResult.familyAssessments.length}):`);
            for (const family of debugResult.familyAssessments) {
                console.log(`- [${family.structureDecision}] ${family.familyLabel} (node=${family.familyNodeId} support=${family.supportKind} confidence=${family.confidence})`);
            }
        }
        return;
    }
    printRuntimeSummary(result);
}
// Surfaces what recall actually retrieved before assessment ever ran, so "was X even considered"
// is answerable without a one-off debug script -- a candidate absent here was dropped at
// retrieval/recall, not by any gate or score in the assessment funnel below.
function printRecallStage(debugResult) {
    const hydrateStep = debugResult.trace.pipeline.find((step) => step.name === 'hydrateCandidateCores');
    if (!hydrateStep || !Array.isArray(hydrateStep.output)) {
        return;
    }
    const hydrated = hydrateStep.output;
    console.log(`recall (${hydrated.length} candidates before assessment):`);
    let i = 0;
    for (const candidate of hydrated.sort((a, b) => String(a.canonicalLabel || '').localeCompare(String(b.canonicalLabel || '')))) {
        i++;
        const evidence = candidate.evidence ?? {};
        const applied = Object.entries(evidence)
            .filter(([key, value]) => key !== 'tieBreakerScore' && value === true)
            .map(([key]) => key);
        const evidenceSummary = applied.length > 0 ? applied.join(', ') : 'none';
        console.log(`${i}. ${candidate.canonicalLabel} (node=${candidate.graphNodeId}) evidence=[${evidenceSummary}]`);
    }
}
function printRuntimeSummary(result) {
    if (result.cleaned) {
        console.log(`locale=${result.cleaned.locale} localeText="${result.cleaned.cleanedTitle}"`);
    }
    if (result.query) {
        console.log(`translatedText="${result.query.englishTokens.join(' ')}"`);
    }
    console.log(`decision=${result.decision.type} reason=${result.decision.reason} confidence=${result.decision.confidence}`);
    console.log(`coverage=${result.coverage.status}`);
    if (result.leaf) {
        console.log(`leaf=${result.leaf.canonicalLabel} (node=${result.leaf.graphNodeId} family=${result.leaf.familyLabel ?? 'none'})`);
    }
    if (result.family) {
        console.log(`family=${result.family.familyLabel} (node=${result.family.familyNodeId})`);
    }
    if (result.altLeafCanonicalTerms.length > 0) {
        console.log(`altLeafCanonicalTerms (${result.altLeafCanonicalTerms.length}):`);
        for (const term of result.altLeafCanonicalTerms) {
            console.log(`- ${term.canonicalTerm} (node=${term.graphNodeId} family=${term.familyLabel ?? 'none'} confidence=${term.confidence.toFixed(2)})`);
        }
    }
    if (result.spans) {
        console.log(`spans (${result.spans.length}):`);
        for (const span of result.spans) {
            console.log(`- "${span.query}": decision=${span.result.decision.type} reason=${span.result.decision.reason}`);
        }
    }
}
function parseCliOptions(args) {
    const options = {
        locale: DEFAULT_RETRIEVAL_LOCALE,
        format: 'text',
        debug: false
    };
    for (const arg of args) {
        if (arg.startsWith('--query=')) {
            options.query = arg.slice('--query='.length).trim();
            continue;
        }
        if (arg.startsWith('--title=')) {
            options.query = arg.slice('--title='.length).trim();
            continue;
        }
        if (arg.startsWith('--locale=')) {
            options.locale = parseLocale(arg.slice('--locale='.length));
            continue;
        }
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim() || undefined;
            continue;
        }
        if (arg.startsWith('--format=')) {
            options.format = parseFormat(arg.slice('--format='.length));
            continue;
        }
        if (arg === '--runtime') {
            options.debug = false;
            continue;
        }
        if (arg === '--debug') {
            options.debug = true;
            continue;
        }
        if (arg === '--no-color') {
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
function parseLocale(value) {
    const normalized = value.trim();
    if (normalized === 'en' || normalized === 'ro' || normalized === 'hu' || normalized === 'et' || normalized === 'unknown') {
        return normalized;
    }
    throw new Error(`Unsupported locale "${value}".`);
}
function parseFormat(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'text' || normalized === 'json') {
        return normalized;
    }
    throw new Error(`Unsupported format "${value}". Use --format=text or --format=json.`);
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/classify-occupation.js --query="software developer"',
        `  [--locale=${DEFAULT_RETRIEVAL_LOCALE}]`,
        `  [--source-name=${DEFAULT_CLASSIFIER_SOURCE_NAME}]`,
        '  [--debug|--runtime]',
        '  [--format=text|json]'
    ].join(' '));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Occupation classifier failed.');
    console.error(message);
    console.error(error);
    process.exitCode = 1;
});
