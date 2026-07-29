import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { resetOccupationSearchMeta } from './reset-occupation-search-meta.js';
import {
  taxonomyFamilyOverrideForSubFamily,
  taxonomySubFamilyOverrideForLeaf
} from '../../runtime/occupation-taxonomy-family-overrides.js';
import { normalizeSearchText } from '../../utils/texts.js';

const DEFAULT_ESCO_SOURCE_NAME = 'esco_1_2_1';
const INSERT_CHUNK_SIZE = 500;
const MAX_SEARCH_ALIASES = 18;
const MAX_DENSE_ALIASES = 8;
const MAX_SIBLING_LABELS = 6;
const MAX_ESSENTIAL_HINTS = 10;
const MAX_OPTIONAL_HINTS = 8;

type SearchMetaRisk = 'low' | 'medium' | 'high';
type AliasRole = 'locale_primary' | 'locale_supporting' | 'english_backbone' | 'reviewed_crosswalk' | 'family_supporting';
type AncestorRole = 'parent' | 'family' | 'group' | 'broader';
type SiblingKind = 'same_family' | 'same_group' | 'related';
type CapabilityHintKind = 'essential' | 'optional' | 'knowledge' | 'tool' | 'software';

export type BuildOccupationSearchMetaOptions = {
  sourceName?: string;
  locales?: string[];
  skipReset?: boolean;
};

type LocaleRow = RowDataPacket & {
  locale_code: string;
};

type OccupationNodeRow = RowDataPacket & {
  id: number;
  canonical_label: string;
  normalized_label: string;
  description: string | null;
};

type GraphNodeRow = RowDataPacket & {
  id: number;
  canonical_label: string;
  normalized_label: string;
  description: string | null;
  node_level: 'group' | 'family' | 'occupation';
};

type GraphAliasRow = RowDataPacket & {
  graph_node_id: number;
  locale_code: string;
  alias: string;
  normalized_alias: string;
  alias_class: string;
  confidence: string | number | null;
  is_primary: number;
  is_active: number;
  is_generic_head_only: number;
  needs_review: number;
};

type GraphRelationshipRow = RowDataPacket & {
  parent_node_id: number;
  child_node_id: number;
  confidence: string | number | null;
};

type CapabilityLinkRow = RowDataPacket & {
  graph_node_id: number;
  capability_id: number;
  relationship_type: string;
  confidence: string | number | null;
  capability_type: 'skill' | 'knowledge' | 'tool' | 'software' | 'language';
  locale_code: string;
  label: string;
  normalized_label: string;
};

type SearchMetaRecord = {
  graphNodeId: number;
  familyNodeId: number | null;
  groupNodeId: number | null;
  parentNodeId: number | null;
  leafDepth: number | null;
  genericRisk: SearchMetaRisk;
  exactAliasCount: number;
  activeAliasCount: number;
  localeCoverageCount: number;
  hasHierarchy: boolean;
  hasCapabilitySupport: boolean;
  englishBackboneStrength: number | null;
  searchText: string;
  denseText: string;
  metadataJson: string;
  qualityFlagsJson: string;
};

type SearchMetaAliasRecord = {
  graphNodeId: number;
  localeCode: string;
  alias: string;
  normalizedAlias: string;
  aliasRole: AliasRole;
  weight: number;
};

type SearchMetaAncestorRecord = {
  graphNodeId: number;
  ancestorNodeId: number;
  distanceFromLeaf: number;
  ancestorRole: AncestorRole;
};

type SearchMetaSiblingRecord = {
  graphNodeId: number;
  siblingNodeId: number;
  siblingKind: SiblingKind;
  weight: number;
};

type SearchMetaCapabilityHintRecord = {
  graphNodeId: number;
  capabilityId: number;
  hintKind: CapabilityHintKind;
  weight: number;
};

type CapabilitySummary = {
  records: SearchMetaCapabilityHintRecord[];
  essentialLabels: string[];
  optionalLabels: string[];
  usefulCount: number;
  stubFilteredCount: number;
};

type HierarchySummary = {
  lineage: GraphNodeRow[];
  parentNode: GraphNodeRow | null;
  familyNode: GraphNodeRow | null;
  groupNode: GraphNodeRow | null;
  ancestorRecords: SearchMetaAncestorRecord[];
};

type MetaArtifacts = {
  meta: SearchMetaRecord;
  aliases: SearchMetaAliasRecord[];
  ancestors: SearchMetaAncestorRecord[];
  siblings: SearchMetaSiblingRecord[];
  capabilityHints: SearchMetaCapabilityHintRecord[];
};

type SyntheticAlias = {
  graph_node_id: number;
  locale_code: string;
  alias: string;
  normalized_alias: string;
  alias_class: string;
  confidence: number;
  is_primary: number;
  is_active: number;
  is_generic_head_only: number;
  needs_review: number;
};

export class OccupationSearchMetaBuilder {
  public constructor(private readonly connection: Connection) {}

  public async run(options: BuildOccupationSearchMetaOptions = {}): Promise<void> {
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
    const artifacts = occupations.map((occupation) =>
      this.buildArtifactsForOccupation(
        sourceName,
        occupation,
        locales,
        nodeById,
        parentByChild,
        childrenByParent,
        aliasesByNodeId.get(occupation.id) ?? [],
        aliasesByNodeId,
        capabilitiesByNodeId.get(occupation.id) ?? []
      )
    );

    await this.connection.beginTransaction();

    try {
      if (!options.skipReset) {
        await resetOccupationSearchMeta(this.connection, sourceName);
      }

      const searchMetaIdByNodeId = await this.insertSearchMetaRecords(artifacts.map((artifact) => artifact.meta));
      await this.insertSearchMetaAliases(
        flatMap(artifacts, (artifact) => artifact.aliases),
        searchMetaIdByNodeId
      );
      await this.insertSearchMetaAncestors(
        flatMap(artifacts, (artifact) => artifact.ancestors),
        searchMetaIdByNodeId
      );
      await this.insertSearchMetaSiblings(
        flatMap(artifacts, (artifact) => artifact.siblings),
        searchMetaIdByNodeId
      );
      await this.insertSearchMetaCapabilityHints(
        flatMap(artifacts, (artifact) => artifact.capabilityHints),
        searchMetaIdByNodeId
      );

      await this.connection.commit();
    } catch (error) {
      await this.connection.rollback();
      throw error;
    }
  }

  private async resolveLocales(sourceName: string, locales: string[] | undefined): Promise<string[]> {
    const requestedLocales = normalizeLocales(locales);

    if (requestedLocales.length > 0) {
      return requestedLocales;
    }

    const [rows] = await this.connection.query<LocaleRow[]>(
      `
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
      `,
      [sourceName]
    );

    const resolvedLocales = rows.map((row) => row.locale_code).filter(Boolean);

    if (resolvedLocales.length === 0) {
      throw new Error(`No active graph alias locales found for source_name="${sourceName}".`);
    }

    return resolvedLocales;
  }

  private async loadActiveLeafOccupations(sourceName: string): Promise<OccupationNodeRow[]> {
    const [rows] = await this.connection.query<OccupationNodeRow[]>(
      `
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
      `,
      [sourceName]
    );

    return rows;
  }

  private async loadSourceNodes(sourceName: string): Promise<GraphNodeRow[]> {
    const [rows] = await this.connection.query<GraphNodeRow[]>(
      `
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
      `,
      [sourceName]
    );

    return rows;
  }

  private async loadRelationships(sourceName: string): Promise<GraphRelationshipRow[]> {
    const [rows] = await this.connection.query<GraphRelationshipRow[]>(
      `
        SELECT
          parent_node_id,
          child_node_id,
          confidence
        FROM ose_graph_relationships
        WHERE relationship_type = 'broader'
          AND is_active = 1
          AND source_name = ?
        ORDER BY child_node_id, parent_node_id
      `,
      [sourceName]
    );

    return rows;
  }

  private async loadAliases(sourceName: string, locales: string[]): Promise<GraphAliasRow[]> {
    const localeFilter = buildLocaleFilter('locale_code', locales);
    const [rows] = await this.connection.query<GraphAliasRow[]>(
      `
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
      `,
      [sourceName, ...localeFilter.params]
    );

    return rows;
  }

  private async loadCapabilities(sourceName: string, locales: string[]): Promise<CapabilityLinkRow[]> {
    const localeFilter = buildLocaleFilter('cap.locale_code', locales);
    const [rows] = await this.connection.query<CapabilityLinkRow[]>(
      `
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
      `,
      [sourceName, ...localeFilter.params]
    );

    return rows;
  }

  private buildArtifactsForOccupation(
    sourceName: string,
    occupation: OccupationNodeRow,
    locales: string[],
    nodeById: Map<number, GraphNodeRow>,
    parentByChild: Map<number, GraphRelationshipRow>,
    childrenByParent: Map<number, number[]>,
    aliasRows: GraphAliasRow[],
    aliasesByNodeId: Map<number, GraphAliasRow[]>,
    capabilityRows: CapabilityLinkRow[]
  ): MetaArtifacts {
    const hierarchy = applyReviewedTaxonomyFamilyOverrideToHierarchy(
      sourceName,
      occupation.id,
      buildHierarchySummary(occupation.id, nodeById, parentByChild),
      nodeById,
      parentByChild
    );
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
      .filter((value): value is string => Boolean(value));

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

  private async insertSearchMetaRecords(records: SearchMetaRecord[]): Promise<Map<number, number>> {
    const searchMetaIdByNodeId = new Map<number, number>();

    for (const record of records) {
      const [result] = await this.connection.execute<ResultSetHeader>(
        `
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
        `,
        [
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
        ]
      );

      searchMetaIdByNodeId.set(record.graphNodeId, result.insertId);
    }

    return searchMetaIdByNodeId;
  }

  private async insertSearchMetaAliases(records: SearchMetaAliasRecord[], searchMetaIdByNodeId: Map<number, number>): Promise<void> {
    const insertable = records
      .map((record) => {
        const searchMetaId = searchMetaIdByNodeId.get(record.graphNodeId);
        return searchMetaId ? { ...record, searchMetaId } : null;
      })
      .filter((record): record is SearchMetaAliasRecord & { searchMetaId: number } => Boolean(record));

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

      await this.connection.execute(
        `
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
        `,
        params
      );
    }
  }

  private async insertSearchMetaAncestors(records: SearchMetaAncestorRecord[], searchMetaIdByNodeId: Map<number, number>): Promise<void> {
    const insertable = records
      .map((record) => {
        const searchMetaId = searchMetaIdByNodeId.get(record.graphNodeId);
        return searchMetaId ? { ...record, searchMetaId } : null;
      })
      .filter((record): record is SearchMetaAncestorRecord & { searchMetaId: number } => Boolean(record));

    for (const chunk of toChunks(insertable, INSERT_CHUNK_SIZE)) {
      const placeholders = chunk.map(() => '(?, ?, ?, ?)').join(', ');
      const params = chunk.flatMap((record) => [record.searchMetaId, record.ancestorNodeId, record.distanceFromLeaf, record.ancestorRole]);

      await this.connection.execute(
        `
          INSERT INTO ose_search_meta_ancestors
            (
              search_meta_id,
              ancestor_node_id,
              distance_from_leaf,
              ancestor_role
            )
          VALUES ${placeholders}
        `,
        params
      );
    }
  }

  private async insertSearchMetaSiblings(records: SearchMetaSiblingRecord[], searchMetaIdByNodeId: Map<number, number>): Promise<void> {
    const insertable = records
      .map((record) => {
        const searchMetaId = searchMetaIdByNodeId.get(record.graphNodeId);
        return searchMetaId ? { ...record, searchMetaId } : null;
      })
      .filter((record): record is SearchMetaSiblingRecord & { searchMetaId: number } => Boolean(record));

    for (const chunk of toChunks(insertable, INSERT_CHUNK_SIZE)) {
      const placeholders = chunk.map(() => '(?, ?, ?, ?)').join(', ');
      const params = chunk.flatMap((record) => [record.searchMetaId, record.siblingNodeId, record.siblingKind, record.weight]);

      await this.connection.execute(
        `
          INSERT INTO ose_search_meta_siblings
            (
              search_meta_id,
              sibling_node_id,
              sibling_kind,
              weight
            )
          VALUES ${placeholders}
        `,
        params
      );
    }
  }

  private async insertSearchMetaCapabilityHints(
    records: SearchMetaCapabilityHintRecord[],
    searchMetaIdByNodeId: Map<number, number>
  ): Promise<void> {
    const insertable = records
      .map((record) => {
        const searchMetaId = searchMetaIdByNodeId.get(record.graphNodeId);
        return searchMetaId ? { ...record, searchMetaId } : null;
      })
      .filter((record): record is SearchMetaCapabilityHintRecord & { searchMetaId: number } => Boolean(record));

    for (const chunk of toChunks(insertable, INSERT_CHUNK_SIZE)) {
      const placeholders = chunk.map(() => '(?, ?, ?, ?)').join(', ');
      const params = chunk.flatMap((record) => [record.searchMetaId, record.capabilityId, record.hintKind, record.weight]);

      await this.connection.execute(
        `
          INSERT INTO ose_search_meta_capability_hints
            (
              search_meta_id,
              capability_id,
              hint_kind,
              weight
            )
          VALUES ${placeholders}
        `,
        params
      );
    }
  }
}

function normalizeSourceName(sourceName: string | undefined): string {
  const trimmed = sourceName?.trim();
  return trimmed || DEFAULT_ESCO_SOURCE_NAME;
}

function normalizeLocales(locales: string[] | undefined): string[] {
  return Array.from(new Set((locales ?? []).map((locale) => locale.trim()).filter(Boolean)));
}

function buildLocaleFilter(columnName: string, locales: string[]): { sql: string; params: string[] } {
  if (locales.length === 0) {
    return { sql: '', params: [] };
  }

  const placeholders = locales.map(() => '?').join(', ');

  return {
    sql: `AND ${columnName} IN (${placeholders})`,
    params: locales
  };
}

function buildParentByChildMap(relationships: GraphRelationshipRow[]): Map<number, GraphRelationshipRow> {
  const parentByChild = new Map<number, GraphRelationshipRow>();

  for (const relationship of relationships) {
    const existing = parentByChild.get(relationship.child_node_id);

    if (!existing || compareRelationships(relationship, existing) < 0) {
      parentByChild.set(relationship.child_node_id, relationship);
    }
  }

  return parentByChild;
}

function buildChildrenByParentMap(relationships: GraphRelationshipRow[], nodeById: Map<number, GraphNodeRow>): Map<number, number[]> {
  const childrenByParent = new Map<number, number[]>();

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

function compareRelationships(left: GraphRelationshipRow, right: GraphRelationshipRow): number {
  const leftConfidence = toNullableNumber(left.confidence) ?? 0;
  const rightConfidence = toNullableNumber(right.confidence) ?? 0;

  if (leftConfidence !== rightConfidence) {
    return rightConfidence - leftConfidence;
  }

  return left.parent_node_id - right.parent_node_id;
}

function ensureAliasCoverage(occupation: OccupationNodeRow, aliases: GraphAliasRow[]): Array<GraphAliasRow | SyntheticAlias> {
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

function buildHierarchySummary(
  graphNodeId: number,
  nodeById: Map<number, GraphNodeRow>,
  parentByChild: Map<number, GraphRelationshipRow>
): HierarchySummary {
  const lineage: GraphNodeRow[] = [];
  const ancestorRecords: SearchMetaAncestorRecord[] = [];
  const seenNodeIds = new Set<number>([graphNodeId]);
  let familyNode: GraphNodeRow | null = null;
  let groupNode: GraphNodeRow | null = null;
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

    const roles: AncestorRole[] = [];

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

function applyReviewedTaxonomyFamilyOverrideToHierarchy(
  sourceName: string,
  graphNodeId: number,
  hierarchy: HierarchySummary,
  nodeById: Map<number, GraphNodeRow>,
  parentByChild: Map<number, GraphRelationshipRow>
): HierarchySummary {
  const leafOverride = taxonomySubFamilyOverrideForLeaf(sourceName, graphNodeId);
  const hierarchyWithLeafOverride = leafOverride
    ? applyReviewedLeafSubFamilyOverrideToHierarchy(graphNodeId, hierarchy, leafOverride.targetSubFamilyNodeId, nodeById, parentByChild)
    : hierarchy;
  const familyOverride = taxonomyFamilyOverrideForSubFamily(sourceName, hierarchyWithLeafOverride.groupNode?.id ?? null);

  if (!familyOverride || hierarchyWithLeafOverride.familyNode?.id === familyOverride.targetFamilyNodeId) {
    return hierarchyWithLeafOverride;
  }

  const targetFamilyNode =
    nodeById.get(familyOverride.targetFamilyNodeId) ??
    ({
      id: familyOverride.targetFamilyNodeId,
      canonical_label: familyOverride.targetFamilyLabel,
      normalized_label: normalizeSearchText(familyOverride.targetFamilyLabel),
      description: null,
      node_level: 'family'
    } as GraphNodeRow);
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

function applyReviewedLeafSubFamilyOverrideToHierarchy(
  graphNodeId: number,
  hierarchy: HierarchySummary,
  targetSubFamilyNodeId: number,
  nodeById: Map<number, GraphNodeRow>,
  parentByChild: Map<number, GraphRelationshipRow>
): HierarchySummary {
  const targetSubFamilyNode = nodeById.get(targetSubFamilyNodeId);

  if (!targetSubFamilyNode) {
    return hierarchy;
  }

  const targetSubFamilyHierarchy = buildHierarchySummary(targetSubFamilyNodeId, nodeById, parentByChild);
  const lineage = [targetSubFamilyNode, ...targetSubFamilyHierarchy.lineage];
  const parentRecord: SearchMetaAncestorRecord = {
    graphNodeId,
    ancestorNodeId: targetSubFamilyNode.id,
    distanceFromLeaf: 1,
    ancestorRole: 'parent'
  };
  const groupRecord: SearchMetaAncestorRecord = {
    graphNodeId,
    ancestorNodeId: targetSubFamilyNode.id,
    distanceFromLeaf: 1,
    ancestorRole: 'group'
  };
  const ancestorRecords: SearchMetaAncestorRecord[] = [
    parentRecord,
    groupRecord,
    ...targetSubFamilyHierarchy.ancestorRecords.map(
      (record): SearchMetaAncestorRecord => ({
        graphNodeId,
        ancestorNodeId: record.ancestorNodeId,
        distanceFromLeaf: record.distanceFromLeaf + 1,
        ancestorRole: record.ancestorRole
      })
    )
  ].sort(compareAncestorRecords);

  return {
    lineage,
    parentNode: targetSubFamilyNode,
    familyNode: targetSubFamilyHierarchy.familyNode,
    groupNode: targetSubFamilyNode,
    ancestorRecords
  };
}

function familyAncestorDistance(hierarchy: HierarchySummary): number {
  const existingFamilyRecord = hierarchy.ancestorRecords.find((record) => record.ancestorRole === 'family');
  return existingFamilyRecord?.distanceFromLeaf ?? (hierarchy.parentNode ? 2 : 1);
}

function compareAncestorRecords(left: SearchMetaAncestorRecord, right: SearchMetaAncestorRecord): number {
  return (
    left.distanceFromLeaf - right.distanceFromLeaf ||
    ancestorRoleRank(left.ancestorRole) - ancestorRoleRank(right.ancestorRole) ||
    left.ancestorNodeId - right.ancestorNodeId
  );
}

function ancestorRoleRank(role: AncestorRole): number {
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

function selectLocaleAliasRows(aliases: Array<GraphAliasRow | SyntheticAlias>, locales: string[]): Array<GraphAliasRow | SyntheticAlias> {
  const localeSet = new Set(locales);
  return dedupeAliases(
    aliases.filter(
      (alias) =>
        alias.is_active === 1 && alias.is_generic_head_only !== 1 && localeSet.has(alias.locale_code) && !looksLikeStubLabel(alias.alias)
    )
  );
}

function selectEnglishBackboneRows(aliases: Array<GraphAliasRow | SyntheticAlias>): Array<GraphAliasRow | SyntheticAlias> {
  return dedupeAliases(
    aliases.filter(
      (alias) => alias.is_active === 1 && alias.is_generic_head_only !== 1 && alias.locale_code === 'en' && !looksLikeStubLabel(alias.alias)
    )
  );
}

function selectPropagatedFamilyAliasRows(hierarchy: HierarchySummary, aliasesByNodeId: Map<number, GraphAliasRow[]>): GraphAliasRow[] {
  if (!hierarchy.familyNode) {
    return [];
  }

  return dedupeAliases(
    (aliasesByNodeId.get(hierarchy.familyNode.id) ?? []).filter(
      (alias) => alias.is_active === 1 && alias.needs_review === 1 && alias.is_generic_head_only !== 1 && !looksLikeStubLabel(alias.alias)
    )
  ) as GraphAliasRow[];
}

function selectFamilySupportingAliasRows(
  aliases: Array<GraphAliasRow | SyntheticAlias>,
  locales: string[]
): Array<GraphAliasRow | SyntheticAlias> {
  const localeSet = new Set([...locales, 'en']);

  return dedupeAliases(
    aliases.filter(
      (alias) =>
        alias.is_active === 1 &&
        alias.needs_review === 1 &&
        alias.is_generic_head_only !== 1 &&
        localeSet.has(alias.locale_code) &&
        !looksLikeStubLabel(alias.alias)
    )
  );
}

function dedupeAliases(aliases: Array<GraphAliasRow | SyntheticAlias>): Array<GraphAliasRow | SyntheticAlias> {
  const bestByKey = new Map<string, GraphAliasRow | SyntheticAlias>();

  for (const alias of aliases) {
    const dedupeKey = `${alias.locale_code}\u0000${alias.normalized_alias}`;
    const existing = bestByKey.get(dedupeKey);

    if (!existing || compareAliasRows(alias, existing) < 0) {
      bestByKey.set(dedupeKey, alias);
    }
  }

  return Array.from(bestByKey.values()).sort(compareAliasRows);
}

function compareAliasRows(left: GraphAliasRow | SyntheticAlias, right: GraphAliasRow | SyntheticAlias): number {
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

function buildCapabilitySummary(graphNodeId: number, rows: CapabilityLinkRow[]): CapabilitySummary {
  const usefulRows = rows.filter((row) => !looksLikeStubLabel(row.label));
  const stubFilteredCount = rows.length - usefulRows.length;
  const essentialRows = dedupeCapabilityRows(
    usefulRows.filter((row) => normalizeCapabilityHintKind(row.relationship_type) === 'essential')
  );
  const essentialLabelSet = new Set(essentialRows.map((row) => row.normalized_label || normalizeText(row.label)));
  const optionalRows = dedupeCapabilityRows(
    usefulRows.filter(
      (row) =>
        normalizeCapabilityHintKind(row.relationship_type) === 'optional' &&
        !essentialLabelSet.has(row.normalized_label || normalizeText(row.label))
    )
  );

  const recordsByKey = new Map<string, SearchMetaCapabilityHintRecord>();

  for (const row of essentialRows) {
    const record: SearchMetaCapabilityHintRecord = {
      graphNodeId,
      capabilityId: row.capability_id,
      hintKind: 'essential',
      weight: roundToFour(Math.max(toNullableNumber(row.confidence) ?? 0.85, 0.85))
    };
    recordsByKey.set(`${record.capabilityId}\u0000${record.hintKind}`, record);
  }

  for (const row of optionalRows) {
    const record: SearchMetaCapabilityHintRecord = {
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

    const record: SearchMetaCapabilityHintRecord = {
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

function dedupeCapabilityRows(rows: CapabilityLinkRow[]): CapabilityLinkRow[] {
  const bestByLabel = new Map<string, CapabilityLinkRow>();

  for (const row of rows) {
    const dedupeKey = row.normalized_label || normalizeText(row.label);
    const existing = bestByLabel.get(dedupeKey);

    if (!existing || compareCapabilityRows(row, existing) < 0) {
      bestByLabel.set(dedupeKey, row);
    }
  }

  return Array.from(bestByLabel.values()).sort(compareCapabilityRows);
}

function compareCapabilityRows(left: CapabilityLinkRow, right: CapabilityLinkRow): number {
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

function normalizeCapabilityHintKind(value: string): 'essential' | 'optional' {
  return value === 'essential' ? 'essential' : 'optional';
}

function normalizeCapabilityTypeHint(capabilityType: CapabilityLinkRow['capability_type']): 'knowledge' | 'tool' | 'software' | null {
  if (capabilityType === 'knowledge' || capabilityType === 'tool' || capabilityType === 'software') {
    return capabilityType;
  }

  return null;
}

function buildSiblingRecords(
  graphNodeId: number,
  parentNode: GraphNodeRow | null,
  nodeById: Map<number, GraphNodeRow>,
  childrenByParent: Map<number, number[]>
): SearchMetaSiblingRecord[] {
  if (!parentNode) {
    return [];
  }

  const childNodeIds = childrenByParent.get(parentNode.id) ?? [];
  const siblingKind: SiblingKind = parentNode.node_level === 'group' ? 'same_group' : 'same_family';

  return childNodeIds
    .filter((childNodeId) => childNodeId !== graphNodeId)
    .map((childNodeId) => nodeById.get(childNodeId))
    .filter((node): node is GraphNodeRow => Boolean(node && node.node_level === 'occupation'))
    .sort((left, right) => left.canonical_label.localeCompare(right.canonical_label))
    .map((node, index) => ({
      graphNodeId,
      siblingNodeId: node.id,
      siblingKind,
      weight: roundToFour(Math.max(1 - index * 0.02, 0.5))
    }));
}

function buildSearchMetaAliasRecords(
  graphNodeId: number,
  localeAliasRows: Array<GraphAliasRow | SyntheticAlias>,
  englishAliasRows: Array<GraphAliasRow | SyntheticAlias>,
  familySupportingAliasRows: Array<GraphAliasRow | SyntheticAlias>,
  locales: string[]
): SearchMetaAliasRecord[] {
  const localeSet = new Set(locales);
  const recordsByKey = new Map<string, SearchMetaAliasRecord>();

  for (const aliasRow of localeAliasRows) {
    if (!localeSet.has(aliasRow.locale_code)) {
      continue;
    }

    const aliasRole: AliasRole =
      aliasRow.needs_review === 1 ? 'reviewed_crosswalk' : aliasRow.is_primary === 1 ? 'locale_primary' : 'locale_supporting';
    const normalizedAlias = normalizeText(aliasRow.alias);
    const record: SearchMetaAliasRecord = {
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
    const aliasRole: AliasRole = aliasRow.needs_review === 1 ? 'reviewed_crosswalk' : 'english_backbone';
    const normalizedAlias = normalizeText(aliasRow.alias);
    const record: SearchMetaAliasRecord = {
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
    const record: SearchMetaAliasRecord = {
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

function computeAliasWeight(aliasRow: GraphAliasRow | SyntheticAlias, aliasRole: AliasRole): number {
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

function countDistinctAliases(aliases: Array<GraphAliasRow | SyntheticAlias>): number {
  return new Set(aliases.filter((alias) => alias.is_active === 1).map((alias) => `${alias.locale_code}\u0000${alias.normalized_alias}`))
    .size;
}

function countDistinctLocales(aliases: Array<GraphAliasRow | SyntheticAlias>): number {
  return new Set(aliases.map((alias) => alias.locale_code)).size;
}

function computeEnglishBackboneStrength(aliases: Array<GraphAliasRow | SyntheticAlias>): number | null {
  if (aliases.length === 0) {
    return null;
  }

  const primaryCount = aliases.filter((alias) => alias.is_primary === 1).length;
  const supportingCount = aliases.length - primaryCount;
  const score = Math.min(1, primaryCount * 0.55 + Math.min(supportingCount, 6) * 0.08 + 0.15);
  return roundToFour(score);
}

function computeGenericRisk(
  canonicalLabel: string,
  aliases: Array<GraphAliasRow | SyntheticAlias>,
  englishBackboneStrength: number | null
): SearchMetaRisk {
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

function buildMetadataJson(
  locales: string[],
  hierarchy: HierarchySummary,
  aliases: Array<GraphAliasRow | SyntheticAlias>,
  capabilitySummary: CapabilitySummary,
  siblingCount: number
): Record<string, unknown> {
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

function buildQualityFlags(
  locales: string[],
  hierarchy: HierarchySummary,
  localeCoverageCount: number,
  englishAliasRows: Array<GraphAliasRow | SyntheticAlias>,
  capabilitySummary: CapabilitySummary,
  genericRisk: SearchMetaRisk
): string[] {
  const flags: string[] = [];

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

function buildSearchText(input: {
  label: string;
  description: string | null;
  localeAliases: Array<GraphAliasRow | SyntheticAlias>;
  englishAliases: Array<GraphAliasRow | SyntheticAlias>;
  hierarchy: HierarchySummary;
  siblingLabels: string[];
  capabilitySummary: CapabilitySummary;
}): string {
  const aliasLabels = limitStrings(
    dedupeStrings([...input.localeAliases.map((alias) => alias.alias), ...input.englishAliases.map((alias) => alias.alias)]),
    MAX_SEARCH_ALIASES
  );
  const siblingLabels = limitStrings(dedupeStrings(input.siblingLabels), MAX_SIBLING_LABELS);
  const sections: string[] = [input.label];

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

function buildDenseText(input: {
  label: string;
  description: string | null;
  localeAliases: Array<GraphAliasRow | SyntheticAlias>;
  englishAliases: Array<GraphAliasRow | SyntheticAlias>;
  hierarchy: HierarchySummary;
  siblingLabels: string[];
  capabilitySummary: CapabilitySummary;
}): string {
  const englishAliases = limitStrings(dedupeStrings(input.englishAliases.map((alias) => alias.alias)), MAX_DENSE_ALIASES);
  const localeAliases = limitStrings(dedupeStrings(input.localeAliases.map((alias) => alias.alias)), MAX_DENSE_ALIASES);
  const siblingLabels = limitStrings(dedupeStrings(input.siblingLabels), 4);
  const sections: string[] = [`${input.label} occupation.`];

  if (input.description?.trim()) {
    sections.push(`${sanitizeSentence(input.description)}.`);
  }

  const hierarchyParts = [
    input.hierarchy.parentNode ? `parent ${input.hierarchy.parentNode.canonical_label}` : null,
    input.hierarchy.familyNode ? `family ${input.hierarchy.familyNode.canonical_label}` : null,
    input.hierarchy.groupNode ? `group ${input.hierarchy.groupNode.canonical_label}` : null
  ].filter((value): value is string => Boolean(value));

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

function sanitizeSentence(value: string): string {
  return value
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.\s]+$/u, '');
}

function assertSafeResetOptions(options: BuildOccupationSearchMetaOptions): void {
  if (options.skipReset) {
    return;
  }

  const locales = normalizeLocales(options.locales);

  if (locales.length === 0) {
    return;
  }

  throw new Error(
    [
      'Refusing to reset occupation search meta while rebuilding only selected locales.',
      'Search meta is stored per graph node, so a reset followed by --locales=en would drop other locale aliases from searchable meta.',
      'Run without --locales to rebuild all active locales, or pass --skip-reset for a diagnostic/append-only partial-locale build.'
    ].join(' ')
  );
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];

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

function limitStrings(values: string[], limit: number): string[] {
  return values.slice(0, limit);
}

function normalizeText(value: string): string {
  return normalizeSearchText(value);
}

function looksLikeStubLabel(label: string | null | undefined): boolean {
  const trimmed = label?.trim();

  if (!trimmed) {
    return true;
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
}

function roundToFour(value: number): number {
  return Number.parseFloat(value.toFixed(4));
}

function clipText(value: string, maxLength: number): string {
  const trimmed = value.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 3).trimEnd()}...`;
}

function toNullableNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toChunks<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function groupBy<T, TKey>(items: T[], keyFn: (item: T) => TKey): Map<TKey, T[]> {
  const grouped = new Map<TKey, T[]>();

  for (const item of items) {
    const key = keyFn(item);
    const rows = grouped.get(key) ?? [];
    rows.push(item);
    grouped.set(key, rows);
  }

  return grouped;
}

function flatMap<T, TValue>(items: T[], mapFn: (item: T) => TValue[]): TValue[] {
  return items.flatMap(mapFn);
}
