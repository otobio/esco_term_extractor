import { type TimingMap } from '../utils/timing.js';
export type FamilyDenseRetrieverOptions = {
    query: string;
    sourceName: string;
    modelKey: string;
    familyNodeIds: number[];
    limit: number;
    timings?: TimingMap;
};
export type FamilyDenseHit = {
    graphNodeId: number;
    canonicalLabel: string;
    familyNodeId: number;
    familyLabel: string;
    score: number;
    dot: number;
};
export declare class FamilyDenseRetriever {
    retrieve(options: FamilyDenseRetrieverOptions): Promise<FamilyDenseHit[]>;
}
