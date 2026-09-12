/**
 * display-titles.ts — packed canonical display-title lookup for term-extractor
 * buckets. The artifact is build-only and keeps runtime resolution to a tiny
 * binary-search over two string tables.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timed } from '@term-extractor/utils/perf';
import { align4, findStringId, readStringTable, stringAt, writeStringTable } from './binary.js';
import { FACETED_FINITE_VALUES, FINITE_VALUES, SECTOR_LABELS } from './finite-values.js';
const MAGIC = 0x44544231; // "DTB1"
const VERSION = 1;
const NUM_SECTIONS = 2;
const KEY_SEPARATOR = '\u001f';
const DEFAULT_DATA_DIR = fileURLToPath(new URL('../data', import.meta.url));
function compositeKey(bucket, canonicalKey) {
    return `${bucket}${KEY_SEPARATOR}${canonicalKey}`;
}
function humanizeCanonicalKey(key) {
    const text = key.replace(/_/g, ' ').trim();
    return text.replace(/\b\w/g, (ch) => ch.toUpperCase()) || key;
}
function generatedDisplayTitleEntries() {
    const entries = [];
    for (const [bucket, values] of Object.entries(FINITE_VALUES)) {
        for (const canonicalKey of values) {
            const sectorLabel = bucket === 'sector' ? SECTOR_LABELS[canonicalKey] : undefined;
            entries.push({
                bucket,
                canonicalKey,
                displayTitle: sectorLabel ?? humanizeCanonicalKey(canonicalKey),
            });
        }
    }
    for (const [bucket, facet] of Object.entries(FACETED_FINITE_VALUES)) {
        for (const canonicalKeys of Object.values(facet.valuesBySubField)) {
            for (const canonicalKey of canonicalKeys) {
                entries.push({
                    bucket,
                    canonicalKey,
                    displayTitle: humanizeCanonicalKey(canonicalKey.split(':').pop() ?? canonicalKey),
                });
            }
        }
    }
    return entries;
}
export function packDisplayTitles(entries) {
    const sorted = [...entries].sort((a, b) => Buffer.compare(Buffer.from(compositeKey(a.bucket, a.canonicalKey), 'utf8'), Buffer.from(compositeKey(b.bucket, b.canonicalKey), 'utf8')));
    const keys = sorted.map((entry) => compositeKey(entry.bucket, entry.canonicalKey));
    const titles = sorted.map((entry) => entry.displayTitle);
    const keyTable = writeStringTable(keys);
    const titleTable = writeStringTable(titles);
    const sections = [keyTable, titleTable];
    const headerSize = 4 + 3 * 4 + NUM_SECTIONS * 4;
    const offsets = [];
    let pos = align4(headerSize);
    for (const section of sections) {
        offsets.push(pos);
        pos = align4(pos + section.length);
    }
    const out = Buffer.alloc(pos);
    out.writeUInt32LE(MAGIC, 0);
    out.writeUInt32LE(VERSION, 4);
    out.writeUInt32LE(sorted.length, 8);
    offsets.forEach((offset, index) => out.writeUInt32LE(offset, 12 + index * 4));
    sections.forEach((section, index) => section.copy(out, offsets[index]));
    return out;
}
export function selectDisplayTitleEntries(terms) {
    const preferred = new Map();
    terms.forEach((term, order) => {
        if (term.bucket === 'location')
            return;
        const displayTitle = term.displayName?.trim();
        if (!displayTitle)
            return;
        const rank = term.languageCode === 'global' ? 0 : term.languageCode === 'en' ? 1 : 2;
        const key = compositeKey(term.bucket, term.canonicalKey);
        const current = preferred.get(key);
        if (!current || rank < current.rank || (rank === current.rank && order < current.order)) {
            preferred.set(key, {
                entry: { bucket: term.bucket, canonicalKey: term.canonicalKey, displayTitle },
                rank,
                order,
            });
        }
    });
    for (const entry of generatedDisplayTitleEntries()) {
        const key = compositeKey(entry.bucket, entry.canonicalKey);
        if (!preferred.has(key)) {
            preferred.set(key, { entry, rank: Number.POSITIVE_INFINITY, order: Number.POSITIVE_INFINITY });
        }
    }
    return [...preferred.values()]
        .sort((a, b) => Buffer.compare(Buffer.from(compositeKey(a.entry.bucket, a.entry.canonicalKey), 'utf8'), Buffer.from(compositeKey(b.entry.bucket, b.entry.canonicalKey), 'utf8')))
        .map((item) => item.entry);
}
export class DisplayTitleStore {
    keys;
    titles;
    size;
    constructor(buffer) {
        const magic = buffer.readUInt32LE(0);
        if (magic !== MAGIC) {
            throw new Error('not a DTB file');
        }
        const version = buffer.readUInt32LE(4);
        if (version !== VERSION) {
            throw new Error(`DTB version ${version} != ${VERSION}`);
        }
        const count = buffer.readUInt32LE(8);
        const keyOffset = buffer.readUInt32LE(12);
        const titleOffset = buffer.readUInt32LE(16);
        this.size = count;
        this.keys = readStringTable(buffer, keyOffset, count);
        this.titles = readStringTable(buffer, titleOffset, count);
    }
    static async load(path = join(DEFAULT_DATA_DIR, 'display-titles.gtb')) {
        return timed(async () => {
            try {
                const buffer = await readFile(path);
                return new DisplayTitleStore(buffer);
            }
            catch {
                return undefined;
            }
        }, `display_titles_load path=${path}`);
    }
    static fromBuffer(buffer) {
        return new DisplayTitleStore(buffer);
    }
    titleFor(bucket, canonicalKey) {
        const index = findStringId(this.keys, compositeKey(bucket, canonicalKey));
        return index < 0 ? null : stringAt(this.titles, index);
    }
    titlesFor(requests) {
        return requests.map(([bucket, canonicalKey]) => this.titleFor(bucket, canonicalKey));
    }
}
export async function buildDisplayTitleArtifact(entries, outPath) {
    await writeFile(outPath, packDisplayTitles(entries));
}
export function displayTitleKey(bucket, canonicalKey) {
    return compositeKey(bucket, canonicalKey);
}
