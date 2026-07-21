import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { RowDataPacket } from 'mysql2/promise';
import { withConnection } from '../db/mysql.js';
import {
  DEFAULT_ESCO_SOURCE_NAME,
  DEFAULT_MODEL_KEY
} from '../retrieval/occupation-candidates.js';
import {
  defaultOccupationVectorManifestPath,
  defaultOccupationVectorMetadataPath,
  defaultOccupationVectorValuesPath,
  type OccupationVectorArtifactManifest,
  type OccupationVectorRecord
} from '../runtime/occupation-vector-artifact.js';

type CliOptions = {
  sourceName: string;
  modelKey: string;
  outPath: string | null;
};

type EmbeddingModelRow = RowDataPacket & {
  id: number;
  model_key: string;
  provider: string;
  dimensions: number;
};

type VectorExportRow = RowDataPacket & {
  graph_node_id: number;
  canonical_label: string;
  family_node_id: number;
  family_label: string;
  embedding_json: unknown;
  vector_norm: string | number | null;
};

type VectorExportRecord = OccupationVectorRecord & {
  vector: number[];
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const exportResult = await withConnection(async (connection) => {
    const [modelRows] = await connection.query<EmbeddingModelRow[]>(
      `
        SELECT id, model_key, provider, dimensions
        FROM ose_embedding_models
        WHERE model_key = ?
        LIMIT 1
      `,
      [options.modelKey]
    );
    const model = modelRows[0] ?? null;

    if (!model) {
      throw new Error(`No embedding model found for model_key="${options.modelKey}". Run embeddings build first.`);
    }

    const [rows] = await connection.query<VectorExportRow[]>(
      `
        SELECT
          embedding.graph_node_id,
          node.canonical_label,
          meta.family_node_id,
          family_node.canonical_label AS family_label,
          embedding.embedding_json,
          embedding.vector_norm
        FROM ose_node_embeddings embedding
        INNER JOIN ose_graph_nodes node
          ON node.id = embedding.graph_node_id
        INNER JOIN ose_search_meta meta
          ON meta.graph_node_id = embedding.graph_node_id
        INNER JOIN ose_graph_nodes family_node
          ON family_node.id = meta.family_node_id
        WHERE embedding.embedding_model_id = ?
          AND embedding.text_role = 'dense_text'
          AND embedding.locale_code IS NULL
          AND node.bucket = 'occupation'
          AND node.status = 'active'
          AND node.is_searchable = 1
          AND EXISTS (
            SELECT 1
            FROM ose_graph_node_sources node_source
            WHERE node_source.graph_node_id = embedding.graph_node_id
              AND node_source.source_name = ?
          )
        ORDER BY embedding.graph_node_id
      `,
      [model.id, options.sourceName]
    );

    const vectors = rows.map((row, index) => toVectorRecord(row, model.dimensions, index));

    return {
      model,
      vectors
    };
  });
  const manifestPath = path.resolve(options.outPath ?? defaultOccupationVectorManifestPath(options.sourceName, options.modelKey));
  const metadataPath = path.resolve(path.dirname(manifestPath), path.basename(defaultOccupationVectorMetadataPath(options.sourceName, options.modelKey)));
  const vectorsPath = path.resolve(path.dirname(manifestPath), path.basename(defaultOccupationVectorValuesPath(options.sourceName, options.modelKey)));
  const manifest = {
    schemaVersion: 1,
    sourceName: options.sourceName,
    modelKey: exportResult.model.model_key,
    provider: exportResult.model.provider,
    dimensions: exportResult.model.dimensions,
    textRole: 'dense_text',
    localeCode: null,
    generatedAt: new Date().toISOString(),
    count: exportResult.vectors.length,
    metadataPath: path.relative(path.dirname(manifestPath), metadataPath),
    vectorsPath: path.relative(path.dirname(manifestPath), vectorsPath),
    vectorDataType: 'float32_le'
  } satisfies OccupationVectorArtifactManifest;

  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(
    metadataPath,
    exportResult.vectors.map(({ vector, ...record }) => JSON.stringify(record)).join('\n') + '\n',
    'utf8'
  );
  await writeFile(vectorsPath, vectorValueBuffer(exportResult.vectors, manifest.dimensions));

  console.log(`Exported ${manifest.count} occupation vectors to ${manifestPath}`);
  console.log(`metadata=${metadataPath}`);
  console.log(`vectors=${vectorsPath}`);
  console.log(`source=${manifest.sourceName} model=${manifest.modelKey} provider=${manifest.provider} dimensions=${manifest.dimensions}`);
}

function toVectorRecord(row: VectorExportRow, dimensions: number, index: number): VectorExportRecord {
  const vector = parseEmbeddingJson(row.embedding_json, dimensions);

  if (!vector) {
    throw new Error(`Invalid embedding vector for graph_node_id=${row.graph_node_id}.`);
  }

  return {
    index,
    graphNodeId: row.graph_node_id,
    canonicalLabel: row.canonical_label,
    familyNodeId: row.family_node_id,
    familyLabel: row.family_label,
    vectorNorm: toNullableNumber(row.vector_norm),
    vector
  };
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    sourceName: DEFAULT_ESCO_SOURCE_NAME,
    modelKey: DEFAULT_MODEL_KEY,
    outPath: null
  };

  for (const arg of args) {
    if (arg.startsWith('--source-name=')) {
      options.sourceName = arg.slice('--source-name='.length).trim();
      continue;
    }

    if (arg.startsWith('--model-key=')) {
      options.modelKey = arg.slice('--model-key='.length).trim();
      continue;
    }

    if (arg.startsWith('--out=')) {
      options.outPath = arg.slice('--out='.length).trim();
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

function parseEmbeddingJson(value: unknown, dimensions: number): number[] | null {
  const parsed = typeof value === 'string' ? JSON.parse(value) as unknown : value;

  if (!Array.isArray(parsed) || parsed.length !== dimensions) {
    return null;
  }

  const vector = parsed.map((item) => (typeof item === 'number' ? item : Number.NaN));
  return vector.every((item) => Number.isFinite(item)) ? vector : null;
}

function toNullableNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function vectorValueBuffer(records: VectorExportRecord[], dimensions: number): Buffer {
  const buffer = Buffer.allocUnsafe(records.length * dimensions * Float32Array.BYTES_PER_ELEMENT);

  records.forEach((record, recordIndex) => {
    record.vector.forEach((value, dimensionIndex) => {
      buffer.writeFloatLE(value, (recordIndex * dimensions + dimensionIndex) * Float32Array.BYTES_PER_ELEMENT);
    });
  });

  return buffer;
}

function printHelp(): void {
  console.log(
    [
      'Usage: node dist/cli/export-occupation-vector-artifact.js',
      `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
      `[--model-key=${DEFAULT_MODEL_KEY}]`,
      '[--out=artifacts/runtime/occupation-vectors.esco_1_2_1.hf-paraphrase-multilingual-minilm-l12-v2.manifest.json]'
    ].join(' ')
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Occupation vector artifact export failed.');
  console.error(message);
  process.exitCode = 1;
});
