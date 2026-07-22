import { defaultOpenSearchTemplateName, getOpenSearchConfig } from './config.js';
import { normalizeSearchText } from '../utils/texts.js';
const DEFAULT_ESCO_SOURCE_NAME = 'esco_1_2_1';
const DEFAULT_BULK_CHUNK_SIZE = 250;
const MAX_FAILURE_EXAMPLES = 10;
export class OccupationOpenSearchIndexManager {
    client;
    config;
    constructor(client, config = getOpenSearchConfig()) {
        this.client = client;
        this.config = config;
    }
    async createOrUpdate(options = {}) {
        const indexName = options.indexName ?? this.config.occupationsIndex;
        const templateName = options.templateName ?? defaultOpenSearchTemplateName(indexName);
        await this.client.put(`/_index_template/${encodeURIComponent(templateName)}`, {
            index_patterns: [indexName],
            priority: 500,
            template: {
                settings: {
                    number_of_shards: 1,
                    number_of_replicas: 0,
                    refresh_interval: '30s',
                    analysis: {
                        analyzer: {
                            ose_text: {
                                tokenizer: 'standard',
                                filter: ['lowercase', 'asciifolding']
                            }
                        },
                        normalizer: {
                            ose_keyword: {
                                type: 'custom',
                                filter: ['lowercase', 'asciifolding']
                            }
                        }
                    }
                },
                mappings: {
                    dynamic: 'strict',
                    properties: buildOccupationIndexProperties()
                }
            }
        });
        if (options.recreate) {
            await this.client.delete(`/${encodeURIComponent(indexName)}`, {
                expectedStatuses: [200, 404]
            });
        }
        const exists = await this.client.head(`/${encodeURIComponent(indexName)}`, {
            expectedStatuses: [200, 404]
        });
        if (exists.status === 404) {
            await this.client.put(`/${encodeURIComponent(indexName)}`, {});
        }
        else {
            await this.client.put(`/${encodeURIComponent(indexName)}/_mapping`, {
                dynamic: 'strict',
                properties: buildOccupationIndexProperties()
            });
        }
        return {
            indexName,
            templateName,
            recreated: options.recreate === true,
            created: exists.status === 404
        };
    }
}
export class OccupationOpenSearchBulkIndexer {
    connection;
    client;
    config;
    constructor(connection, client, config = getOpenSearchConfig()) {
        this.connection = connection;
        this.client = client;
        this.config = config;
    }
    async run(options = {}) {
        const sourceName = normalizeSourceName(options.sourceName);
        const indexName = options.indexName ?? this.config.occupationsIndex;
        const templateName = options.templateName ?? defaultOpenSearchTemplateName(indexName);
        const chunkSize = normalizePositiveInteger('chunk-size', options.chunkSize, DEFAULT_BULK_CHUNK_SIZE);
        const limit = normalizeOptionalPositiveInteger('limit', options.limit);
        if (options.ensureIndex !== false) {
            const manager = new OccupationOpenSearchIndexManager(this.client, this.config);
            await manager.createOrUpdate({
                indexName,
                templateName,
                recreate: options.recreateIndex
            });
        }
        const totalCandidateCount = await this.countIndexableOccupations(sourceName, limit);
        let lastGraphNodeId = 0;
        let remaining = limit;
        let attemptedDocumentCount = 0;
        let indexedDocumentCount = 0;
        let failedDocumentCount = 0;
        while (remaining === undefined || remaining > 0) {
            const queryLimit = Math.min(chunkSize, remaining ?? chunkSize);
            const baseRows = await this.loadBaseOccupationRows(sourceName, lastGraphNodeId, queryLimit);
            if (baseRows.length === 0) {
                break;
            }
            lastGraphNodeId = baseRows[baseRows.length - 1]?.graph_node_id ?? lastGraphNodeId;
            const graphNodeIds = baseRows.map((row) => row.graph_node_id);
            const [aliasRows, capabilityRows, ancestorRows] = await Promise.all([
                this.loadAliasRows(graphNodeIds),
                this.loadCapabilityRows(graphNodeIds),
                this.loadAncestorRows(graphNodeIds)
            ]);
            const documents = buildDocuments(sourceName, baseRows, aliasRows, capabilityRows, ancestorRows);
            const bulkResult = await this.bulkIndexDocuments(indexName, documents);
            attemptedDocumentCount += documents.length;
            indexedDocumentCount += bulkResult.indexedDocumentCount;
            failedDocumentCount += bulkResult.failedDocumentCount;
            if (remaining !== undefined) {
                remaining -= baseRows.length;
            }
            options.onProgress?.({
                indexName,
                sourceName,
                lastGraphNodeId,
                chunkDocumentCount: documents.length,
                indexedDocumentCount,
                failedDocumentCount,
                remaining
            });
        }
        if (options.refresh !== false) {
            await this.client.post(`/${encodeURIComponent(indexName)}/_refresh`, undefined, {
                expectedStatuses: [200]
            });
        }
        return {
            indexName,
            sourceName,
            chunkSize,
            totalCandidateCount,
            attemptedDocumentCount,
            indexedDocumentCount,
            failedDocumentCount
        };
    }
    async countIndexableOccupations(sourceName, limit) {
        const [rows] = await this.connection.query(`
        SELECT COUNT(*) AS count_value
        FROM ose_graph_nodes node
        INNER JOIN ose_search_meta meta
          ON meta.graph_node_id = node.id
        WHERE node.bucket = 'occupation'
          AND node.node_level = 'occupation'
          AND node.status = 'active'
          AND node.is_searchable = 1
          AND EXISTS (
            SELECT 1
            FROM ose_graph_node_sources node_source
            WHERE node_source.graph_node_id = node.id
              AND node_source.source_name = ?
          )
      `, [sourceName]);
        const count = toNumber(rows[0]?.count_value) ?? 0;
        return limit === undefined ? count : Math.min(count, limit);
    }
    async loadBaseOccupationRows(sourceName, lastGraphNodeId, limit) {
        const [rows] = await this.connection.query(`
        SELECT
          node.id AS graph_node_id,
          node.node_level,
          node.canonical_label,
          node.normalized_label,
          meta.search_text,
          meta.family_node_id,
          family.canonical_label AS family_label,
          meta.group_node_id,
          grp.canonical_label AS group_label,
          meta.generic_risk,
          meta.has_hierarchy,
          meta.has_capability_support,
          CAST(meta.quality_flags_json AS CHAR) AS quality_flags_json
        FROM ose_graph_nodes node
        INNER JOIN ose_search_meta meta
          ON meta.graph_node_id = node.id
        LEFT JOIN ose_graph_nodes family
          ON family.id = meta.family_node_id
        LEFT JOIN ose_graph_nodes grp
          ON grp.id = meta.group_node_id
        WHERE node.bucket = 'occupation'
          AND node.node_level = 'occupation'
          AND node.status = 'active'
          AND node.is_searchable = 1
          AND node.id > ?
          AND EXISTS (
            SELECT 1
            FROM ose_graph_node_sources node_source
            WHERE node_source.graph_node_id = node.id
              AND node_source.source_name = ?
          )
        ORDER BY node.id
        LIMIT ?
      `, [lastGraphNodeId, sourceName, limit]);
        return rows;
    }
    async loadAliasRows(graphNodeIds) {
        if (graphNodeIds.length === 0) {
            return [];
        }
        const placeholders = graphNodeIds.map(() => '?').join(', ');
        const [rows] = await this.connection.query(`
        SELECT
          meta.graph_node_id,
          alias.locale_code,
          alias.alias,
          alias.normalized_alias,
          alias.alias_role,
          alias.weight
        FROM ose_search_meta_aliases alias
        INNER JOIN ose_search_meta meta
          ON meta.id = alias.search_meta_id
        WHERE meta.graph_node_id IN (${placeholders})
        ORDER BY meta.graph_node_id, alias.locale_code, alias.alias_role, alias.weight DESC, alias.alias
      `, graphNodeIds);
        return rows;
    }
    async loadCapabilityRows(graphNodeIds) {
        if (graphNodeIds.length === 0) {
            return [];
        }
        const placeholders = graphNodeIds.map(() => '?').join(', ');
        const [rows] = await this.connection.query(`
        SELECT
          meta.graph_node_id,
          cap.label
        FROM ose_search_meta_capability_hints hint
        INNER JOIN ose_search_meta meta
          ON meta.id = hint.search_meta_id
        INNER JOIN ose_capabilities cap
          ON cap.id = hint.capability_id
        WHERE meta.graph_node_id IN (${placeholders})
        ORDER BY meta.graph_node_id, hint.hint_kind, cap.locale_code, cap.label
      `, graphNodeIds);
        return rows;
    }
    async loadAncestorRows(graphNodeIds) {
        if (graphNodeIds.length === 0) {
            return [];
        }
        const placeholders = graphNodeIds.map(() => '?').join(', ');
        const [rows] = await this.connection.query(`
        SELECT
          meta.graph_node_id,
          ancestor.distance_from_leaf,
          node.canonical_label
        FROM ose_search_meta_ancestors ancestor
        INNER JOIN ose_search_meta meta
          ON meta.id = ancestor.search_meta_id
        INNER JOIN ose_graph_nodes node
          ON node.id = ancestor.ancestor_node_id
        WHERE meta.graph_node_id IN (${placeholders})
        ORDER BY meta.graph_node_id, ancestor.distance_from_leaf, ancestor.ancestor_role, node.canonical_label
      `, graphNodeIds);
        return rows;
    }
    async bulkIndexDocuments(indexName, documents) {
        if (documents.length === 0) {
            return {
                indexedDocumentCount: 0,
                failedDocumentCount: 0
            };
        }
        const payload = documents
            .flatMap((document) => [
            JSON.stringify({
                index: {
                    _index: indexName,
                    _id: String(document.graph_node_id)
                }
            }),
            JSON.stringify(document)
        ])
            .join('\n')
            .concat('\n');
        const response = await this.client.post('/_bulk', payload, {
            contentType: 'application/x-ndjson',
            expectedStatuses: [200]
        });
        const body = response.body;
        if (!body) {
            throw new Error('OpenSearch bulk request returned an empty response body.');
        }
        const items = Array.isArray(body.items) ? body.items : [];
        let indexedDocumentCount = 0;
        let failedDocumentCount = 0;
        const failureExamples = [];
        for (const item of items) {
            const result = item.index;
            if (!result) {
                failedDocumentCount += 1;
                continue;
            }
            if (result.status >= 200 && result.status < 300) {
                indexedDocumentCount += 1;
                continue;
            }
            failedDocumentCount += 1;
            if (failureExamples.length < MAX_FAILURE_EXAMPLES) {
                const type = result.error?.type ?? 'unknown_error';
                const reason = result.error?.reason ?? 'No reason provided.';
                failureExamples.push(`${type}: ${reason}`);
            }
        }
        if ((body.errors ?? false) || failedDocumentCount > 0) {
            throw new Error(`OpenSearch bulk indexing failed for ${failedDocumentCount} documents.${failureExamples.length > 0 ? ` Examples: ${failureExamples.join(' | ')}` : ''}`);
        }
        return {
            indexedDocumentCount,
            failedDocumentCount
        };
    }
}
function buildOccupationIndexProperties() {
    const properties = {
        graph_node_id: { type: 'long' },
        source_name: { type: 'keyword' },
        node_level: { type: 'keyword' },
        canonical_label: {
            type: 'text',
            analyzer: 'ose_text',
            fields: {
                raw: { type: 'keyword' },
                folded: { type: 'keyword', normalizer: 'ose_keyword' }
            }
        },
        normalized_label: { type: 'keyword', normalizer: 'ose_keyword' },
        locale_codes: { type: 'keyword' },
        locale_aliases: { type: 'object', enabled: false },
        aliases_text: {
            type: 'text',
            analyzer: 'ose_text',
            fields: {
                raw: { type: 'keyword', ignore_above: 8191 }
            }
        },
        locale_primary_aliases_text: { type: 'text', analyzer: 'ose_text' },
        locale_supporting_aliases_text: { type: 'text', analyzer: 'ose_text' },
        reviewed_crosswalk_aliases_text: { type: 'text', analyzer: 'ose_text' },
        family_supporting_aliases_text: { type: 'text', analyzer: 'ose_text' },
        english_backbone_aliases_text: { type: 'text', analyzer: 'ose_text' },
        normalized_aliases: { type: 'keyword', normalizer: 'ose_keyword' },
        search_text: { type: 'text', analyzer: 'ose_text' },
        family_node_id: { type: 'long' },
        family_label: { type: 'text', analyzer: 'ose_text', fields: { raw: { type: 'keyword' } } },
        group_node_id: { type: 'long' },
        group_label: { type: 'text', analyzer: 'ose_text', fields: { raw: { type: 'keyword' } } },
        generic_risk: { type: 'keyword' },
        has_hierarchy: { type: 'boolean' },
        has_capability_support: { type: 'boolean' },
        capability_text: { type: 'text', analyzer: 'ose_text' },
        ancestor_text: { type: 'text', analyzer: 'ose_text' },
        quality_flags: { type: 'keyword' }
    };
    return properties;
}
function buildDocuments(sourceName, baseRows, aliasRows, capabilityRows, ancestorRows) {
    const aliasesByNodeId = groupBy(aliasRows, (row) => row.graph_node_id);
    const capabilitiesByNodeId = groupBy(capabilityRows, (row) => row.graph_node_id);
    const ancestorsByNodeId = groupBy(ancestorRows, (row) => row.graph_node_id);
    return baseRows.map((row) => {
        const aliasBundle = buildAliasBundle(aliasesByNodeId.get(row.graph_node_id) ?? []);
        const capabilities = capabilitiesByNodeId.get(row.graph_node_id) ?? [];
        const ancestors = ancestorsByNodeId.get(row.graph_node_id) ?? [];
        const document = {
            graph_node_id: row.graph_node_id,
            source_name: sourceName,
            node_level: row.node_level,
            canonical_label: row.canonical_label,
            normalized_label: row.normalized_label,
            locale_codes: Object.keys(aliasBundle.localeAliases).sort(),
            locale_aliases: aliasBundle.localeAliases,
            aliases_text: aliasBundle.aliasesText,
            locale_primary_aliases_text: aliasBundle.roleAliasesText.locale_primary,
            locale_supporting_aliases_text: aliasBundle.roleAliasesText.locale_supporting,
            reviewed_crosswalk_aliases_text: aliasBundle.roleAliasesText.reviewed_crosswalk,
            family_supporting_aliases_text: aliasBundle.roleAliasesText.family_supporting,
            english_backbone_aliases_text: aliasBundle.roleAliasesText.english_backbone,
            normalized_aliases: aliasBundle.normalizedAliases,
            search_text: row.search_text ?? '',
            family_node_id: row.family_node_id,
            family_label: row.family_label,
            group_node_id: row.group_node_id,
            group_label: row.group_label,
            generic_risk: row.generic_risk,
            has_hierarchy: row.has_hierarchy === 1,
            has_capability_support: row.has_capability_support === 1,
            capability_text: uniqueValues(capabilities.map((item) => item.label)).join('\n'),
            ancestor_text: uniqueValues(ancestors.map((item) => item.canonical_label)).join('\n'),
            quality_flags: parseStringArray(row.quality_flags_json)
        };
        return document;
    });
}
function buildAliasBundle(aliasRows) {
    const localeAliases = new Map();
    const roleAliases = new Map();
    const normalizedAliases = [];
    const aliasesText = [];
    const normalizedSeen = new Set();
    const aliasSeen = new Set();
    const roleAliasSeen = new Set();
    for (const row of aliasRows) {
        const locale = row.locale_code.trim();
        const alias = row.alias.trim();
        const normalizedAlias = normalizeSearchText(alias);
        const aliasRole = knownAliasRole(row.alias_role);
        if (!locale || !alias) {
            continue;
        }
        if (aliasRole === 'family_supporting') {
            const roleKey = `${aliasRole}|${alias}`;
            if (!roleAliasSeen.has(roleKey)) {
                roleAliasSeen.add(roleKey);
                const values = roleAliases.get(aliasRole) ?? [];
                values.push(alias);
                roleAliases.set(aliasRole, values);
            }
            continue;
        }
        const localeValues = localeAliases.get(locale) ?? [];
        if (!localeValues.includes(alias)) {
            localeValues.push(alias);
            localeAliases.set(locale, localeValues);
        }
        if (!aliasSeen.has(alias)) {
            aliasSeen.add(alias);
            aliasesText.push(alias);
        }
        if (aliasRole) {
            const roleKey = `${aliasRole}|${alias}`;
            if (!roleAliasSeen.has(roleKey)) {
                roleAliasSeen.add(roleKey);
                const values = roleAliases.get(aliasRole) ?? [];
                values.push(alias);
                roleAliases.set(aliasRole, values);
            }
        }
        if (normalizedAlias && !normalizedSeen.has(normalizedAlias)) {
            normalizedSeen.add(normalizedAlias);
            normalizedAliases.push(normalizedAlias);
        }
    }
    return {
        localeAliases: Object.fromEntries(Array.from(localeAliases.entries()).sort(([left], [right]) => left.localeCompare(right))),
        aliasesText: aliasesText.join('\n'),
        roleAliasesText: {
            locale_primary: uniqueValues(roleAliases.get('locale_primary') ?? []).join('\n'),
            locale_supporting: uniqueValues(roleAliases.get('locale_supporting') ?? []).join('\n'),
            reviewed_crosswalk: uniqueValues(roleAliases.get('reviewed_crosswalk') ?? []).join('\n'),
            family_supporting: uniqueValues(roleAliases.get('family_supporting') ?? []).join('\n'),
            english_backbone: uniqueValues(roleAliases.get('english_backbone') ?? []).join('\n')
        },
        normalizedAliases
    };
}
function knownAliasRole(value) {
    if (value === 'locale_primary' ||
        value === 'locale_supporting' ||
        value === 'reviewed_crosswalk' ||
        value === 'family_supporting' ||
        value === 'english_backbone') {
        return value;
    }
    return null;
}
function parseStringArray(value) {
    if (!value) {
        return [];
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string' && item.trim().length > 0) : [];
    }
    catch {
        return [];
    }
}
function groupBy(rows, keySelector) {
    const grouped = new Map();
    for (const row of rows) {
        const key = keySelector(row);
        const bucket = grouped.get(key) ?? [];
        bucket.push(row);
        grouped.set(key, bucket);
    }
    return grouped;
}
function normalizeSourceName(value) {
    const normalized = value?.trim();
    return normalized || DEFAULT_ESCO_SOURCE_NAME;
}
function normalizePositiveInteger(flagName, value, fallback) {
    if (value === undefined) {
        return fallback;
    }
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`--${flagName} must be a positive integer. Received "${value}".`);
    }
    return value;
}
function normalizeOptionalPositiveInteger(flagName, value) {
    if (value === undefined) {
        return undefined;
    }
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`--${flagName} must be a positive integer. Received "${value}".`);
    }
    return value;
}
function toNumber(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
    }
    if (typeof value === 'string') {
        const parsed = Number.parseInt(value, 10);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
}
function uniqueValues(values) {
    const unique = new Set();
    for (const value of values) {
        const normalized = value.trim();
        if (normalized) {
            unique.add(normalized);
        }
    }
    return Array.from(unique);
}
