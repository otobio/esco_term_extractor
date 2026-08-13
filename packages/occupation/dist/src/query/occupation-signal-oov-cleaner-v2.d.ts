import { type SupportedQueryLocale } from './query-preparation.js';
export type OccupationOovTokenV2 = {
    surface: string;
    folded: string;
    kept: boolean;
    matchedVariant: string | null;
};
export type OccupationOovCleanResultV2 = {
    sourceName: string;
    locale: SupportedQueryLocale;
    originalTitle: string;
    keptText: string;
    keptTokens: string[];
    tokens: OccupationOovTokenV2[];
};
export declare function cleanOccupationTitleSignalsV2(options: {
    sourceName: string;
    locale: string;
    title: string;
}): Promise<OccupationOovCleanResultV2>;
