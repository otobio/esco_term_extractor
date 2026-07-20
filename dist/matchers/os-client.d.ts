import type { OpenSearchClient } from './types.js';
export interface OpenSearchClientOptions {
    url?: string;
    index?: string;
    /** Optional HTTP basic auth for a secured cluster (local dev usually needs none). */
    auth?: {
        username: string;
        password: string;
    };
    /** Force a query model id (skips discovery); pass null to disable neural. */
    queryModelId?: string | null;
}
export declare function createOpenSearchClient(options?: OpenSearchClientOptions): OpenSearchClient;
