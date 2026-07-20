/**
 * High-precision lexical index over canonical aliases.
 *
 * The semantic path captures paraphrase; this path captures exact surface forms —
 * abbreviations, codes and multi-word names ("wfh", "SQL", "Cluj-Napoca") where a
 * short embedding is unreliable. We index every normalized alias (plus display
 * name and value) and, at query time, look up all 1..N-gram spans of a clause.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeText, words } from './normalize.ts';
import { isStopword } from './stopwords.ts';
import type { BucketName, DictionaryTerm, SupportedLanguage } from './types.ts';

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

interface LexicalFile {
  entries: LexicalEntry[];
  /** normalized alias -> indices into `entries`. */
  byAlias: Record<string, number[]>;
}

const FILE = 'lexical.json';
const MAX_NGRAM = 6;

export class LexicalIndex {
  private constructor(
    private readonly entries: LexicalEntry[],
    private readonly byAlias: Map<string, number[]>,
  ) {}

  static async load(dir: string): Promise<LexicalIndex> {
    const data: LexicalFile = JSON.parse(await readFile(join(dir, FILE), 'utf8'));
    return new LexicalIndex(data.entries, new Map(Object.entries(data.byAlias)));
  }

  /** Build an in-memory index (no disk I/O) — used by tests and embedded callers. */
  static fromTerms(terms: DictionaryTerm[]): LexicalIndex {
    const { entries, byAlias } = LexicalIndex.buildMaps(terms);
    return new LexicalIndex(entries, byAlias);
  }

  /**
   * Exact whole-value alias match within a bucket. Used by structured resolution:
   * the caller supplies a deliberate keyword for a known bucket, so an exact alias
   * hit is trusted directly (no corroboration, no embedding — the fast path).
   */
  lookupExact(value: string, bucket: BucketName, languages?: SupportedLanguage[]): LexicalEntry[] {
    const norm = normalizeText(value);
    if (norm.length < 2) return [];
    const idxs = this.byAlias.get(norm);
    if (!idxs) return [];
    const langSet = languages?.length ? new Set(languages) : null;
    const out: LexicalEntry[] = [];
    for (const idx of idxs) {
      const e = this.entries[idx];
      if (e.bucket !== bucket) continue;
      if (langSet && !langSet.has(e.languageCode)) continue;
      out.push(e);
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
    const langSet = languages?.length ? new Set(languages) : null;
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
          const idxs = this.byAlias.get(form);
          if (!idxs) continue;
          for (const idx of idxs) {
            const e = this.entries[idx];
            if (bucket !== undefined && e.bucket !== bucket) continue;
            if (langSet && !langSet.has(e.languageCode)) continue;
            const wc = n + 1;
            const prev = best.get(idx);
            if (prev === undefined || wc > prev.words) best.set(idx, { words: wc, gram });
          }
        }
      }
    }
    return [...best].map(([idx, { words: wc, gram }]) => ({ entry: this.entries[idx], words: wc, gram }));
  }

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
    const file: LexicalFile = { entries, byAlias: Object.fromEntries(byAlias) };
    await writeFile(join(dir, FILE), JSON.stringify(file));
  }
}
