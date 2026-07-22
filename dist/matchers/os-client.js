/**
 * Fetch-based OpenSearch client for the matcher — batched `_msearch` against the
 * `canonical_runtime_terms` index, plus one-time discovery of the deployed
 * neural-sparse query-tokenizer model. No OpenSearch SDK dependency.
 */
import { opensearchFetch } from '@term-extractor/utils/opensearch-fetch';
import { timed } from '@term-extractor/utils/perf';
const QUERY_TOKENIZER_MODEL = 'amazon/neural-sparse/opensearch-neural-sparse-tokenizer-v1';
const REQUEST_TIMEOUT_MS = 5000;
export function createOpenSearchClient(options = {}) {
    const url = (options.url ?? process.env.OPENSEARCH_URL ?? 'http://localhost:9201').replace(/\/$/, '');
    const index = options.index ?? process.env.CANONICAL_RUNTIME_TERMS_INDEX ?? 'canonical_runtime_terms';
    let modelId = options.queryModelId;
    const authHeader = options.auth
        ? { Authorization: `Basic ${Buffer.from(`${options.auth.username}:${options.auth.password}`).toString('base64')}` }
        : undefined;
    return {
        async queryModelId() {
            if (modelId !== undefined)
                return modelId;
            await timed(async () => {
                try {
                    const res = await opensearchFetch(`${url}/_plugins/_ml/models/_search`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', ...authHeader },
                        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                        body: JSON.stringify({
                            size: 1,
                            query: {
                                bool: {
                                    must: [{ term: { model_state: 'DEPLOYED' } }, { match_phrase: { name: QUERY_TOKENIZER_MODEL } }],
                                },
                            },
                        }),
                    });
                    const body = res.ok ? (await res.json()) : null;
                    modelId = body?.hits?.hits?.[0]?._id ?? null;
                }
                catch {
                    modelId = null;
                }
            }, 'os_client.queryModelId');
            return modelId ?? null;
        },
        async msearch(queries) {
            return timed(async () => {
                const lines = [];
                for (const q of queries) {
                    lines.push(JSON.stringify({ index }));
                    lines.push(JSON.stringify(q));
                }
                const res = await opensearchFetch(`${url}/_msearch`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-ndjson', ...authHeader },
                    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
                    body: `${lines.join('\n')}\n`,
                });
                if (!res.ok)
                    throw new Error(`_msearch -> ${res.status} ${await res.text()}`);
                const body = (await res.json());
                return body.responses ?? [];
            }, `os_client.msearch queries=${queries.length}`);
        },
    };
}
