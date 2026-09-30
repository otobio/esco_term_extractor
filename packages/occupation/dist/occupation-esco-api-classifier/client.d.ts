import type { EscoApiLocale, EscoIscoGroup, EscoSearchHit, EscoTerm } from './types.js';
export type EscoApiFetch = (url: string, init: {
    signal: AbortSignal;
    headers: Record<string, string>;
}) => Promise<{
    ok: boolean;
    status: number;
    json(): Promise<unknown>;
}>;
export type EscoApiClientOptions = {
    baseUrl?: string;
    version?: string;
    timeoutMs?: number;
    retries?: number;
    fetch?: EscoApiFetch;
};
export declare class EscoApiError extends Error {
    readonly status: number | null;
    constructor(message: string, status: number | null);
}
export declare class EscoApiClient {
    private readonly baseUrl;
    private readonly version;
    private readonly timeoutMs;
    private readonly retries;
    private readonly fetchImpl;
    private readonly responseCache;
    private readonly iscoGroupCache;
    constructor(options?: EscoApiClientOptions);
    searchOccupations(text: string, language: EscoApiLocale): Promise<EscoSearchHit[]>;
    searchTerms(text: string, language: EscoApiLocale): Promise<EscoTerm[]>;
    getIscoGroups(uris: string[], language: EscoApiLocale): Promise<Map<string, EscoIscoGroup>>;
    private getJson;
    private buildUrl;
    private fetchWithRetry;
}
export declare function defaultEscoApiClient(): EscoApiClient;
