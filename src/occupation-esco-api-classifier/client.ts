import { BoundedCache } from '../utils/cache.js';
import { isRecord } from '../utils/validation.js';
import {
  ESCO_API_BASE_URL,
  ESCO_API_FAMILY_CACHE_SIZE,
  ESCO_API_PAGE_LIMIT,
  ESCO_API_RESPONSE_CACHE_SIZE,
  ESCO_API_RETRIES,
  ESCO_API_RETRY_BACKOFF_MS,
  ESCO_API_TIMEOUT_MS,
  ESCO_API_VERSION,
  ESCO_ISCO_URI_PREFIX,
  ESCO_OCCUPATION_URI_PREFIX,
  SKOS_XL_LABEL_TYPES
} from './config.js';
import type { EscoApiLocale, EscoIscoGroup, EscoSearchHit, EscoTerm } from './types.js';

export type EscoApiFetch = (
  url: string,
  init: { signal: AbortSignal; headers: Record<string, string> }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export type EscoApiClientOptions = {
  baseUrl?: string;
  version?: string;
  timeoutMs?: number;
  retries?: number;
  fetch?: EscoApiFetch;
};

type QueryParams = Record<string, string | number | string[]>;

export class EscoApiError extends Error {
  public constructor(message: string, public readonly status: number | null) {
    super(message);
  }
}

export class EscoApiClient {
  private readonly baseUrl: string;
  private readonly version: string;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly fetchImpl: EscoApiFetch;
  private readonly responseCache = new BoundedCache<string, unknown>(ESCO_API_RESPONSE_CACHE_SIZE);
  private readonly iscoGroupCache = new BoundedCache<string, EscoIscoGroup>(ESCO_API_FAMILY_CACHE_SIZE);

  public constructor(options: EscoApiClientOptions = {}) {
    this.baseUrl = (options.baseUrl ?? ESCO_API_BASE_URL).replace(/\/+$/u, '');
    this.version = options.version ?? ESCO_API_VERSION;
    this.timeoutMs = options.timeoutMs ?? ESCO_API_TIMEOUT_MS;
    this.retries = options.retries ?? ESCO_API_RETRIES;
    this.fetchImpl = options.fetch ?? (globalThis.fetch as EscoApiFetch);
  }

  public async searchOccupations(text: string, language: EscoApiLocale): Promise<EscoSearchHit[]> {
    const body = await this.getJson('search', { text, language, type: 'occupation', limit: ESCO_API_PAGE_LIMIT, full: 'false' });

    return embeddedResults(body).flatMap(parseSearchHit);
  }

  public async searchTerms(text: string, language: EscoApiLocale): Promise<EscoTerm[]> {
    const body = await this.getJson('terms', { text, language, type: 'occupation', limit: ESCO_API_PAGE_LIMIT });

    return embeddedResults(body).flatMap(parseTerm);
  }

  public async getIscoGroups(uris: string[], language: EscoApiLocale): Promise<Map<string, EscoIscoGroup>> {
    const groups = new Map<string, EscoIscoGroup>();
    const missing: string[] = [];

    for (const uri of new Set(uris)) {
      const cached = this.iscoGroupCache.get(`${language}|${uri}`);

      if (cached) {
        groups.set(uri, cached);
      } else {
        missing.push(uri);
      }
    }

    if (missing.length === 0) {
      return groups;
    }

    const body = await this.getJson('resource/concept', { uris: missing, language });
    const embedded = isRecord(body) && isRecord(body._embedded) ? Object.values(body._embedded) : [];

    for (const group of embedded.flatMap(parseIscoGroup)) {
      this.iscoGroupCache.set(`${language}|${group.uri}`, group);
      groups.set(group.uri, group);
    }

    return groups;
  }

  private async getJson(path: string, params: QueryParams): Promise<unknown> {
    const url = this.buildUrl(path, params);
    const cached = this.responseCache.get(url);

    if (cached !== undefined) {
      return cached;
    }

    const body = await this.fetchWithRetry(url);
    this.responseCache.set(url, body);

    return body;
  }

  private buildUrl(path: string, params: QueryParams): string {
    const search = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      for (const item of Array.isArray(value) ? value : [value]) {
        search.append(key, String(item));
      }
    }

    search.append('selectedVersion', this.version);

    return `${this.baseUrl}/${path}?${search.toString()}`;
  }

  private async fetchWithRetry(url: string): Promise<unknown> {
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      if (attempt > 0) {
        await new Promise((resolve) => setTimeout(resolve, ESCO_API_RETRY_BACKOFF_MS * attempt));
      }

      try {
        const response = await this.fetchImpl(url, {
          signal: AbortSignal.timeout(this.timeoutMs),
          headers: { Accept: 'application/json' }
        });

        if (response.ok) {
          return await response.json();
        }

        lastError = new EscoApiError(`ESCO API ${response.status} for ${url}`, response.status);

        if (response.status < 500) {
          break;
        }
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError instanceof EscoApiError ? lastError : new EscoApiError(`ESCO API request failed for ${url}: ${String(lastError)}`, null);
  }
}

let defaultClient: EscoApiClient | null = null;

export function defaultEscoApiClient(): EscoApiClient {
  defaultClient ??= new EscoApiClient();

  return defaultClient;
}

function embeddedResults(body: unknown): unknown[] {
  if (!isRecord(body) || !isRecord(body._embedded) || !Array.isArray(body._embedded.results)) {
    throw new EscoApiError('ESCO API response is missing _embedded.results', null);
  }

  return body._embedded.results;
}

function parseSearchHit(row: unknown): EscoSearchHit[] {
  if (!isRecord(row) || typeof row.uri !== 'string' || typeof row.code !== 'string' || typeof row.title !== 'string') {
    return [];
  }

  if (!row.uri.startsWith(ESCO_OCCUPATION_URI_PREFIX)) {
    return [];
  }

  const preferredLabels = isRecord(row.preferredLabel)
    ? Object.fromEntries(Object.entries(row.preferredLabel).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
    : {};

  return [
    {
      uri: row.uri,
      code: row.code,
      title: row.title,
      preferredLabels,
      searchHit: typeof row.searchHit === 'string' ? row.searchHit : null
    }
  ];
}

function parseTerm(row: unknown): EscoTerm[] {
  if (!isRecord(row) || typeof row.concept !== 'string' || typeof row.literalForm !== 'string' || typeof row.hasLabelType !== 'string') {
    return [];
  }

  const isOccupation = row.concept.startsWith(ESCO_OCCUPATION_URI_PREFIX);
  const isIscoGroup = row.concept.startsWith(ESCO_ISCO_URI_PREFIX);
  const labelSource = SKOS_XL_LABEL_TYPES[row.hasLabelType as keyof typeof SKOS_XL_LABEL_TYPES];

  if ((!isOccupation && !isIscoGroup) || !labelSource) {
    return [];
  }

  return [{ conceptUri: row.concept, literalForm: row.literalForm, labelSource }];
}

function parseIscoGroup(row: unknown): EscoIscoGroup[] {
  if (!isRecord(row) || typeof row.uri !== 'string' || typeof row.code !== 'string' || typeof row.title !== 'string') {
    return [];
  }

  const englishLabel = isRecord(row.preferredLabel) && typeof row.preferredLabel.en === 'string' ? row.preferredLabel.en : row.title;

  return [{ uri: row.uri, code: row.code, label: englishLabel, localLabel: row.title }];
}
