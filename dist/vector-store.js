/**
 * On-disk vector store for canonical term embeddings.
 *
 * Layout (written by scripts/build-embeddings.ts):
 *   - vectors.bin        contiguous Float32 vectors, one per term, grouped by
 *                        (bucket, language) so a query can scan only the ranges
 *                        it needs.
 *   - index.meta.json    { model, dim, terms[], ranges } aligned to vectors.bin.
 *
 * All vectors are L2-normalized at build time, so scoring is a plain dot product.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
/** Bump when the on-disk layout changes in a backward-incompatible way. */
export const INDEX_SCHEMA_VERSION = 2;
/**
 * Hubness centering coefficient applied at query time. Some embedding vectors
 * (short/brand-like display names, on multilingual models especially) sit near
 * the global centroid and score high against *everything* ("hubs"). We subtract
 * `HUBNESS_CENTERING × bias[i]` — where bias[i] is a term's similarity to the
 * centroid — so hubs are demoted while specific terms are untouched. 0 disables.
 */
export const HUBNESS_CENTERING = 0.7;
const VECTORS_FILE = 'vectors.bin';
const META_FILE = 'index.meta.json';
export class VectorStore {
    model;
    dim;
    terms;
    vectors;
    ranges;
    centering;
    /** canonicalKey -> vector indices (one per indexed language / alias vector). */
    byKey;
    bias;
    constructor(model, dim, terms, vectors, ranges, 
    /** Hubness bias per term (0 when absent); scaled by `centering` at query time. */
    bias, centering) {
        this.model = model;
        this.dim = dim;
        this.terms = terms;
        this.vectors = vectors;
        this.ranges = ranges;
        this.centering = centering;
        this.bias = bias ?? new Float32Array(terms.length);
        this.byKey = new Map();
        for (let i = 0; i < terms.length; i++) {
            const list = this.byKey.get(terms[i].canonicalKey);
            if (list)
                list.push(i);
            else
                this.byKey.set(terms[i].canonicalKey, [i]);
        }
    }
    static async load(dir) {
        const meta = JSON.parse(await readFile(join(dir, META_FILE), 'utf8'));
        if (meta.schemaVersion !== undefined && meta.schemaVersion !== INDEX_SCHEMA_VERSION) {
            throw new Error(`Index schema version ${meta.schemaVersion} is incompatible with this build ` +
                `(expected ${INDEX_SCHEMA_VERSION}). Rebuild the index with 'npm run build:index'.`);
        }
        const buf = await readFile(join(dir, VECTORS_FILE));
        // Copy into an aligned ArrayBuffer (Buffer byteOffset is not guaranteed /4).
        const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        const vectors = new Float32Array(ab);
        if (vectors.length !== meta.count * meta.dim) {
            throw new Error(`vector store corrupt: expected ${meta.count * meta.dim} floats, got ${vectors.length}`);
        }
        const bias = meta.bias ? Float32Array.from(meta.bias) : null;
        return new VectorStore(meta.model, meta.dim, meta.terms, vectors, meta.ranges, bias, HUBNESS_CENTERING);
    }
    get size() {
        return this.terms.length;
    }
    buckets() {
        return Object.keys(this.ranges);
    }
    term(index) {
        return this.terms[index];
    }
    /** First stored term for a canonical key (for enriching inferred/structured hits). */
    termByKey(canonicalKey) {
        const idxs = this.byKey.get(canonicalKey);
        return idxs?.length ? this.terms[idxs[0]] : undefined;
    }
    /**
     * Find the single best-matching term for `query` within `bucket`, restricted to
     * `languages` (all languages of the bucket when omitted). Returns null if the
     * bucket/languages have no vectors.
     */
    searchBest(query, bucket, languages) {
        const byLang = this.ranges[bucket];
        if (!byLang)
            return null;
        const langs = languages?.length ? languages : Object.keys(byLang);
        const dim = this.dim;
        const vecs = this.vectors;
        let bestIdx = -1;
        let bestScore = -Infinity;
        for (const lang of langs) {
            const range = byLang[lang];
            if (!range)
                continue;
            const [start, end] = range;
            for (let i = start; i < end; i++) {
                const base = i * dim;
                let dot = 0;
                for (let d = 0; d < dim; d++)
                    dot += query[d] * vecs[base + d];
                const score = dot - this.centering * this.bias[i];
                if (score > bestScore) {
                    bestScore = score;
                    bestIdx = i;
                }
            }
        }
        return bestIdx < 0 ? null : { index: bestIdx, score: bestScore };
    }
    /**
     * Top-`k` matching terms for `query` within `bucket`, de-duplicated by canonical
     * key (a term indexed in several languages contributes once, at its best score),
     * sorted by descending score. Used by structured single-bucket resolution.
     */
    searchTopK(query, bucket, k, languages) {
        const byLang = this.ranges[bucket];
        if (!byLang)
            return [];
        const langs = languages?.length ? languages : Object.keys(byLang);
        const bestByKey = new Map();
        for (const lang of langs) {
            const range = byLang[lang];
            if (!range)
                continue;
            for (let i = range[0]; i < range[1]; i++) {
                const score = this.dot(query, i) - this.centering * this.bias[i];
                const key = this.terms[i].canonicalKey;
                const prev = bestByKey.get(key);
                if (!prev || score > prev.score)
                    bestByKey.set(key, { index: i, score });
            }
        }
        return [...bestByKey.values()].sort((a, b) => b.score - a.score).slice(0, k);
    }
    dot(query, index) {
        const base = index * this.dim;
        let d = 0;
        for (let k = 0; k < this.dim; k++)
            d += query[k] * this.vectors[base + k];
        return d;
    }
    /**
     * Cosine similarity between `query` and a specific canonical term's own
     * embedding (best over its language/alias vectors, optionally preferring
     * `language`). Returns null when the term has no vector in the index.
     */
    similarityTo(query, canonicalKey, language) {
        const idxs = this.byKey.get(canonicalKey);
        if (!idxs?.length)
            return null;
        let best = -Infinity;
        for (const i of idxs) {
            if (language && this.terms[i].languageCode !== language)
                continue;
            const s = this.dot(query, i);
            if (s > best)
                best = s;
        }
        // Fall back to any-language vector if the language filter excluded everything.
        if (best === -Infinity) {
            for (const i of idxs) {
                const s = this.dot(query, i);
                if (s > best)
                    best = s;
            }
        }
        return best === -Infinity ? null : best;
    }
    /** Per-term similarity to the L2-normalized global centroid (the hubness bias). */
    static computeBias(dim, vectors, count) {
        const centroid = new Float32Array(dim);
        for (let i = 0; i < count; i++) {
            const base = i * dim;
            for (let d = 0; d < dim; d++)
                centroid[d] += vectors[base + d];
        }
        let norm = 0;
        for (let d = 0; d < dim; d++) {
            centroid[d] /= count;
            norm += centroid[d] * centroid[d];
        }
        norm = Math.sqrt(norm) || 1;
        for (let d = 0; d < dim; d++)
            centroid[d] /= norm;
        const bias = new Float32Array(count);
        for (let i = 0; i < count; i++) {
            const base = i * dim;
            let dot = 0;
            for (let d = 0; d < dim; d++)
                dot += vectors[base + d] * centroid[d];
            bias[i] = dot;
        }
        return bias;
    }
    /** Build the contiguous, (bucket,language)-grouped arrays from raw entries. */
    static buildArrays(dim, entries) {
        // Group by (bucket, language) so ranges are contiguous.
        entries.sort((a, b) => {
            if (a.term.bucket !== b.term.bucket)
                return a.term.bucket < b.term.bucket ? -1 : 1;
            if (a.term.languageCode !== b.term.languageCode)
                return a.term.languageCode < b.term.languageCode ? -1 : 1;
            return 0;
        });
        const count = entries.length;
        const vectors = new Float32Array(count * dim);
        const terms = new Array(count);
        const ranges = {};
        for (let i = 0; i < count; i++) {
            const { term, vector } = entries[i];
            vectors.set(vector, i * dim);
            terms[i] = {
                canonicalKey: term.canonicalKey,
                bucket: term.bucket,
                displayName: term.displayName,
                termType: term.termType,
                languageCode: term.languageCode,
            };
            const byLang = (ranges[term.bucket] ??= {});
            const r = byLang[term.languageCode];
            if (!r)
                byLang[term.languageCode] = [i, i + 1];
            else
                r[1] = i + 1;
        }
        const bias = VectorStore.computeBias(dim, vectors, count);
        return { count, vectors, terms, ranges, bias };
    }
    /**
     * Build an in-memory store (no disk I/O) — used by tests and embedded callers.
     * Centering defaults to 0 here so in-memory/test scores are raw dot products;
     * pass a coefficient to enable hubness centering.
     */
    static fromEntries(model, dim, entries, centering = 0) {
        const { vectors, terms, ranges, bias } = VectorStore.buildArrays(dim, entries);
        return new VectorStore(model, dim, terms, vectors, ranges, centering ? bias : null, centering);
    }
    /** Persist a freshly built index to `dir`. */
    static async save(dir, model, dim, entries) {
        await mkdir(dir, { recursive: true });
        const { count, vectors, terms, ranges, bias } = VectorStore.buildArrays(dim, entries);
        const meta = {
            schemaVersion: INDEX_SCHEMA_VERSION,
            model,
            dim,
            count,
            terms,
            ranges,
            bias: Array.from(bias),
        };
        await writeFile(join(dir, META_FILE), JSON.stringify(meta));
        await writeFile(join(dir, VECTORS_FILE), Buffer.from(vectors.buffer, vectors.byteOffset, vectors.byteLength));
    }
}
