export type TimingMap = Record<string, number>;
export declare function timed<T>(work: () => T | Promise<T>, ref: string, timings: TimingMap): Promise<T>;
export declare function addTiming(timings: TimingMap, ref: string, elapsedMs: number): void;
export declare function mergeTimings(...sources: Array<TimingMap | undefined>): TimingMap;
