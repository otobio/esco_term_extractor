import { resetCapabilityGraphSlice } from './reset-capability-graph-slice.js';
import { normalizeSearchText } from '../../utils/texts.js';
const DEFAULT_ESCO_SOURCE_NAME = 'esco_1_2_1';
const GRAPH_CREATED_RELATION_KIND = 'occupation_skill';
const INSERT_CHUNK_SIZE = 500;
export class CapabilityGraphBuilder {
    connection;
    constructor(connection) {
        this.connection = connection;
    }
    async run(options = {}) {
        const sourceName = normalizeSourceName(options.sourceName);
        const locales = await this.resolveLocales(sourceName, options.locales);
        const occupationNodeIdByExternalUri = await this.loadOccupationNodeIdByExternalUri(sourceName);
        if (occupationNodeIdByExternalUri.size === 0) {
            throw new Error(`No occupation graph nodes found for source_name="${sourceName}". Build the occupation graph first.`);
        }
        const concepts = await this.loadLinkedCapabilityConcepts(sourceName, locales);
        if (concepts.length === 0) {
            throw new Error(`No linked capability source concepts found for source_name="${sourceName}".`);
        }
        const capabilities = buildCapabilityRecords(concepts);
        await this.connection.beginTransaction();
        try {
            await resetCapabilityGraphSlice(this.connection, sourceName);
            const capabilityIdByExternalUri = await this.insertCapabilities(capabilities);
            const links = await this.buildLinkCandidates(sourceName, locales, occupationNodeIdByExternalUri, capabilityIdByExternalUri);
            await this.insertCapabilityLinks(links);
            await this.connection.commit();
        }
        catch (error) {
            await this.connection.rollback();
            throw error;
        }
    }
    async resolveLocales(sourceName, locales) {
        const requestedLocales = normalizeLocales(locales);
        if (requestedLocales.length > 0) {
            return requestedLocales;
        }
        const [rows] = await this.connection.query(`
        SELECT DISTINCT locale_code
        FROM ose_source_relations
        WHERE source_name = ?
          AND relation_kind = ?
        ORDER BY locale_code
      `, [sourceName, GRAPH_CREATED_RELATION_KIND]);
        const resolvedLocales = rows.map((row) => row.locale_code);
        if (resolvedLocales.length === 0) {
            throw new Error(`No occupation_skill locales found in ose_source_relations for source_name="${sourceName}".`);
        }
        return resolvedLocales;
    }
    async loadOccupationNodeIdByExternalUri(sourceName) {
        const [rows] = await this.connection.query(`
        SELECT DISTINCT node_source.graph_node_id, node_source.external_uri
        FROM ose_graph_node_sources node_source
        INNER JOIN ose_graph_nodes node
          ON node.id = node_source.graph_node_id
        WHERE node.bucket = 'occupation'
          AND node_source.source_name = ?
          AND node_source.external_uri IS NOT NULL
      `, [sourceName]);
        return new Map(rows.map((row) => [row.external_uri, row.graph_node_id]));
    }
    async loadLinkedCapabilityConcepts(sourceName, locales) {
        const localeFilter = buildLocaleFilter('concept.locale_code', locales);
        const [rows] = await this.connection.query(`
        SELECT
          concept.id,
          concept.source_kind,
          concept.source_name,
          concept.locale_code,
          concept.external_uri,
          concept.entity_kind,
          concept.concept_type,
          concept.preferred_label,
          concept.normalized_label,
          concept.description,
          concept.definition_text
        FROM ose_source_concepts concept
        INNER JOIN (
          SELECT DISTINCT child_external_uri
          FROM ose_source_relations
          WHERE source_name = ?
            AND relation_kind = ?
            ${buildLocaleFilter('locale_code', locales).sql}
        ) linked
          ON linked.child_external_uri = concept.external_uri
        WHERE concept.source_name = ?
          ${localeFilter.sql}
          AND concept.entity_kind IN ('skill', 'language_skill')
        ORDER BY concept.external_uri, concept.locale_code, concept.id
      `, [sourceName, GRAPH_CREATED_RELATION_KIND, ...buildLocaleFilter('locale_code', locales).params, sourceName, ...localeFilter.params]);
        return rows;
    }
    async buildLinkCandidates(sourceName, locales, occupationNodeIdByExternalUri, capabilityIdByExternalUri) {
        const localeFilter = buildLocaleFilter('locale_code', locales);
        const [rows] = await this.connection.query(`
        SELECT
          id,
          parent_external_uri,
          child_external_uri,
          relation_type,
          weight,
          confidence
        FROM ose_source_relations
        WHERE source_name = ?
          AND relation_kind = ?
          ${localeFilter.sql}
        ORDER BY id
      `, [sourceName, GRAPH_CREATED_RELATION_KIND, ...localeFilter.params]);
        const bestByKey = new Map();
        for (const row of rows) {
            const graphNodeId = occupationNodeIdByExternalUri.get(row.parent_external_uri);
            const capabilityId = capabilityIdByExternalUri.get(row.child_external_uri);
            if (!graphNodeId || !capabilityId) {
                continue;
            }
            const relationshipType = normalizeRelationshipType(row.relation_type);
            const candidate = {
                graphNodeId,
                capabilityId,
                relationshipType,
                weight: toNullableNumber(row.weight),
                confidence: toNullableNumber(row.confidence),
                sourceName,
                sourceRelationId: row.id
            };
            const dedupeKey = `${graphNodeId}:${capabilityId}:${relationshipType}`;
            const current = bestByKey.get(dedupeKey);
            if (!current || compareLinkCandidates(candidate, current) < 0) {
                bestByKey.set(dedupeKey, candidate);
            }
        }
        return [...bestByKey.values()];
    }
    async insertCapabilities(capabilities) {
        const capabilityIdByExternalUri = new Map();
        for (const chunk of toChunks(capabilities, INSERT_CHUNK_SIZE)) {
            const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
            const params = chunk.flatMap((capability) => [
                capability.canonicalKey,
                capability.capabilityType,
                capability.label,
                capability.normalizedLabel,
                capability.localeCode,
                capability.description
            ]);
            await this.connection.execute(`
          INSERT INTO ose_capabilities
            (
              canonical_key,
              capability_type,
              label,
              normalized_label,
              locale_code,
              description
            )
          VALUES ${placeholders}
        `, params);
        }
        for (const capability of capabilities) {
            const [rows] = await this.connection.query(`
          SELECT id
          FROM ose_capabilities
          WHERE canonical_key = ?
            AND locale_code = ?
        `, [capability.canonicalKey, capability.localeCode]);
            const capabilityId = rows[0]?.id;
            if (!capabilityId) {
                throw new Error(`Capability insert lookup failed for canonical_key="${capability.canonicalKey}".`);
            }
            capabilityIdByExternalUri.set(capability.externalUri, capabilityId);
        }
        return capabilityIdByExternalUri;
    }
    async insertCapabilityLinks(links) {
        for (const chunk of toChunks(links, INSERT_CHUNK_SIZE)) {
            const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
            const params = chunk.flatMap((link) => [
                link.graphNodeId,
                link.capabilityId,
                link.relationshipType,
                link.weight,
                link.confidence,
                link.sourceName
            ]);
            await this.connection.execute(`
          INSERT INTO ose_graph_capability_links
            (
              graph_node_id,
              capability_id,
              relationship_type,
              weight,
              confidence,
              source_name
            )
          VALUES ${placeholders}
        `, params);
        }
    }
}
function buildCapabilityRecords(concepts) {
    const groupedConcepts = new Map();
    for (const concept of concepts) {
        const rows = groupedConcepts.get(concept.external_uri) ?? [];
        rows.push(concept);
        groupedConcepts.set(concept.external_uri, rows);
    }
    return [...groupedConcepts.values()].map((rows) => buildCapabilityRecord(rows));
}
function buildCapabilityRecord(rows) {
    const sortedRows = [...rows].sort(compareConceptRows);
    const bestRow = sortedRows[0];
    const label = pickBestLabel(sortedRows, bestRow.external_uri);
    return {
        externalUri: bestRow.external_uri,
        canonicalKey: `${bestRow.source_name}:capability:${bestRow.external_uri}`,
        capabilityType: deriveCapabilityType(sortedRows),
        label,
        normalizedLabel: normalizeText(label),
        localeCode: bestRow.locale_code,
        description: pickBestDescription(sortedRows)
    };
}
function compareConceptRows(left, right) {
    return scoreConceptRow(right) - scoreConceptRow(left);
}
function scoreConceptRow(row) {
    let score = 0;
    if (row.locale_code === 'en') {
        score += 20;
    }
    if (row.description || row.definition_text) {
        score += 5;
    }
    if (row.concept_type) {
        score += 3;
    }
    if (!looksLikeStubLabel(row.preferred_label)) {
        score += 100;
    }
    if (row.concept_type?.trim().toLowerCase() === 'knowledge') {
        score += 1;
    }
    return score;
}
function deriveCapabilityType(rows) {
    for (const row of rows) {
        if (row.entity_kind === 'language_skill') {
            return 'language';
        }
    }
    for (const row of rows) {
        const conceptType = row.concept_type?.trim().toLowerCase();
        if (conceptType === 'knowledge' || conceptType === 'knowledge skill') {
            return 'knowledge';
        }
    }
    return 'skill';
}
function pickBestLabel(rows, externalUri) {
    for (const row of rows) {
        if (!looksLikeStubLabel(row.preferred_label)) {
            return row.preferred_label.trim();
        }
    }
    return deriveLabelFromUri(externalUri);
}
function pickBestDescription(rows) {
    for (const row of rows) {
        const description = row.description?.trim() || row.definition_text?.trim();
        if (description) {
            return description;
        }
    }
    return null;
}
function looksLikeStubLabel(label) {
    const trimmed = label?.trim();
    if (!trimmed) {
        return true;
    }
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
}
function deriveLabelFromUri(externalUri) {
    return externalUri.split('/').pop() ?? externalUri;
}
function normalizeSourceName(sourceName) {
    const normalized = sourceName?.trim();
    return normalized || DEFAULT_ESCO_SOURCE_NAME;
}
function normalizeLocales(locales) {
    return (locales ?? []).map((locale) => locale.trim()).filter(Boolean);
}
function buildLocaleFilter(columnName, locales) {
    if (locales.length === 0) {
        return { sql: '', params: [] };
    }
    const placeholders = locales.map(() => '?').join(', ');
    return {
        sql: `AND ${columnName} IN (${placeholders})`,
        params: locales
    };
}
function normalizeRelationshipType(relationType) {
    const normalized = relationType?.trim().toLowerCase();
    return normalized || 'related';
}
function normalizeText(value) {
    return normalizeSearchText(value);
}
function toNullableNumber(value) {
    if (value === null || value === '') {
        return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function compareLinkCandidates(left, right) {
    const leftConfidence = left.confidence ?? 0;
    const rightConfidence = right.confidence ?? 0;
    if (leftConfidence !== rightConfidence) {
        return rightConfidence - leftConfidence;
    }
    const leftWeight = left.weight ?? 0;
    const rightWeight = right.weight ?? 0;
    if (leftWeight !== rightWeight) {
        return rightWeight - leftWeight;
    }
    return left.sourceRelationId - right.sourceRelationId;
}
function toChunks(items, chunkSize) {
    const chunks = [];
    for (let index = 0; index < items.length; index += chunkSize) {
        chunks.push(items.slice(index, index + chunkSize));
    }
    return chunks;
}
