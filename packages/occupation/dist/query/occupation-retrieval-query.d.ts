import { type TimingMap } from '../utils/timing.js';
import { type OccupationRoleSpanSelection } from './occupation-role-span-selector.js';
import { type PreparedQuery } from './query-preparation.js';
export type { OccupationRoleSpanSelection } from './occupation-role-span-selector.js';
export type PreparedOccupationRetrievalQuery = {
    originalQuery: string;
    query: string;
    querySpans: string[];
    locale: string;
    normalizedQuery: string;
    foldedQuery: string;
    querySignals: string[];
    keptQuerySignals: string[];
    querySignalCleaningMs: number;
    roleSpanSelection: OccupationRoleSpanSelection;
    preparedQuery: PreparedQuery;
};
export type PrepareOccupationRetrievalQueryOptions = {
    sourceName: string;
    locale: string;
    originalQuery: string;
    timings?: TimingMap;
};
export declare function prepareOccupationRetrievalQuery(options: PrepareOccupationRetrievalQueryOptions): Promise<PreparedOccupationRetrievalQuery>;
