import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { resetGraphBucket } from '../reset-graph-bucket.js';
import { normalizeSearchText } from '../../utils/texts.js';

const DEFAULT_ESCO_SOURCE_NAME = 'esco_1_2_1';
const OCCUPATION_BUCKET = 'occupation';
const GRAPH_CREATED_BY = 'occupation_graph_builder';

export type BuildOccupationGraphOptions = {
  sourceName?: string;
  locales?: string[];
};

type SourceConceptRow = RowDataPacket & {
  id: number;
  source_kind: string;
  source_name: string;
  locale_code: string;
  external_uri: string;
  entity_kind: string;
  concept_type: string | null;
  preferred_label: string;
  normalized_label: string | null;
  description: string | null;
  definition_text: string | null;
};

type SourceAliasRow = RowDataPacket & {
  id: number;
  source_concept_id: number;
  locale_code: string;
  alias: string;
  normalized_alias: string | null;
  alias_type: string | null;
  is_preferred: number;
  source_name: string;
  external_uri: string;
};

type SourceRelationRow = RowDataPacket & {
  id: number;
  parent_external_uri: string;
  child_external_uri: string;
  parent_entity_kind: string | null;
  child_entity_kind: string | null;
  source_name: string;
  weight: string | number | null;
  confidence: string | number | null;
};

type LocaleRow = RowDataPacket & {
  locale_code: string;
};

type NodeRecord = {
  graphNodeId?: number;
  externalUri: string;
  sourceKind: string;
  sourceName: string;
  entityKind: 'occupation' | 'occupation_group';
  nodeLevel: 'occupation' | 'family' | 'group';
  canonicalKey: string;
  termType: string;
  canonicalLabel: string;
  normalizedLabel: string;
  slug: string;
  description: string | null;
  isLeaf: boolean;
  sourceConfidence: number;
};

type AliasCandidate = {
  graphNodeId: number;
  localeCode: string;
  alias: string;
  normalizedAlias: string;
  aliasType: string | null;
  aliasClass: 'preferred_label' | 'alt_label';
  sourceName: string;
  sourceRecordType: string;
  confidence: number;
  isPrimary: boolean;
  isActive: boolean;
  isGenericHeadOnly: boolean;
  needsReview: boolean;
  reviewNote: string | null;
};

type RelationshipCandidate = {
  parentNodeId: number;
  childNodeId: number;
  sourceName: string;
  sourceRelationId: number;
  weight: number | null;
  confidence: number | null;
};

export class OccupationGraphBuilder {
  public constructor(private readonly connection: Connection) {}

  public async run(options: BuildOccupationGraphOptions = {}): Promise<void> {
    const sourceName = normalizeSourceName(options.sourceName);
    const locales = await this.resolveLocales(sourceName, options.locales);
    const concepts = await this.loadSourceConcepts(sourceName, locales);

    if (concepts.length === 0) {
      throw new Error(`No occupation or occupation_group source concepts found for source_name="${sourceName}".`);
    }

    const nodes = buildNodeRecords(concepts);
    const nodeRecordByExternalUri = new Map(nodes.map((node) => [node.externalUri, node]));

    await this.connection.beginTransaction();

    try {
      await resetGraphBucket(this.connection, OCCUPATION_BUCKET);

      const nodeIdByExternalUri = await this.insertGraphNodes(nodes);
      await this.insertNodeSources(concepts, nodeIdByExternalUri);

      const aliases = await this.buildAliasCandidates(sourceName, locales, concepts, nodeIdByExternalUri, nodeRecordByExternalUri);
      await this.insertGraphAliases(aliases);

      const relationships = await this.buildRelationshipCandidates(sourceName, locales, nodeIdByExternalUri);
      await this.insertRelationships(relationships);

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
        FROM ose_source_concepts
        WHERE source_name = ?
          AND entity_kind IN ('occupation', 'occupation_group')
        ORDER BY locale_code
      `,
      [sourceName]
    );

    const resolvedLocales = rows.map((row) => row.locale_code);

    if (resolvedLocales.length === 0) {
      throw new Error(`No locales found in ose_source_concepts for source_name="${sourceName}".`);
    }

    return resolvedLocales;
  }

  private async loadSourceConcepts(sourceName: string, locales: string[]): Promise<SourceConceptRow[]> {
    const localeFilter = buildLocaleFilter('locale_code', locales);
    const [rows] = await this.connection.query<SourceConceptRow[]>(
      `
        SELECT
          id,
          source_kind,
          source_name,
          locale_code,
          external_uri,
          entity_kind,
          concept_type,
          preferred_label,
          normalized_label,
          description,
          definition_text
        FROM ose_source_concepts
        WHERE source_name = ?
          AND entity_kind IN ('occupation', 'occupation_group')
          ${localeFilter.sql}
        ORDER BY external_uri, locale_code, id
      `,
      [sourceName, ...localeFilter.params]
    );

    return rows;
  }

  private async insertGraphNodes(nodes: NodeRecord[]): Promise<Map<string, number>> {
    const nodeIdByExternalUri = new Map<string, number>();

    for (const node of nodes) {
      const [result] = await this.connection.execute<ResultSetHeader>(
        `
          INSERT INTO ose_graph_nodes
            (
              canonical_key,
              node_level,
              bucket,
              term_type,
              canonical_label,
              normalized_label,
              slug,
              description,
              status,
              is_searchable,
              is_leaf,
              source_confidence,
              created_by
            )
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, ?, ?, ?)
        `,
        [
          node.canonicalKey,
          node.nodeLevel,
          OCCUPATION_BUCKET,
          node.termType,
          node.canonicalLabel,
          node.normalizedLabel,
          node.slug,
          node.description,
          node.isLeaf ? 1 : 0,
          node.sourceConfidence,
          GRAPH_CREATED_BY
        ]
      );

      nodeIdByExternalUri.set(node.externalUri, result.insertId);
    }

    return nodeIdByExternalUri;
  }

  private async insertNodeSources(concepts: SourceConceptRow[], nodeIdByExternalUri: Map<string, number>): Promise<void> {
    const inserted = new Set<string>();

    for (const concept of concepts) {
      const graphNodeId = nodeIdByExternalUri.get(concept.external_uri);

      if (!graphNodeId) {
        continue;
      }

      const dedupeKey = `${graphNodeId}:${concept.id}`;

      if (inserted.has(dedupeKey)) {
        continue;
      }

      inserted.add(dedupeKey);

      await this.connection.execute(
        `
          INSERT INTO ose_graph_node_sources
            (
              graph_node_id,
              source_concept_id,
              source_name,
              source_kind,
              source_locale,
              external_uri,
              mapping_type,
              confidence,
              notes
            )
          VALUES
            (?, ?, ?, ?, ?, ?, 'source_concept', ?, ?)
        `,
        [
          graphNodeId,
          concept.id,
          concept.source_name,
          concept.source_kind,
          concept.locale_code,
          concept.external_uri,
          looksLikeStubLabel(concept.preferred_label) ? 0.6 : 1,
          buildNodeSourceNote(concept)
        ]
      );
    }
  }

  private async buildAliasCandidates(
    sourceName: string,
    locales: string[],
    concepts: SourceConceptRow[],
    nodeIdByExternalUri: Map<string, number>,
    nodeRecordByExternalUri: Map<string, NodeRecord>
  ): Promise<AliasCandidate[]> {
    const conceptById = new Map<number, SourceConceptRow>();
    const aliasCollisionMap = new Map<string, Set<number>>();

    for (const concept of concepts) {
      conceptById.set(concept.id, concept);
    }

    const aliases = await this.loadSourceAliases(sourceName, locales);

    for (const aliasRow of aliases) {
      const graphNodeId = nodeIdByExternalUri.get(aliasRow.external_uri);
      const normalizedAlias = normalizeText(aliasRow.alias);

      if (!graphNodeId || !normalizedAlias) {
        continue;
      }

      const collisionKey = `${aliasRow.locale_code}\u0000${normalizedAlias}`;
      const collisionSet = aliasCollisionMap.get(collisionKey) ?? new Set<number>();
      collisionSet.add(graphNodeId);
      aliasCollisionMap.set(collisionKey, collisionSet);
    }

    const bestAliasByKey = new Map<string, AliasCandidate>();

    for (const aliasRow of aliases) {
      const graphNodeId = nodeIdByExternalUri.get(aliasRow.external_uri);
      const concept = conceptById.get(aliasRow.source_concept_id);

      if (!graphNodeId || !concept) {
        continue;
      }

      const normalizedAlias = normalizeText(aliasRow.alias);

      if (!normalizedAlias) {
        continue;
      }

      const nodeRecord = nodeRecordByExternalUri.get(aliasRow.external_uri) ?? buildNodeRecord([concept]);
      const collisionKey = `${aliasRow.locale_code}\u0000${normalizedAlias}`;
      const collisionCount = aliasCollisionMap.get(collisionKey)?.size ?? 0;
      const genericFlag = shouldFlagAliasAsGeneric(aliasRow.alias, normalizedAlias, collisionCount, aliasRow.is_preferred === 1);
      const aliasCandidate: AliasCandidate = {
        graphNodeId,
        localeCode: aliasRow.locale_code,
        alias: aliasRow.alias.trim(),
        normalizedAlias,
        aliasType: aliasRow.alias_type,
        aliasClass: aliasRow.is_preferred === 1 ? 'preferred_label' : 'alt_label',
        sourceName: aliasRow.source_name,
        sourceRecordType: 'ose_source_aliases',
        confidence: aliasRow.is_preferred === 1 ? 1 : aliasRow.alias_type === 'hidden_label' ? 0.5 : 0.8,
        isPrimary: aliasRow.is_preferred === 1,
        isActive: true,
        isGenericHeadOnly: genericFlag,
        needsReview: genericFlag,
        reviewNote: genericFlag
          ? `Single-token alias shared by ${collisionCount} occupation nodes in locale ${aliasRow.locale_code}.`
          : buildAliasReviewNote(aliasRow.alias_type, normalizedAlias, nodeRecord.normalizedLabel)
      };

      const dedupeKey = `${graphNodeId}\u0000${aliasRow.locale_code}\u0000${normalizedAlias}`;
      const existing = bestAliasByKey.get(dedupeKey);

      if (!existing || compareAliasCandidates(aliasCandidate, existing) < 0) {
        bestAliasByKey.set(dedupeKey, aliasCandidate);
      }
    }

    return Array.from(bestAliasByKey.values());
  }

  private async loadSourceAliases(sourceName: string, locales: string[]): Promise<SourceAliasRow[]> {
    const localeFilter = buildLocaleFilter('alias.locale_code', locales);
    const [rows] = await this.connection.query<SourceAliasRow[]>(
      `
        SELECT
          alias.id,
          alias.source_concept_id,
          alias.locale_code,
          alias.alias,
          alias.normalized_alias,
          alias.alias_type,
          alias.is_preferred,
          concept.source_name,
          concept.external_uri
        FROM ose_source_aliases alias
        INNER JOIN ose_source_concepts concept
          ON concept.id = alias.source_concept_id
        WHERE concept.source_name = ?
          AND concept.entity_kind IN ('occupation', 'occupation_group')
          ${localeFilter.sql}
        ORDER BY alias.source_concept_id, alias.is_preferred DESC, alias.id
      `,
      [sourceName, ...localeFilter.params]
    );

    return rows;
  }

  private async insertGraphAliases(aliases: AliasCandidate[]): Promise<void> {
    for (const alias of aliases) {
      await this.connection.execute(
        `
          INSERT INTO ose_graph_aliases
            (
              graph_node_id,
              locale_code,
              alias,
              normalized_alias,
              alias_type,
              alias_class,
              source_name,
              source_record_type,
              confidence,
              is_primary,
              is_active,
              is_generic_head_only,
              needs_review,
              review_note
            )
          VALUES
            (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          alias.graphNodeId,
          alias.localeCode,
          alias.alias,
          alias.normalizedAlias,
          alias.aliasType,
          alias.aliasClass,
          alias.sourceName,
          alias.sourceRecordType,
          alias.confidence,
          alias.isPrimary ? 1 : 0,
          alias.isActive ? 1 : 0,
          alias.isGenericHeadOnly ? 1 : 0,
          alias.needsReview ? 1 : 0,
          alias.reviewNote
        ]
      );
    }
  }

  private async buildRelationshipCandidates(
    sourceName: string,
    locales: string[],
    nodeIdByExternalUri: Map<string, number>
  ): Promise<RelationshipCandidate[]> {
    const localeFilter = buildLocaleFilter('locale_code', locales);
    const [rows] = await this.connection.query<SourceRelationRow[]>(
      `
        SELECT
          id,
          parent_external_uri,
          child_external_uri,
          parent_entity_kind,
          child_entity_kind,
          source_name,
          weight,
          confidence
        FROM ose_source_relations
        WHERE source_name = ?
          AND relation_kind = 'broader_occupation'
          ${localeFilter.sql}
        ORDER BY id
      `,
      [sourceName, ...localeFilter.params]
    );

    const bestRelationshipByKey = new Map<string, RelationshipCandidate>();

    for (const row of rows) {
      const parentNodeId = nodeIdByExternalUri.get(row.parent_external_uri);
      const childNodeId = nodeIdByExternalUri.get(row.child_external_uri);

      if (!parentNodeId || !childNodeId || parentNodeId === childNodeId) {
        continue;
      }

      const dedupeKey = `${parentNodeId}\u0000${childNodeId}`;
      const candidate: RelationshipCandidate = {
        parentNodeId,
        childNodeId,
        sourceName: row.source_name,
        sourceRelationId: row.id,
        weight: toNullableNumber(row.weight),
        confidence: toNullableNumber(row.confidence) ?? 1
      };
      const existing = bestRelationshipByKey.get(dedupeKey);

      if (!existing || compareRelationshipCandidates(candidate, existing) < 0) {
        bestRelationshipByKey.set(dedupeKey, candidate);
      }
    }

    return Array.from(bestRelationshipByKey.values());
  }

  private async insertRelationships(relationships: RelationshipCandidate[]): Promise<void> {
    for (const relationship of relationships) {
      await this.connection.execute(
        `
          INSERT INTO ose_graph_relationships
            (
              parent_node_id,
              child_node_id,
              relationship_type,
              source_name,
              source_relation_id,
              weight,
              confidence,
              is_active
            )
          VALUES
            (?, ?, 'broader', ?, ?, ?, ?, 1)
        `,
        [
          relationship.parentNodeId,
          relationship.childNodeId,
          relationship.sourceName,
          relationship.sourceRelationId,
          relationship.weight,
          relationship.confidence
        ]
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

function buildNodeRecords(concepts: SourceConceptRow[]): NodeRecord[] {
  const groupedConcepts = new Map<string, SourceConceptRow[]>();

  for (const concept of concepts) {
    const rows = groupedConcepts.get(concept.external_uri) ?? [];
    rows.push(concept);
    groupedConcepts.set(concept.external_uri, rows);
  }

  return Array.from(groupedConcepts.values()).map((rows) => buildNodeRecord(rows));
}

function buildNodeRecord(rows: SourceConceptRow[]): NodeRecord {
  const sortedRows = [...rows].sort(compareConceptRows);
  const bestRow = sortedRows[0];
  const entityKind = normalizeEntityKind(bestRow.entity_kind);
  const canonicalLabel = pickBestLabel(sortedRows, bestRow.external_uri);
  const normalizedLabel = normalizeText(canonicalLabel);
  const description = pickBestDescription(sortedRows);

  return {
    externalUri: bestRow.external_uri,
    sourceKind: bestRow.source_kind,
    sourceName: bestRow.source_name,
    entityKind,
    nodeLevel: deriveNodeLevel(entityKind, bestRow.external_uri),
    canonicalKey: `${bestRow.source_name}:${entityKind}:${bestRow.external_uri}`,
    termType: clip(bestRow.concept_type ?? entityKind, 64),
    canonicalLabel,
    normalizedLabel,
    slug: buildNodeSlug(entityKind, bestRow.external_uri, canonicalLabel),
    description,
    isLeaf: entityKind === 'occupation',
    sourceConfidence: looksLikeStubLabel(canonicalLabel) ? 0.6 : 1
  };
}

function compareConceptRows(left: SourceConceptRow, right: SourceConceptRow): number {
  return scoreConceptRow(right) - scoreConceptRow(left);
}

function scoreConceptRow(row: SourceConceptRow): number {
  let score = 0;

  if (row.locale_code === 'en') {
    score += 20;
  }

  if (row.concept_type) {
    score += 10;
  }

  if (row.description || row.definition_text) {
    score += 5;
  }

  if (!looksLikeStubLabel(row.preferred_label)) {
    score += 100;
  }

  return score;
}

function pickBestLabel(rows: SourceConceptRow[], externalUri: string): string {
  for (const row of rows) {
    if (!looksLikeStubLabel(row.preferred_label)) {
      return row.preferred_label.trim();
    }
  }

  return deriveLabelFromUri(externalUri);
}

function pickBestDescription(rows: SourceConceptRow[]): string | null {
  for (const row of rows) {
    const description = row.description?.trim() || row.definition_text?.trim();

    if (description) {
      return description;
    }
  }

  return null;
}

function normalizeEntityKind(entityKind: string): 'occupation' | 'occupation_group' {
  return entityKind === 'occupation_group' ? 'occupation_group' : 'occupation';
}

function deriveNodeLevel(entityKind: 'occupation' | 'occupation_group', externalUri: string): 'occupation' | 'family' | 'group' {
  if (entityKind === 'occupation') {
    return 'occupation';
  }

  const iscoCode = extractIscoCode(externalUri);

  if (iscoCode.length >= 4) {
    return 'group';
  }

  return 'family';
}

function buildNodeSlug(entityKind: 'occupation' | 'occupation_group', externalUri: string, canonicalLabel: string): string {
  const labelSlug = slugify(canonicalLabel);
  const uriTail = externalUri.split('/').pop() ?? externalUri;

  return entityKind === 'occupation'
    ? clip(`occupation-${labelSlug}-${uriTail.toLowerCase()}`, 255)
    : clip(`occupation-group-${extractIscoCode(externalUri).toLowerCase()}-${labelSlug}`, 255);
}

function extractIscoCode(externalUri: string): string {
  const match = externalUri.match(/\/isco\/c([a-z0-9]+)$/i);
  return match?.[1] ?? externalUri.split('/').pop()?.replace(/^c/i, '') ?? 'unknown';
}

function deriveLabelFromUri(externalUri: string): string {
  return externalUri.split('/').pop() ?? externalUri;
}

function looksLikeStubLabel(label: string | null | undefined): boolean {
  const trimmed = label?.trim();

  if (!trimmed) {
    return true;
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(trimmed);
}

function normalizeText(value: string): string {
  return normalizeSearchText(value);
}

function slugify(value: string): string {
  const normalized = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  return normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'node';
}

function shouldFlagAliasAsGeneric(alias: string, normalizedAlias: string, collisionCount: number, isPreferred: boolean): boolean {
  if (isPreferred) {
    return false;
  }

  if (collisionCount < 2) {
    return false;
  }

  if (normalizedAlias.length < 3) {
    return true;
  }

  return /^[\p{L}\p{N}]+$/u.test(alias.trim());
}

function buildAliasReviewNote(aliasType: string | null, normalizedAlias: string, normalizedLabel: string): string | null {
  if (aliasType === 'hidden_label') {
    return 'Imported from a hidden label source row; keep active for review in this phase.';
  }

  if (normalizedAlias === normalizedLabel) {
    return null;
  }

  return null;
}

function compareAliasCandidates(left: AliasCandidate, right: AliasCandidate): number {
  if (left.isPrimary !== right.isPrimary) {
    return left.isPrimary ? -1 : 1;
  }

  if (left.confidence !== right.confidence) {
    return right.confidence - left.confidence;
  }

  return left.alias.localeCompare(right.alias);
}

function compareRelationshipCandidates(left: RelationshipCandidate, right: RelationshipCandidate): number {
  const leftConfidence = left.confidence ?? 0;
  const rightConfidence = right.confidence ?? 0;

  if (leftConfidence !== rightConfidence) {
    return rightConfidence - leftConfidence;
  }

  return left.sourceRelationId - right.sourceRelationId;
}

function buildNodeSourceNote(concept: SourceConceptRow): string | null {
  if (looksLikeStubLabel(concept.preferred_label)) {
    return 'Source concept was present but only had a stub-like label during graph build.';
  }

  return null;
}

function toNullableNumber(value: string | number | null): number | null {
  if (value === null || value === '') {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clip(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}
