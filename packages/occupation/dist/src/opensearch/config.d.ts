export type OpenSearchConfig = {
    node: string;
    username?: string;
    password?: string;
    occupationsIndex: string;
    occupationAliasesIndex: string;
    requestTimeoutMs: number;
};
export declare function getOpenSearchConfig(): OpenSearchConfig;
export declare function defaultOpenSearchTemplateName(indexName: string): string;
