import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const DEFAULT_PROMPT_PATH = path.join(ROOT, 'docs', 'LLM_JOB_TITLE_TRIAGE_REVIEW_PROMPT.md');
const DEFAULT_COLUMNS_PATH = path.join(ROOT, 'data', 'taxonomy-review', 'job-title-triage-brief.columns.json');
const DEFAULT_SCHEMA_PATH = path.join(ROOT, 'data', 'taxonomy-review', 'job-title-triage-output.schema.json');
const DEFAULT_BATCH_MANIFEST_PATH = path.join(ROOT, 'data', 'taxonomy-review', 'job-title-triage-batches.ro.all.manifest.json');
const DEFAULT_OUT_DIR = path.join(ROOT, 'data', 'taxonomy-review', 'job-title-triage-reviewed.ro.batches');
const DEFAULT_OUT_PATH = path.join(ROOT, 'data', 'taxonomy-review', 'job-title-triage-reviewed.ro.jsonl');
const DEFAULT_API_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = process.env.OPENAI_MODEL || 'gpt-5-mini';
const DEFAULT_API_KEY_ENV = 'OPENAI_API_KEY';

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const promptContract = readUtf8(options.promptPath);
  const columnsText = readUtf8(options.columnsPath);
  const schemaText = readUtf8(options.schemaPath);
  const schema = JSON.parse(schemaText);
  const manifest = JSON.parse(readUtf8(options.batchManifestPath));
  const batchFiles = selectBatchFiles(manifest, options);

  if (options.dryRun) {
    const preview = buildPrompt({
      promptContract,
      columnsText,
      schemaText,
      batchTsv: readUtf8(batchFiles[0].filePath)
    });

    console.log(
      [
        `dry_run=true`,
        `model=${options.model}`,
        `batch_count=${batchFiles.length}`,
        `first_batch=${batchFiles[0].batchIndex}`,
        `prompt_chars=${preview.length}`,
        `out_dir=${options.outDir}`,
        `out_path=${options.outPath}`
      ].join('  ')
    );
    return;
  }

  const apiKey = process.env[options.apiKeyEnv]?.trim();
  if (!apiKey) {
    throw new Error(`Missing ${options.apiKeyEnv}. Set it in the environment before running the direct LLM flow.`);
  }

  mkdirSync(options.outDir, { recursive: true });
  if (options.clearOutDir) {
    clearDirectory(options.outDir);
  }

  for (const batch of batchFiles) {
    const batchOutPath = path.join(options.outDir, `job-title-triage-reviewed.batch.${String(batch.batchIndex).padStart(4, '0')}.jsonl`);

    if (options.resume && fileExists(batchOutPath)) {
      console.log(`skip batch=${batch.batchIndex} existing=${batchOutPath}`);
      continue;
    }

    const batchTsv = readUtf8(batch.filePath);
    const expectedRows = countTsvRows(batchTsv);
    const prompt = buildPrompt({ promptContract, columnsText, schemaText, batchTsv });
    const responseText = await runBatchWithRetries({ options, prompt, batchIndex: batch.batchIndex, apiKey });
    const rows = parseAndValidateJsonLines(responseText, schema, expectedRows, batch.batchIndex);

    writeFileSync(batchOutPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
    console.log(`accepted batch=${batch.batchIndex} rows=${rows.length} out=${batchOutPath}`);
  }

  const merged = mergeBatchOutputs(options.outDir);
  writeFileSync(options.outPath, merged, 'utf8');
  console.log(`merged batches=${countJsonLines(merged)} out=${options.outPath}`);
}

function parseCliOptions(args) {
  const options = {
    promptPath: DEFAULT_PROMPT_PATH,
    columnsPath: DEFAULT_COLUMNS_PATH,
    schemaPath: DEFAULT_SCHEMA_PATH,
    batchManifestPath: DEFAULT_BATCH_MANIFEST_PATH,
    outDir: DEFAULT_OUT_DIR,
    outPath: DEFAULT_OUT_PATH,
    apiUrl: DEFAULT_API_URL,
    model: DEFAULT_MODEL,
    apiKeyEnv: DEFAULT_API_KEY_ENV,
    startBatch: 1,
    endBatch: Number.POSITIVE_INFINITY,
    batchIndex: null,
    maxRetries: 2,
    dryRun: false,
    resume: true,
    clearOutDir: false
  };

  for (const arg of args) {
    if (arg.startsWith('--prompt=')) {
      options.promptPath = resolveCliPath(arg.slice('--prompt='.length));
      continue;
    }
    if (arg.startsWith('--columns=')) {
      options.columnsPath = resolveCliPath(arg.slice('--columns='.length));
      continue;
    }
    if (arg.startsWith('--schema=')) {
      options.schemaPath = resolveCliPath(arg.slice('--schema='.length));
      continue;
    }
    if (arg.startsWith('--batch-manifest=')) {
      options.batchManifestPath = resolveCliPath(arg.slice('--batch-manifest='.length));
      continue;
    }
    if (arg.startsWith('--out-dir=')) {
      options.outDir = resolveCliPath(arg.slice('--out-dir='.length));
      continue;
    }
    if (arg.startsWith('--out=')) {
      options.outPath = resolveCliPath(arg.slice('--out='.length));
      continue;
    }
    if (arg.startsWith('--api-url=')) {
      options.apiUrl = arg.slice('--api-url='.length).trim();
      continue;
    }
    if (arg.startsWith('--model=')) {
      options.model = arg.slice('--model='.length).trim();
      continue;
    }
    if (arg.startsWith('--api-key-env=')) {
      options.apiKeyEnv = arg.slice('--api-key-env='.length).trim();
      continue;
    }
    if (arg.startsWith('--start-batch=')) {
      options.startBatch = positiveInteger(arg.slice('--start-batch='.length), '--start-batch');
      continue;
    }
    if (arg.startsWith('--end-batch=')) {
      options.endBatch = positiveInteger(arg.slice('--end-batch='.length), '--end-batch');
      continue;
    }
    if (arg.startsWith('--batch-index=')) {
      options.batchIndex = positiveInteger(arg.slice('--batch-index='.length), '--batch-index');
      continue;
    }
    if (arg.startsWith('--max-retries=')) {
      options.maxRetries = nonNegativeInteger(arg.slice('--max-retries='.length), '--max-retries');
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }
    if (arg === '--no-resume') {
      options.resume = false;
      continue;
    }
    if (arg === '--clear-out-dir') {
      options.clearOutDir = true;
      continue;
    }
    if (arg === '--help') {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.batchIndex !== null) {
    options.startBatch = options.batchIndex;
    options.endBatch = options.batchIndex;
  }

  if (options.endBatch < options.startBatch) {
    throw new Error('--end-batch must be greater than or equal to --start-batch');
  }

  return options;
}

function printHelp() {
  console.log(
    [
      'Usage: node scripts/run-llm-job-title-triage-direct.js',
      '[--batch-manifest=data/taxonomy-review/job-title-triage-batches.ro.all.manifest.json]',
      '[--batch-index=1]',
      '[--start-batch=1 --end-batch=10]',
      '[--out-dir=data/taxonomy-review/job-title-triage-reviewed.ro.batches]',
      '[--out=data/taxonomy-review/job-title-triage-reviewed.ro.jsonl]',
      '[--model=gpt-5-mini]',
      '[--api-key-env=OPENAI_API_KEY]',
      '[--max-retries=2]',
      '[--dry-run]',
      '[--no-resume]',
      '[--clear-out-dir]'
    ].join(' ')
  );
}

function selectBatchFiles(manifest, options) {
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  const selected = files
    .filter((entry) => Number.isInteger(entry.batch_index))
    .filter((entry) => entry.batch_index >= options.startBatch && entry.batch_index <= options.endBatch)
    .map((entry) => ({
      batchIndex: entry.batch_index,
      filePath: resolveCliPath(entry.file)
    }));

  if (selected.length === 0) {
    throw new Error('No batch files matched the requested batch selection.');
  }

  return selected.sort((left, right) => left.batchIndex - right.batchIndex);
}

function buildPrompt({ promptContract, columnsText, schemaText, batchTsv }) {
  return [
    promptContract.trim(),
    '',
    'Field definitions:',
    columnsText.trim(),
    '',
    'Output schema:',
    schemaText.trim(),
    '',
    'Review these TSV rows and output exactly one JSON object per row.',
    'Return newline-delimited JSON only.',
    'Do not wrap the objects in an array.',
    'Do not include markdown fences.',
    'Do not include commentary before or after the JSON objects.',
    '',
    'TSV rows:',
    batchTsv.trim(),
    ''
  ].join('\n');
}

async function runBatchWithRetries({ options, prompt, batchIndex, apiKey }) {
  let lastError = null;

  for (let attempt = 1; attempt <= options.maxRetries + 1; attempt += 1) {
    try {
      console.log(`request batch=${batchIndex} attempt=${attempt} model=${options.model}`);
      return await callResponsesApi({
        apiUrl: options.apiUrl,
        apiKey,
        model: options.model,
        prompt,
        retryMode: attempt > 1
      });
    } catch (error) {
      lastError = error;
      console.error(`retry batch=${batchIndex} attempt=${attempt} error=${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function callResponsesApi({ apiUrl, apiKey, model, prompt, retryMode }) {
  const inputText = retryMode
    ? `${prompt}\n\nYour last response did not follow the contract. Re-run the same TSV rows. Return newline-delimited JSON only. One JSON object per TSV row. No array wrapper. No markdown. No prose. Every object must match the provided schema exactly. If uncertain, keep artifact_proposals empty.`
    : prompt;

  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      input: inputText
    })
  });

  if (!response.ok) {
    throw new Error(`LLM API request failed with ${response.status} ${response.statusText}: ${await response.text()}`);
  }

  const payload = await response.json();
  const outputText = extractOutputText(payload);
  if (!outputText.trim()) {
    throw new Error('LLM API returned an empty response body.');
  }

  return outputText;
}

function extractOutputText(payload) {
  if (typeof payload.output_text === 'string') {
    return payload.output_text;
  }

  const output = Array.isArray(payload.output) ? payload.output : [];
  const chunks = [];

  for (const item of output) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (typeof part?.text === 'string') {
        chunks.push(part.text);
      }
    }
  }

  return chunks.join('\n').trim();
}

function parseAndValidateJsonLines(text, schema, expectedRows, batchIndex) {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length !== expectedRows) {
    throw new Error(`Batch ${batchIndex} returned ${lines.length} JSON lines, expected ${expectedRows}.`);
  }

  const rows = lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(
        `Batch ${batchIndex} has invalid JSON at output line ${index + 1}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  });

  const required = stringArray(schema.required);
  const titleTypeEnum = stringArray(schema.properties?.title_type?.enum);
  const failureModeEnum = stringArray(schema.properties?.pipeline_failure_mode?.enum);
  const proposalTypeEnum = stringArray(schema.properties?.artifact_proposals?.items?.properties?.type?.enum);

  for (const [index, row] of rows.entries()) {
    validateRow(row, { required, titleTypeEnum, failureModeEnum, proposalTypeEnum, batchIndex, rowNumber: index + 1 });
  }

  return rows;
}

function validateRow(row, context) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`Batch ${context.batchIndex} output line ${context.rowNumber} is not a JSON object.`);
  }

  for (const field of context.required) {
    if (!(field in row)) {
      throw new Error(`Batch ${context.batchIndex} output line ${context.rowNumber} is missing required field ${field}.`);
    }
  }

  if (!Number.isInteger(row.row_index) || row.row_index < 1) {
    throw new Error(`Batch ${context.batchIndex} output line ${context.rowNumber} has invalid row_index.`);
  }
  if (!context.titleTypeEnum.includes(row.title_type)) {
    throw new Error(`Batch ${context.batchIndex} output line ${context.rowNumber} has invalid title_type ${String(row.title_type)}.`);
  }
  if (typeof row.pipeline_result_plausible !== 'boolean') {
    throw new Error(`Batch ${context.batchIndex} output line ${context.rowNumber} has non-boolean pipeline_result_plausible.`);
  }
  if (!context.failureModeEnum.includes(row.pipeline_failure_mode)) {
    throw new Error(
      `Batch ${context.batchIndex} output line ${context.rowNumber} has invalid pipeline_failure_mode ${String(row.pipeline_failure_mode)}.`
    );
  }

  for (const field of ['role_heads', 'domain_terms', 'noise_terms', 'artifact_proposals']) {
    if (!Array.isArray(row[field])) {
      throw new Error(`Batch ${context.batchIndex} output line ${context.rowNumber} field ${field} must be an array.`);
    }
  }

  if ('role_modifiers' in row && !Array.isArray(row.role_modifiers)) {
    throw new Error(`Batch ${context.batchIndex} output line ${context.rowNumber} field role_modifiers must be an array when present.`);
  }

  for (const [proposalIndex, proposal] of row.artifact_proposals.entries()) {
    if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) {
      throw new Error(`Batch ${context.batchIndex} output line ${context.rowNumber} proposal ${proposalIndex + 1} is not an object.`);
    }
    if (!context.proposalTypeEnum.includes(proposal.type)) {
      throw new Error(
        `Batch ${context.batchIndex} output line ${context.rowNumber} proposal ${proposalIndex + 1} has invalid type ${String(proposal.type)}.`
      );
    }
  }
}

function mergeBatchOutputs(outDir) {
  const files = readdirSync(outDir)
    .filter((fileName) => fileName.endsWith('.jsonl'))
    .sort((left, right) => left.localeCompare(right));

  return files
    .map((fileName) => readUtf8(path.join(outDir, fileName)).trim())
    .filter(Boolean)
    .join('\n')
    .concat('\n');
}

function countTsvRows(tsv) {
  return tsv
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .slice(1).length;
}

function countJsonLines(text) {
  return text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean).length;
}

function clearDirectory(directoryPath) {
  for (const fileName of readdirSync(directoryPath)) {
    rmSync(path.join(directoryPath, fileName), { force: true, recursive: true });
  }
}

function resolveCliPath(filePath) {
  return path.isAbsolute(filePath) ? filePath : path.join(ROOT, filePath);
}

function readUtf8(filePath) {
  return readFileSync(filePath, 'utf8');
}

function fileExists(filePath) {
  try {
    readFileSync(filePath, 'utf8');
    return true;
  } catch {
    return false;
  }
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}

function positiveInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`${label} must be a positive integer.`);
  }
  return parsed;
}

function nonNegativeInteger(value, label) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${label} must be a non-negative integer.`);
  }
  return parsed;
}

main().catch((error) => {
  console.error('Direct LLM job-title triage flow failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
