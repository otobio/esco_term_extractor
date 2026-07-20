import { withConnection } from '../db/mysql.js';
import { OpenSearchClient } from '../opensearch/client.js';
import { defaultOpenSearchTemplateName, getOpenSearchConfig } from '../opensearch/config.js';
import { OccupationOpenSearchBulkIndexer } from '../opensearch/occupations-index.js';

type CliOptions = {
  sourceName?: string;
  indexName?: string;
  templateName?: string;
  chunkSize?: number;
  limit?: number;
  modelKey?: string;
  ensureIndex?: boolean;
  recreateIndex?: boolean;
  includeVectorField?: boolean;
  refresh?: boolean;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const config = getOpenSearchConfig();
  const result = await withConnection(async (connection) => {
    const indexer = new OccupationOpenSearchBulkIndexer(connection, new OpenSearchClient(config), config);

    return indexer.run({
      sourceName: options.sourceName,
      indexName: options.indexName,
      templateName: options.templateName,
      chunkSize: options.chunkSize,
      limit: options.limit,
      modelKey: options.modelKey,
      ensureIndex: options.ensureIndex,
      recreateIndex: options.recreateIndex,
      includeVectorField: options.includeVectorField,
      refresh: options.refresh,
      onProgress: (progress) => {
        const remainingSummary = progress.remaining === undefined ? '' : `, remaining ${progress.remaining}`;
        console.log(
          `Indexed chunk of ${progress.chunkDocumentCount} occupation docs through graph_node_id=${progress.lastGraphNodeId}; indexed ${progress.indexedDocumentCount}, failed ${progress.failedDocumentCount}, vectors ${progress.vectorDocumentCount}${remainingSummary}.`
        );
      }
    });
  });

  const embeddingSummary = result.usedEmbeddingModelKey
    ? `embedding model "${result.usedEmbeddingModelKey}" (${result.embeddingDimensions} dims)`
    : 'no embedding model found; dense_vector omitted from documents';

  console.log(
    `OpenSearch occupation population completed for index "${result.indexName}" from source "${result.sourceName}" with chunk size ${result.chunkSize}; ${embeddingSummary}.`
  );
  console.log(
    `Attempted ${result.attemptedDocumentCount}/${result.totalCandidateCount} documents, indexed ${result.indexedDocumentCount}, failed ${result.failedDocumentCount}, vectors ${result.vectorDocumentCount}.`
  );
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    ensureIndex: true,
    includeVectorField: true,
    refresh: true
  };

  for (const arg of args) {
    if (arg.startsWith('--source-name=')) {
      options.sourceName = arg.slice('--source-name='.length).trim();
      continue;
    }

    if (arg.startsWith('--index-name=')) {
      options.indexName = arg.slice('--index-name='.length).trim();
      continue;
    }

    if (arg.startsWith('--template-name=')) {
      options.templateName = arg.slice('--template-name='.length).trim();
      continue;
    }

    if (arg.startsWith('--chunk-size=')) {
      options.chunkSize = parsePositiveInteger('chunk-size', arg.slice('--chunk-size='.length));
      continue;
    }

    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger('limit', arg.slice('--limit='.length));
      continue;
    }

    if (arg.startsWith('--model-key=')) {
      options.modelKey = arg.slice('--model-key='.length).trim();
      continue;
    }

    if (arg === '--skip-create') {
      options.ensureIndex = false;
      continue;
    }

    if (arg === '--recreate-index') {
      options.recreateIndex = true;
      continue;
    }

    if (arg === '--no-vector-field') {
      options.includeVectorField = false;
      continue;
    }

    if (arg === '--no-refresh') {
      options.refresh = false;
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

function parsePositiveInteger(flagName: string, value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${flagName} must be a positive integer. Received "${value}".`);
  }

  return parsed;
}

function printHelp(): void {
  const config = getOpenSearchConfig();

  console.log(
    [
      'Usage: node dist/cli/populate-opensearch-occupations.js',
      '[--source-name=esco_1_2_1]',
      `[--index-name=${config.occupationsIndex}]`,
      `[--template-name=${defaultOpenSearchTemplateName(config.occupationsIndex)}]`,
      '[--chunk-size=250]',
      '[--limit=N]',
      '[--model-key=hf-paraphrase-multilingual-minilm-l12-v2]',
      '[--skip-create]',
      '[--recreate-index]',
      '[--no-vector-field]',
      '[--no-refresh]'
    ].join(' ')
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('OpenSearch occupation population failed.');
  console.error(message);
  process.exitCode = 1;
});
