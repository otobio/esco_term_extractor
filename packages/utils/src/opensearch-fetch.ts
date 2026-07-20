/**
 * opensearchFetch — a drop-in `fetch` for OpenSearch (HTTP REST) that adds cluster
 * authentication. Generic and self-contained: it knows nothing about any consuming
 * app. Call sites use it exactly like `fetch`; auth strategies grow here without
 * touching them.
 *
 * Strategy is chosen from an explicit config (`configureOpenSearchAuth`) or, by
 * default, from the environment:
 *   - none  : transparent passthrough (local / unsecured cluster).
 *   - basic : HTTP Basic — OPENSEARCH_USERNAME / OPENSEARCH_PASSWORD.
 *   - aws   : AWS SigV4 signing for Amazon OpenSearch (managed `es` or serverless
 *             `aoss`) — AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN /
 *             AWS_REGION, service via OPENSEARCH_AWS_SERVICE (default `es`). Signing is
 *             done by `aws4fetch`, imported lazily so non-AWS callers never load it.
 */
import type { AwsClient } from 'aws4fetch';

export type OpenSearchAuth =
  | { kind: 'none' }
  | { kind: 'basic'; username: string; password: string }
  | {
      kind: 'aws';
      accessKeyId: string;
      secretAccessKey: string;
      sessionToken?: string;
      region: string;
      service?: 'es' | 'aoss';
    };

let configured: OpenSearchAuth | undefined;
let awsClient: AwsClient | undefined;

/** Explicitly set the auth strategy (overrides env auto-detection). `undefined`
 *  restores environment-based detection. */
export function configureOpenSearchAuth(auth: OpenSearchAuth | undefined): void {
  configured = auth;
  awsClient = undefined; // drop the memoized signer
}

function envAuth(): OpenSearchAuth {
  const e = process.env;
  const region = e.AWS_REGION ?? e.AWS_DEFAULT_REGION;
  const wantsAws = e.OPENSEARCH_AUTH === 'aws' || (!e.OPENSEARCH_USERNAME && !!e.AWS_ACCESS_KEY_ID);
  if (wantsAws && e.AWS_ACCESS_KEY_ID && e.AWS_SECRET_ACCESS_KEY && region) {
    return {
      kind: 'aws',
      accessKeyId: e.AWS_ACCESS_KEY_ID,
      secretAccessKey: e.AWS_SECRET_ACCESS_KEY,
      sessionToken: e.AWS_SESSION_TOKEN,
      region,
      service: e.OPENSEARCH_AWS_SERVICE === 'aoss' ? 'aoss' : 'es',
    };
  }
  if (e.OPENSEARCH_USERNAME && e.OPENSEARCH_PASSWORD) {
    return { kind: 'basic', username: e.OPENSEARCH_USERNAME, password: e.OPENSEARCH_PASSWORD };
  }
  return { kind: 'none' };
}

/** Same signature and behavior as `fetch`, plus cluster authentication. */
export function opensearchFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  const auth = configured ?? envAuth();
  if (auth.kind === 'aws') return awsFetch(auth, input, init);
  if (auth.kind === 'basic') {
    const headers = new Headers(init.headers);
    if (!headers.has('Authorization')) {
      headers.set('Authorization', `Basic ${Buffer.from(`${auth.username}:${auth.password}`).toString('base64')}`);
    }
    return fetch(input, { ...init, headers });
  }
  return fetch(input, init);
}

async function awsFetch(
  auth: Extract<OpenSearchAuth, { kind: 'aws' }>,
  input: string | URL,
  init: RequestInit,
): Promise<Response> {
  if (!awsClient) {
    const { AwsClient } = await import('aws4fetch'); // lazy: only when AWS auth is used
    awsClient = new AwsClient({
      accessKeyId: auth.accessKeyId,
      secretAccessKey: auth.secretAccessKey,
      sessionToken: auth.sessionToken,
      region: auth.region,
      service: auth.service ?? 'es',
    });
  }
  return awsClient.fetch(input.toString(), init);
}
