export declare function compareBigInt(left: bigint, right: bigint): number;
export declare function sortedIncludes(values: string[], needle: string): boolean;
export declare function sortedNumberIncludes(values: readonly number[], needle: number): boolean;
export declare function lookupSortedPairValue<T>(entries: Array<[string, T]>, key: string, fallback: T): T;
export declare function containsTokenPhrase(haystackPhrase: string, needleTokens: string[]): boolean;
export declare function uniqueSortedStrings(values: Iterable<string>): string[];
export declare function roundScore(value: number): number;
export declare function clampScore(value: number): number;
/**
 * Scans `items` for the maximum of `selector(item)` without allocating an intermediate
 * mapped array or spreading into Math.max, which are wasteful on large candidate/hit lists.
 */
export declare function maxOf<T>(items: readonly T[], selector: (item: T) => number, fallback?: number): number;
