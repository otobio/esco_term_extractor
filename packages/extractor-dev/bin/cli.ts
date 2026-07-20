#!/usr/bin/env tsx
/**
 * term-extractor CLI.
 *
 *   # Interactive REPL — paste a description, type `.` on its own line to run:
 *   term-extractor repl [--data-dir data] [--buckets ...] [--languages ...]
 *   term-extractor                     # `repl` is the default in a terminal
 *
 *   # One-shot:
 *   term-extractor extract "<text>" [--buckets ...] [--languages ...] [--json] [--pretty]
 *   term-extractor extract --file post.txt
 *   cat post.txt | term-extractor extract
 *
 * (Use `npm run snapshot` and `npm run build:index` for the dictionary snapshot
 * and embedding build steps.)
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { TermExtractor } from '../src/extractor.ts';
import type { BucketName, ExtractionResult, StructuredResolution, SupportedLanguage } from '../src/types.ts';
import { ALL_BUCKETS } from '../src/types.ts';

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (code: string, s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s: string) => c('1', s);
const dim = (s: string) => c('2', s);
const cyan = (s: string) => c('36', s);
const green = (s: string) => c('32', s);
const yellow = (s: string) => c('33', s);
const red = (s: string) => c('31', s);

function scoreColor(score: number): (s: string) => string {
  if (score >= 0.8) return green;
  if (score >= 0.65) return yellow;
  return red;
}

function bar(score: number): string {
  const filled = Math.round(Math.max(0, Math.min(1, score)) * 10);
  return '▓'.repeat(filled) + '░'.repeat(10 - filled);
}

function methodTag(method: string): string {
  const label = method.padEnd(8);
  if (method === 'both') return green(label);
  if (method === 'semantic') return cyan(label);
  return yellow(label);
}

function formatResult(result: ExtractionResult): string {
  const lines: string[] = [];
  const buckets = Object.keys(result.matchesByBucket) as BucketName[];
  if (!buckets.length) {
    lines.push(dim('  (no matches)'));
  }
  // Preserve canonical bucket ordering.
  for (const bucket of ALL_BUCKETS) {
    const terms = result.matchesByBucket[bucket];
    if (!terms?.length) continue;
    lines.push('');
    lines.push(`${bold(cyan(bucket))} ${dim(`(${terms.length})`)}`);
    for (const t of terms) {
      const sc = scoreColor(t.score);
      lines.push(
        `  ${sc(t.score.toFixed(3))} ${dim(bar(t.score))} ${methodTag(t.method)} ` +
          `${t.displayName}  ${dim(`${t.canonicalKey} [${t.languageCode}]`)}`,
      );
    }
  }
  const d = result.diagnostics;
  lines.push('');
  lines.push(dim(`  ${d.clausesAnalyzed} clauses analyzed, ${d.clausesSkipped} skipped`));
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Shared option parsing
// ---------------------------------------------------------------------------

interface RunOpts {
  dataDir: string;
  buckets?: BucketName[];
  languages?: SupportedLanguage[];
}

function parseBuckets(v?: string): BucketName[] | undefined {
  return v
    ?.split(',')
    .map((s) => s.trim() as BucketName)
    .filter(Boolean);
}
function parseLangs(v?: string): SupportedLanguage[] | undefined {
  return v
    ?.split(',')
    .map((s) => s.trim() as SupportedLanguage)
    .filter(Boolean);
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

// ---------------------------------------------------------------------------
// extract (one-shot)
// ---------------------------------------------------------------------------

async function extractCmd(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'data-dir': { type: 'string', default: 'data' },
      buckets: { type: 'string' },
      languages: { type: 'string' },
      file: { type: 'string' },
      json: { type: 'boolean', default: false },
      pretty: { type: 'boolean', default: false },
    },
  });

  let text = values.file ? await readFile(resolve(values.file), 'utf8') : positionals.join(' ');
  if (!text.trim() && !process.stdin.isTTY) text = await readStdin();
  if (!text.trim()) {
    console.error('No input text. Pass text as an argument, use --file, or pipe via stdin.');
    process.exit(1);
  }

  const extractor = await TermExtractor.load({ dataDir: resolve(values['data-dir']!) });
  const result = await extractor.extract(text, {
    targetBuckets: parseBuckets(values.buckets),
    languages: parseLangs(values.languages),
  });

  if (values.json) console.log(JSON.stringify(result, null, values.pretty ? 2 : 0));
  else console.log(formatResult(result));
}

// ---------------------------------------------------------------------------
// structured (single-bucket keyword resolution)
// ---------------------------------------------------------------------------

function formatStructured(r: StructuredResolution): string {
  const head = `${bold(cyan(r.bucket))} ${dim('←')} ${bold(r.input)}`;
  if (!r.matched) return `${head}  ${red('(no match)')}`;
  const lines = [`${head}  ${dim(`[${r.method}]`)}`];
  for (const t of r.terms) {
    const sc = scoreColor(t.score);
    lines.push(
      `    ${sc(t.score.toFixed(3))} ${methodTag(t.method)} ${t.displayName}  ` +
        dim(`${t.canonicalKey} [${t.languageCode}]`),
    );
  }
  return lines.join('\n');
}

async function structuredCmd(argv: string[]) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'data-dir': { type: 'string', default: 'data' },
      languages: { type: 'string' },
      topk: { type: 'string', default: '3' },
      json: { type: 'boolean', default: false },
      pretty: { type: 'boolean', default: false },
    },
  });

  const [bucket, ...vals] = positionals;
  if (!bucket || !vals.length) {
    console.error(
      'Usage: term-extractor structured <bucket> "<value>" ["<value2>" ...] [--languages ro,en] [--topk 3] [--json]',
    );
    console.error(`  buckets: ${ALL_BUCKETS.join(', ')}`);
    process.exit(1);
  }
  if (!ALL_BUCKETS.includes(bucket as BucketName)) {
    console.error(`Unknown bucket "${bucket}". Expected one of: ${ALL_BUCKETS.join(', ')}`);
    process.exit(1);
  }

  const extractor = await TermExtractor.load({ dataDir: resolve(values['data-dir']!) });
  const results = await extractor.resolveStructuredMany(bucket as BucketName, vals, {
    languages: parseLangs(values.languages),
    topK: Number(values.topk),
  });

  if (values.json) console.log(JSON.stringify(results, null, values.pretty ? 2 : 0));
  else console.log(results.map(formatStructured).join('\n'));
}

// ---------------------------------------------------------------------------
// repl (interactive)
// ---------------------------------------------------------------------------

async function replCmd(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      'data-dir': { type: 'string', default: 'data' },
      buckets: { type: 'string' },
      languages: { type: 'string' },
    },
  });

  const opts: RunOpts = {
    dataDir: resolve(values['data-dir']!),
    buckets: parseBuckets(values.buckets),
    languages: parseLangs(values.languages),
  };

  process.stdout.write(dim('Loading model + index...'));
  const extractor = await TermExtractor.load({ dataDir: opts.dataDir });
  process.stdout.write(dim(' ready.\n'));

  printBanner(opts);

  const isTty = Boolean(process.stdin.isTTY);
  const rl = createInterface({ input: process.stdin, terminal: isTty, prompt: cyan('› ') });
  let buffer: string[] = [];

  const run = async (text: string) => {
    const t0 = Date.now();
    const result = await extractor.extract(text, {
      targetBuckets: opts.buckets,
      languages: opts.languages,
    });
    console.log(formatResult(result));
    console.log(dim(`  (${Date.now() - t0}ms)\n`));
  };

  // `for await` serializes handling so an async run() finishes before the next
  // line is read — correct for both a live TTY and piped input.
  if (isTty) rl.prompt();
  for await (const line of rl) {
    const trimmed = line.trim();

    if (trimmed.startsWith(':')) {
      const parts = trimmed.slice(1).split(/\s+/);
      const cmd = parts[0];
      const arg = parts.slice(1).join(' ');
      if (cmd === 'q' || cmd === 'quit' || cmd === 'exit') break;
      switch (cmd) {
        case 'buckets':
          opts.buckets = arg ? parseBuckets(arg) : undefined;
          console.log(dim(`  buckets = ${opts.buckets?.join(', ') ?? 'all'}\n`));
          break;
        case 'langs':
        case 'languages':
          opts.languages = arg ? parseLangs(arg) : undefined;
          console.log(dim(`  languages = ${opts.languages?.join(', ') ?? 'all'}\n`));
          break;
        case 'clear':
          buffer = [];
          console.log(dim('  buffer cleared\n'));
          break;
        case 'help':
          printBanner(opts);
          break;
        default:
          console.log(red(`  unknown command :${cmd}\n`));
      }
      if (isTty) rl.prompt();
      continue;
    }

    // `.` on its own line runs the accumulated buffer.
    if (trimmed === '.') {
      const text = buffer.join('\n').trim();
      buffer = [];
      if (!text) console.log(dim('  (nothing to run)\n'));
      else await run(text);
      if (isTty) rl.prompt();
      continue;
    }

    buffer.push(line);
  }

  rl.close();
  console.log(dim('\nbye.'));
}

function printBanner(opts: RunOpts) {
  console.log(bold('\nterm-extractor REPL'));
  console.log(dim('  Paste a job description, then type a single "." on its own line to extract.'));
  console.log(dim('  Commands: :buckets a,b | :langs ro,en | :clear | :help | :quit (or Ctrl-D)'));
  console.log(
    dim(`  buckets = ${opts.buckets?.join(', ') ?? 'all'} | languages = ${opts.languages?.join(', ') ?? 'all'}\n`),
  );
}

// ---------------------------------------------------------------------------

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  switch (cmd) {
    case 'extract':
      await extractCmd(rest);
      break;
    case 'structured':
      await structuredCmd(rest);
      break;
    case 'repl':
      await replCmd(rest);
      break;
    case undefined:
      // No subcommand: REPL in a terminal, otherwise treat stdin as one-shot.
      if (process.stdin.isTTY) await replCmd([]);
      else await extractCmd([]);
      break;
    default:
      console.error('Usage: term-extractor <repl|extract|structured> [options]');
      console.error('  term-extractor repl');
      console.error('  term-extractor extract "<text>" [--file f] [--buckets ...] [--languages ...] [--json]');
      console.error('  term-extractor structured <bucket> "<value>" [--languages ...] [--topk N] [--json]');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
