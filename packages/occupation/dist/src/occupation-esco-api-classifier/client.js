import { BoundedCache } from '../utils/cache.js';
import { isRecord } from '../utils/validation.js';
import { ESCO_API_BASE_URL, ESCO_API_FAMILY_CACHE_SIZE, ESCO_API_PAGE_LIMIT, ESCO_API_RESPONSE_CACHE_SIZE, ESCO_API_RETRIES, ESCO_API_RETRY_BACKOFF_MS, ESCO_API_TIMEOUT_MS, ESCO_API_VERSION, ESCO_ISCO_URI_PREFIX, ESCO_OCCUPATION_URI_PREFIX, SKOS_XL_LABEL_TYPES } from './config.js';
export class EscoApiError extends Error {
    status;
    constructor(message, status) {
        super(message);
        this.status = status;
    }
}
export class EscoApiClient {
    baseUrl;
    version;
    timeoutMs;
    retries;
    fetchImpl;
    responseCache = new BoundedCache(ESCO_API_RESPONSE_CACHE_SIZE);
    iscoGroupCache = new BoundedCache(ESCO_API_FAMILY_CACHE_SIZE);
    constructor(options = {}) {
        this.baseUrl = (options.baseUrl ?? ESCO_API_BASE_URL).replace(/\/+$/u, '');
        this.version = options.version ?? ESCO_API_VERSION;
        this.timeoutMs = options.timeoutMs ?? ESCO_API_TIMEOUT_MS;
        this.retries = options.retries ?? ESCO_API_RETRIES;
        this.fetchImpl = options.fetch ?? globalThis.fetch;
    }
    async searchOccupations(text, language) {
        const body = await this.getJson('search', { text, language, type: 'occupation', limit: ESCO_API_PAGE_LIMIT, full: 'false' });
        return embeddedResults(body).flatMap(parseSearchHit);
    }
    async searchTerms(text, language) {
        const body = await this.getJson('terms', { text, language, type: 'occupation', limit: ESCO_API_PAGE_LIMIT });
        return embeddedResults(body).flatMap(parseTerm);
    }
    async getIscoGroups(uris, language) {
        const groups = new Map();
        const missing = [];
        for (const uri of new Set(uris)) {
            const cached = this.iscoGroupCache.get(`${language}|${uri}`);
            if (cached) {
                groups.set(uri, cached);
            }
            else {
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
    async getJson(path, params) {
        const url = this.buildUrl(path, params);
        const cached = this.responseCache.get(url);
        if (cached !== undefined) {
            return cached;
        }
        const body = await this.fetchWithRetry(url);
        this.responseCache.set(url, body);
        return body;
    }
    buildUrl(path, params) {
        const search = new URLSearchParams();
        for (const [key, value] of Object.entries(params)) {
            for (const item of Array.isArray(value) ? value : [value]) {
                search.append(key, String(item));
            }
        }
        search.append('selectedVersion', this.version);
        return `${this.baseUrl}/${path}?${search.toString()}`;
    }
    async fetchWithRetry(url) {
        let lastError = null;
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
            }
            catch (error) {
                lastError = error;
            }
        }
        throw lastError instanceof EscoApiError ? lastError : new EscoApiError(`ESCO API request failed for ${url}: ${String(lastError)}`, null);
    }
}
let defaultClient = null;
export function defaultEscoApiClient() {
    defaultClient ??= new EscoApiClient();
    return defaultClient;
}
function embeddedResults(body) {
    if (!isRecord(body) || !isRecord(body._embedded) || !Array.isArray(body._embedded.results)) {
        throw new EscoApiError('ESCO API response is missing _embedded.results', null);
    }
    return body._embedded.results;
}
function parseSearchHit(row) {
    if (!isRecord(row) || typeof row.uri !== 'string' || typeof row.code !== 'string' || typeof row.title !== 'string') {
        return [];
    }
    if (!row.uri.startsWith(ESCO_OCCUPATION_URI_PREFIX)) {
        return [];
    }
    const preferredLabels = isRecord(row.preferredLabel)
        ? Object.fromEntries(Object.entries(row.preferredLabel).filter((entry) => typeof entry[1] === 'string'))
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
function parseTerm(row) {
    if (!isRecord(row) || typeof row.concept !== 'string' || typeof row.literalForm !== 'string' || typeof row.hasLabelType !== 'string') {
        return [];
    }
    const isOccupation = row.concept.startsWith(ESCO_OCCUPATION_URI_PREFIX);
    const isIscoGroup = row.concept.startsWith(ESCO_ISCO_URI_PREFIX);
    const labelSource = SKOS_XL_LABEL_TYPES[row.hasLabelType];
    if ((!isOccupation && !isIscoGroup) || !labelSource) {
        return [];
    }
    return [{ conceptUri: row.concept, literalForm: row.literalForm, labelSource }];
}
function parseIscoGroup(row) {
    if (!isRecord(row) || typeof row.uri !== 'string' || typeof row.code !== 'string' || typeof row.title !== 'string') {
        return [];
    }
    const englishLabel = isRecord(row.preferredLabel) && typeof row.preferredLabel.en === 'string' ? row.preferredLabel.en : row.title;
    return [{ uri: row.uri, code: row.code, label: englishLabel, localLabel: row.title }];
}
