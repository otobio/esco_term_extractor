/**
 * Fetch-based OpenSearch client for the matcher — batched `_msearch` against the
 * `canonical_runtime_terms` index, plus one-time discovery of the deployed
 * neural-sparse query-tokenizer model. No OpenSearch SDK dependency.
 */
import { opensearchFetch } from '@term-extractor/utils/opensearch-fetch';
import type { OpenSearchClient } from './types.ts';

const QUERY_TOKENIZER_MODEL = 'amazon/neural-sparse/opensearch-neural-sparse-tokenizer-v1';

export interface OpenSearchClientOptions {
  url?: string;
  index?: string;
  /** Optional HTTP basic auth for a secured cluster (local dev usually needs none). */
  auth?: { username: string; password: string };
  /** Force a query model id (skips discovery); pass null to disable neural. */
  queryModelId?: string | null;
}

export function createOpenSearchClient(options: OpenSearchClientOptions = {}): OpenSearchClient {
  const url = (options.url ?? process.env.OPENSEARCH_URL ?? 'http://localhost:9201').replace(/\/$/, '');
  const index = options.index ?? process.env.CANONICAL_RUNTIME_TERMS_INDEX ?? 'canonical_runtime_terms';
  let modelId: string | null | undefined = options.queryModelId;

  const authHeader = options.auth
    ? { Authorization: `Basic ${Buffer.from(`${options.auth.username}:${options.auth.password}`).toString('base64')}` }
    : undefined;

  return {
    async queryModelId(): Promise<string | null> {
      if (modelId !== undefined) return modelId;
      try {
        const res = await opensearchFetch(`${url}/_plugins/_ml/models/_search`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeader },
          body: JSON.stringify({
            size: 1,
            query: {
              bool: {
                must: [{ term: { model_state: 'DEPLOYED' } }, { match_phrase: { name: QUERY_TOKENIZER_MODEL } }],
              },
            },
          }),
        });
        const body = res.ok ? ((await res.json()) as { hits?: { hits?: { _id?: string }[] } }) : null;
        modelId = body?.hits?.hits?.[0]?._id ?? null;
      } catch {
        modelId = null;
      }
      return modelId;
    },

    async msearch(queries: Record<string, unknown>[]): Promise<unknown[]> {
      const lines: string[] = [];
      for (const q of queries) {
        lines.push(JSON.stringify({ index }));
        lines.push(JSON.stringify(q));
      }
      const res = await opensearchFetch(`${url}/_msearch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-ndjson', ...authHeader },
        body: `${lines.join('\n')}\n`,
      });
      if (!res.ok) throw new Error(`_msearch -> ${res.status} ${await res.text()}`);
      const body = (await res.json()) as { responses?: unknown[] };
      return body.responses ?? [];
    },
  };
}
