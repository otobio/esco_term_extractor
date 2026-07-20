/**
 * Logistic-regression seniority-level classifier — a model-free-at-runtime source
 * for the `level` bucket. A multinomial (softmax) linear model over the sparse text
 * features in {@link vectorize}, with a dedicated `none` class so a seniority-free
 * title (a bare occupation like "Zugrav") is CLASSIFIED as none rather than forced
 * into a band. It emits the top band only when that band beats `none` and clears a
 * calibrated probability floor — otherwise it abstains.
 *
 * Serialized as a small JSON weight matrix (a few MB, no ONNX, no download); loads
 * and runs on CPU in microseconds, deterministically.
 *
 * Entry point: {@link inferLevelLr} (SYNC) is folded into `inferLevel` (see its
 * `enableLr` option) and reconciled with the regex by {@link reconcileLevel} — a
 * confident LR band overrides a disagreeing regex band on the same clause.
 */
import type { InferredTerm } from '../inference/shared.js';
import type { Clause } from '../tokenizer.js';
/** Label used for titles carrying no seniority signal (the classifier abstains). */
export declare const NONE_CLASS = "none";
/** Default probability a real band must reach (and beat `none`) to be emitted.
 *  Calibrated on the held-out gold set (scripts/eval-level-lr.ts): 0.7 is the
 *  balanced knee — LR alone ~47% recall / 87% precision, union ~53% / ~77%. Raise
 *  toward 0.8 for precision-strict use (union ~53% / ~81%), lower toward 0.4 for max
 *  recall (~54%). */
export declare const DEFAULT_LR_THRESHOLD = 0.7;
/**
 * Trained model. `weights[c]` is class c's sparse weight row (vocab-index → weight);
 * sparse because most features are inert for most classes. `vocab` maps a feature
 * string to its column. JSON-friendly: arrays/objects, no typed arrays.
 */
export interface LevelLrModel {
    classes: string[];
    /** feature string → column index */
    vocab: Record<string, number>;
    /** per-class bias */
    bias: number[];
    /** per-class { index → weight } sparse rows (aligned with `classes`) */
    weights: Record<number, number>[];
}
/** Runtime form: vocab as a Map for O(1) lookups, weights as index→weight Maps. */
export interface LoadedLevelLr {
    classes: string[];
    vocab: Map<string, number>;
    bias: number[];
    weights: Map<number, number>[];
}
export declare function loadLevelLr(model: LevelLrModel): LoadedLevelLr;
/** Softmax probabilities per class for a title, in `classes` order. */
export declare function predictProbs(m: LoadedLevelLr, title: string): number[];
/** Top band (excluding `none`) with its probability, and `none`'s probability. */
export declare function topBand(m: LoadedLevelLr, title: string): {
    key: string;
    prob: number;
    noneProb: number;
};
/**
 * SYNCHRONOUS core: the top band per clause as {@link InferredTerm}s (deduped across
 * clauses, highest-probability evidence per band). Pure CPU math, no I/O — so it can
 * be called inline from the synchronous `inferLevel`. Emits a band only when it clears
 * `threshold` AND outranks `none`.
 */
export declare function inferLevelLr(clauses: Clause[], m: LoadedLevelLr, opts?: {
    threshold?: number;
}): InferredTerm[];
/**
 * Merge regex-derived level terms with LR terms, letting a CONFIDENT LR band OVERRIDE
 * a regex band that disagrees on the SAME clause (matched by evidence text) — instead
 * of blindly unioning both, which would keep the regex's wrong answer next to LR's
 * right one and cost precision. Where LR is silent on a clause or agrees, terms union
 * by max score (the established rule).
 */
export declare function reconcileLevel(base: InferredTerm[], lr: InferredTerm[]): InferredTerm[];
export declare function defaultLevelLrModel(): LoadedLevelLr | null;
