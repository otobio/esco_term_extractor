import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { OccupationSearchPipeline } from '../search-pipeline/occupation-search-pipeline.js';
import { DEFAULT_ESCO_SOURCE_NAME, DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import { parseRetrievalBackend } from '../retrieval/retrieval-engine-factory.js';
import { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
const CSV_HEADERS = [
    'run_label',
    'row_number',
    'listing_id',
    'title',
    'effective_query',
    'query_spans',
    'span_results',
    'listing_ranking_occupations',
    'listing_searchable_occupations',
    'decision_type',
    'selected_label',
    'selected_node_id',
    'confidence',
    'coverage_status',
    'top_family_label',
    'top_family_id',
    'top_family_confidence',
    'top_family_evidence_tier',
    'top_leaf_label',
    'top_leaf_id',
    'top_leaf_confidence',
    'top_leaf_selection_tier',
    'matched_role_tokens',
    'missing_role_tokens',
    'matched_useful_tokens',
    'missing_useful_tokens',
    'ngram_evidence_count',
    'exact_alias_evidence_count',
    'folded_alias_evidence_count',
    'opensearch_lexical_evidence_count',
    'scanned_alias_hits',
    'scanned_opensearch_hits',
    'error'
];
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    if (options.enableNgram && !process.env.OSE_ENABLE_NGRAM_ALIAS_RETRIEVAL) {
        process.env.OSE_ENABLE_NGRAM_ALIAS_RETRIEVAL = '1';
    }
    if (options.includeFamilySupporting && !process.env.OSE_ENABLE_NGRAM_ALIAS_FAMILY_SUPPORT) {
        process.env.OSE_ENABLE_NGRAM_ALIAS_FAMILY_SUPPORT = '1';
    }
    const listings = await fetchListingTitles(options);
    const runtime = await OccupationRuntimeContext.load({
        sourceName: options.sourceName,
        retrievalBackend: options.retrievalBackend ?? undefined,
        aliasNgramLocales: [options.locale]
    });
    const pipeline = OccupationSearchPipeline.withRuntime(runtime);
    const rows = [];
    for (let index = 0; index < listings.length; index += 1) {
        const listing = listings[index];
        const title = normalizedTitle(listing);
        if (!title) {
            continue;
        }
        try {
            const result = await pipeline.run({
                query: title,
                locale: options.locale,
                sourceName: options.sourceName,
                limit: 20
            });
            rows.push(resultToCsvRow(options, listing, title, index + 1, result, null));
        }
        catch (error) {
            rows.push(resultToCsvRow(options, listing, title, index + 1, null, error instanceof Error ? error.message : String(error)));
        }
    }
    await mkdir(path.dirname(options.outPath), { recursive: true });
    await writeFile(options.outPath, toCsv(rows), 'utf8');
    console.log(`Wrote ${rows.length} listing title pipeline rows to ${options.outPath}`);
    console.log(`run_label=${options.runLabel}`);
    console.log(`index=${options.index}`);
    console.log(`locale=${options.locale}`);
}
async function fetchListingTitles(options) {
    const url = new URL(`/${encodeURIComponent(options.index)}/_search`, options.opensearchUrl);
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'content-type': 'application/json'
        },
        body: JSON.stringify({
            size: options.size,
            sort: ['_doc'],
            _source: ['title', 'ranking.occupation', 'searchable.occupation'],
            query: {
                exists: {
                    field: 'title'
                }
            }
        })
    });
    if (!response.ok) {
        throw new Error(`OpenSearch listing query failed: HTTP ${response.status} ${await response.text()}`);
    }
    const payload = await response.json();
    return payload.hits?.hits ?? [];
}
function resultToCsvRow(options, listing, title, rowNumber, result, error) {
    const topFamily = result?.rankedFamilies[0] ?? null;
    const topLeaf = result?.rankedLeaves[0] ?? topFamily?.leaves[0] ?? null;
    return {
        run_label: options.runLabel,
        row_number: rowNumber,
        listing_id: listing._id,
        title,
        effective_query: result?.queryContext.query ?? null,
        query_spans: result?.queryContext.querySpans.join('|') ?? null,
        span_results: result ? compactSpanResults(result) : null,
        listing_ranking_occupations: stringList(listing._source?.ranking?.occupation).join('|'),
        listing_searchable_occupations: stringList(listing._source?.searchable?.occupation).join('|'),
        decision_type: result?.decision.decisionType ?? null,
        selected_label: result?.decision.selectedLabel ?? null,
        selected_node_id: result?.decision.selectedNodeId ?? null,
        confidence: result ? Math.round(result.decision.confidence * 100) : null,
        coverage_status: result?.coverageStatus.status ?? null,
        top_family_label: topFamily?.familyLabel ?? null,
        top_family_id: topFamily?.familyNodeId ?? null,
        top_family_confidence: topFamily ? Math.round(topFamily.confidence * 100) : null,
        top_family_evidence_tier: topFamily?.evidenceTier ?? null,
        top_leaf_label: topLeaf?.canonicalLabel ?? null,
        top_leaf_id: topLeaf?.graphNodeId ?? null,
        top_leaf_confidence: topLeaf ? Math.round(topLeaf.confidence * 100) : null,
        top_leaf_selection_tier: topLeaf?.selectionEvidence?.tier ?? null,
        matched_role_tokens: result?.coverageStatus.signals.matchedRoleTokens.join('|') ?? null,
        missing_role_tokens: result?.coverageStatus.signals.missingRoleTokens.join('|') ?? null,
        matched_useful_tokens: result?.coverageStatus.signals.matchedUsefulTokens.join('|') ?? null,
        missing_useful_tokens: result?.coverageStatus.signals.missingUsefulTokens.join('|') ?? null,
        ngram_evidence_count: topFamily ? evidenceCount(topFamily, topLeaf, 'ngram_alias') : null,
        exact_alias_evidence_count: topFamily ? evidenceCount(topFamily, topLeaf, 'exact_alias') : null,
        folded_alias_evidence_count: topFamily ? evidenceCount(topFamily, topLeaf, 'folded_alias') : null,
        opensearch_lexical_evidence_count: topFamily ? evidenceCount(topFamily, topLeaf, 'opensearch_lexical') : null,
        scanned_alias_hits: result?.queryContext.scannedAliasHitCount ?? null,
        scanned_opensearch_hits: result?.queryContext.scannedOpenSearchHitCount ?? null,
        error
    };
}
function compactSpanResults(result) {
    if (result.spanResults.length === 0) {
        return '';
    }
    return result.spanResults
        .map((span) => {
        const label = span.decision.selectedLabel ?? '';
        const confidence = Math.round(span.decision.confidence * 100);
        return `${span.spanIndex}:${span.query}=>${span.decision.decisionType}:${label}(${confidence}%)`;
    })
        .join('; ');
}
function evidenceCount(family, leaf, channel) {
    return family.evidence.filter((record) => record.channel === channel).length +
        (leaf?.evidence.filter((record) => record.channel === channel).length ?? 0);
}
function normalizedTitle(hit) {
    return typeof hit._source?.title === 'string' ? hit._source.title.trim() : '';
}
function stringList(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value.filter((item) => typeof item === 'string');
}
function toCsv(rows) {
    const lines = [
        CSV_HEADERS.join(','),
        ...rows.map((row) => CSV_HEADERS.map((header) => csvEscape(row[header])).join(','))
    ];
    return `${lines.join('\n')}\n`;
}
function csvEscape(value) {
    if (value === null || value === undefined) {
        return '';
    }
    const text = String(value).replace(/\r?\n/gu, ' ').trim();
    return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}
function parseCliOptions(args) {
    const runLabel = timestampRunLabel();
    const options = {
        opensearchUrl: 'http://127.0.0.1:9201',
        index: 'jbng-local-listings-1',
        size: 100,
        locale: DEFAULT_RETRIEVAL_LOCALE,
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        runLabel,
        outPath: path.resolve('artifacts/evaluation/listing-title-pipeline', `${runLabel}.csv`),
        enableNgram: true,
        includeFamilySupporting: true,
        retrievalBackend: null
    };
    for (const arg of args) {
        if (arg.startsWith('--opensearch-url=')) {
            options.opensearchUrl = arg.slice('--opensearch-url='.length).trim();
            continue;
        }
        if (arg.startsWith('--index=')) {
            options.index = arg.slice('--index='.length).trim();
            continue;
        }
        if (arg.startsWith('--size=')) {
            options.size = parsePositiveInteger(arg.slice('--size='.length), '--size');
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
        if (arg.startsWith('--run-label=')) {
            options.runLabel = arg.slice('--run-label='.length).trim();
            options.outPath = path.resolve('artifacts/evaluation/listing-title-pipeline', `${options.runLabel}.csv`);
            continue;
        }
        if (arg.startsWith('--retrieval-backend=')) {
            options.retrievalBackend = parseRetrievalBackend(arg.slice('--retrieval-backend='.length));
            continue;
        }
        if (arg.startsWith('--out=')) {
            options.outPath = path.resolve(arg.slice('--out='.length).trim());
            continue;
        }
        if (arg === '--no-ngram') {
            options.enableNgram = false;
            continue;
        }
        if (arg === '--no-family-supporting') {
            options.includeFamilySupporting = false;
            continue;
        }
        if (arg === '--help') {
            printHelp();
            process.exit(0);
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    if (!options.index) {
        throw new Error('--index must not be empty.');
    }
    if (!options.locale) {
        throw new Error('--locale must not be empty.');
    }
    if (!options.runLabel) {
        throw new Error('--run-label must not be empty.');
    }
    return options;
}
function parsePositiveInteger(value, label) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${label} must be a positive integer.`);
    }
    return parsed;
}
function timestampRunLabel() {
    return `listing-title-${new Date().toISOString().replace(/[:.]/gu, '-').replace('T', '_').replace('Z', 'Z')}`;
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/run-listing-title-pipeline-csv.js',
        '[--opensearch-url=http://127.0.0.1:9201]',
        '[--index=jbng-local-listings-1]',
        '[--size=100]',
        '[--locale=en]',
        '[--run-label=before]',
        '[--retrieval-backend=opensearch|runtime-cache|binary-cache]',
        '[--out=artifacts/evaluation/listing-title-pipeline/before.csv]',
        '[--no-ngram]',
        '[--no-family-supporting]'
    ].join(' '));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Listing title pipeline CSV run failed.');
    console.error(message);
    process.exitCode = 1;
});
