import { appendFile } from 'node:fs/promises';

const DEFAULT_INGEST_LOG_FILE = '/tmp/esco-term-extractor-ingest.jsonl';

export interface IngestLogOptions {
  runtime?: unknown;
  locale?: string;
  countryCode?: string;
  bucket?: string;
  profile?: string;
  mode?: string;
}

export function summarizeIngestOptions(opts: IngestLogOptions): Record<string, unknown> {
  return {
    locale: opts.locale,
    countryCode: opts.countryCode,
    bucket: opts.bucket,
    profile: opts.profile,
    mode: opts.mode,
    hasRuntime: Boolean(opts.runtime),
  };
}

function jsonSafe(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, nested) => {
      if (typeof nested === 'bigint') return nested.toString();
      return nested;
    }),
  );
}

export async function logIngestCall(event: string, payload: Record<string, unknown>): Promise<void> {
  const logFile = process.env.ESCO_TERM_EXTRACTOR_INGEST_LOG_FILE ?? DEFAULT_INGEST_LOG_FILE;
  const entry = {
    at: new Date().toISOString(),
    event,
    ...payload,
  };

  try {
    await appendFile(logFile, `${JSON.stringify(jsonSafe(entry), null, 2)}\n`);
  } catch (err) {
    console.warn('[esco-term-extractor ingest logger] failed to write log', err);
  }
}
