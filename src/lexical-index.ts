/**
 * High-precision lexical index over canonical aliases.
 *
 * The semantic path captures paraphrase; this path captures exact surface forms —
 * abbreviations, codes and multi-word names ("wfh", "SQL", "Cluj-Napoca") where a
 * short embedding is unreliable. We index every normalized alias (plus display
 * name and value) and, at query time, look up all 1..N-gram spans of a clause.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LexicalBin, pack } from './lexical-bin.js';
import { normalizeText, words } from './normalize.js';
import { isStopword } from './stopwords.js';
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

const BIN_FILE = 'lexical.lxb';
const MAX_NGRAM = 6;

export class LexicalIndex {
  private constructor(private readonly bin: LexicalBin) {}

  static async load(dir: string): Promise<LexicalIndex> {
    return new LexicalIndex(await LexicalBin.load(join(dir, BIN_FILE)));
  }

  /** Wrap an already-loaded bin. Seam for in-memory/embedded builders (see test/support/lexical.ts). */
  static fromBin(bin: LexicalBin): LexicalIndex {
    return new LexicalIndex(bin);
  }

  /**
   * Exact whole-value alias match within a bucket. Used by structured resolution:
   * the caller supplies a deliberate keyword for a known bucket, so an exact alias
   * hit is trusted directly (no corroboration, no embedding — the fast path).
   */
  lookupExact(value: string, bucket: BucketName, languages?: SupportedLanguage[]): LexicalEntry[] {
    const norm = normalizeText(value);
    if (norm.length < 2) return [];
    const idxs = this.bin.exact(norm);
    if (!idxs.length) return [];
    const bucketIdx = this.bin.bucketIndex(bucket);
    const langSet = languages?.length ? new Set(languages.map((l) => this.bin.langIndex(l))) : null;
    const out: LexicalEntry[] = [];
    for (const idx of idxs) {
      if (this.bin.bucketAt(idx) !== bucketIdx) continue;
      if (langSet && !langSet.has(this.bin.langAt(idx))) continue;
      out.push(this.bin.entry(idx));
    }
    return out;
  }

  /**
   * Return every canonical entry whose alias exactly matches some 1..N-gram of the
   * clause, restricted to `bucket` and (optionally) `languages`.
   */
  /**
   * Alias hits for a single bucket. Thin filter over the one-pass {@link lookupAll}.
   */
  lookup(
    clause: string,
    bucket: BucketName,
    languages?: SupportedLanguage[],
    expand?: (gram: string) => string[],
  ): LexicalHit[] {
    return this.scan(clause, languages, expand, bucket);
  }

  /**
   * Alias hits across ALL buckets in a single n-gram pass — each hit carries its
   * bucket (via `entry.bucket`), so a caller wanting several buckets scans once
   * instead of re-scanning per bucket.
   */
  lookupAll(clause: string, languages?: SupportedLanguage[], expand?: (gram: string) => string[]): LexicalHit[] {
    return this.scan(clause, languages, expand);
  }

  /**
   * Shared n-gram scan. Generates every 1..N-gram of the clause, matches each
   * (and, when given, its variants) against the alias index, and keeps the
   * longest gram per entry. `bucket` restricts to one bucket; omit for all.
   *
   * @param expand optional variant expander (e.g. plural↔singular): each n-gram
   *   is looked up as itself AND its variants, while the original text gram is
   *   what's reported. Omitted = exact behavior.
   */
  private scan(
    clause: string,
    languages: SupportedLanguage[] | undefined,
    expand: ((gram: string) => string[]) | undefined,
    bucket?: BucketName,
  ): LexicalHit[] {
    const toks = words(normalizeText(clause));
    if (!toks.length) return [];
    const bucketIdx = bucket !== undefined ? this.bin.bucketIndex(bucket) : undefined;
    const langSet = languages?.length ? new Set(languages.map((l) => this.bin.langIndex(l))) : null;
    // Keep the most specific (largest n-gram) hit per entry, with its gram text.
    const best = new Map<number, { words: number; gram: string }>();
    for (let i = 0; i < toks.length; i++) {
      let gram = '';
      for (let n = 0; n < MAX_NGRAM && i + n < toks.length; n++) {
        gram = n === 0 ? toks[i] : `${gram} ${toks[i + n]}`;
        if (gram.length < 3) continue;
        // Unigram hits on common function words are never trustworthy.
        if (n === 0 && isStopword(gram)) continue;
        const forms = expand ? [gram, ...expand(gram)] : [gram];
        for (const form of forms) {
          const idxs = this.bin.exact(form);
          if (!idxs.length) continue;
          for (const idx of idxs) {
            if (bucketIdx !== undefined && this.bin.bucketAt(idx) !== bucketIdx) continue;
            if (langSet && !langSet.has(this.bin.langAt(idx))) continue;
            const wc = n + 1;
            const prev = best.get(idx);
            if (prev === undefined || wc > prev.words) best.set(idx, { words: wc, gram });
          }
        }
      }
    }
    return [...best].map(([idx, { words: wc, gram }]) => ({ entry: this.bin.entry(idx), words: wc, gram }));
  }

  /**
   * offline build-time packer, do not use in runtime
   */
  private static buildMaps(terms: DictionaryTerm[]): { entries: LexicalEntry[]; byAlias: Map<string, number[]> } {
    const entries: LexicalEntry[] = new Array(terms.length);
    // Use a Map to avoid Object.prototype key collisions ("constructor", "toString", ...).
    const byAlias = new Map<string, number[]>();
    for (let i = 0; i < terms.length; i++) {
      const t = terms[i];
      entries[i] = {
        canonicalKey: t.canonicalKey,
        bucket: t.bucket,
        displayName: t.displayName,
        termType: t.termType,
        languageCode: t.languageCode,
      };
      const surfaces = new Set<string>();
      for (const s of [t.displayName, t.value, ...t.aliases]) {
        const norm = normalizeText(s ?? '');
        // Skip trivially short or purely numeric surfaces to avoid false hits.
        if (norm.length < 3) continue;
        if (/^\d+$/.test(norm)) continue;
        surfaces.add(norm);
      }
      for (const norm of surfaces) {
        const list = byAlias.get(norm);
        if (list) list.push(i);
        else byAlias.set(norm, [i]);
      }
    }
    return { entries, byAlias };
  }

  static async build(dir: string, terms: DictionaryTerm[]): Promise<void> {
    await mkdir(dir, { recursive: true });
    const { entries, byAlias } = LexicalIndex.buildMaps(terms);
    await writeFile(join(dir, BIN_FILE), pack(entries, byAlias));
  }
}
