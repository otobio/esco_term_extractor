import { createHash } from 'node:crypto';
import type { Connection, RowDataPacket } from 'mysql2/promise';
import { tokenizeNormalizedText } from '../query/query-preparation.js';
import { applyReviewedTaxonomyOverridesToFields } from '../runtime/occupation-taxonomy-family-overrides.js';
import { normalizeSearchText } from '../utils/texts.js';
import { OpenSearchClient } from './client.js';
import { defaultOpenSearchTemplateName, getOpenSearchConfig, type OpenSearchConfig } from './config.js';

const DEFAULT_ESCO_SOURCE_NAME = 'esco_1_2_1';
const DEFAULT_BULK_CHUNK_SIZE = 10000;
const MAX_FAILURE_EXAMPLES = 10;
const ALIAS_AUTHORITY_WEIGHT_SCALE = 100;

type AliasRole =
  | 'locale_primary'
  | 'locale_supporting'
  | 'reviewed_crosswalk'
  | 'family_supporting'
  | 'english_backbone';

const ALIAS_ROLE_RANK: Record<AliasRole, number> = {
  locale_primary: 5,
  reviewed_crosswalk: 4,
  locale_supporting: 3,
  family_supporting: 2,
  english_backbone: 1
};

type AliasIndexRow = RowDataPacket & {
  graph_node_id: number;
  canonical_label: string;
  source_name: string;
  locale_code: string;
  alias: string;
  normalized_alias: string;
  alias_role: AliasRole;
  weight: string | number | null;
  family_node_id: number | null;
  family_label: string | null;
  group_node_id: number | null;
  group_label: string | null;
  generic_risk: 'low' | 'medium' | 'high';
  has_capability_support: number;
};

type CountRow = RowDataPacket & {
  count_value: number;
};

export type CreateOccupationAliasIndexOptions = {
  indexName?: string;
  templateName?: string;
  recreate?: boolean;
};

export type CreateOccupationAliasIndexResult = {
  indexName: string;
  templateName: string;
  recreated: boolean;
  created: boolean;
};

export type PopulateOccupationAliasIndexOptions = {
  sourceName?: string;
  indexName?: string;
  templateName?: string;
  chunkSize?: number;
  limit?: number;
  ensureIndex?: boolean;
  recreateIndex?: boolean;
  refresh?: boolean;
  onProgress?: (progress: PopulateOccupationAliasIndexProgress) => void;
};

export type PopulateOccupationAliasIndexProgress = {
  indexName: string;
  sourceName: string;
  lastGraphNodeId: number;
  lastAliasSortKey: string;
  chunkDocumentCount: number;
  indexedDocumentCount: number;
  failedDocumentCount: number;
  remaining?: number;
};

export type PopulateOccupationAliasIndexResult = {
  indexName: string;
  sourceName: string;
  chunkSize: number;
  totalCandidateCount: number;
  attemptedDocumentCount: number;
  indexedDocumentCount: number;
  failedDocumentCount: number;
};

type OccupationAliasIndexDocument = {
  source_name: string;
  graph_node_id: number;
  canonical_label: string;
  locale_code: string;
  alias: string;
  normalized_alias_exact: string;
  normalized_alias: string;
  alias_text: string;
  alias_token_count: number;
  alias_role: AliasRole;
  alias_role_rank: number;
  alias_weight: number | null;
  alias_authority_score: number;
  family_node_id: number | null;
  family_label: string | null;
  group_node_id: number | null;
  group_label: string | null;
  generic_risk: 'low' | 'medium' | 'high';
  has_capability_support: boolean;
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

export class OccupationAliasOpenSearchIndexManager {
  public constructor(
    private readonly client: OpenSearchClient,
    private readonly config: OpenSearchConfig = getOpenSearchConfig()
  ) {}

  public async createOrUpdate(options: CreateOccupationAliasIndexOptions = {}): Promise<CreateOccupationAliasIndexResult> {
    const indexName = options.indexName ?? this.config.occupationAliasesIndex;
    const templateName = options.templateName ?? defaultOpenSearchTemplateName(indexName);

    await this.client.put(`/_index_template/${encodeURIComponent(templateName)}`, {
      index_patterns: [indexName],
      priority: 510,
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
          properties: buildOccupationAliasIndexProperties()
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
        properties: buildOccupationAliasIndexProperties()
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

export class OccupationAliasOpenSearchBulkIndexer {
  public constructor(
    private readonly connection: Connection,
    private readonly client: OpenSearchClient,
    private readonly config: OpenSearchConfig = getOpenSearchConfig()
  ) {}

  public async run(options: PopulateOccupationAliasIndexOptions = {}): Promise<PopulateOccupationAliasIndexResult> {
    const sourceName = normalizeSourceName(options.sourceName);
    const indexName = options.indexName ?? this.config.occupationAliasesIndex;
    const templateName = options.templateName ?? defaultOpenSearchTemplateName(indexName);
    const chunkSize = normalizePositiveInteger('chunk-size', options.chunkSize, DEFAULT_BULK_CHUNK_SIZE);
    const limit = normalizeOptionalPositiveInteger('limit', options.limit);

    if (options.ensureIndex !== false) {
      const manager = new OccupationAliasOpenSearchIndexManager(this.client, this.config);
      await manager.createOrUpdate({
        indexName,
        templateName,
        recreate: options.recreateIndex
      });
    }

    const totalCandidateCount = await this.countIndexableAliases(sourceName, limit);
    let lastGraphNodeId = 0;
    let lastAliasSortKey = '';
    let remaining = limit;
    let attemptedDocumentCount = 0;
    let indexedDocumentCount = 0;
    let failedDocumentCount = 0;

    while (remaining === undefined || remaining > 0) {
      const queryLimit = Math.min(chunkSize, remaining ?? chunkSize);
      const rows = await this.loadAliasRows(sourceName, lastGraphNodeId, lastAliasSortKey, queryLimit);

      if (rows.length === 0) {
        break;
      }

      const lastRow = rows[rows.length - 1];
      lastGraphNodeId = lastRow?.graph_node_id ?? lastGraphNodeId;
      lastAliasSortKey = lastRow ? aliasSortKey(lastRow) : lastAliasSortKey;

      const documents = rows.map(toAliasDocument);
      const bulkResult = await this.bulkIndexDocuments(indexName, documents);

      attemptedDocumentCount += documents.length;
      indexedDocumentCount += bulkResult.indexedDocumentCount;
      failedDocumentCount += bulkResult.failedDocumentCount;

      if (remaining !== undefined) {
        remaining -= rows.length;
      }

      options.onProgress?.({
        indexName,
        sourceName,
        lastGraphNodeId,
        lastAliasSortKey,
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

  private async countIndexableAliases(sourceName: string, limit: number | undefined): Promise<number> {
    const [rows] = await this.connection.query<CountRow[]>(
      `
        SELECT COUNT(*) AS count_value
        FROM ose_search_meta_aliases alias
        INNER JOIN ose_search_meta meta
          ON meta.id = alias.search_meta_id
        INNER JOIN ose_graph_nodes node
          ON node.id = meta.graph_node_id
        WHERE node.bucket = 'occupation'
          AND node.node_level = 'occupation'
          AND node.status = 'active'
          AND node.is_searchable = 1
          AND alias.alias_role IN ('locale_primary', 'locale_supporting', 'reviewed_crosswalk', 'family_supporting', 'english_backbone')
          AND EXISTS (
            SELECT 1
            FROM ose_graph_node_sources node_source
            WHERE node_source.graph_node_id = meta.graph_node_id
              AND node_source.source_name = ?
          )
      `,
      [sourceName]
    );

    const count = toNumber(rows[0]?.count_value) ?? 0;
    return limit === undefined ? count : Math.min(count, limit);
  }

  private async loadAliasRows(
    sourceName: string,
    lastGraphNodeId: number,
    lastAliasSortKey: string,
    limit: number
  ): Promise<AliasIndexRow[]> {
    const [rows] = await this.connection.query<AliasIndexRow[]>(
      `
        SELECT
          meta.graph_node_id,
          node.canonical_label,
          ? AS source_name,
          alias.locale_code,
          alias.alias,
          alias.normalized_alias,
          alias.alias_role,
          alias.weight,
          meta.family_node_id,
          family.canonical_label AS family_label,
          meta.group_node_id,
          grp.canonical_label AS group_label,
          meta.generic_risk,
          meta.has_capability_support,
          CONCAT_WS(
            '\\0',
            alias.locale_code,
            alias.alias_role,
            alias.normalized_alias,
            alias.alias
          ) AS alias_sort_key
        FROM ose_search_meta_aliases alias
        INNER JOIN ose_search_meta meta
          ON meta.id = alias.search_meta_id
        INNER JOIN ose_graph_nodes node
          ON node.id = meta.graph_node_id
        LEFT JOIN ose_graph_nodes family
          ON family.id = meta.family_node_id
        LEFT JOIN ose_graph_nodes grp
          ON grp.id = meta.group_node_id
        WHERE node.bucket = 'occupation'
          AND node.node_level = 'occupation'
          AND node.status = 'active'
          AND node.is_searchable = 1
          AND alias.alias_role IN ('locale_primary', 'locale_supporting', 'reviewed_crosswalk', 'family_supporting', 'english_backbone')
          AND (
            meta.graph_node_id > ?
            OR (
              meta.graph_node_id = ?
              AND CONCAT_WS(
                '\\0',
                alias.locale_code,
                alias.alias_role,
                alias.normalized_alias,
                alias.alias
              ) > ?
            )
          )
          AND EXISTS (
            SELECT 1
            FROM ose_graph_node_sources node_source
            WHERE node_source.graph_node_id = meta.graph_node_id
              AND node_source.source_name = ?
          )
        ORDER BY meta.graph_node_id, alias_sort_key
        LIMIT ?
      `,
      [sourceName, lastGraphNodeId, lastGraphNodeId, lastAliasSortKey, sourceName, limit]
    );

    return rows;
  }

  private async bulkIndexDocuments(
    indexName: string,
    documents: OccupationAliasIndexDocument[]
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
            _id: aliasDocumentId(document)
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
      throw new Error('OpenSearch alias bulk request returned an empty response body.');
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
        `OpenSearch alias bulk indexing failed for ${failedDocumentCount} documents.${failureExamples.length > 0 ? ` Examples: ${failureExamples.join(' | ')}` : ''}`
      );
    }

    return {
      indexedDocumentCount,
      failedDocumentCount
    };
  }
}

function buildOccupationAliasIndexProperties(): Record<string, unknown> {
  return {
    source_name: { type: 'keyword' },
    graph_node_id: { type: 'long' },
    canonical_label: {
      type: 'text',
      analyzer: 'ose_text',
      fields: {
        raw: { type: 'keyword' },
        folded: { type: 'keyword', normalizer: 'ose_keyword' }
      }
    },
    locale_code: { type: 'keyword' },
    alias: {
      type: 'text',
      analyzer: 'ose_text',
      fields: {
        raw: { type: 'keyword', ignore_above: 8191 },
        folded: { type: 'keyword', normalizer: 'ose_keyword', ignore_above: 8191 }
      }
    },
    normalized_alias_exact: { type: 'keyword', ignore_above: 8191 },
    normalized_alias: { type: 'keyword', normalizer: 'ose_keyword', ignore_above: 8191 },
    alias_text: { type: 'text', analyzer: 'ose_text' },
    alias_token_count: { type: 'integer' },
    alias_role: { type: 'keyword' },
    alias_role_rank: { type: 'integer' },
    alias_weight: { type: 'float' },
    alias_authority_score: { type: 'float' },
    family_node_id: { type: 'long' },
    family_label: { type: 'text', analyzer: 'ose_text', fields: { raw: { type: 'keyword' } } },
    group_node_id: { type: 'long' },
    group_label: { type: 'text', analyzer: 'ose_text', fields: { raw: { type: 'keyword' } } },
    generic_risk: { type: 'keyword' },
    has_capability_support: { type: 'boolean' }
  };
}

function toAliasDocument(row: AliasIndexRow): OccupationAliasIndexDocument {
  const aliasWeight = toNumber(row.weight);
  const aliasRoleRank = ALIAS_ROLE_RANK[row.alias_role];
  const normalizedAlias = normalizeSearchText(row.alias);
  const aliasText = normalizedAlias || row.alias;
  const taxonomyFields = applyReviewedTaxonomyOverridesToFields(row.source_name, {
    graphNodeId: row.graph_node_id,
    familyNodeId: row.family_node_id,
    familyLabel: row.family_label,
    groupNodeId: row.group_node_id,
    groupLabel: row.group_label
  });

  return {
    source_name: row.source_name,
    graph_node_id: row.graph_node_id,
    canonical_label: row.canonical_label,
    locale_code: row.locale_code,
    alias: row.alias,
    normalized_alias_exact: normalizedAlias,
    normalized_alias: normalizedAlias,
    alias_text: aliasText,
    alias_token_count: tokenizeNormalizedText(aliasText).length,
    alias_role: row.alias_role,
    alias_role_rank: aliasRoleRank,
    alias_weight: aliasWeight,
    alias_authority_score: aliasRoleRank * ALIAS_AUTHORITY_WEIGHT_SCALE + (aliasWeight ?? 0),
    family_node_id: taxonomyFields.familyNodeId,
    family_label: taxonomyFields.familyLabel,
    group_node_id: taxonomyFields.groupNodeId,
    group_label: taxonomyFields.groupLabel,
    generic_risk: row.generic_risk,
    has_capability_support: row.has_capability_support === 1
  };
}

function aliasDocumentId(document: OccupationAliasIndexDocument): string {
  return createHash('sha256')
    .update(
      [
        document.source_name,
        String(document.graph_node_id),
        document.locale_code,
        document.alias_role,
        document.normalized_alias,
        document.alias
      ].join('\0')
    )
    .digest('hex');
}

function aliasSortKey(row: AliasIndexRow): string {
  return [row.locale_code, row.alias_role, row.normalized_alias, row.alias].join('\0');
}

function normalizeSourceName(sourceName: string | undefined): string {
  const trimmed = sourceName?.trim();
  return trimmed || DEFAULT_ESCO_SOURCE_NAME;
}

function normalizePositiveInteger(label: string, value: number | undefined, fallback: number): number {
  const resolved = value ?? fallback;

  if (!Number.isInteger(resolved) || resolved <= 0 || resolved > 10000) {
    throw new Error(`${label} must be a positive integer no greater than 10000. Received "${resolved}".`);
  }

  return resolved;
}

function normalizeOptionalPositiveInteger(label: string, value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer. Received "${value}".`);
  }

  return value;
}

function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}
