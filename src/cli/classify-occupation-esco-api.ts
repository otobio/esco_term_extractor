import {
  classifyOccupationTitleViaEscoApi,
  classifyOccupationTitleViaEscoApiDebug,
  type EscoApiClassification,
  type EscoApiClassificationDebug
} from '../occupation-esco-api-classifier/index.js';

type CliOptions = { query: string; locale: string; debug: boolean; json: boolean };

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const input = { query: options.query, locale: options.locale };

  if (options.debug) {
    const debug = await classifyOccupationTitleViaEscoApiDebug(input);
    options.json ? console.log(JSON.stringify(debug, null, 2)) : printDebug(debug);
    return;
  }

  const result = await classifyOccupationTitleViaEscoApi(input);
  options.json ? console.log(JSON.stringify(result, null, 2)) : printResult(result, '');
}

function printResult(result: EscoApiClassification, indent: string): void {
  const { decision } = result;
  console.log(`${indent}decision: ${decision.type} (${decision.reason}, confidence=${decision.confidence}) language=${result.evidenceLanguage ?? '-'}`);

  if (result.leaf) {
    console.log(`${indent}leaf: ${result.leaf.label} [${result.leaf.code}] local="${result.leaf.localLabel}" matched="${result.leaf.matchedLabel}" (${result.leaf.matchedLabelSource})`);
  }

  if (result.family) {
    console.log(`${indent}family: ${result.family.label} [${result.family.code}] local="${result.family.localLabel}"`);
  }

  console.log(`${indent}coverage: matched=[${result.coverage.matchedTokens.join(', ')}] missing=[${result.coverage.missingTokens.join(', ')}]`);

  for (const leaf of result.altLeaves) {
    console.log(`${indent}  alt leaf: ${leaf.label} [${leaf.code}] matched="${leaf.matchedLabel}"`);
  }

  for (const family of result.altFamilies) {
    console.log(`${indent}  alt family: ${family.label} [${family.code}]`);
  }

  for (const span of result.spans ?? []) {
    console.log(`${indent}span "${span.query}":`);
    printResult(span.result, `${indent}  `);
  }
}

function printDebug(debug: EscoApiClassificationDebug): void {
  printResult(debug.result, '');

  for (const span of debug.spans) {
    console.log(`\nspan "${span.query}" language=${span.evidenceLanguage} timings=${JSON.stringify(span.timings)}`);

    for (const candidate of span.candidates.slice(0, 15)) {
      const match = candidate.match;
      const summary = match ? `${match.relation} ${match.source} overlap=${match.overlap.toFixed(2)} label="${match.label}"` : 'no label match';
      console.log(`  #${candidate.searchRank} ${candidate.label} [${candidate.code}] ${summary}`);
    }

    for (const family of span.familyLabelCandidates) {
      console.log(`  isco ${family.code} ${family.match.relation} label="${family.match.label}"`);
    }
  }
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = { query: '', locale: 'en', debug: false, json: false };

  for (const arg of args) {
    if (arg.startsWith('--query=')) {
      options.query = arg.slice('--query='.length).trim();
    } else if (arg.startsWith('--locale=')) {
      options.locale = arg.slice('--locale='.length).trim();
    } else if (arg === '--debug') {
      options.debug = true;
    } else if (arg === '--format=json') {
      options.json = true;
    } else if (arg !== '--no-color') {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!options.query) {
    throw new Error('Provide --query="...".');
  }

  return options;
}

main().catch((error: unknown) => {
  console.error('ESCO API classifier failed.');
  console.error(error);
  process.exitCode = 1;
});
