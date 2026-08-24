#!/usr/bin/env node
// Guard-rail run before `git commit`: fails loudly if artifacts/runtime has grown past the
// GitHub-friendly size budget, or if serving the golden suite pushes runtime RSS past a sane
// ceiling. Both numbers are override-able via flags since "sane" will drift as the artifact set
// grows -- treat a failure here as "go look", not as an immovable law.
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_ARTIFACTS_MAX_MB = 195;
// Measured: live JS heap and mmap'd binary-cache artifacts stay flat (~90-120MB heap, ~59MB
// external) across the full 193-case/4-locale golden suite -- there's no data-accumulation leak.
// The RSS growth without these flags (peaks ~630MB) is V8 reserving heap capacity after
// allocation bursts and never giving it back; capping semi-space/old-space size keeps that
// reservation bounded without changing results (same 100/193 pass count at every setting tried).
// --max-semi-space-size=8 --max-old-space-size=200 keeps this worst-case run (all 4 locales
// resident in one process) around ~320MB peak, with headroom under the ~400MB AWS runtime budget.
const DEFAULT_MEMORY_MAX_MB = 400;
const MEMORY_CAPPING_NODE_FLAGS = ['--max-semi-space-size=8', '--max-old-space-size=200'];
const SAMPLE_INTERVAL_MS = 250;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const artifactsResult = await checkArtifactsSize(options.artifactsMaxMb);
  const memoryResult = options.skipMemory ? null : await checkRuntimeMemory(options.memoryMaxMb);

  console.log('');
  console.log(
    `artifacts/runtime size: ${artifactsResult.totalMb.toFixed(1)} MB (limit ${options.artifactsMaxMb} MB) -- ${artifactsResult.ok ? 'OK' : 'OVER LIMIT'}`
  );

  if (memoryResult) {
    console.log(
      `golden-suite peak RSS: ${memoryResult.peakMb.toFixed(1)} MB (limit ${options.memoryMaxMb} MB) -- ${memoryResult.ok ? 'OK' : 'OVER LIMIT'}`
    );
  } else {
    console.log('golden-suite peak RSS: skipped (--skip-memory)');
  }

  const failed = !artifactsResult.ok || (memoryResult && !memoryResult.ok);

  if (failed) {
    console.error('\nPre-commit limit check FAILED -- review before committing.');
    process.exitCode = 1;
    return;
  }

  console.log('\nPre-commit limit check passed.');
}

function parseArgs(args) {
  const options = {
    artifactsMaxMb: DEFAULT_ARTIFACTS_MAX_MB,
    memoryMaxMb: DEFAULT_MEMORY_MAX_MB,
    skipMemory: false
  };

  for (const arg of args) {
    if (arg.startsWith('--artifacts-max-mb=')) {
      options.artifactsMaxMb = Number(arg.slice('--artifacts-max-mb='.length));
      continue;
    }

    if (arg.startsWith('--memory-max-mb=')) {
      options.memoryMaxMb = Number(arg.slice('--memory-max-mb='.length));
      continue;
    }

    if (arg === '--skip-memory') {
      options.skipMemory = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

async function checkArtifactsSize(maxMb) {
  const artifactsDir = path.join(REPO_ROOT, 'artifacts', 'runtime');
  const totalBytes = await directorySizeBytes(artifactsDir);
  const totalMb = totalBytes / (1024 * 1024);

  return { totalMb, ok: totalMb <= maxMb };
}

async function directorySizeBytes(directory) {
  let total = 0;
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      total += await directorySizeBytes(entryPath);
      continue;
    }

    const entryStat = await stat(entryPath);
    total += entryStat.size;
  }

  return total;
}

async function checkRuntimeMemory(maxMb) {
  const child = spawn(
    process.execPath,
    [
      ...MEMORY_CAPPING_NODE_FLAGS,
      path.join(REPO_ROOT, 'dist', 'cli', 'run-pipeline-golden-suite.js'),
      '--retrieval-backend=binary-cache',
      '--suite=all'
    ],
    { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'inherit'] }
  );

  let peakKb = 0;
  const sampler = setInterval(() => {
    sampleRss(child.pid, (rssKb) => {
      if (rssKb !== null) {
        peakKb = Math.max(peakKb, rssKb);
      }
    });
  }, SAMPLE_INTERVAL_MS);

  const exitCode = await new Promise((resolve) => {
    child.on('exit', (code) => resolve(code ?? 0));
  });

  clearInterval(sampler);

  if (exitCode !== 0) {
    throw new Error(`Golden suite exited with code ${exitCode} while measuring memory.`);
  }

  const peakMb = peakKb / 1024;
  return { peakMb, ok: peakMb <= maxMb };
}

function sampleRss(pid, callback) {
  const ps = spawn('ps', ['-o', 'rss=', '-p', String(pid)]);
  let output = '';
  ps.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  ps.on('close', () => {
    const rssKb = Number(output.trim());
    callback(Number.isFinite(rssKb) && rssKb > 0 ? rssKb : null);
  });
  ps.on('error', () => callback(null));
}

main().catch((error) => {
  console.error('Pre-commit limit check errored.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
