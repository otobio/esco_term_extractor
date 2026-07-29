import { resetOccupationSearchMeta } from './reset-occupation-search-meta.js';
import { taxonomyFamilyOverrideForSubFamily, taxonomySubFamilyOverrideForLeaf } from '../../runtime/occupation-taxonomy-family-overrides.js';
import { normalizeSearchText } from '../../utils/texts.js';
const DEFAULT_ESCO_SOURCE_NAME = 'esco_1_2_1';
const INSERT_CHUNK_SIZE = 500;
const MAX_SEARCH_ALIASES = 18;
const MAX_DENSE_ALIASES = 8;
const MAX_SIBLING_LABELS = 6;
const MAX_ESSENTIAL_HINTS = 10;
const MAX_OPTIONAL_HINTS = 8;
export class OccupationSearchMetaBuilder {
    connection;
    constructor(connection) {
        this.connection = connection;
    }
    async run(options = {}) {
        const sourceName = normalizeSourceName(options.sourceName);
        assertSafeResetOptions(options);
        const locales = await this.resolveLocales(sourceName, options.locales);
        const localeBundle = Array.from(new Set([...locales, 'en']));
        const occupations = await this.loadActiveLeafOccupations(sourceName);
        if (occupations.length === 0) {
            throw new Error(`No active leaf occupation nodes found for source_name="${sourceName}".`);
        }
        const allNodes = await this.loadSourceNodes(sourceName);
        const relationships = await this.loadRelationships(sourceName);
        const aliases = await this.loadAliases(sourceName, localeBundle);
        const capabilities = await this.loadCapabilities(sourceName, localeBundle);
        const nodeById = new Map(allNodes.map((node) => [node.id, node]));
        const parentByChild = buildParentByChildMap(relationships);
        const childrenByParent = buildChildrenByParentMap(relationships, nodeById);
        const aliasesByNodeId = groupBy(aliases, (row) => row.graph_node_id);
        const capabilitiesByNodeId = groupBy(capabilities, (row) => row.graph_node_id);
        const artifacts = occupations.map((occupation) => this.buildArtifactsForOccupation(sourceName, occupation, locales, nodeById, parentByChild, childrenByParent, aliasesByNodeId.get(occupation.id) ?? [], aliasesByNodeId, capabilitiesByNodeId.get(occupation.id) ?? []));
        await this.connection.beginTransaction();
        try {
            if (!options.skipReset) {
                await resetOccupationSearchMeta(this.connection, sourceName);
            }
            const searchMetaIdByNodeId = await this.insertSearchMetaRecords(artifacts.map((artifact) => artifact.meta));
            await this.insertSearchMetaAliases(flatMap(artifacts, (artifact) => artifact.aliases), searchMetaIdByNodeId);
            await this.insertSearchMetaAncestors(flatMap(artifacts, (artifact) => artifact.ancestors), searchMetaIdByNodeId);
            await this.insertSearchMetaSiblings(flatMap(artifacts, (artifact) => artifact.siblings), searchMetaIdByNodeId);
            await this.insertSearchMetaCapabilityHints(flatMap(artifacts, (artifact) => artifact.capabilityHints), searchMetaIdByNodeId);
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
        FROM ose_graph_aliases alias
        WHERE alias.is_active = 1
          AND EXISTS (
            SELECT 1
            FROM ose_graph_node_sources node_source
            WHERE node_source.graph_node_id = alias.graph_node_id
              AND node_source.source_name = ?
          )
        ORDER BY locale_code
      `, [sourceName]);
        const resolvedLocales = rows.map((row) => row.locale_code).filter(Boolean);
        if (resolvedLocales.length === 0) {
            throw new Error(`No active graph alias locales found for source_name="${sourceName}".`);
        }
        return resolvedLocales;
    }
    async loadActiveLeafOccupations(sourceName) {
        const [rows] = await this.connection.query(`
        SELECT DISTINCT
          node.id,
          node.canonical_label,
          node.normalized_label,
          node.description
        FROM ose_graph_nodes node
        INNER JOIN ose_graph_node_sources node_source
          ON node_source.graph_node_id = node.id
        WHERE node.bucket = 'occupation'
          AND node.node_level = 'occupation'
          AND node.status = 'active'
          AND node.is_searchable = 1
          AND node.is_leaf = 1
          AND node_source.source_name = ?
        ORDER BY node.id
      `, [sourceName]);
        return rows;
    }
    async loadSourceNodes(sourceName) {
        const [rows] = await this.connection.query(`
        SELECT DISTINCT
          node.id,
          node.canonical_label,
          node.normalized_label,
          node.description,
          node.node_level
        FROM ose_graph_nodes node
        INNER JOIN ose_graph_node_sources node_source
          ON node_source.graph_node_id = node.id
        WHERE node.bucket = 'occupation'
          AND node.status = 'active'
          AND node_source.source_name = ?
        ORDER BY node.id
      `, [sourceName]);
        return rows;
    }
    async loadRelationships(sourceName) {
        const [rows] = await this.connection.query(`
        SELECT
          parent_node_id,
          child_node_id,
          confidence
        FROM ose_graph_relationships
        WHERE relationship_type = 'broader'
          AND is_active = 1
          AND source_name = ?
        ORDER BY child_node_id, parent_node_id
      `, [sourceName]);
        return rows;
    }
    async loadAliases(sourceName, locales) {
        const localeFilter = buildLocaleFilter('locale_code', locales);
        const [rows] = await this.connection.query(`
        SELECT
          graph_node_id,
          locale_code,
          alias,
          normalized_alias,
          alias_class,
          confidence,
          is_primary,
          is_active,
          is_generic_head_only,
          needs_review
        FROM ose_graph_aliases
        WHERE is_active = 1
          AND EXISTS (
            SELECT 1
            FROM ose_graph_node_sources node_source
            WHERE node_source.graph_node_id = ose_graph_aliases.graph_node_id
              AND node_source.source_name = ?
          )
          ${localeFilter.sql}
        ORDER BY graph_node_id, locale_code, is_primary DESC, confidence DESC, alias
      `, [sourceName, ...localeFilter.params]);
        return rows;
    }
    async loadCapabilities(sourceName, locales) {
        const localeFilter = buildLocaleFilter('cap.locale_code', locales);
        const [rows] = await this.connection.query(`
        SELECT
          link.graph_node_id,
          link.capability_id,
          link.relationship_type,
          link.confidence,
          cap.capability_type,
          cap.locale_code,
          cap.label,
          cap.normalized_label
        FROM ose_graph_capability_links link
        INNER JOIN ose_capabilities cap
          ON cap.id = link.capability_id
        INNER JOIN (
          SELECT DISTINCT graph_node_id
          FROM ose_graph_node_sources
          WHERE source_name = ?
        ) scoped
          ON scoped.graph_node_id = link.graph_node_id
        WHERE 1 = 1
          ${localeFilter.sql}
        ORDER BY link.graph_node_id, link.relationship_type, cap.locale_code, cap.label
      `, [sourceName, ...localeFilter.params]);
        return rows;
    }
    buildArtifactsForOccupation(sourceName, occupation, locales, nodeById, parentByChild, childrenByParent, aliasRows, aliasesByNodeId, capabilityRows) {
        const hierarchy = applyReviewedTaxonomyFamilyOverrideToHierarchy(sourceName, occupation.id, buildHierarchySummary(occupation.id, nodeById, parentByChild), nodeById, parentByChild);
        const ownAliases = ensureAliasCoverage(occupation, aliasRows);
        const propagatedFamilyAliases = selectPropagatedFamilyAliasRows(hierarchy, aliasesByNodeId);
        const aliases = dedupeAliases([...ownAliases, ...propagatedFamilyAliases]);
        const localeAliasRows = selectLocaleAliasRows(ownAliases, locales);
        const englishAliasRows = selectEnglishBackboneRows(ownAliases);
        const familySupportingAliasRows = selectFamilySupportingAliasRows(propagatedFamilyAliases, locales);
        const capabilitySummary = buildCapabilitySummary(occupation.id, capabilityRows);
        const siblingRows = buildSiblingRecords(occupation.id, hierarchy.parentNode, nodeById, childrenByParent);
        const siblingLabels = siblingRows
            .map((record) => nodeById.get(record.siblingNodeId)?.canonical_label ?? null)
            .filter((value) => Boolean(value));
        const activeAliasCount = countDistinctAliases(aliases);
        const exactAliasCount = countDistinctAliases(aliases.filter((alias) => alias.is_generic_head_only !== 1));
        const localeCoverageCount = countDistinctLocales(localeAliasRows);
        const englishBackboneStrength = computeEnglishBackboneStrength(englishAliasRows);
        const genericRisk = computeGenericRisk(occupation.canonical_label, aliases, englishBackboneStrength);
        const metadata = buildMetadataJson(locales, hierarchy, aliases, capabilitySummary, siblingRows.length);
        const qualityFlags = buildQualityFlags(locales, hierarchy, localeCoverageCount, englishAliasRows, capabilitySummary, genericRisk);
        const searchText = buildSearchText({
            label: occupation.canonical_label,
            description: occupation.description,
            localeAliases: localeAliasRows,
            englishAliases: englishAliasRows,
            hierarchy,
            siblingLabels,
            capabilitySummary
        });
        const denseText = buildDenseText({
            label: occupation.canonical_label,
            description: occupation.description,
            localeAliases: localeAliasRows,
            englishAliases: englishAliasRows,
            hierarchy,
            siblingLabels,
            capabilitySummary
        });
        return {
            meta: {
                graphNodeId: occupation.id,
                familyNodeId: hierarchy.familyNode?.id ?? null,
                groupNodeId: hierarchy.groupNode?.id ?? null,
                parentNodeId: hierarchy.parentNode?.id ?? null,
                leafDepth: hierarchy.lineage.length > 0 ? hierarchy.lineage.length : null,
                genericRisk,
                exactAliasCount,
                activeAliasCount,
                localeCoverageCount,
                hasHierarchy: hierarchy.lineage.length > 0,
                hasCapabilitySupport: capabilitySummary.usefulCount > 0,
                englishBackboneStrength,
                searchText,
                denseText,
                metadataJson: JSON.stringify(metadata),
                qualityFlagsJson: JSON.stringify(qualityFlags)
            },
            aliases: buildSearchMetaAliasRecords(occupation.id, localeAliasRows, englishAliasRows, familySupportingAliasRows, locales),
            ancestors: hierarchy.ancestorRecords,
            siblings: siblingRows,
            capabilityHints: capabilitySummary.records
        };
    }
    async insertSearchMetaRecords(records) {
        const searchMetaIdByNodeId = new Map();
        for (const record of records) {
            const [result] = await this.connection.execute(`
          INSERT INTO ose_search_meta
            (
              graph_node_id,
              family_node_id,
              group_node_id,
              parent_node_id,
              leaf_depth,
              generic_risk,
              exact_alias_count,
              active_alias_count,
              locale_coverage_count,
              has_hierarchy,
              has_capability_support,
              english_backbone_strength,
              search_text,
              dense_text,
              metadata_json,
              quality_flags_json
            )
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [
                record.graphNodeId,
                record.familyNodeId,
                record.groupNodeId,
                record.parentNodeId,
                record.leafDepth,
                record.genericRisk,
                record.exactAliasCount,
                record.activeAliasCount,
                record.localeCoverageCount,
                record.hasHierarchy ? 1 : 0,
                record.hasCapabilitySupport ? 1 : 0,
                record.englishBackboneStrength,
                record.searchText,
                record.denseText,
                record.metadataJson,
                record.qualityFlagsJson
            ]);
            searchMetaIdByNodeId.set(record.graphNodeId, result.insertId);
        }
        return searchMetaIdByNodeId;
    }
    async insertSearchMetaAliases(records, searchMetaIdByNodeId) {
        const insertable = records
            .map((record) => {
            const searchMetaId = searchMetaIdByNodeId.get(record.graphNodeId);
            return searchMetaId ? { ...record, searchMetaId } : null;
        })
            .filter((record) => Boolean(record));
        for (const chunk of toChunks(insertable, INSERT_CHUNK_SIZE)) {
            const placeholders = chunk.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
            const params = chunk.flatMap((record) => [
                record.searchMetaId,
                record.localeCode,
                record.alias,
                record.normalizedAlias,
                record.aliasRole,
                record.weight
            ]);
            await this.connection.execute(`
          INSERT INTO ose_search_meta_aliases
            (
              search_meta_id,
              locale_code,
              alias,
              normalized_alias,
              alias_role,
              weight
            )
          VALUES ${placeholders}
        `, params);
        }
    }
    async insertSearchMetaAncestors(records, searchMetaIdByNodeId) {
        const insertable = records
            .map((record) => {
            const searchMetaId = searchMetaIdByNodeId.get(record.graphNodeId);
            return searchMetaId ? { ...record, searchMetaId } : null;
        })
            .filter((record) => Boolean(record));
        for (const chunk of toChunks(insertable, INSERT_CHUNK_SIZE)) {
            const placeholders = chunk.map(() => '(?, ?, ?, ?)').join(', ');
            const params = chunk.flatMap((record) => [record.searchMetaId, record.ancestorNodeId, record.distanceFromLeaf, record.ancestorRole]);
            await this.connection.execute(`
          INSERT INTO ose_search_meta_ancestors
            (
              search_meta_id,
              ancestor_node_id,
              distance_from_leaf,
              ancestor_role
            )
          VALUES ${placeholders}
        `, params);
        }
    }
    async insertSearchMetaSiblings(records, searchMetaIdByNodeId) {
        const insertable = records
            .map((record) => {
            const searchMetaId = searchMetaIdByNodeId.get(record.graphNodeId);
            return searchMetaId ? { ...record, searchMetaId } : null;
        })
            .filter((record) => Boolean(record));
        for (const chunk of toChunks(insertable, INSERT_CHUNK_SIZE)) {
            const placeholders = chunk.map(() => '(?, ?, ?, ?)').join(', ');
            const params = chunk.flatMap((record) => [record.searchMetaId, record.siblingNodeId, record.siblingKind, record.weight]);
            await this.connection.execute(`
          INSERT INTO ose_search_meta_siblings
            (
              search_meta_id,
              sibling_node_id,
              sibling_kind,
              weight
            )
          VALUES ${placeholders}
        `, params);
        }
    }
    async insertSearchMetaCapabilityHints(records, searchMetaIdByNodeId) {
        const insertable = records
            .map((record) => {
            const searchMetaId = searchMetaIdByNodeId.get(record.graphNodeId);
            return searchMetaId ? { ...record, searchMetaId } : null;
        })
            .filter((record) => Boolean(record));
        for (const chunk of toChunks(insertable, INSERT_CHUNK_SIZE)) {
            const placeholders = chunk.map(() => '(?, ?, ?, ?)').join(', ');
            const params = chunk.flatMap((record) => [record.searchMetaId, record.capabilityId, record.hintKind, record.weight]);
            await this.connection.execute(`
          INSERT INTO ose_search_meta_capability_hints
            (
              search_meta_id,
              capability_id,
              hint_kind,
              weight
            )
          VALUES ${placeholders}
        `, params);
        }
    }
}
function normalizeSourceName(sourceName) {
    const trimmed = sourceName?.trim();
    return trimmed || DEFAULT_ESCO_SOURCE_NAME;
}
function normalizeLocales(locales) {
    return Array.from(new Set((locales ?? []).map((locale) => locale.trim()).filter(Boolean)));
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
function buildParentByChildMap(relationships) {
    const parentByChild = new Map();
    for (const relationship of relationships) {
        const existing = parentByChild.get(relationship.child_node_id);
        if (!existing || compareRelationships(relationship, existing) < 0) {
            parentByChild.set(relationship.child_node_id, relationship);
        }
    }
    return parentByChild;
}
function buildChildrenByParentMap(relationships, nodeById) {
    const childrenByParent = new Map();
    for (const relationship of relationships) {
        const childNode = nodeById.get(relationship.child_node_id);
        if (childNode?.node_level !== 'occupation') {
            continue;
        }
        const rows = childrenByParent.get(relationship.parent_node_id) ?? [];
        rows.push(relationship.child_node_id);
        childrenByParent.set(relationship.parent_node_id, rows);
    }
    for (const [parentNodeId, childNodeIds] of childrenByParent.entries()) {
        const uniqueChildNodeIds = Array.from(new Set(childNodeIds)).sort((left, right) => left - right);
        childrenByParent.set(parentNodeId, uniqueChildNodeIds);
    }
    return childrenByParent;
}
function compareRelationships(left, right) {
    const leftConfidence = toNullableNumber(left.confidence) ?? 0;
    const rightConfidence = toNullableNumber(right.confidence) ?? 0;
    if (leftConfidence !== rightConfidence) {
        return rightConfidence - leftConfidence;
    }
    return left.parent_node_id - right.parent_node_id;
}
function ensureAliasCoverage(occupation, aliases) {
    if (aliases.length > 0) {
        return aliases;
    }
    if (looksLikeStubLabel(occupation.canonical_label)) {
        return [];
    }
    return [
        {
            graph_node_id: occupation.id,
            locale_code: 'en',
            alias: occupation.canonical_label,
            normalized_alias: occupation.normalized_label,
            alias_class: 'synthetic',
            confidence: 0.75,
            is_primary: 1,
            is_active: 1,
            is_generic_head_only: 0,
            needs_review: 0
        }
    ];
}
function buildHierarchySummary(graphNodeId, nodeById, parentByChild) {
    const lineage = [];
    const ancestorRecords = [];
    const seenNodeIds = new Set([graphNodeId]);
    let familyNode = null;
    let groupNode = null;
    let currentNodeId = graphNodeId;
    let distance = 0;
    while (parentByChild.has(currentNodeId)) {
        const relationship = parentByChild.get(currentNodeId);
        if (!relationship) {
            break;
        }
        const ancestorNode = nodeById.get(relationship.parent_node_id);
        if (!ancestorNode || seenNodeIds.has(ancestorNode.id)) {
            break;
        }
        seenNodeIds.add(ancestorNode.id);
        lineage.push(ancestorNode);
        distance += 1;
        const roles = [];
        if (distance === 1) {
            roles.push('parent');
        }
        if (ancestorNode.node_level === 'family' && !familyNode) {
            familyNode = ancestorNode;
            roles.push('family');
        }
        if (ancestorNode.node_level === 'group' && !groupNode) {
            groupNode = ancestorNode;
            roles.push('group');
        }
        if (roles.length === 0) {
            roles.push('broader');
        }
        for (const role of roles) {
            ancestorRecords.push({
                graphNodeId,
                ancestorNodeId: ancestorNode.id,
                distanceFromLeaf: distance,
                ancestorRole: role
            });
        }
        currentNodeId = ancestorNode.id;
    }
    return {
        lineage,
        parentNode: lineage[0] ?? null,
        familyNode,
        groupNode,
        ancestorRecords
    };
}
function applyReviewedTaxonomyFamilyOverrideToHierarchy(sourceName, graphNodeId, hierarchy, nodeById, parentByChild) {
    const leafOverride = taxonomySubFamilyOverrideForLeaf(sourceName, graphNodeId);
    const hierarchyWithLeafOverride = leafOverride
        ? applyReviewedLeafSubFamilyOverrideToHierarchy(graphNodeId, hierarchy, leafOverride.targetSubFamilyNodeId, nodeById, parentByChild)
        : hierarchy;
    const familyOverride = taxonomyFamilyOverrideForSubFamily(sourceName, hierarchyWithLeafOverride.groupNode?.id ?? null);
    if (!familyOverride || hierarchyWithLeafOverride.familyNode?.id === familyOverride.targetFamilyNodeId) {
        return hierarchyWithLeafOverride;
    }
    const targetFamilyNode = nodeById.get(familyOverride.targetFamilyNodeId) ??
        {
            id: familyOverride.targetFamilyNodeId,
            canonical_label: familyOverride.targetFamilyLabel,
            normalized_label: normalizeSearchText(familyOverride.targetFamilyLabel),
            description: null,
            node_level: 'family'
        };
    const ancestorRecords = hierarchyWithLeafOverride.ancestorRecords
        .filter((record) => record.ancestorRole !== 'family')
        .concat({
        graphNodeId,
        ancestorNodeId: targetFamilyNode.id,
        distanceFromLeaf: familyAncestorDistance(hierarchyWithLeafOverride),
        ancestorRole: 'family'
    })
        .sort(compareAncestorRecords);
    return {
        ...hierarchyWithLeafOverride,
        familyNode: targetFamilyNode,
        ancestorRecords
    };
}
function applyReviewedLeafSubFamilyOverrideToHierarchy(graphNodeId, hierarchy, targetSubFamilyNodeId, nodeById, parentByChild) {
    const targetSubFamilyNode = nodeById.get(targetSubFamilyNodeId);
    if (!targetSubFamilyNode) {
        return hierarchy;
    }
    const targetSubFamilyHierarchy = buildHierarchySummary(targetSubFamilyNodeId, nodeById, parentByChild);
    const lineage = [targetSubFamilyNode, ...targetSubFamilyHierarchy.lineage];
    const parentRecord = {
        graphNodeId,
        ancestorNodeId: targetSubFamilyNode.id,
        distanceFromLeaf: 1,
        ancestorRole: 'parent'
    };
    const groupRecord = {
        graphNodeId,
        ancestorNodeId: targetSubFamilyNode.id,
        distanceFromLeaf: 1,
        ancestorRole: 'group'
    };
    const ancestorRecords = [
        parentRecord,
        groupRecord,
        ...targetSubFamilyHierarchy.ancestorRecords.map((record) => ({
            graphNodeId,
            ancestorNodeId: record.ancestorNodeId,
            distanceFromLeaf: record.distanceFromLeaf + 1,
            ancestorRole: record.ancestorRole
        }))
    ].sort(compareAncestorRecords);
    return {
        lineage,
        parentNode: targetSubFamilyNode,
        familyNode: targetSubFamilyHierarchy.familyNode,
        groupNode: targetSubFamilyNode,
        ancestorRecords
    };
}
function familyAncestorDistance(hierarchy) {
    const existingFamilyRecord = hierarchy.ancestorRecords.find((record) => record.ancestorRole === 'family');
    return existingFamilyRecord?.distanceFromLeaf ?? (hierarchy.parentNode ? 2 : 1);
}
function compareAncestorRecords(left, right) {
    return (left.distanceFromLeaf - right.distanceFromLeaf ||
        ancestorRoleRank(left.ancestorRole) - ancestorRoleRank(right.ancestorRole) ||
        left.ancestorNodeId - right.ancestorNodeId);
}
function ancestorRoleRank(role) {
    switch (role) {
        case 'parent':
            return 0;
        case 'family':
            return 1;
        case 'group':
            return 2;
        case 'broader':
            return 3;
    }
}
function selectLocaleAliasRows(aliases, locales) {
    const localeSet = new Set(locales);
    return dedupeAliases(aliases.filter((alias) => alias.is_active === 1 && alias.is_generic_head_only !== 1 && localeSet.has(alias.locale_code) && !looksLikeStubLabel(alias.alias)));
}
function selectEnglishBackboneRows(aliases) {
    return dedupeAliases(aliases.filter((alias) => alias.is_active === 1 && alias.is_generic_head_only !== 1 && alias.locale_code === 'en' && !looksLikeStubLabel(alias.alias)));
}
function selectPropagatedFamilyAliasRows(hierarchy, aliasesByNodeId) {
    if (!hierarchy.familyNode) {
        return [];
    }
    return dedupeAliases((aliasesByNodeId.get(hierarchy.familyNode.id) ?? []).filter((alias) => alias.is_active === 1 && alias.needs_review === 1 && alias.is_generic_head_only !== 1 && !looksLikeStubLabel(alias.alias)));
}
function selectFamilySupportingAliasRows(aliases, locales) {
    const localeSet = new Set([...locales, 'en']);
    return dedupeAliases(aliases.filter((alias) => alias.is_active === 1 &&
        alias.needs_review === 1 &&
        alias.is_generic_head_only !== 1 &&
        localeSet.has(alias.locale_code) &&
        !looksLikeStubLabel(alias.alias)));
}
function dedupeAliases(aliases) {
    const bestByKey = new Map();
    for (const alias of aliases) {
        const dedupeKey = `${alias.locale_code}\u0000${alias.normalized_alias}`;
        const existing = bestByKey.get(dedupeKey);
        if (!existing || compareAliasRows(alias, existing) < 0) {
            bestByKey.set(dedupeKey, alias);
        }
    }
    return Array.from(bestByKey.values()).sort(compareAliasRows);
}
function compareAliasRows(left, right) {
    if (left.is_primary !== right.is_primary) {
        return left.is_primary === 1 ? -1 : 1;
    }
    const leftConfidence = toNullableNumber(left.confidence) ?? 0;
    const rightConfidence = toNullableNumber(right.confidence) ?? 0;
    if (leftConfidence !== rightConfidence) {
        return rightConfidence - leftConfidence;
    }
    return left.alias.localeCompare(right.alias);
}
function buildCapabilitySummary(graphNodeId, rows) {
    const usefulRows = rows.filter((row) => !looksLikeStubLabel(row.label));
    const stubFilteredCount = rows.length - usefulRows.length;
    const essentialRows = dedupeCapabilityRows(usefulRows.filter((row) => normalizeCapabilityHintKind(row.relationship_type) === 'essential'));
    const essentialLabelSet = new Set(essentialRows.map((row) => row.normalized_label || normalizeText(row.label)));
    const optionalRows = dedupeCapabilityRows(usefulRows.filter((row) => normalizeCapabilityHintKind(row.relationship_type) === 'optional' &&
        !essentialLabelSet.has(row.normalized_label || normalizeText(row.label))));
    const recordsByKey = new Map();
    for (const row of essentialRows) {
        const record = {
            graphNodeId,
            capabilityId: row.capability_id,
            hintKind: 'essential',
            weight: roundToFour(Math.max(toNullableNumber(row.confidence) ?? 0.85, 0.85))
        };
        recordsByKey.set(`${record.capabilityId}\u0000${record.hintKind}`, record);
    }
    for (const row of optionalRows) {
        const record = {
            graphNodeId,
            capabilityId: row.capability_id,
            hintKind: 'optional',
            weight: roundToFour(Math.max(toNullableNumber(row.confidence) ?? 0.65, 0.55))
        };
        recordsByKey.set(`${record.capabilityId}\u0000${record.hintKind}`, record);
    }
    for (const row of usefulRows) {
        const hintKind = normalizeCapabilityTypeHint(row.capability_type);
        if (!hintKind) {
            continue;
        }
        const record = {
            graphNodeId,
            capabilityId: row.capability_id,
            hintKind,
            weight: roundToFour(Math.max(toNullableNumber(row.confidence) ?? 0.55, 0.45))
        };
        recordsByKey.set(`${record.capabilityId}\u0000${record.hintKind}`, record);
    }
    return {
        records: Array.from(recordsByKey.values()),
        essentialLabels: essentialRows.slice(0, MAX_ESSENTIAL_HINTS).map((row) => row.label),
        optionalLabels: optionalRows.slice(0, MAX_OPTIONAL_HINTS).map((row) => row.label),
        usefulCount: usefulRows.length,
        stubFilteredCount
    };
}
function dedupeCapabilityRows(rows) {
    const bestByLabel = new Map();
    for (const row of rows) {
        const dedupeKey = row.normalized_label || normalizeText(row.label);
        const existing = bestByLabel.get(dedupeKey);
        if (!existing || compareCapabilityRows(row, existing) < 0) {
            bestByLabel.set(dedupeKey, row);
        }
    }
    return Array.from(bestByLabel.values()).sort(compareCapabilityRows);
}
function compareCapabilityRows(left, right) {
    const leftRelationshipScore = normalizeCapabilityHintKind(left.relationship_type) === 'essential' ? 0 : 1;
    const rightRelationshipScore = normalizeCapabilityHintKind(right.relationship_type) === 'essential' ? 0 : 1;
    if (leftRelationshipScore !== rightRelationshipScore) {
        return leftRelationshipScore - rightRelationshipScore;
    }
    if (left.locale_code !== right.locale_code) {
        if (left.locale_code === 'en') {
            return -1;
        }
        if (right.locale_code === 'en') {
            return 1;
        }
    }
    const leftConfidence = toNullableNumber(left.confidence) ?? 0;
    const rightConfidence = toNullableNumber(right.confidence) ?? 0;
    if (leftConfidence !== rightConfidence) {
        return rightConfidence - leftConfidence;
    }
    return left.label.localeCompare(right.label);
}
function normalizeCapabilityHintKind(value) {
    return value === 'essential' ? 'essential' : 'optional';
}
function normalizeCapabilityTypeHint(capabilityType) {
    if (capabilityType === 'knowledge' || capabilityType === 'tool' || capabilityType === 'software') {
        return capabilityType;
    }
    return null;
}
function buildSiblingRecords(graphNodeId, parentNode, nodeById, childrenByParent) {
    if (!parentNode) {
        return [];
    }
    const childNodeIds = childrenByParent.get(parentNode.id) ?? [];
    const siblingKind = parentNode.node_level === 'group' ? 'same_group' : 'same_family';
    return childNodeIds
        .filter((childNodeId) => childNodeId !== graphNodeId)
        .map((childNodeId) => nodeById.get(childNodeId))
        .filter((node) => Boolean(node && node.node_level === 'occupation'))
        .sort((left, right) => left.canonical_label.localeCompare(right.canonical_label))
        .map((node, index) => ({
        graphNodeId,
        siblingNodeId: node.id,
        siblingKind,
        weight: roundToFour(Math.max(1 - index * 0.02, 0.5))
    }));
}
function buildSearchMetaAliasRecords(graphNodeId, localeAliasRows, englishAliasRows, familySupportingAliasRows, locales) {
    const localeSet = new Set(locales);
    const recordsByKey = new Map();
    for (const aliasRow of localeAliasRows) {
        if (!localeSet.has(aliasRow.locale_code)) {
            continue;
        }
        const aliasRole = aliasRow.needs_review === 1 ? 'reviewed_crosswalk' : aliasRow.is_primary === 1 ? 'locale_primary' : 'locale_supporting';
        const normalizedAlias = normalizeText(aliasRow.alias);
        const record = {
            graphNodeId,
            localeCode: aliasRow.locale_code,
            alias: aliasRow.alias,
            normalizedAlias,
            aliasRole,
            weight: computeAliasWeight(aliasRow, aliasRole)
        };
        recordsByKey.set(`${record.localeCode}\u0000${record.normalizedAlias}\u0000${record.aliasRole}`, record);
    }
    for (const aliasRow of englishAliasRows) {
        const aliasRole = aliasRow.needs_review === 1 ? 'reviewed_crosswalk' : 'english_backbone';
        const normalizedAlias = normalizeText(aliasRow.alias);
        const record = {
            graphNodeId,
            localeCode: 'en',
            alias: aliasRow.alias,
            normalizedAlias,
            aliasRole,
            weight: computeAliasWeight(aliasRow, aliasRole)
        };
        recordsByKey.set(`${record.localeCode}\u0000${record.normalizedAlias}\u0000${record.aliasRole}`, record);
    }
    for (const aliasRow of familySupportingAliasRows) {
        const normalizedAlias = normalizeText(aliasRow.alias);
        const record = {
            graphNodeId,
            localeCode: aliasRow.locale_code,
            alias: aliasRow.alias,
            normalizedAlias,
            aliasRole: 'family_supporting',
            weight: computeAliasWeight(aliasRow, 'family_supporting')
        };
        recordsByKey.set(`${record.localeCode}\u0000${record.normalizedAlias}\u0000${record.aliasRole}`, record);
    }
    return Array.from(recordsByKey.values()).sort((left, right) => {
        if (left.aliasRole !== right.aliasRole) {
            return left.aliasRole.localeCompare(right.aliasRole);
        }
        if (left.localeCode !== right.localeCode) {
            return left.localeCode.localeCompare(right.localeCode);
        }
        return left.alias.localeCompare(right.alias);
    });
}
function computeAliasWeight(aliasRow, aliasRole) {
    const confidence = toNullableNumber(aliasRow.confidence) ?? (aliasRow.is_primary === 1 ? 1 : 0.8);
    if (aliasRole === 'english_backbone') {
        return roundToFour(aliasRow.is_primary === 1 ? Math.max(confidence, 0.95) : Math.max(confidence, 0.75));
    }
    if (aliasRole === 'reviewed_crosswalk') {
        return roundToFour(Math.min(Math.max(confidence, 0.72), 0.82));
    }
    if (aliasRole === 'family_supporting') {
        return roundToFour(Math.min(Math.max(confidence, 0.62), 0.72));
    }
    return roundToFour(aliasRow.is_primary === 1 ? Math.max(confidence, 0.9) : Math.max(confidence, 0.6));
}
function countDistinctAliases(aliases) {
    return new Set(aliases.filter((alias) => alias.is_active === 1).map((alias) => `${alias.locale_code}\u0000${alias.normalized_alias}`))
        .size;
}
function countDistinctLocales(aliases) {
    return new Set(aliases.map((alias) => alias.locale_code)).size;
}
function computeEnglishBackboneStrength(aliases) {
    if (aliases.length === 0) {
        return null;
    }
    const primaryCount = aliases.filter((alias) => alias.is_primary === 1).length;
    const supportingCount = aliases.length - primaryCount;
    const score = Math.min(1, primaryCount * 0.55 + Math.min(supportingCount, 6) * 0.08 + 0.15);
    return roundToFour(score);
}
function computeGenericRisk(canonicalLabel, aliases, englishBackboneStrength) {
    const activeAliases = aliases.filter((alias) => alias.is_active === 1);
    const genericAliasCount = activeAliases.filter((alias) => alias.is_generic_head_only === 1).length;
    const nonGenericSupportingCount = activeAliases.filter((alias) => alias.is_generic_head_only !== 1 && alias.is_primary !== 1).length;
    const tokenCount = canonicalLabel.trim().split(/\s+/u).filter(Boolean).length;
    const genericRatio = activeAliases.length > 0 ? genericAliasCount / activeAliases.length : 0;
    if ((genericAliasCount >= 2 && genericRatio >= 0.4) || (tokenCount <= 2 && genericAliasCount >= 3 && nonGenericSupportingCount === 0)) {
        return 'high';
    }
    if (genericAliasCount >= 1 || nonGenericSupportingCount <= 1 || (englishBackboneStrength ?? 0) < 0.5) {
        return 'medium';
    }
    return 'low';
}
function buildMetadataJson(locales, hierarchy, aliases, capabilitySummary, siblingCount) {
    return {
        locales,
        hierarchy: {
            depth: hierarchy.lineage.length,
            parent_label: hierarchy.parentNode?.canonical_label ?? null,
            family_label: hierarchy.familyNode?.canonical_label ?? null,
            group_label: hierarchy.groupNode?.canonical_label ?? null
        },
        alias_stats: {
            active_count: countDistinctAliases(aliases),
            generic_count: aliases.filter((alias) => alias.is_active === 1 && alias.is_generic_head_only === 1).length,
            english_count: aliases.filter((alias) => alias.locale_code === 'en' && alias.is_active === 1).length,
            locale_count: countDistinctLocales(aliases.filter((alias) => alias.is_active === 1))
        },
        capability_stats: {
            useful_count: capabilitySummary.usefulCount,
            stub_filtered_count: capabilitySummary.stubFilteredCount,
            essential_count: capabilitySummary.essentialLabels.length,
            optional_count: capabilitySummary.optionalLabels.length
        },
        sibling_count: siblingCount
    };
}
function buildQualityFlags(locales, hierarchy, localeCoverageCount, englishAliasRows, capabilitySummary, genericRisk) {
    const flags = [];
    if (!hierarchy.parentNode) {
        flags.push('missing_parent');
    }
    if (!hierarchy.familyNode) {
        flags.push('missing_family');
    }
    if (!hierarchy.groupNode) {
        flags.push('missing_group');
    }
    if (localeCoverageCount < locales.length) {
        flags.push('partial_locale_coverage');
    }
    if (englishAliasRows.length === 0) {
        flags.push('missing_english_backbone');
    }
    if (capabilitySummary.usefulCount === 0) {
        flags.push('missing_capability_hints');
    }
    if (capabilitySummary.stubFilteredCount > 0) {
        flags.push('stub_capability_labels_filtered');
    }
    if (genericRisk !== 'low') {
        flags.push(`generic_risk_${genericRisk}`);
    }
    return flags;
}
function buildSearchText(input) {
    const aliasLabels = limitStrings(dedupeStrings([...input.localeAliases.map((alias) => alias.alias), ...input.englishAliases.map((alias) => alias.alias)]), MAX_SEARCH_ALIASES);
    const siblingLabels = limitStrings(dedupeStrings(input.siblingLabels), MAX_SIBLING_LABELS);
    const sections = [input.label];
    if (aliasLabels.length > 0) {
        sections.push(`aliases: ${aliasLabels.join('; ')}`);
    }
    if (input.hierarchy.parentNode) {
        sections.push(`parent: ${input.hierarchy.parentNode.canonical_label}`);
    }
    if (input.hierarchy.familyNode) {
        sections.push(`family: ${input.hierarchy.familyNode.canonical_label}`);
    }
    if (input.hierarchy.groupNode) {
        sections.push(`group: ${input.hierarchy.groupNode.canonical_label}`);
    }
    if (siblingLabels.length > 0) {
        sections.push(`related occupations: ${siblingLabels.join('; ')}`);
    }
    if (input.capabilitySummary.essentialLabels.length > 0) {
        sections.push(`core capabilities: ${input.capabilitySummary.essentialLabels.join('; ')}`);
    }
    if (input.capabilitySummary.optionalLabels.length > 0) {
        sections.push(`optional capabilities: ${input.capabilitySummary.optionalLabels.join('; ')}`);
    }
    if (input.description?.trim()) {
        sections.push(`description: ${sanitizeSentence(input.description)}`);
    }
    return clipText(sections.join('. '), 6000);
}
function buildDenseText(input) {
    const englishAliases = limitStrings(dedupeStrings(input.englishAliases.map((alias) => alias.alias)), MAX_DENSE_ALIASES);
    const localeAliases = limitStrings(dedupeStrings(input.localeAliases.map((alias) => alias.alias)), MAX_DENSE_ALIASES);
    const siblingLabels = limitStrings(dedupeStrings(input.siblingLabels), 4);
    const sections = [`${input.label} occupation.`];
    if (input.description?.trim()) {
        sections.push(`${sanitizeSentence(input.description)}.`);
    }
    const hierarchyParts = [
        input.hierarchy.parentNode ? `parent ${input.hierarchy.parentNode.canonical_label}` : null,
        input.hierarchy.familyNode ? `family ${input.hierarchy.familyNode.canonical_label}` : null,
        input.hierarchy.groupNode ? `group ${input.hierarchy.groupNode.canonical_label}` : null
    ].filter((value) => Boolean(value));
    if (hierarchyParts.length > 0) {
        sections.push(`Hierarchy: ${hierarchyParts.join(', ')}.`);
    }
    if (englishAliases.length > 0) {
        sections.push(`English backbone aliases: ${englishAliases.join('; ')}.`);
    }
    if (localeAliases.length > 0) {
        sections.push(`Locale aliases: ${localeAliases.join('; ')}.`);
    }
    if (siblingLabels.length > 0) {
        sections.push(`Same-parent occupations include ${siblingLabels.join('; ')}.`);
    }
    if (input.capabilitySummary.essentialLabels.length > 0) {
        sections.push(`Essential capabilities: ${input.capabilitySummary.essentialLabels.join('; ')}.`);
    }
    if (input.capabilitySummary.optionalLabels.length > 0) {
        sections.push(`Optional capabilities: ${input.capabilitySummary.optionalLabels.join('; ')}.`);
    }
    return clipText(sections.join(' '), 2500);
}
function sanitizeSentence(value) {
    return value
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/[.\s]+$/u, '');
}
function assertSafeResetOptions(options) {
    if (options.skipReset) {
        return;
    }
    const locales = normalizeLocales(options.locales);
    if (locales.length === 0) {
        return;
    }
    throw new Error([
        'Refusing to reset occupation search meta while rebuilding only selected locales.',
        'Search meta is stored per graph node, so a reset followed by --locales=en would drop other locale aliases from searchable meta.',
        'Run without --locales to rebuild all active locales, or pass --skip-reset for a diagnostic/append-only partial-locale build.'
    ].join(' '));
}
function dedupeStrings(values) {
    const seen = new Set();
    const deduped = [];
    for (const value of values) {
        const trimmed = value.trim();
        if (!trimmed) {
            continue;
        }
        const key = normalizeText(trimmed);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        deduped.push(trimmed);
    }
    return deduped;
}
function limitStrings(values, limit) {
    return values.slice(0, limit);
}
function normalizeText(value) {
    return normalizeSearchText(value);
}
function looksLikeStubLabel(label) {
    const trimmed = label?.trim();
    if (!trimmed) {
        return true;
    }
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
}
function roundToFour(value) {
    return Number.parseFloat(value.toFixed(4));
}
function clipText(value, maxLength) {
    const trimmed = value.trim();
    if (trimmed.length <= maxLength) {
        return trimmed;
    }
    return `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}
function toNullableNumber(value) {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
}
function toChunks(items, chunkSize) {
    const chunks = [];
    for (let index = 0; index < items.length; index += chunkSize) {
        chunks.push(items.slice(index, index + chunkSize));
    }
    return chunks;
}
function groupBy(items, keyFn) {
    const grouped = new Map();
    for (const item of items) {
        const key = keyFn(item);
        const rows = grouped.get(key) ?? [];
        rows.push(item);
        grouped.set(key, rows);
    }
    return grouped;
}
function flatMap(items, mapFn) {
    return items.flatMap(mapFn);
}
