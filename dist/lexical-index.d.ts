import { LexicalBin } from './lexical-bin.js';
import type { BucketName, DictionaryTerm, SupportedLanguage } from './types.js';
export interface LexicalEntry {
    canonicalKey: string;
    bucket: BucketName;
    displayName: string;
    termType: string;
    languageCode: SupportedLanguage;
}
export interface LexicalHit {
    entry: LexicalEntry;
    /** Word count of the matched alias n-gram (1 = unigram, needs corroboration). */
    words: number;
    /** The normalized alias text that matched (for negation checks). */
    gram: string;
}
export declare class LexicalIndex {
    private readonly bin;
    private constructor();
    static load(dir: string): Promise<LexicalIndex>;
    /** Wrap an already-loaded bin. Seam for in-memory/embedded builders (see test/support/lexical.ts). */
    static fromBin(bin: LexicalBin): LexicalIndex;
    /**
     * Exact whole-value alias match within a bucket. Used by structured resolution:
     * the caller supplies a deliberate keyword for a known bucket, so an exact alias
     * hit is trusted directly (no corroboration, no embedding — the fast path).
     */
    lookupExact(value: string, bucket: BucketName, languages?: SupportedLanguage[]): LexicalEntry[];
    /**
     * Return every canonical entry whose alias exactly matches some 1..N-gram of the
     * clause, restricted to `bucket` and (optionally) `languages`.
     */
    /**
     * Alias hits for a single bucket. Thin filter over the one-pass {@link lookupAll}.
     */
    lookup(clause: string, bucket: BucketName, languages?: SupportedLanguage[], expand?: (gram: string) => string[]): LexicalHit[];
    /**
     * Alias hits across ALL buckets in a single n-gram pass — each hit carries its
     * bucket (via `entry.bucket`), so a caller wanting several buckets scans once
     * instead of re-scanning per bucket.
     */
    lookupAll(clause: string, languages?: SupportedLanguage[], expand?: (gram: string) => string[]): LexicalHit[];
    /**
     * Shared n-gram scan. Generates every 1..N-gram of the clause, matches each
     * (and, when given, its variants) against the alias index, and keeps the
     * longest gram per entry. `bucket` restricts to one bucket; omit for all.
     *
     * @param expand optional variant expander (e.g. plural↔singular): each n-gram
     *   is looked up as itself AND its variants, while the original text gram is
     *   what's reported. Omitted = exact behavior.
     */
    private scan;
    /**
     * offline build-time packer, do not use in runtime
     */
    private static buildMaps;
    static build(dir: string, terms: DictionaryTerm[]): Promise<void>;
}
