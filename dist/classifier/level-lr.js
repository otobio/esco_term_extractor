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
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { vectorize } from './level-features.js';
/** Label used for titles carrying no seniority signal (the classifier abstains). */
export const NONE_CLASS = 'none';
/** Default probability a real band must reach (and beat `none`) to be emitted.
 *  Calibrated on the held-out gold set (scripts/eval-level-lr.ts): 0.7 is the
 *  balanced knee — LR alone ~47% recall / 87% precision, union ~53% / ~77%. Raise
 *  toward 0.8 for precision-strict use (union ~53% / ~81%), lower toward 0.4 for max
 *  recall (~54%). */
export const DEFAULT_LR_THRESHOLD = 0.7;
export function loadLevelLr(model) {
    return {
        classes: model.classes,
        vocab: new Map(Object.entries(model.vocab)),
        bias: model.bias,
        weights: model.weights.map((row) => new Map(Object.entries(row).map(([k, v]) => [Number(k), v]))),
    };
}
/** Numerically-stable softmax (subtract the max before exponentiating). */
function softmax(scores) {
    const mx = Math.max(...scores);
    const exps = scores.map((s) => Math.exp(s - mx));
    const sum = exps.reduce((a, b) => a + b, 0);
    return exps.map((e) => e / sum);
}
/** Linear score of one class for a feature vector: bias + Σ weight·value. */
function classScore(bias, weights, x) {
    let s = bias;
    for (const [idx, val] of x) {
        const w = weights.get(idx);
        if (w !== undefined)
            s += w * val;
    }
    return s;
}
/** Softmax probabilities per class for a title, in `classes` order. */
export function predictProbs(m, title) {
    const x = vectorize(title, m.vocab);
    return softmax(m.classes.map((_, c) => classScore(m.bias[c], m.weights[c], x)));
}
/** Top band (excluding `none`) with its probability, and `none`'s probability. */
export function topBand(m, title) {
    const probs = predictProbs(m, title);
    const noneIdx = m.classes.indexOf(NONE_CLASS);
    const noneProb = noneIdx >= 0 ? probs[noneIdx] : 0;
    let bestC = -1;
    let bestP = -1;
    for (let c = 0; c < m.classes.length; c++) {
        if (c === noneIdx)
            continue;
        if (probs[c] > bestP) {
            bestP = probs[c];
            bestC = c;
        }
    }
    return { key: bestC >= 0 ? m.classes[bestC] : NONE_CLASS, prob: bestP, noneProb };
}
/**
 * SYNCHRONOUS core: the top band per clause as {@link InferredTerm}s (deduped across
 * clauses, highest-probability evidence per band). Pure CPU math, no I/O — so it can
 * be called inline from the synchronous `inferLevel`. Emits a band only when it clears
 * `threshold` AND outranks `none`.
 */
export function inferLevelLr(clauses, m, opts = {}) {
    const threshold = opts.threshold ?? DEFAULT_LR_THRESHOLD;
    const seen = new Map();
    for (const c of clauses) {
        const t = topBand(m, c.text);
        if (t.key === NONE_CLASS || t.prob < threshold || t.prob <= t.noneProb)
            continue;
        const prev = seen.get(t.key);
        if (!prev || t.prob > prev.score)
            seen.set(t.key, { canonicalKey: t.key, score: t.prob, evidence: c.text });
    }
    return [...seen.values()];
}
/**
 * Merge regex-derived level terms with LR terms, letting a CONFIDENT LR band OVERRIDE
 * a regex band that disagrees on the SAME clause (matched by evidence text) — instead
 * of blindly unioning both, which would keep the regex's wrong answer next to LR's
 * right one and cost precision. Where LR is silent on a clause or agrees, terms union
 * by max score (the established rule).
 */
export function reconcileLevel(base, lr) {
    if (!lr.length)
        return base;
    // Bands LR chose, grouped by the clause (evidence text) it chose them for.
    const lrBandsByClause = new Map();
    for (const t of lr) {
        const bands = lrBandsByClause.get(t.evidence) ?? new Set();
        bands.add(t.canonicalKey);
        lrBandsByClause.set(t.evidence, bands);
    }
    // A regex band is overridden iff LR spoke for the SAME clause but chose other bands.
    const overriddenByLr = (r) => {
        const lrBands = lrBandsByClause.get(r.evidence);
        return lrBands !== undefined && !lrBands.has(r.canonicalKey);
    };
    // Union by canonical key, highest score wins — LR first, then the surviving regex.
    const out = new Map();
    const put = (t) => {
        const prev = out.get(t.canonicalKey);
        if (!prev || t.score > prev.score)
            out.set(t.canonicalKey, t);
    };
    for (const t of lr)
        put(t);
    for (const r of base)
        if (!overriddenByLr(r))
            put(r);
    return [...out.values()];
}
/** Lazily-loaded default model from `data/level-lr.json` (resolved relative to this
 *  module, cwd-independent). `undefined` = not tried; `null` = absent/unreadable, so
 *  a caller falls back to regex-only. Read once, then cached. */
let DEFAULT_MODEL;
export function defaultLevelLrModel() {
    if (DEFAULT_MODEL !== undefined)
        return DEFAULT_MODEL;
    try {
        const path = fileURLToPath(new URL('../../data/level-lr.json', import.meta.url));
        DEFAULT_MODEL = loadLevelLr(JSON.parse(readFileSync(path, 'utf8')));
    }
    catch {
        DEFAULT_MODEL = null; // no model file → regex-only
    }
    return DEFAULT_MODEL;
}
