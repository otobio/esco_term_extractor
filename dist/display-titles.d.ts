import type { BucketName, DictionaryTerm } from './types.js';
export type DisplayTitleEntry = {
    bucket: BucketName;
    canonicalKey: string;
    displayTitle: string;
};
export type BinaryStringTable = {
    count: number;
    offsets: Uint32Array;
    bytes: Buffer;
};
export declare function writeStringTable(strings: string[]): Buffer;
export declare function packDisplayTitles(entries: DisplayTitleEntry[]): Buffer;
export declare function selectDisplayTitleEntries(terms: DictionaryTerm[]): DisplayTitleEntry[];
export declare class DisplayTitleStore {
    private readonly keys;
    private readonly titles;
    readonly size: number;
    private constructor();
    static load(path?: string): Promise<DisplayTitleStore | undefined>;
    static fromBuffer(buffer: Buffer): DisplayTitleStore;
    titleFor(bucket: BucketName, canonicalKey: string): string | null;
    titlesFor(requests: Array<readonly [BucketName, string]>): (string | null)[];
}
export declare function buildDisplayTitleArtifact(entries: DisplayTitleEntry[], outPath: string): Promise<void>;
export declare function displayTitleKey(bucket: BucketName, canonicalKey: string): string;
