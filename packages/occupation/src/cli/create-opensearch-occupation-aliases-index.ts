import { OpenSearchClient } from '../opensearch/client.js';
import { defaultOpenSearchTemplateName, getOpenSearchConfig } from '../opensearch/config.js';
import { OccupationAliasOpenSearchIndexManager } from '../opensearch/occupation-aliases-index.js';

type CliOptions = {
  indexName?: string;
  templateName?: string;
  recreate?: boolean;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const config = getOpenSearchConfig();
  const manager = new OccupationAliasOpenSearchIndexManager(new OpenSearchClient(config), config);
  const result = await manager.createOrUpdate({
    indexName: options.indexName,
    templateName: options.templateName,
    recreate: options.recreate
  });
  const action = result.recreated ? 'recreated' : result.created ? 'created' : 'updated in place';

  console.log(`OpenSearch occupation alias index ${action}: index="${result.indexName}", template="${result.templateName}".`);
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {};

  for (const arg of args) {
    if (arg.startsWith('--index-name=')) {
      options.indexName = arg.slice('--index-name='.length).trim();
      continue;
    }

    if (arg.startsWith('--template-name=')) {
      options.templateName = arg.slice('--template-name='.length).trim();
      continue;
    }

    if (arg === '--recreate') {
      options.recreate = true;
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

function printHelp(): void {
  const config = getOpenSearchConfig();

  console.log(
    [
      'Usage: node dist/cli/create-opensearch-occupation-aliases-index.js',
      `[--index-name=${config.occupationAliasesIndex}]`,
      `[--template-name=${defaultOpenSearchTemplateName(config.occupationAliasesIndex)}]`,
      '[--recreate]'
    ].join(' ')
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('OpenSearch occupation alias index creation failed.');
  console.error(message);
  process.exitCode = 1;
});
