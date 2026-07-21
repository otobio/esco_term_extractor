export type EscoConfig = {
    downloadsDir: string;
    locales: string[];
    version: string;
    sourceKind: string;
    sourceName: string;
};
export type EscoConfigOverrides = {
    downloadsDir?: string;
    locales?: string[];
    version?: string;
};
export declare function getEscoConfig(overrides?: EscoConfigOverrides): EscoConfig;
