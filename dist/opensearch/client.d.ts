import type { OpenSearchConfig } from './config.js';
export type OpenSearchRequestOptions = {
    body?: string | object | undefined;
    contentType?: string;
    expectedStatuses?: number[];
    signal?: AbortSignal;
};
export type OpenSearchResponse<T> = {
    status: number;
    body: T | null;
    text: string;
};
export declare class OpenSearchClient {
    private readonly config;
    constructor(config: OpenSearchConfig);
    get<T>(path: string, options?: Omit<OpenSearchRequestOptions, 'body'>): Promise<OpenSearchResponse<T>>;
    put<T>(path: string, body?: string | object, options?: Omit<OpenSearchRequestOptions, 'body'>): Promise<OpenSearchResponse<T>>;
    post<T>(path: string, body?: string | object, options?: Omit<OpenSearchRequestOptions, 'body'>): Promise<OpenSearchResponse<T>>;
    delete<T>(path: string, options?: Omit<OpenSearchRequestOptions, 'body'>): Promise<OpenSearchResponse<T>>;
    head(path: string, options?: Omit<OpenSearchRequestOptions, 'body'>): Promise<OpenSearchResponse<null>>;
    request<T>(method: string, path: string, options?: OpenSearchRequestOptions): Promise<OpenSearchResponse<T>>;
    private buildUrl;
    private buildHeaders;
}
