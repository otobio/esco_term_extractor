import { withConnection } from '../db/mysql.js';
import { defaultOccupationEmbeddingDimensions, defaultOccupationEmbeddingModelKey, OccupationEmbeddingBuilder } from '../embeddings/occupation/build-occupation-embeddings.js';
import { DEFAULT_TRANSFORMERS_MODEL_NAME, TRANSFORMERS_MODEL_KEY } from '../embeddings/providers/index.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const result = await withConnection(async (connection) => {
        const builder = new OccupationEmbeddingBuilder(connection);
        return builder.run({
            sourceName: options.sourceName,
            provider: options.provider,
            modelKey: options.modelKey,
            modelName: options.modelName,
            cacheDir: options.cacheDir,
            dimensions: options.dimensions,
            skipExisting: options.skipExisting,
            limit: options.limit,
            processChunkSize: options.processChunkSize,
            onProgress: (progress) => {
                const remainingSummary = progress.remaining === undefined ? '' : `, remaining ${progress.remaining}`;
                console.log(`Embedded chunk of ${progress.chunkRowCount} rows for model "${progress.modelKey}" through graph_node_id=${progress.lastGraphNodeId}; processed ${progress.processedNodeCount}, inserted ${progress.insertedEmbeddingCount}${remainingSummary}.`);
            }
        });
    });
    const skipSummary = options.skipExisting ? 'skipping existing rows' : 'replacing scoped rows';
    const limitSummary = options.limit ? `, limit ${options.limit}` : '';
    console.log(`Occupation dense_text embeddings completed for source "${result.sourceName}" with model "${result.modelKey}" (${result.dimensions} dimensions, provider ${result.provider}, model id ${result.modelId}), ${skipSummary}${limitSummary}.`);
    console.log(`Processed ${result.processedNodeCount} graph nodes, inserted ${result.insertedEmbeddingCount} embeddings, skipped ${result.skippedEmptyTextCount} empty dense_text rows.`);
}
function parseCliOptions(args) {
    const options = {};
    for (const arg of args) {
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
            continue;
        }
        if (arg.startsWith('--provider=')) {
            options.provider = parseProvider(arg.slice('--provider='.length));
            continue;
        }
        if (arg.startsWith('--model-key=')) {
            options.modelKey = arg.slice('--model-key='.length).trim();
            continue;
        }
        if (arg.startsWith('--model-name=')) {
            options.modelName = arg.slice('--model-name='.length).trim();
            continue;
        }
        if (arg.startsWith('--cache-dir=')) {
            options.cacheDir = arg.slice('--cache-dir='.length).trim();
            continue;
        }
        if (arg.startsWith('--dimensions=')) {
            options.dimensions = parsePositiveInteger('dimensions', arg.slice('--dimensions='.length));
            continue;
        }
        if (arg === '--skip-existing') {
            options.skipExisting = true;
            continue;
        }
        if (arg.startsWith('--limit=')) {
            options.limit = parsePositiveInteger('limit', arg.slice('--limit='.length));
            continue;
        }
        if (arg.startsWith('--process-chunk-size=')) {
            options.processChunkSize = parsePositiveInteger('process-chunk-size', arg.slice('--process-chunk-size='.length));
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
function parseProvider(value) {
    const normalized = value.trim();
    if (normalized === 'local-hash' || normalized === 'transformers') {
        return normalized;
    }
    throw new Error(`Unsupported --provider="${value}". Use local-hash or transformers.`);
}
function parsePositiveInteger(flagName, value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`--${flagName} must be a positive integer. Received "${value}".`);
    }
    return parsed;
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/build-occupation-embeddings.js',
        '[--source-name=esco_1_2_1]',
        '[--provider=local-hash|transformers]',
        `[--model-key=${defaultOccupationEmbeddingModelKey()}]`,
        `[--model-name=${DEFAULT_TRANSFORMERS_MODEL_NAME}]`,
        `[--dimensions=${defaultOccupationEmbeddingDimensions()}]`,
        '[--cache-dir=/path/to/model-cache]',
        '[--skip-existing]',
        '[--limit=N]',
        '[--process-chunk-size=N]',
        '',
        `Transformers default model key: ${TRANSFORMERS_MODEL_KEY}. Transformers runs default to smaller process chunks for CPU inference.`
    ].join(' '));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Occupation dense_text embedding build failed.');
    console.error(message);
    process.exitCode = 1;
});
