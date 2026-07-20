export interface IngestLogOptions {
    runtime?: unknown;
    locale?: string;
    countryCode?: string;
    bucket?: string;
    profile?: string;
    mode?: string;
}
export declare function summarizeIngestOptions(opts: IngestLogOptions): Record<string, unknown>;
export declare function logIngestCall(event: string, payload: Record<string, unknown>): Promise<void>;
