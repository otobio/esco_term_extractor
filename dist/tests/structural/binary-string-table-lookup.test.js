import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { findStringId, readStringTableSync, stringAt, writeStringTable } from '../../src/utils/binary-table.js';
import { getDefaultRuntimeDir } from '../../src/runtime/runtime-dir.js';
// findStringId binary-searches a string table by comparing the needle's UTF-8 bytes against the
// backing buffer, instead of decoding a throwaway JS string at every probe. That is only
// equivalent to the previous JS-string comparison while every searched table is sorted in UTF-8
// byte order, which matches JS UTF-16 order for BMP text but NOT for supplementary-plane
// characters (emoji), whose surrogates sort below U+E000..U+FFFF in UTF-16 but above it in UTF-8.
// These tests pin both halves: the lookup behaviour, and the artifact ordering it depends on.
// Sorted by localeCompare at export and never binary-searched -- callers resolve its ids directly.
// If findStringId is ever pointed at it, it must be re-sorted in byte order first.
const UNSEARCHED_STRING_TABLES = new Set(['occupation-leaf-structure.esco_1_2_1.binary.strings.bin']);
function readStringTableEntries(filePath) {
    const buffer = readFileSync(filePath);
    const count = buffer.readUInt32LE(0);
    const offsets = new Uint32Array(buffer.buffer, buffer.byteOffset + 4, count + 1);
    const bytes = buffer.subarray(4 + (count + 1) * 4);
    const entries = [];
    for (let index = 0; index < count; index += 1) {
        entries.push(bytes.toString('utf8', offsets[index], offsets[index + 1]));
    }
    return entries;
}
function byteSorted(strings) {
    return [...strings].sort((left, right) => Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8')));
}
function withTemporaryStringTable(strings, run) {
    const directory = mkdtempSync(path.join(tmpdir(), 'binary-string-table-'));
    try {
        const filePath = path.join(directory, 'strings.bin');
        writeFileSync(filePath, writeStringTable(strings));
        run(filePath, strings.length);
    }
    finally {
        rmSync(directory, { recursive: true, force: true });
    }
}
/** The pre-optimisation search: decode each probe and compare as JS strings. */
function referenceFindStringId(entries, value) {
    let low = 0;
    let high = entries.length - 1;
    while (low <= high) {
        const mid = (low + high) >>> 1;
        const current = entries[mid];
        if (current < value) {
            low = mid + 1;
        }
        else if (current > value) {
            high = mid - 1;
        }
        else {
            return mid;
        }
    }
    return -1;
}
test('findStringId round-trips every entry of a byte-sorted table, including RO/HU diacritics', () => {
    const strings = byteSorted(['accountant', 'bucatar', 'bucătar', 'könyvelő', 'sofer', 'șofer', 'ügyvéd', 'zoologist']);
    withTemporaryStringTable(strings, (filePath, count) => {
        const table = readStringTableSync(filePath, count);
        strings.forEach((value, index) => {
            assert.equal(findStringId(table, value), index, `expected to find ${JSON.stringify(value)}`);
            assert.equal(stringAt(table, index), value);
        });
    });
});
test('findStringId returns -1 for absent values, including prefixes and extensions of real entries', () => {
    const strings = byteSorted(['accountant', 'accountants', 'nurse']);
    withTemporaryStringTable(strings, (filePath, count) => {
        const table = readStringTableSync(filePath, count);
        for (const missing of ['account', 'accountantss', 'nurs', 'nursex', '', 'zzz']) {
            assert.equal(findStringId(table, missing), -1, `expected ${JSON.stringify(missing)} to be absent`);
        }
    });
});
test('findStringId handles a needle longer than the scratch buffer', () => {
    const long = 'ș'.repeat(600);
    const strings = byteSorted(['accountant', long]);
    withTemporaryStringTable(strings, (filePath, count) => {
        const table = readStringTableSync(filePath, count);
        assert.equal(stringAt(table, findStringId(table, long)), long);
        assert.equal(findStringId(table, 'accountant'), strings.indexOf('accountant'));
    });
});
test('every runtime string table is BMP-only, so UTF-8 byte order matches JS string order', () => {
    const runtimeDir = getDefaultRuntimeDir();
    const files = readdirSync(runtimeDir).filter((file) => file.endsWith('strings.bin'));
    assert.ok(files.length > 0, 'expected runtime string tables to be present');
    for (const file of files) {
        for (const value of readStringTableEntries(path.join(runtimeDir, file))) {
            for (let index = 0; index < value.length; index += 1) {
                const code = value.charCodeAt(index);
                assert.ok(code < 0xd800 || code > 0xdfff, `${file} contains a supplementary-plane character in ${JSON.stringify(value)}; byte order and JS string order diverge, so searched tables must be re-sorted in byte order at export`);
            }
        }
    }
});
test('every searched runtime string table is sorted in UTF-8 byte order', () => {
    const runtimeDir = getDefaultRuntimeDir();
    const files = readdirSync(runtimeDir)
        .filter((file) => file.endsWith('strings.bin'))
        .filter((file) => !UNSEARCHED_STRING_TABLES.has(file));
    assert.ok(files.length > 0, 'expected searched runtime string tables to be present');
    for (const file of files) {
        const entries = readStringTableEntries(path.join(runtimeDir, file));
        for (let index = 1; index < entries.length; index += 1) {
            const previous = Buffer.from(entries[index - 1], 'utf8');
            const current = Buffer.from(entries[index], 'utf8');
            assert.ok(Buffer.compare(previous, current) < 0, `${file} is not byte-sorted at ${index}: ${JSON.stringify(entries[index - 1])} >= ${JSON.stringify(entries[index])}`);
        }
    }
});
test('findStringId agrees with a decoded-string binary search across real runtime tables', () => {
    const runtimeDir = getDefaultRuntimeDir();
    const files = readdirSync(runtimeDir)
        .filter((file) => file.endsWith('strings.bin'))
        .filter((file) => !UNSEARCHED_STRING_TABLES.has(file));
    for (const file of files) {
        const filePath = path.join(runtimeDir, file);
        const entries = readStringTableEntries(filePath);
        const table = readStringTableSync(filePath, entries.length);
        const step = Math.max(1, Math.floor(entries.length / 200));
        for (let index = 0; index < entries.length; index += step) {
            const value = entries[index];
            const extension = `${value}-absent-probe`;
            assert.equal(findStringId(table, value), referenceFindStringId(entries, value), `${file}: ${JSON.stringify(value)}`);
            assert.equal(findStringId(table, extension), referenceFindStringId(entries, extension), `${file}: ${JSON.stringify(extension)}`);
        }
    }
});
