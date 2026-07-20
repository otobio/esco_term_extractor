import type { Connection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { sha256Hex } from '../local-hash.js';
import {
  createEmbeddingProvider,
  DEFAULT_TRANSFORMERS_DIMENSIONS,
  TRANSFORMERS_MODEL_KEY,
  type EmbeddingProviderKind,
  type TextEmbeddingProvider
} from '../providers/index.js';

const DEFAULT_ESCO_SOURCE_NAME = 'esco_1_2_1';
const DEFAULT_PROCESS_CHUNK_SIZE = 250;
const TRANSFORMERS_PROCESS_CHUNK_SIZE = 32;
const INSERT_CHUNK_SIZE = 250;

export type BuildOccupationEmbeddingsOptions = {
  sourceName?: string;
  provider?: EmbeddingProviderKind;
  modelKey?: string;
  modelName?: string;
  cacheDir?: string;
  dimensions?: number;
  skipExisting?: boolean;
  limit?: number;
  processChunkSize?: number;
  onProgress?: (progress: BuildOccupationEmbeddingsProgress) => void;
};

export type BuildOccupationEmbeddingsResult = {
  sourceName: string;
  modelId: number;
  modelKey: string;
  provider: string;
  dimensions: number;
  processedNodeCount: number;
  insertedEmbeddingCount: number;
  skippedEmptyTextCount: number;
};

export type BuildOccupationEmbeddingsProgress = {
  sourceName: string;
  modelKey: string;
  provider: string;
  lastGraphNodeId: number;
  processedNodeCount: number;
  insertedEmbeddingCount: number;
  chunkRowCount: number;
  remaining?: number;
};

type EmbeddingModelRow = RowDataPacket & {
  id: number;
  dimensions: number;
};

type DenseTextRow = RowDataPacket & {
  graph_node_id: number;
  dense_text: string | null;
};

type CountRow = RowDataPacket & {
  count_value: number;
};

type NodeEmbeddingRecord = {
  graphNodeId: number;
  textHash: string;
  embeddingJson: string;
  vectorNorm: number;
};

export class OccupationEmbeddingBuilder {
  public constructor(private readonly connection: Connection) {}

  public async run(options: BuildOccupationEmbeddingsOptions = {}): Promise<BuildOccupationEmbeddingsResult> {
    const sourceName = normalizeSourceName(options.sourceName);
    const provider = await createEmbeddingProvider({
      provider: options.provider,
      modelKey: options.modelKey,
      modelName: options.modelName,
      cacheDir: options.cacheDir,
      dimensions: options.dimensions
    });

    try {
      const metadata = provider.metadata;
      const limit = normalizeLimit(options.limit);
      const processChunkSize = normalizeProcessChunkSize(options.processChunkSize, metadata.provider);
      const modelId = await this.upsertEmbeddingModel(provider);
      const skippedEmptyTextCount = await this.countEmptyDenseTextRows(sourceName);

      let lastGraphNodeId = 0;
      let remaining = limit;
      let processedNodeCount = 0;
      let insertedEmbeddingCount = 0;

      while (remaining === undefined || remaining > 0) {
        const queryLimit = Math.min(processChunkSize, remaining ?? processChunkSize);
        const rows = await this.loadDenseTextRows(sourceName, modelId, lastGraphNodeId, queryLimit, options.skipExisting === true);

        if (rows.length === 0) {
          break;
        }

        lastGraphNodeId = rows[rows.length - 1]?.graph_node_id ?? lastGraphNodeId;
        const records = await buildNodeEmbeddingRecords(rows, provider);

        if (records.length > 0) {
          await this.replaceNodeEmbeddings(modelId, records, options.skipExisting === true);
        }

        processedNodeCount += records.length;
        insertedEmbeddingCount += records.length;

        if (remaining !== undefined) {
          remaining -= rows.length;
        }

        options.onProgress?.({
          sourceName,
          modelKey: metadata.modelKey,
          provider: metadata.provider,
          lastGraphNodeId,
          processedNodeCount,
          insertedEmbeddingCount,
          chunkRowCount: rows.length,
          remaining
        });
      }

      return {
        sourceName,
        modelId,
        modelKey: metadata.modelKey,
        provider: metadata.provider,
        dimensions: metadata.dimensions,
        processedNodeCount,
        insertedEmbeddingCount,
        skippedEmptyTextCount
      };
    } finally {
      await provider.dispose?.();
    }
  }

  private async upsertEmbeddingModel(provider: TextEmbeddingProvider): Promise<number> {
    const metadata = provider.metadata;
    const existingModel = await this.loadEmbeddingModel(metadata.modelKey);

    if (existingModel && existingModel.dimensions !== metadata.dimensions) {
      throw new Error(
        `Embedding model "${metadata.modelKey}" is already registered with ${existingModel.dimensions} dimensions. Use --dimensions=${existingModel.dimensions} or choose a new --model-key for ${metadata.dimensions} dimensions.`
      );
    }

    const [result] = await this.connection.execute<ResultSetHeader>(
      `
        INSERT INTO ose_embedding_models
          (
            model_key,
            model_family,
            provider,
            dimensions,
            pooling_strategy,
            normalization_strategy,
            is_multilingual,
            notes
          )
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          id = LAST_INSERT_ID(id),
          model_family = VALUES(model_family),
          provider = VALUES(provider),
          dimensions = VALUES(dimensions),
          pooling_strategy = VALUES(pooling_strategy),
          normalization_strategy = VALUES(normalization_strategy),
          is_multilingual = VALUES(is_multilingual),
          notes = VALUES(notes)
      `,
      [
        metadata.modelKey,
        metadata.modelFamily,
        metadata.provider,
        metadata.dimensions,
        metadata.poolingStrategy,
        metadata.normalizationStrategy,
        metadata.isMultilingual ? 1 : 0,
        metadata.notes
      ]
    );

    if (result.insertId > 0) {
      return result.insertId;
    }

    const model = await this.loadEmbeddingModel(metadata.modelKey);

    if (!model) {
      throw new Error(`Could not register embedding model for model_key="${metadata.modelKey}".`);
    }

    return model.id;
  }

  private async loadEmbeddingModel(modelKey: string): Promise<EmbeddingModelRow | null> {
    const [rows] = await this.connection.query<EmbeddingModelRow[]>(
      `
        SELECT
          id,
          dimensions
        FROM ose_embedding_models
        WHERE model_key = ?
        LIMIT 1
      `,
      [modelKey]
    );

    return rows[0] ?? null;
  }

  private async loadDenseTextRows(
    sourceName: string,
    modelId: number,
    lastGraphNodeId: number,
    limit: number,
    skipExisting: boolean
  ): Promise<DenseTextRow[]> {
    const skipExistingSql = skipExisting
      ? `
          AND NOT EXISTS (
            SELECT 1
            FROM ose_node_embeddings existing_embedding
            WHERE existing_embedding.graph_node_id = meta.graph_node_id
              AND existing_embedding.embedding_model_id = ?
              AND existing_embedding.text_role = 'dense_text'
              AND existing_embedding.locale_code IS NULL
          )
        `
      : '';
    const params = skipExisting
      ? [sourceName, lastGraphNodeId, modelId, limit]
      : [sourceName, lastGraphNodeId, limit];

    const [rows] = await this.connection.query<DenseTextRow[]>(
      `
        SELECT DISTINCT
          meta.graph_node_id,
          meta.dense_text
        FROM ose_search_meta meta
        INNER JOIN ose_graph_nodes node
          ON node.id = meta.graph_node_id
        INNER JOIN ose_graph_node_sources node_source
          ON node_source.graph_node_id = node.id
        WHERE node_source.source_name = ?
          AND meta.graph_node_id > ?
          AND node.bucket = 'occupation'
          AND node.node_level = 'occupation'
          AND node.status = 'active'
          AND node.is_searchable = 1
          AND meta.dense_text IS NOT NULL
          AND TRIM(meta.dense_text) <> ''
          ${skipExistingSql}
        ORDER BY meta.graph_node_id
        LIMIT ?
      `,
      params
    );

    return rows;
  }

  private async countEmptyDenseTextRows(sourceName: string): Promise<number> {
    const [rows] = await this.connection.query<CountRow[]>(
      `
        SELECT COUNT(DISTINCT meta.graph_node_id) AS count_value
        FROM ose_search_meta meta
        INNER JOIN ose_graph_nodes node
          ON node.id = meta.graph_node_id
        INNER JOIN ose_graph_node_sources node_source
          ON node_source.graph_node_id = node.id
        WHERE node_source.source_name = ?
          AND node.bucket = 'occupation'
          AND node.node_level = 'occupation'
          AND node.status = 'active'
          AND node.is_searchable = 1
          AND (meta.dense_text IS NULL OR TRIM(meta.dense_text) = '')
      `,
      [sourceName]
    );

    return rows[0]?.count_value ?? 0;
  }

  private async replaceNodeEmbeddings(modelId: number, records: NodeEmbeddingRecord[], skipExisting: boolean): Promise<void> {
    if (records.length === 0) {
      return;
    }

    await this.connection.beginTransaction();

    try {
      if (!skipExisting) {
        await this.deleteExistingNodeEmbeddings(modelId, records.map((record) => record.graphNodeId));
      }

      await this.insertNodeEmbeddings(modelId, records);
      await this.connection.commit();
    } catch (error) {
      await this.connection.rollback();
      throw error;
    }
  }

  private async deleteExistingNodeEmbeddings(modelId: number, graphNodeIds: number[]): Promise<void> {
    const uniqueGraphNodeIds = Array.from(new Set(graphNodeIds));

    for (const chunk of toChunks(uniqueGraphNodeIds, INSERT_CHUNK_SIZE)) {
      const placeholders = chunk.map(() => '?').join(', ');

      await this.connection.execute(
        `
          DELETE FROM ose_node_embeddings
          WHERE embedding_model_id = ?
            AND text_role = 'dense_text'
            AND locale_code IS NULL
            AND graph_node_id IN (${placeholders})
        `,
        [modelId, ...chunk]
      );
    }
  }

  private async insertNodeEmbeddings(modelId: number, records: NodeEmbeddingRecord[]): Promise<void> {
    for (const chunk of toChunks(records, INSERT_CHUNK_SIZE)) {
      const placeholders = chunk.map(() => "(?, ?, 'dense_text', NULL, ?, ?, ?)").join(', ');
      const params = chunk.flatMap((record) => [
        record.graphNodeId,
        modelId,
        record.textHash,
        record.embeddingJson,
        record.vectorNorm
      ]);

      await this.connection.execute(
        `
          INSERT INTO ose_node_embeddings
            (
              graph_node_id,
              embedding_model_id,
              text_role,
              locale_code,
              text_hash,
              embedding_json,
              vector_norm
            )
          VALUES ${placeholders}
        `,
        params
      );
    }
  }
}

async function buildNodeEmbeddingRecords(
  rows: DenseTextRow[],
  provider: TextEmbeddingProvider
): Promise<NodeEmbeddingRecord[]> {
  const denseTexts = rows.map((row) => row.dense_text?.trim() ?? '');
  const embeddings = provider.embedBatch
    ? await provider.embedBatch(denseTexts)
    : await Promise.all(denseTexts.map((denseText) => provider.embed(denseText)));

  if (embeddings.length !== rows.length) {
    throw new Error(`Embedding provider returned ${embeddings.length} vectors for ${rows.length} dense_text rows.`);
  }

  return rows.map((row, index) => {
    const denseText = denseTexts[index] ?? '';
    const embedding = embeddings[index];

    if (!embedding) {
      throw new Error(`Embedding provider did not return a vector for graph_node_id=${row.graph_node_id}.`);
    }

    return {
      graphNodeId: row.graph_node_id,
      textHash: sha256Hex(denseText),
      embeddingJson: JSON.stringify(embedding.vector),
      vectorNorm: embedding.vectorNorm
    };
  });
}

function normalizeSourceName(sourceName: string | undefined): string {
  const trimmed = sourceName?.trim();
  return trimmed || DEFAULT_ESCO_SOURCE_NAME;
}

function normalizeLimit(limit: number | undefined): number | undefined {
  if (limit === undefined) {
    return undefined;
  }

  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error(`Embedding limit must be a positive integer. Received "${limit}".`);
  }

  return limit;
}

function normalizeProcessChunkSize(processChunkSize: number | undefined, provider: string): number {
  if (processChunkSize === undefined) {
    return provider === 'huggingface-transformers-js' ? TRANSFORMERS_PROCESS_CHUNK_SIZE : DEFAULT_PROCESS_CHUNK_SIZE;
  }

  if (!Number.isInteger(processChunkSize) || processChunkSize <= 0) {
    throw new Error(`Embedding process chunk size must be a positive integer. Received "${processChunkSize}".`);
  }

  return processChunkSize;
}

export function defaultOccupationEmbeddingModelKey(): string {
  return TRANSFORMERS_MODEL_KEY;
}

export function defaultOccupationEmbeddingDimensions(): number {
  return DEFAULT_TRANSFORMERS_DIMENSIONS;
}

function toChunks<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}
