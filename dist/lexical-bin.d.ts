import type { LexicalEntry } from './lexical-index.js';
import type { BucketName, SupportedLanguage } from './types.js';
/** Build the LXB buffer from an already-resolved entries/alias map. Pure. */
export declare function pack(entries: LexicalEntry[], byAlias: Map<string, number[]>): Buffer;
export declare class LexicalBin {
    private readonly bucket;
    private readonly lang;
    private readonly termType;
    private readonly keyOff;
    private readonly keyBlob;
    private readonly nameOff;
    private readonly nameBlob;
    private readonly aliasOff;
    private readonly postOff;
    private readonly postings;
    private readonly aliasBlob;
    private readonly bucketDict;
    private readonly langDict;
    private readonly termTypeDict;
    private bucketIdx?;
    private langIdx?;
    readonly size: number;
    private constructor();
    static load(path: string): Promise<LexicalBin>;
    static fromBuffer(buf: Buffer): LexicalBin;
    /** Raw dict-index byte — cheap bucket compare in a hot scan loop (no string decode). */
    bucketAt(i: number): number;
    /** Raw dict-index byte — cheap language compare in a hot scan loop (no string decode). */
    langAt(i: number): number;
    /** Reverse-lookup a bucket name to its dict index (memoized); -1 if absent from the data. */
    bucketIndex(name: BucketName): number;
    /** Reverse-lookup a language code to its dict index (memoized); -1 if absent from the data. */
    langIndex(name: SupportedLanguage): number;
    /** Full decode of one entry — only called for actual hits, not scan candidates. */
    entry(i: number): LexicalEntry;
    /** Binary search the byte-sorted alias dictionary → its postings (entry ids).
     *  Compares UTF-8 bytes directly — no string decode/allocation on the hot path. */
    exact(norm: string): number[];
}
