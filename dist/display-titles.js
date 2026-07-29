/**
 * display-titles.ts — packed canonical display-title lookup for term-extractor
 * buckets. The artifact is build-only and keeps runtime resolution to a tiny
 * binary-search over two string tables.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { timed } from '@term-extractor/utils/perf';
const MAGIC = 0x44544231; // "DTB1"
const VERSION = 1;
const NUM_SECTIONS = 2;
const KEY_SEPARATOR = '\u001f';
const DEFAULT_DATA_DIR = fileURLToPath(new URL('../data', import.meta.url));
const dec = new TextDecoder();
export function writeStringTable(strings) {
    const encoded = strings.map((value) => Buffer.from(value, 'utf8'));
    const offsets = new Uint32Array(strings.length + 1);
    let byteLength = 0;
    encoded.forEach((buffer, index) => {
        offsets[index] = byteLength;
        byteLength += buffer.byteLength;
    });
    offsets[strings.length] = byteLength;
    const output = Buffer.allocUnsafe(4 + offsets.byteLength + byteLength);
    output.writeUInt32LE(strings.length, 0);
    Buffer.from(offsets.buffer).copy(output, 4);
    let offset = 4 + offsets.byteLength;
    for (const buffer of encoded) {
        buffer.copy(output, offset);
        offset += buffer.byteLength;
    }
    return output;
}
function readStringTableAt(buffer, offset, expectedCount) {
    const count = buffer.readUInt32LE(offset);
    if (count !== expectedCount) {
        throw new Error(`String table count mismatch at offset ${offset}: expected=${expectedCount}, file=${count}.`);
    }
    const offsets = new Uint32Array(count + 1);
    let cursor = offset + 4;
    for (let i = 0; i <= count; i += 1) {
        offsets[i] = buffer.readUInt32LE(cursor);
        cursor += 4;
    }
    const bytesOffset = offset + 4 + (count + 1) * 4;
    return {
        count,
        offsets,
        bytes: buffer.subarray(bytesOffset, bytesOffset + offsets[count]),
    };
}
function stringAt(table, stringId) {
    if (stringId < 0 || stringId >= table.count)
        return '';
    return table.bytes.toString('utf8', table.offsets[stringId], table.offsets[stringId + 1]);
}
function compositeKey(bucket, canonicalKey) {
    return `${bucket}${KEY_SEPARATOR}${canonicalKey}`;
}
function compareToTable(table, index, keyBytes) {
    return Buffer.compare(keyBytes, table.bytes.subarray(table.offsets[index], table.offsets[index + 1]));
}
export function packDisplayTitles(entries) {
    const sorted = [...entries].sort((a, b) => Buffer.compare(Buffer.from(compositeKey(a.bucket, a.canonicalKey), 'utf8'), Buffer.from(compositeKey(b.bucket, b.canonicalKey), 'utf8')));
    const keys = sorted.map((entry) => compositeKey(entry.bucket, entry.canonicalKey));
    const titles = sorted.map((entry) => entry.displayTitle);
    const keyTable = writeStringTable(keys);
    const titleTable = writeStringTable(titles);
    const sections = [keyTable, titleTable];
    const headerSize = 4 + 3 * 4 + NUM_SECTIONS * 4;
    const align4 = (n) => (n + 3) & ~3;
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
        this.keys = readStringTableAt(buffer, keyOffset, count);
        this.titles = readStringTableAt(buffer, titleOffset, count);
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
        const keyBytes = Buffer.from(compositeKey(bucket, canonicalKey), 'utf8');
        let low = 0;
        let high = this.keys.count - 1;
        while (low <= high) {
            const mid = (low + high) >>> 1;
            const cmp = compareToTable(this.keys, mid, keyBytes);
            if (cmp === 0)
                return stringAt(this.titles, mid);
            if (cmp < 0)
                low = mid + 1;
            else
                high = mid - 1;
        }
        return null;
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
