import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { withConnection } from '../db/mysql.js';
import { prepareOccupationRetrievalQuery } from '../query/occupation-retrieval-query.js';
import { DEFAULT_ESCO_SOURCE_NAME, DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import { buildAliasNgramIndexFromRows, buildAliasNgramIndex, retrieveAliasNgramHits } from '../retrieval/alias-ngram-retriever.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const queries = await loadQueries(options);
    if (queries.length === 0) {
        throw new Error('Provide queries through --query-file=PATH or stdin.');
    }
    const indexStart = performance.now();
    const index = await buildIndex(options);
    const indexLoadMs = roundMs(performance.now() - indexStart);
    if (options.format === 'text') {
        console.log(`Alias ngram batch source=${options.sourceName} locale=${options.locale} aliases=${index.aliasCount} family_supporting=${index.includeFamilySupportingAliases} index_load=${indexLoadMs}ms`);
    }
    for (const input of queries) {
        const queryLocale = input.locale ?? options.locale;
        const prepareStart = performance.now();
        const retrievalQuery = await prepareOccupationRetrievalQuery({
            sourceName: options.sourceName,
            locale: queryLocale,
            originalQuery: input.query
        });
        const scoringQueryText = scoringQueryForMode(options.queryMode, retrievalQuery.preparedQuery);
        const scoringPreparedQuery = scoringQueryText === retrievalQuery.preparedQuery.raw
            ? retrievalQuery.preparedQuery
            : await prepareOccupationRetrievalQuery({
                sourceName: options.sourceName,
                locale: queryLocale,
                originalQuery: scoringQueryText
            }).then((query) => query.preparedQuery);
        const prepareMs = roundMs(performance.now() - prepareStart);
        const scoreStart = performance.now();
        const hits = retrieveAliasNgramHits(index, scoringPreparedQuery, { limit: options.limit });
        const scoreMs = roundMs(performance.now() - scoreStart);
        const result = {
            query: input.query,
            effectiveQuery: retrievalQuery.query,
            scoringQuery: scoringQueryText,
            queryMode: options.queryMode,
            intent: retrievalQuery.preparedQuery.intent,
            querySpans: retrievalQuery.querySpans,
            locale: retrievalQuery.locale,
            timings: {
                prepareMs,
                scoreMs
            },
            hits
        };
        if (options.format === 'jsonl') {
            console.log(JSON.stringify(result));
            continue;
        }
        console.log('');
        console.log(`Query: "${result.query}"`);
        console.log(`effective="${result.effectiveQuery}" scoring="${result.scoringQuery}" mode=${result.queryMode} spans=${result.querySpans.length} prepare=${prepareMs}ms score=${scoreMs}ms`);
        console.log(`intent role=${result.intent.roleTokens.join(',') || 'none'} head=${result.intent.roleHeadTokens.join(',') || 'none'} domain=${result.intent.domainTokens.join(',') || 'none'}`);
        for (const [hitIndex, hit] of hits.entries()) {
            console.log(`${hitIndex + 1}. ${hit.canonicalLabel} score=${hit.score} cosine=${hit.cosine} coverage=${hit.usefulTokenCoverage} alias="${hit.alias}" role=${hit.aliasRole} family="${hit.familyLabel ?? 'n/a'}"`);
        }
    }
}
function scoringQueryForMode(queryMode, preparedQuery) {
    if (queryMode === 'effective') {
        return preparedQuery.raw;
    }
    return preparedQuery.intent.roleTokens.join(' ').trim() ||
        preparedQuery.usefulFoldedTokens.join(' ').trim() ||
        preparedQuery.normalized;
}
async function buildIndex(options) {
    if (options.aliasSource === 'artifact') {
        return buildAliasNgramIndex({
            sourceName: options.sourceName,
            locale: options.locale,
            includeFamilySupportingAliases: options.includeFamilySupportingAliases
        });
    }
    return withConnection(async (connection) => {
        const [rows] = await connection.query(`
        (
          SELECT
            meta.graph_node_id,
            node.canonical_label,
            meta.family_node_id,
            family.canonical_label AS family_label,
            alias.alias,
            alias.normalized_alias,
            alias.alias_role,
            alias.weight
          FROM ose_search_meta_aliases alias
          INNER JOIN ose_search_meta meta
            ON meta.id = alias.search_meta_id
          INNER JOIN ose_graph_nodes node
            ON node.id = meta.graph_node_id
          LEFT JOIN ose_graph_nodes family
            ON family.id = meta.family_node_id
          WHERE node.bucket = 'occupation'
            AND node.node_level = 'occupation'
            AND node.status = 'active'
            AND node.is_searchable = 1
            AND alias.locale_code = ?
            AND alias.alias_role IN ('locale_primary', 'locale_supporting', 'reviewed_crosswalk')
            AND EXISTS (
              SELECT 1
              FROM ose_graph_node_sources node_source
              WHERE node_source.graph_node_id = meta.graph_node_id
                AND node_source.source_name = ?
            )
        )
        UNION ALL
        (
          SELECT
            meta.family_node_id AS graph_node_id,
            family.canonical_label,
            meta.family_node_id,
            family.canonical_label AS family_label,
            MIN(alias.alias) AS alias,
            alias.normalized_alias,
            alias.alias_role,
            MAX(alias.weight) AS weight
          FROM ose_search_meta_aliases alias
          INNER JOIN ose_search_meta meta
            ON meta.id = alias.search_meta_id
          INNER JOIN ose_graph_nodes node
            ON node.id = meta.graph_node_id
          INNER JOIN ose_graph_nodes family
            ON family.id = meta.family_node_id
          WHERE ? = 1
            AND node.bucket = 'occupation'
            AND node.node_level = 'occupation'
            AND node.status = 'active'
            AND node.is_searchable = 1
            AND alias.locale_code = ?
            AND alias.alias_role = 'family_supporting'
            AND EXISTS (
              SELECT 1
              FROM ose_graph_node_sources node_source
              WHERE node_source.graph_node_id = meta.graph_node_id
                AND node_source.source_name = ?
            )
          GROUP BY
            meta.family_node_id,
            family.canonical_label,
            alias.normalized_alias,
            alias.alias_role
        )
        ORDER BY
          graph_node_id,
          FIELD(alias_role, 'locale_primary', 'reviewed_crosswalk', 'locale_supporting', 'family_supporting'),
          weight DESC,
          normalized_alias
      `, [
            options.locale,
            options.sourceName,
            options.includeFamilySupportingAliases ? 1 : 0,
            options.locale,
            options.sourceName
        ]);
        return buildAliasNgramIndexFromRows({
            sourceName: options.sourceName,
            locale: options.locale,
            includeFamilySupportingAliases: options.includeFamilySupportingAliases,
            rows: rows.map(toAliasNgramSourceRow)
        });
    });
}
function toAliasNgramSourceRow(row) {
    return {
        graphNodeId: Number(row.graph_node_id),
        canonicalLabel: String(row.canonical_label),
        familyNodeId: row.family_node_id === null ? null : Number(row.family_node_id),
        familyLabel: row.family_label === null ? null : String(row.family_label),
        alias: String(row.alias),
        normalizedAlias: String(row.normalized_alias),
        aliasRole: String(row.alias_role),
        aliasWeight: row.weight === null ? null : Number(row.weight)
    };
}
async function loadQueries(options) {
    const raw = options.queryFile ? await readFile(options.queryFile, 'utf8') : await readStdin();
    return raw
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'))
        .map((line) => {
        const parsed = tryParseJsonLine(line);
        if (parsed) {
            return parsed;
        }
        return { query: line };
    });
}
function tryParseJsonLine(line) {
    if (!line.startsWith('{')) {
        return null;
    }
    const parsed = JSON.parse(line);
    if (!parsed || typeof parsed !== 'object' || !('query' in parsed) || typeof parsed.query !== 'string') {
        throw new Error(`Invalid JSONL query row: ${line}`);
    }
    return {
        query: parsed.query,
        locale: 'locale' in parsed && typeof parsed.locale === 'string' ? parsed.locale : undefined
    };
}
async function readStdin() {
    const chunks = [];
    for await (const chunk of process.stdin) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks).toString('utf8');
}
function parseCliOptions(args) {
    const options = {
        locale: DEFAULT_RETRIEVAL_LOCALE,
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        limit: 5,
        format: 'text',
        includeFamilySupportingAliases: false,
        aliasSource: 'mysql',
        queryMode: 'role'
    };
    for (const arg of args) {
        if (arg.startsWith('--query-file=')) {
            options.queryFile = arg.slice('--query-file='.length).trim();
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
        if (arg.startsWith('--alias-source=')) {
            options.aliasSource = parseAliasSource(arg.slice('--alias-source='.length));
            continue;
        }
        if (arg.startsWith('--query-mode=')) {
            options.queryMode = parseQueryMode(arg.slice('--query-mode='.length));
            continue;
        }
        if (arg === '--include-family-supporting') {
            options.includeFamilySupportingAliases = true;
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
function parsePositiveInteger(value, label) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${label} must be a positive integer.`);
    }
    return parsed;
}
function parseFormat(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'text' || normalized === 'jsonl') {
        return normalized;
    }
    throw new Error(`Unsupported format "${value}". Use --format=text or --format=jsonl.`);
}
function parseAliasSource(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'mysql' || normalized === 'artifact') {
        return normalized;
    }
    throw new Error(`Unsupported alias source "${value}". Use --alias-source=mysql or --alias-source=artifact.`);
}
function parseQueryMode(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'effective' || normalized === 'role') {
        return normalized;
    }
    throw new Error(`Unsupported query mode "${value}". Use --query-mode=role or --query-mode=effective.`);
}
function roundMs(value) {
    return Number(value.toFixed(2));
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/probe-alias-ngram-batch.js --query-file=/tmp/queries.txt',
        `[--locale=${DEFAULT_RETRIEVAL_LOCALE}]`,
        `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
        '[--limit=5]',
        '[--include-family-supporting]',
        '[--alias-source=mysql|artifact]',
        '[--query-mode=role|effective]',
        '[--format=text|jsonl]'
    ].join(' '));
}
main().catch((error) => {
    console.error('Alias ngram batch probe failed.');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
