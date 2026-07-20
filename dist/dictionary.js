/**
 * Dictionary snapshot I/O.
 *
 * The dictionary is the converted, self-contained copy of the OpenSearch
 * `canonical_runtime_terms` index — one JSON object per line (JSONL) so it can be
 * streamed and appended without loading the whole file into memory during export.
 */
import { readFile } from 'node:fs/promises';
export function serializeTerm(term) {
    return JSON.stringify(term);
}
/**
 * Reject dictionary terms that would only produce garbage matches: empty /
 * single-character display names, or display names that are actually a URL or an
 * external code (e.g. a raw `http://data.europa.eu/ux2/nace2.1/...` value that
 * leaked into the display field). Applied at index-build time so both the vector
 * store and the lexical index exclude them.
 */
export function isUsableTerm(term) {
    const dn = (term.displayName ?? '').trim();
    if (dn.length < 2)
        return false;
    const lower = dn.toLowerCase();
    if (lower.startsWith('http') || dn.includes('://') || lower.includes('europa.eu'))
        return false;
    return true;
}
/** Load a JSONL dictionary snapshot into memory. */
export async function loadDictionary(path) {
    const raw = await readFile(path, 'utf8');
    const out = [];
    for (const line of raw.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        out.push(JSON.parse(trimmed));
    }
    return out;
}
