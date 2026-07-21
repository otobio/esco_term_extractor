import { type SupportedQueryLocale } from './query-preparation.js';
export type OccupationSignalCleanDecision = {
    signal: string;
    kept: boolean;
    score: number;
    reason: string;
    tokenCount: number;
    knownTokenCount: number;
    tokenCoverage: number;
    longestPhraseLength: number;
    hasOccupationAnchor: boolean;
};
export type CleanOccupationSignalsOptions = {
    sourceName: string;
    locale: string;
    signals: string[];
};
export type CleanOccupationTitleOptions = {
    sourceName: string;
    locale: string;
    title: string;
};
export type CleanOccupationSignalsResult = {
    sourceName: string;
    locale: SupportedQueryLocale;
    signals: string[];
    keptSignals: string[];
    decisions: OccupationSignalCleanDecision[];
};
export declare function cleanOccupationTitleSignals(options: CleanOccupationTitleOptions): Promise<CleanOccupationSignalsResult>;
export declare function cleanOccupationSignals(options: CleanOccupationSignalsOptions): Promise<CleanOccupationSignalsResult>;
