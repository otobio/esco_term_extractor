import type { Connection, RowDataPacket } from 'mysql2/promise';
import { OpenSearchClient } from './client.js';
import { defaultOpenSearchTemplateName, getOpenSearchConfig, type OpenSearchConfig } from './config.js';
import {
  applyReviewedTaxonomyOverridesToFields,
  taxonomyFamilyOverrideForSubFamily,
  taxonomySubFamilyOverrideForLeaf
} from '../runtime/occupation-taxonomy-family-overrides.js';
import { normalizeSearchText } from '../utils/texts.js';

const DEFAULT_ESCO_SOURCE_NAME = 'esco_1_2_1';
const DEFAULT_BULK_CHUNK_SIZE = 250;
const MAX_FAILURE_EXAMPLES = 10;

type BaseOccupationRow = RowDataPacket & {
  graph_node_id: number;
  node_level: string;
  canonical_label: string;
  normalized_label: string;
  search_text: string | null;
  family_node_id: number | null;
  family_label: string | null;
  group_node_id: number | null;
  group_label: string | null;
  generic_risk: 'low' | 'medium' | 'high';
  has_hierarchy: number;
  has_capability_support: number;
  quality_flags_json: string | null;
};

type AliasRow = RowDataPacket & {
  graph_node_id: number;
  locale_code: string;
  alias: string;
  normalized_alias: string;
  alias_role: string;
  weight: string | number | null;
};

type CapabilityRow = RowDataPacket & {
  graph_node_id: number;
  label: string;
};

type AncestorRow = RowDataPacket & {
  graph_node_id: number;
  ancestor_node_id: number;
  distance_from_leaf: number;
  ancestor_role: string;
  canonical_label: string;
};

type CountRow = RowDataPacket & {
  count_value: number;
};

export type CreateOccupationIndexOptions = {
  indexName?: string;
  templateName?: string;
  recreate?: boolean;
};

export type CreateOccupationIndexResult = {
  indexName: string;
  templateName: string;
  recreated: boolean;
  created: boolean;
};

export type PopulateOccupationIndexOptions = {
  sourceName?: string;
  indexName?: string;
  templateName?: string;
  chunkSize?: number;
  limit?: number;
  ensureIndex?: boolean;
  recreateIndex?: boolean;
  refresh?: boolean;
  onProgress?: (progress: PopulateOccupationIndexProgress) => void;
};

export type PopulateOccupationIndexProgress = {
  indexName: string;
  sourceName: string;
  lastGraphNodeId: number;
  chunkDocumentCount: number;
  indexedDocumentCount: number;
  failedDocumentCount: number;
  remaining?: number;
};

export type PopulateOccupationIndexResult = {
  indexName: string;
  sourceName: string;
  chunkSize: number;
  totalCandidateCount: number;
  attemptedDocumentCount: number;
  indexedDocumentCount: number;
  failedDocumentCount: number;
};

type OccupationIndexDocument = {
  graph_node_id: number;
  source_name: string;
  node_level: string;
  canonical_label: string;
  normalized_label: string;
  locale_codes: string[];
  locale_aliases: Record<string, string[]>;
  aliases_text: string;
  locale_primary_aliases_text: string;
  locale_supporting_aliases_text: string;
  reviewed_crosswalk_aliases_text: string;
  family_supporting_aliases_text: string;
  english_backbone_aliases_text: string;
  normalized_aliases: string[];
  search_text: string;
  family_node_id: number | null;
  family_label: string | null;
  group_node_id: number | null;
  group_label: string | null;
  generic_risk: 'low' | 'medium' | 'high';
  has_hierarchy: boolean;
  has_capability_support: boolean;
  capability_text: string;
  ancestor_text: string;
  quality_flags: string[];
  [fieldName: string]: boolean | number | Record<string, string[]> | string | string[] | null | undefined;
};

type BulkItemResult = {
  status: number;
  error?: {
    type?: string;
    reason?: string;
  };
};

type BulkResponse = {
  errors?: boolean;
  items?: Array<{
    index?: BulkItemResult;
  }>;
};

export class OccupationOpenSearchIndexManager {
  public constructor(
    private readonly client: OpenSearchClient,
    private readonly config: OpenSearchConfig = getOpenSearchConfig()
  ) {}

  public async createOrUpdate(options: CreateOccupationIndexOptions = {}): Promise<CreateOccupationIndexResult> {
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
    } else {
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
  public constructor(
    private readonly connection: Connection,
    private readonly client: OpenSearchClient,
    private readonly config: OpenSearchConfig = getOpenSearchConfig()
  ) {}

  public async run(options: PopulateOccupationIndexOptions = {}): Promise<PopulateOccupationIndexResult> {
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
      const documents = buildDocuments(
        sourceName,
        baseRows,
        aliasRows,
        capabilityRows,
        ancestorRows
      );
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

  private async countIndexableOccupations(sourceName: string, limit: number | undefined): Promise<number> {
    const [rows] = await this.connection.query<CountRow[]>(
      `
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
      `,
      [sourceName]
    );

    const count = toNumber(rows[0]?.count_value) ?? 0;
    return limit === undefined ? count : Math.min(count, limit);
  }

  private async loadBaseOccupationRows(
    sourceName: string,
    lastGraphNodeId: number,
    limit: number
  ): Promise<BaseOccupationRow[]> {
    const [rows] = await this.connection.query<BaseOccupationRow[]>(
      `
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
      `,
      [lastGraphNodeId, sourceName, limit]
    );

    return rows;
  }

  private async loadAliasRows(graphNodeIds: number[]): Promise<AliasRow[]> {
    if (graphNodeIds.length === 0) {
      return [];
    }

    const placeholders = graphNodeIds.map(() => '?').join(', ');
    const [rows] = await this.connection.query<AliasRow[]>(
      `
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
      `,
      graphNodeIds
    );

    return rows;
  }

  private async loadCapabilityRows(graphNodeIds: number[]): Promise<CapabilityRow[]> {
    if (graphNodeIds.length === 0) {
      return [];
    }

    const placeholders = graphNodeIds.map(() => '?').join(', ');
    const [rows] = await this.connection.query<CapabilityRow[]>(
      `
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
      `,
      graphNodeIds
    );

    return rows;
  }

  private async loadAncestorRows(graphNodeIds: number[]): Promise<AncestorRow[]> {
    if (graphNodeIds.length === 0) {
      return [];
    }

    const placeholders = graphNodeIds.map(() => '?').join(', ');
    const [rows] = await this.connection.query<AncestorRow[]>(
      `
        SELECT
          meta.graph_node_id,
          ancestor.ancestor_node_id,
          ancestor.distance_from_leaf,
          ancestor.ancestor_role,
          node.canonical_label
        FROM ose_search_meta_ancestors ancestor
        INNER JOIN ose_search_meta meta
          ON meta.id = ancestor.search_meta_id
        INNER JOIN ose_graph_nodes node
          ON node.id = ancestor.ancestor_node_id
        WHERE meta.graph_node_id IN (${placeholders})
        ORDER BY meta.graph_node_id, ancestor.distance_from_leaf, ancestor.ancestor_role, node.canonical_label
      `,
      graphNodeIds
    );

    return rows;
  }

  private async bulkIndexDocuments(
    indexName: string,
    documents: OccupationIndexDocument[]
  ): Promise<{ indexedDocumentCount: number; failedDocumentCount: number }> {
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
    const response = await this.client.post<BulkResponse>('/_bulk', payload, {
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
    const failureExamples: string[] = [];

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
      throw new Error(
        `OpenSearch bulk indexing failed for ${failedDocumentCount} documents.${failureExamples.length > 0 ? ` Examples: ${failureExamples.join(' | ')}` : ''}`
      );
    }

    return {
      indexedDocumentCount,
      failedDocumentCount
    };
  }
}

function buildOccupationIndexProperties(): Record<string, unknown> {
  const properties: Record<string, unknown> = {
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

function buildDocuments(
  sourceName: string,
  baseRows: BaseOccupationRow[],
  aliasRows: AliasRow[],
  capabilityRows: CapabilityRow[],
  ancestorRows: AncestorRow[]
): OccupationIndexDocument[] {
  const aliasesByNodeId = groupBy(aliasRows, (row) => row.graph_node_id);
  const capabilitiesByNodeId = groupBy(capabilityRows, (row) => row.graph_node_id);
  const ancestorsByNodeId = groupBy(ancestorRows, (row) => row.graph_node_id);

  return baseRows.map((row) => {
    const aliasBundle = buildAliasBundle(aliasesByNodeId.get(row.graph_node_id) ?? []);
    const capabilities = capabilitiesByNodeId.get(row.graph_node_id) ?? [];
    const ancestors = ancestorsByNodeId.get(row.graph_node_id) ?? [];
    const taxonomyFields = applyReviewedTaxonomyOverridesToFields(sourceName, {
      graphNodeId: row.graph_node_id,
      familyNodeId: row.family_node_id,
      familyLabel: row.family_label,
      groupNodeId: row.group_node_id,
      groupLabel: row.group_label
    });
    const ancestorLabels = effectiveAncestorLabels(sourceName, taxonomyFields, ancestors);
    const document: OccupationIndexDocument = {
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
      family_node_id: taxonomyFields.familyNodeId,
      family_label: taxonomyFields.familyLabel,
      group_node_id: taxonomyFields.groupNodeId,
      group_label: taxonomyFields.groupLabel,
      generic_risk: row.generic_risk,
      has_hierarchy: row.has_hierarchy === 1,
      has_capability_support: row.has_capability_support === 1,
      capability_text: uniqueValues(capabilities.map((item) => item.label)).join('\n'),
      ancestor_text: uniqueValues(ancestorLabels).join('\n'),
      quality_flags: parseStringArray(row.quality_flags_json)
    };

    return document;
  });
}

function effectiveAncestorLabels(
  sourceName: string,
  fields: TaxonomyOverrideFieldsInput,
  ancestors: AncestorRow[]
): string[] {
  const leafOverride = taxonomySubFamilyOverrideForLeaf(sourceName, fields.graphNodeId);
  const familyOverride = taxonomyFamilyOverrideForSubFamily(sourceName, fields.groupNodeId);

  if (!leafOverride && !familyOverride) {
    return ancestors.map((item) => item.canonical_label);
  }

  const removedRoles = leafOverride ? new Set(['parent', 'group', 'family']) : new Set(['family']);
  const labels = ancestors
    .filter((item) => !removedRoles.has(item.ancestor_role))
    .map((item) => item.canonical_label);

  if (leafOverride) {
    labels.push(leafOverride.targetSubFamilyLabel);
  }

  if (fields.familyLabel) {
    labels.push(fields.familyLabel);
  }

  return labels;
}

type TaxonomyOverrideFieldsInput = {
  graphNodeId: number;
  familyNodeId: number | null;
  familyLabel: string | null;
  groupNodeId: number | null;
  groupLabel: string | null;
};

function buildAliasBundle(aliasRows: AliasRow[]): {
  localeAliases: Record<string, string[]>;
  aliasesText: string;
  roleAliasesText: Record<KnownAliasRole, string>;
  normalizedAliases: string[];
} {
  const localeAliases = new Map<string, string[]>();
  const roleAliases = new Map<KnownAliasRole, string[]>();
  const normalizedAliases: string[] = [];
  const aliasesText: string[] = [];
  const normalizedSeen = new Set<string>();
  const aliasSeen = new Set<string>();
  const roleAliasSeen = new Set<string>();

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

type KnownAliasRole = 'locale_primary' | 'locale_supporting' | 'reviewed_crosswalk' | 'family_supporting' | 'english_backbone';

function knownAliasRole(value: string): KnownAliasRole | null {
  if (
    value === 'locale_primary' ||
    value === 'locale_supporting' ||
    value === 'reviewed_crosswalk' ||
    value === 'family_supporting' ||
    value === 'english_backbone'
  ) {
    return value;
  }

  return null;
}

function parseStringArray(value: string | null): string[] {
  if (!value) {
    return [];
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
  } catch {
    return [];
  }
}

function groupBy<T>(rows: T[], keySelector: (row: T) => number): Map<number, T[]> {
  const grouped = new Map<number, T[]>();

  for (const row of rows) {
    const key = keySelector(row);
    const bucket = grouped.get(key) ?? [];
    bucket.push(row);
    grouped.set(key, bucket);
  }

  return grouped;
}

function normalizeSourceName(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized || DEFAULT_ESCO_SOURCE_NAME;
}

function normalizePositiveInteger(flagName: string, value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${flagName} must be a positive integer. Received "${value}".`);
  }

  return value;
}

function normalizeOptionalPositiveInteger(flagName: string, value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`--${flagName} must be a positive integer. Received "${value}".`);
  }

  return value;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}

function uniqueValues(values: string[]): string[] {
  const unique = new Set<string>();

  for (const value of values) {
    const normalized = value.trim();

    if (normalized) {
      unique.add(normalized);
    }
  }

  return Array.from(unique);
}
