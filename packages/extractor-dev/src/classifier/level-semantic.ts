/**
 * Semantic seniority-level classifier — an OPT-IN, model-backed source that unions
 * into the `level` bucket alongside the hand-written regex rules in `level.ts`.
 *
 * Why: the regex rules pattern-match one trigger word in isolation, so the SAME
 * word ("manager", "sef", "head of") miscalibrates across bands depending on the
 * whole phrase it sits in. This layer embeds the WHOLE clause and takes the max
 * cosine to a small per-band exemplar set ({@link LEVEL_EXEMPLARS}), returning the
 * top band IF it clears a calibrated threshold — otherwise it abstains (a bare
 * occupation title like "Zugrav" sits far from every band and must stay silent).
 *
 * It returns the SAME {@link InferredTerm} shape `inferLevel` returns, so it merges
 * via the exact same max-score-per-canonical-key union in `aliasLookup.finalize`.
 * The regex rules are never replaced — they still resolve the clear majority for
 * free (no model load); this only adds a candidate the regex couldn't reach.
 *
 * The model never loads on the default path: a caller opts in by constructing an
 * index + classifier (see {@link makeLevelClassifier}).
 */

import { collector, type InferredTerm } from '../../../../src/inference/shared.ts';
import type { Clause } from '../../../../src/tokenizer.ts';
import type { TextEmbedder } from '../embedder.ts';
import { LEVEL_EXEMPLARS, type LevelExemplarGroup } from './level-exemplars.ts';

/** Async seniority-level classifier: title clauses (+ locale) → extra `level` terms.
 *  Kept as an explicit type so the embedding path has a named contract. */
export type LevelClassifier = (clauses: Clause[], locale?: string) => Promise<InferredTerm[]>;

/** Default cosine floor a top band must clear to be emitted. Calibrated so that
 *  bare occupation / seniority-free titles (which sit far from every band) abstain,
 *  while genuine band phrases clear it. See scripts/calibrate-level.ts. */
export const DEFAULT_LEVEL_THRESHOLD = 0.55;

/** One embedded exemplar phrase, tagged with its band key + locale. */
export interface LevelExemplarVector {
  key: string;
  locale: string;
  phrase: string;
  vector: Float32Array;
}

/** Dot product of two equal-length vectors. Both exemplar and clause vectors are
 *  L2-normalized by the embedder, so this equals cosine similarity. */
function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/** Immutable, embedded exemplar corpus. Built once (model loaded), then reused. */
export class LevelExemplarIndex {
  private constructor(private readonly rows: readonly LevelExemplarVector[]) {}

  /** Embed every exemplar phrase in one pass. `embedder` must be the SAME model the
   *  query clauses are embedded with (cosine is only meaningful within one model). */
  static async build(
    embedder: TextEmbedder,
    groups: readonly LevelExemplarGroup[] = LEVEL_EXEMPLARS,
  ): Promise<LevelExemplarIndex> {
    const phrases: string[] = [];
    const meta: { key: string; locale: string; phrase: string }[] = [];
    for (const g of groups) {
      for (const phrase of g.phrases) {
        phrases.push(phrase);
        meta.push({ key: g.key, locale: g.locale, phrase });
      }
    }
    const vectors = phrases.length ? await embedder.embed(phrases) : [];
    return new LevelExemplarIndex(meta.map((m, i) => ({ ...m, vector: vectors[i] })));
  }

  /** Rebuild from already-embedded rows (a prebuilt file, or a test stub). */
  static fromVectors(rows: readonly LevelExemplarVector[]): LevelExemplarIndex {
    return new LevelExemplarIndex(rows);
  }

  /**
   * Nearest band to `vector`: the max cosine over every exemplar (restricted to
   * `locales` when given), returned only if it clears `threshold`. Score is the
   * raw cosine — comparable to the regex scores (~0.8) it unions against.
   */
  classify(
    vector: Float32Array,
    locales: Set<string> | undefined,
    threshold: number,
  ): { key: string; score: number } | null {
    // Global argmax over the allowed exemplars; strict `>` keeps the first-seen band
    // on ties (deterministic via exemplar order). Threshold applied once, at the end.
    let bestKey: string | null = null;
    let bestScore = -Infinity;
    for (const row of this.rows) {
      if (locales && !locales.has(row.locale)) continue;
      const s = dot(vector, row.vector);
      if (s > bestScore) {
        bestScore = s;
        bestKey = row.key;
      }
    }
    return bestKey !== null && bestScore >= threshold ? { key: bestKey, score: bestScore } : null;
  }
}

/** Locale set a query in `locale` compares against: its own language plus en +
 *  global (mirrors the lexical scan — an RO listing may carry an English title). */
function queryLocales(locale?: string): Set<string> {
  const langs = new Set<string>(['en', 'global']);
  if (locale) langs.add(locale);
  return langs;
}

/**
 * Build the opt-in {@link LevelClassifier} the title profile unions into `level`.
 * Embeds each clause once and emits the nearest band per clause above `threshold`.
 * Returns `[]` for clauses with no clause text or no band above the floor.
 */
export function makeLevelClassifier(
  embedder: TextEmbedder,
  index: LevelExemplarIndex,
  opts: { threshold?: number } = {},
): LevelClassifier {
  const threshold = opts.threshold ?? DEFAULT_LEVEL_THRESHOLD;
  return async (clauses: Clause[], locale?: string): Promise<InferredTerm[]> => {
    if (!clauses.length) return [];
    const locales = queryLocales(locale);
    const vectors = await embedder.embed(clauses.map((c) => c.text));
    const { add, terms } = collector();
    clauses.forEach((clause, i) => {
      const best = index.classify(vectors[i], locales, threshold);
      if (best) add(best.key, best.score, clause.text);
    });
    return terms();
  };
}
