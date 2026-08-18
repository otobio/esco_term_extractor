import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withConnection } from '../db/mysql.js';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { normalizeSearchText } from '../utils/texts.js';
import { SEARCH_META_BINARY_SCHEMA_VERSION, buildOccupationSearchMetaBinaryFiles, defaultOccupationSearchMetaManifestPath } from '../runtime/occupation-search-meta-artifact.js';
import { applyReviewedAliasSeeds } from '../runtime/occupation-alias-seed-overrides.js';
import { applyReviewedTaxonomyOverrides } from '../runtime/occupation-taxonomy-family-overrides.js';
import { defaultRuntimeReviewJsonlPath, runtimeReviewArtifactBaseName, writeRuntimeReviewJsonl } from '../runtime/runtime-review-artifacts.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const records = await withConnection(async (connection) => {
        const [metaRows] = await connection.query(`
        SELECT
          meta.id AS search_meta_id,
          meta.graph_node_id,
          node.canonical_label,
          meta.generic_risk,
          meta.has_hierarchy,
          meta.has_capability_support,
          meta.family_node_id,
          family_node.canonical_label AS family_label,
          meta.group_node_id,
          group_node.canonical_label AS group_label,
          meta.parent_node_id,
          parent_node.canonical_label AS parent_label
        FROM ose_search_meta meta
        INNER JOIN ose_graph_nodes node
          ON node.id = meta.graph_node_id
        LEFT JOIN ose_graph_nodes family_node
          ON family_node.id = meta.family_node_id
        LEFT JOIN ose_graph_nodes group_node
          ON group_node.id = meta.group_node_id
        LEFT JOIN ose_graph_nodes parent_node
          ON parent_node.id = meta.parent_node_id
        WHERE EXISTS (
          SELECT 1
          FROM ose_graph_node_sources node_source
          WHERE node_source.graph_node_id = meta.graph_node_id
            AND node_source.source_name = ?
        )
        ORDER BY meta.graph_node_id
      `, [options.sourceName]);
        const searchMetaIds = metaRows.map((row) => row.search_meta_id);
        const graphNodeIds = metaRows.map((row) => row.graph_node_id);
        const [ancestorRows, siblingRows, aliasRows, capabilityRows] = await Promise.all([
            loadAncestors(connection, searchMetaIds),
            loadSiblings(connection, searchMetaIds),
            loadAliases(connection, searchMetaIds),
            loadCapabilities(connection, graphNodeIds)
        ]);
        const ancestorsBySearchMetaId = groupBy(ancestorRows, (row) => row.search_meta_id, toAncestorRecord);
        const siblingsBySearchMetaId = groupBy(siblingRows, (row) => row.search_meta_id, toSiblingRecord);
        const aliasesBySearchMetaId = groupBy(aliasRows, (row) => row.search_meta_id, toAliasRecord);
        const capabilitiesByNodeId = groupBy(capabilityRows, (row) => row.graph_node_id, toCapabilityRecord);
        const records = metaRows.map((row) => applyReviewedAliasSeeds(options.sourceName, applyReviewedTaxonomyOverrides(options.sourceName, {
            searchMetaId: row.search_meta_id,
            graphNodeId: row.graph_node_id,
            canonicalLabel: row.canonical_label,
            genericRisk: row.generic_risk,
            hasHierarchy: row.has_hierarchy === 1,
            hasCapabilitySupport: row.has_capability_support === 1,
            familyNodeId: row.family_node_id,
            familyLabel: row.family_label,
            groupNodeId: row.group_node_id,
            groupLabel: row.group_label,
            parentNodeId: row.parent_node_id,
            parentLabel: row.parent_label,
            ancestors: ancestorsBySearchMetaId.get(row.search_meta_id) ?? [],
            siblings: siblingsBySearchMetaId.get(row.search_meta_id) ?? [],
            aliases: aliasesBySearchMetaId.get(row.search_meta_id) ?? [],
            capabilityLabels: capabilitiesByNodeId.get(row.graph_node_id) ?? []
        })));
        return records;
    });
    const manifestPath = path.resolve(options.outPath ?? defaultOccupationSearchMetaManifestPath(options.sourceName));
    const prefix = path.basename(defaultOccupationSearchMetaManifestPath(options.sourceName), '.manifest.json');
    const binaryFiles = buildOccupationSearchMetaBinaryFiles(records, prefix);
    const manifest = {
        schemaVersion: SEARCH_META_BINARY_SCHEMA_VERSION,
        sourceName: options.sourceName,
        generatedAt: new Date().toISOString(),
        count: records.length,
        ...binaryFiles.counts,
        files: binaryFiles.manifestFiles
    };
    const reviewJsonlPath = options.reviewJsonlOutPath ? path.resolve(options.reviewJsonlOutPath) : null;
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await Promise.all(Array.from(binaryFiles.buffers.entries()).map(([fileName, buffer]) => writeFile(path.resolve(path.dirname(manifestPath), fileName), buffer)));
    if (reviewJsonlPath) {
        await writeRuntimeReviewJsonl(reviewJsonlPath, records);
    }
    const outputBytes = Array.from(binaryFiles.buffers.values()).reduce((total, buffer) => total + buffer.byteLength, 0);
    for (const [fileName, buffer] of binaryFiles.buffers.entries()) {
        console.log(`${fileName}=${buffer.byteLength}`);
    }
    console.log(`Exported ${manifest.count} occupation search-meta records to ${manifestPath}`);
    console.log(`binary_bytes=${outputBytes}`);
    if (reviewJsonlPath) {
        console.log(`review_jsonl=${reviewJsonlPath}`);
    }
    console.log(`source=${manifest.sourceName}`);
}
async function loadAncestors(connection, searchMetaIds) {
    if (searchMetaIds.length === 0) {
        return [];
    }
    const [rows] = await connection.query(`
      SELECT
        ancestor.search_meta_id,
        ancestor.ancestor_node_id AS graph_node_id,
        node.canonical_label,
        node.node_level,
        ancestor.distance_from_leaf,
        ancestor.ancestor_role
      FROM ose_search_meta_ancestors ancestor
      INNER JOIN ose_graph_nodes node
        ON node.id = ancestor.ancestor_node_id
      WHERE ancestor.search_meta_id IN (?)
      ORDER BY ancestor.search_meta_id, ancestor.distance_from_leaf, FIELD(ancestor.ancestor_role, 'parent', 'family', 'group', 'broader'), node.canonical_label
    `, [searchMetaIds]);
    return rows;
}
async function loadSiblings(connection, searchMetaIds) {
    if (searchMetaIds.length === 0) {
        return [];
    }
    const [rows] = await connection.query(`
      SELECT
        sibling.search_meta_id,
        sibling.sibling_node_id AS graph_node_id,
        node.canonical_label,
        node.node_level,
        sibling.sibling_kind,
        sibling.weight
      FROM ose_search_meta_siblings sibling
      INNER JOIN ose_graph_nodes node
        ON node.id = sibling.sibling_node_id
      WHERE sibling.search_meta_id IN (?)
      ORDER BY sibling.search_meta_id, sibling.weight DESC, node.canonical_label
    `, [searchMetaIds]);
    return rows;
}
async function loadAliases(connection, searchMetaIds) {
    if (searchMetaIds.length === 0) {
        return [];
    }
    const [rows] = await connection.query(`
      SELECT
        search_meta_id,
        locale_code,
        alias,
        normalized_alias,
        alias_role,
        weight
      FROM ose_search_meta_aliases
      WHERE search_meta_id IN (?)
      ORDER BY search_meta_id, locale_code, FIELD(alias_role, 'locale_primary', 'reviewed_crosswalk', 'locale_supporting', 'family_supporting', 'english_backbone'), weight DESC, alias
    `, [searchMetaIds]);
    return rows;
}
async function loadCapabilities(connection, graphNodeIds) {
    if (graphNodeIds.length === 0) {
        return [];
    }
    const [rows] = await connection.query(`
      SELECT
        meta.graph_node_id,
        capability.id AS capability_id,
        capability.capability_type,
        capability.canonical_key,
        capability.locale_code,
        capability.label,
        capability.normalized_label,
        hint.hint_kind,
        hint.weight
      FROM ose_search_meta meta
      INNER JOIN ose_search_meta_capability_hints hint
        ON hint.search_meta_id = meta.id
      INNER JOIN ose_capabilities capability
        ON capability.id = hint.capability_id
      WHERE meta.graph_node_id IN (?)
        AND hint.hint_kind != 'optional'
      ORDER BY
        meta.graph_node_id,
        FIELD(hint.hint_kind, 'essential', 'knowledge', 'tool', 'software'),
        hint.weight DESC,
        capability.label
    `, [graphNodeIds]);
    return rows;
}
function groupBy(rows, keyForRow, valueForRow) {
    const grouped = new Map();
    for (const row of rows) {
        const key = keyForRow(row);
        const values = grouped.get(key) ?? [];
        values.push(valueForRow(row));
        grouped.set(key, values);
    }
    return grouped;
}
function toAncestorRecord(row) {
    return {
        graphNodeId: row.graph_node_id,
        canonicalLabel: row.canonical_label,
        nodeLevel: row.node_level,
        distanceFromLeaf: row.distance_from_leaf,
        ancestorRole: row.ancestor_role
    };
}
function toSiblingRecord(row) {
    return {
        graphNodeId: row.graph_node_id,
        canonicalLabel: row.canonical_label,
        nodeLevel: row.node_level,
        siblingKind: row.sibling_kind,
        weight: toNullableNumber(row.weight)
    };
}
function toAliasRecord(row) {
    return {
        localeCode: row.locale_code,
        alias: row.alias,
        normalizedAlias: normalizeSearchText(row.alias),
        aliasRole: row.alias_role,
        isPrimary: row.alias_role === 'locale_primary',
        confidence: toNullableNumber(row.weight),
        weight: toNullableNumber(row.weight)
    };
}
function toCapabilityRecord(row) {
    return {
        capabilityId: row.capability_id,
        capabilityType: row.capability_type,
        canonicalKey: row.canonical_key,
        localeCode: row.locale_code,
        label: row.label,
        normalizedLabel: row.normalized_label,
        hintKind: row.hint_kind,
        weight: toNullableNumber(row.weight)
    };
}
function parseCliOptions(args) {
    const options = {
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        outPath: null,
        reviewJsonlOutPath: defaultRuntimeReviewJsonlPath(runtimeReviewArtifactBaseName('occupation-search-meta', DEFAULT_ESCO_SOURCE_NAME))
    };
    for (const arg of args) {
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
            options.reviewJsonlOutPath = defaultRuntimeReviewJsonlPath(runtimeReviewArtifactBaseName('occupation-search-meta', options.sourceName));
            continue;
        }
        if (arg.startsWith('--out=')) {
            options.outPath = arg.slice('--out='.length).trim();
            continue;
        }
        if (arg.startsWith('--review-jsonl-out=')) {
            options.reviewJsonlOutPath = arg.slice('--review-jsonl-out='.length).trim();
            continue;
        }
        if (arg === '--no-review-jsonl') {
            options.reviewJsonlOutPath = null;
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
function toNullableNumber(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/export-occupation-search-meta-artifact.js',
        `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
        '[--out=artifacts/runtime/occupation-search-meta.esco_1_2_1.manifest.json]',
        '[--review-jsonl-out=data/runtime-review/occupation-search-meta.esco_1_2_1.jsonl]',
        '[--no-review-jsonl]'
    ].join(' '));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Occupation search-meta artifact export failed.');
    console.error(message);
    process.exitCode = 1;
});
