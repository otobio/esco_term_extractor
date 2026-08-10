import { withConnection } from '../db/mysql.js';
import {
  DEFAULT_EURES_DOWNLOAD_DIR,
  DEFAULT_EURES_REPORT_DIR,
  EURES_COUNTRY_CONFIG,
  importEuresEscoAliasCandidates
} from './enrichment/eures/import-eures-esco-alias-candidates.js';

type SupportedCountry = keyof typeof EURES_COUNTRY_CONFIG;

type CliOptions = {
  sourceName?: string;
  countries?: SupportedCountry[];
  downloadDir?: string;
  reportDir?: string;
  sampleLimit?: number;
  writeArtifact?: boolean;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const result = await withConnection((connection) =>
    importEuresEscoAliasCandidates(connection, {
      sourceName: options.sourceName,
      countries: options.countries,
      downloadDir: options.downloadDir,
      reportDir: options.reportDir,
      sampleLimit: options.sampleLimit,
      writeArtifact: options.writeArtifact
    })
  );

  console.log('EURES ESCO alias candidate import completed.');
  console.log(`source=${result.sourceName} countries=${result.countries.join(',')} report=${result.reportPath}`);
  console.log(
    [
      `mapping_rows=${result.summary.mappingRows}`,
      `unique_aliases=${result.summary.uniqueAliases}`,
      `generate=${result.summary.generate}`,
      `review=${result.summary.review}`,
      `exclude=${result.summary.exclude}`
    ].join('  ')
  );
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    writeArtifact: true
  };

  for (const arg of args) {
    if (arg.startsWith('--source-name=')) {
      options.sourceName = arg.slice('--source-name='.length).trim();
      continue;
    }

    if (arg.startsWith('--countries=')) {
      options.countries = parseCountries(arg.slice('--countries='.length));
      continue;
    }

    if (arg.startsWith('--download-dir=')) {
      options.downloadDir = arg.slice('--download-dir='.length).trim();
      continue;
    }

    if (arg.startsWith('--report-dir=')) {
      options.reportDir = arg.slice('--report-dir='.length).trim();
      continue;
    }

    if (arg.startsWith('--sample-limit=')) {
      const sampleLimit = Number.parseInt(arg.slice('--sample-limit='.length), 10);

      if (!Number.isInteger(sampleLimit) || sampleLimit < 0) {
        throw new Error(`--sample-limit must be a non-negative integer. Received: ${arg}`);
      }

      options.sampleLimit = sampleLimit;
      continue;
    }

    if (arg === '--no-write-artifact') {
      options.writeArtifact = false;
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

function parseCountries(value: string): SupportedCountry[] {
  const countries = value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  const supported = Object.keys(EURES_COUNTRY_CONFIG);

  for (const country of countries) {
    if (!supported.includes(country)) {
      throw new Error(`Unsupported country "${country}". Supported values: ${supported.join(',')}`);
    }
  }

  return Array.from(new Set(countries)) as SupportedCountry[];
}

function printHelp(): void {
  console.log(
    [
      'Usage: node dist/cli/import-eures-esco-alias-candidates.js [options]',
      '',
      'Options:',
      '  --source-name=esco_1_2_1',
      '  --countries=ee,hu,ro',
      `  --download-dir=${DEFAULT_EURES_DOWNLOAD_DIR}`,
      `  --report-dir=${DEFAULT_EURES_REPORT_DIR}`,
      '  --sample-limit=20',
      '  --no-write-artifact',
      '  --help',
      '',
      'This command stages EURES-derived locale alias candidates for review. It does not promote aliases into the graph.'
    ].join('\n')
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('EURES ESCO alias candidate import failed.');
  console.error(message);
  process.exitCode = 1;
});
