import { closeSync, openSync, readSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
export async function readStringTable(filePath, expectedCount) {
    const buffer = await readFile(filePath);
    return parseStringTable(buffer, filePath, expectedCount);
}
export function readStringTableSync(filePath, expectedCount) {
    const buffer = readFileSync(filePath);
    return parseStringTable(buffer, filePath, expectedCount);
}
export function readFileBackedStringTableSync(filePath, expectedCount, options = {}) {
    const fd = acquireFd(filePath);
    const file = {
        filePath,
        fd,
        dataOffset: 0,
        cache: new Map(),
        maxEntries: options.maxEntries ?? 512
    };
    try {
        const countBuffer = Buffer.allocUnsafe(4);
        readFileRangeSync(file, countBuffer, 0);
        const count = countBuffer.readUInt32LE(0);
        if (count !== expectedCount) {
            throw new Error(`String table count mismatch at ${filePath}: manifest=${expectedCount}, file=${count}.`);
        }
        const offsetsBuffer = Buffer.allocUnsafe((count + 1) * 4);
        readFileRangeSync(file, offsetsBuffer, 4);
        file.dataOffset = 4 + offsetsBuffer.byteLength;
        return {
            count,
            offsets: new Uint32Array(offsetsBuffer.buffer, offsetsBuffer.byteOffset, count + 1),
            file
        };
    }
    catch (error) {
        releaseFd(filePath);
        throw error;
    }
}
function parseStringTable(buffer, filePath, expectedCount) {
    const count = buffer.readUInt32LE(0);
    if (count !== expectedCount) {
        throw new Error(`String table count mismatch at ${filePath}: manifest=${expectedCount}, file=${count}.`);
    }
    const offsets = new Uint32Array(buffer.buffer, buffer.byteOffset + 4, count + 1);
    const bytesOffset = 4 + (count + 1) * 4;
    return {
        count,
        offsets,
        bytes: buffer.subarray(bytesOffset)
    };
}
export async function readFixedTable(filePath, width, expectedCount) {
    const buffer = await readFile(filePath);
    return parseFixedTable(buffer, filePath, width, expectedCount);
}
export function readFixedTableSync(filePath, width, expectedCount) {
    const buffer = readFileSync(filePath);
    return parseFixedTable(buffer, filePath, width, expectedCount);
}
export function readFileBackedFixedTableSync(filePath, width, expectedCount, options = {}) {
    const fd = acquireFd(filePath);
    const file = {
        filePath,
        fd,
        dataOffset: 8,
        pageRowCount: options.pageRowCount ?? 4096,
        cache: new Map(),
        maxPages: options.maxPages ?? 8
    };
    try {
        const header = Buffer.allocUnsafe(8);
        readFileRangeSync(file, header, 0);
        const count = header.readUInt32LE(0);
        const rowWidth = header.readUInt32LE(4);
        if (count !== expectedCount || rowWidth !== width) {
            throw new Error(`Fixed table shape mismatch at ${filePath}: manifest=${expectedCount}x${width}, file=${count}x${rowWidth}.`);
        }
        return {
            count,
            width,
            file
        };
    }
    catch (error) {
        releaseFd(filePath);
        throw error;
    }
}
function parseFixedTable(buffer, filePath, width, expectedCount) {
    const count = buffer.readUInt32LE(0);
    const rowWidth = buffer.readUInt32LE(4);
    if (count !== expectedCount || rowWidth !== width) {
        throw new Error(`Fixed table shape mismatch at ${filePath}: manifest=${expectedCount}x${width}, file=${count}x${rowWidth}.`);
    }
    return {
        count,
        width,
        values: new Uint32Array(buffer.buffer, buffer.byteOffset + 8, count * width)
    };
}
export async function readUint32Rows(filePath) {
    const buffer = await readFile(filePath);
    const count = buffer.readUInt32LE(0);
    return new Uint32Array(buffer.buffer, buffer.byteOffset + 4, count);
}
export function readFileBackedUint32RowsSync(filePath, options = {}) {
    const fd = acquireFd(filePath);
    const rows = {
        count: 0,
        filePath,
        fd,
        dataOffset: 4,
        pageRowCount: options.pageRowCount ?? 16384,
        cache: new Map(),
        maxPages: options.maxPages ?? 8
    };
    try {
        const header = Buffer.allocUnsafe(4);
        readFileRangeSync(rows, header, 0);
        rows.count = header.readUInt32LE(0);
        return rows;
    }
    catch (error) {
        releaseFd(filePath);
        throw error;
    }
}
export function stringAt(table, stringId) {
    if (stringId >= table.count) {
        return '';
    }
    if (table.bytes) {
        return table.bytes.toString('utf8', table.offsets[stringId], table.offsets[stringId + 1]);
    }
    if (table.file) {
        const cached = table.file.cache.get(stringId);
        if (cached !== undefined) {
            table.file.cache.delete(stringId);
            table.file.cache.set(stringId, cached);
            return cached;
        }
        const start = table.offsets[stringId] ?? 0;
        const end = table.offsets[stringId + 1] ?? start;
        if (end <= start) {
            return '';
        }
        const buffer = Buffer.allocUnsafe(end - start);
        readFileRangeSync(table.file, buffer, table.file.dataOffset + start);
        const value = buffer.toString('utf8');
        table.file.cache.set(stringId, value);
        while (table.file.cache.size > table.file.maxEntries) {
            const oldestKey = table.file.cache.keys().next().value;
            if (oldestKey === undefined) {
                break;
            }
            table.file.cache.delete(oldestKey);
        }
        return value;
    }
    return '';
}
export function findStringId(table, value) {
    let low = 0;
    let high = table.count - 1;
    while (low <= high) {
        const mid = (low + high) >>> 1;
        const current = stringAt(table, mid);
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
export function rowValue(table, rowIndex, columnIndex) {
    if (table.values) {
        return table.values[rowIndex * table.width + columnIndex] ?? 0;
    }
    if (table.file) {
        const page = fixedTablePage(table, table.file, rowIndex);
        const pageRowIndex = rowIndex % table.file.pageRowCount;
        return page[pageRowIndex * table.width + columnIndex] ?? 0;
    }
    return 0;
}
export function uint32RowsLength(rows) {
    return rows instanceof Uint32Array ? rows.length : rows.count;
}
export function uint32RowsSlice(rows, offset, length) {
    if (rows instanceof Uint32Array) {
        return Array.from(rows.subarray(offset, offset + length));
    }
    const values = [];
    const end = Math.min(offset + length, rows.count);
    for (let cursor = offset; cursor < end; cursor += 1) {
        const page = uint32RowsPage(rows, cursor);
        values.push(page[cursor % rows.pageRowCount] ?? 0);
    }
    return values;
}
export function uint32RowValue(rows, rowIndex) {
    if (rows instanceof Uint32Array) {
        return rows[rowIndex] ?? 0;
    }
    const page = uint32RowsPage(rows, rowIndex);
    return page[rowIndex % rows.pageRowCount] ?? 0;
}
export function closeFixedTable(table) {
    if (!table.file) {
        return;
    }
    closeFileBackedFixedTable(table.file);
}
export function closeUint32Rows(rows) {
    if (rows instanceof Uint32Array) {
        return;
    }
    closeFileBackedUint32Rows(rows);
}
export function closeStringTable(table) {
    if (!table.file || table.file.closed) {
        return;
    }
    table.file.closed = true;
    table.file.cache.clear();
    releaseFd(table.file.filePath);
}
export function closeFileBackedFixedTable(file) {
    if (file.closed) {
        return;
    }
    file.closed = true;
    file.cache.clear();
    releaseFd(file.filePath);
}
export function closeFileBackedUint32Rows(rows) {
    if (rows.closed) {
        return;
    }
    rows.closed = true;
    rows.cache.clear();
    releaseFd(rows.filePath);
}
function fixedTablePage(table, file, rowIndex) {
    const pageId = Math.floor(rowIndex / file.pageRowCount);
    const cached = file.cache.get(pageId);
    if (cached) {
        file.cache.delete(pageId);
        file.cache.set(pageId, cached);
        return cached;
    }
    const startRow = pageId * file.pageRowCount;
    const rowCount = Math.min(file.pageRowCount, Math.max(0, table.count - startRow));
    const buffer = takePageBuffer(file.cache, file.maxPages, rowCount * table.width * 4);
    readFileRangeSync(file, buffer, file.dataOffset + startRow * table.width * 4);
    const page = new Uint32Array(buffer.buffer, buffer.byteOffset, rowCount * table.width);
    cachePage(file.cache, pageId, page, file.maxPages);
    return page;
}
function uint32RowsPage(rows, rowIndex) {
    const pageId = Math.floor(rowIndex / rows.pageRowCount);
    const cached = rows.cache.get(pageId);
    if (cached) {
        rows.cache.delete(pageId);
        rows.cache.set(pageId, cached);
        return cached;
    }
    const startRow = pageId * rows.pageRowCount;
    const rowCount = Math.min(rows.pageRowCount, Math.max(0, rows.count - startRow));
    const buffer = takePageBuffer(rows.cache, rows.maxPages, rowCount * 4);
    readFileRangeSync(rows, buffer, rows.dataOffset + startRow * 4);
    const page = new Uint32Array(buffer.buffer, buffer.byteOffset, rowCount);
    cachePage(rows.cache, pageId, page, rows.maxPages);
    return page;
}
const openFds = new Map();
/**
 * Page-backed tables read from the same file repeatedly across the process
 * lifetime, so a fd is opened once per file path and shared/refcounted across
 * every table view onto it, instead of paying an open+close syscall per page
 * miss.
 */
function acquireFd(filePath) {
    const existing = openFds.get(filePath);
    if (existing) {
        existing.refCount += 1;
        return existing.fd;
    }
    const fd = openSync(filePath, 'r');
    openFds.set(filePath, { fd, refCount: 1 });
    return fd;
}
function releaseFd(filePath) {
    const existing = openFds.get(filePath);
    if (!existing) {
        return;
    }
    existing.refCount -= 1;
    if (existing.refCount <= 0) {
        openFds.delete(filePath);
        try {
            closeSync(existing.fd);
        }
        catch (error) {
            if (error.code !== 'EBADF') {
                throw error;
            }
        }
    }
}
/**
 * A fd can go stale underneath a long-lived table view — e.g. another view
 * onto the same path released the shared fd out from under this one due to a
 * refcount mismatch elsewhere. Rather than crash the read, reopen and retry
 * once. Concurrent views sharing the path can hit this at once; reopenFd
 * makes them converge on a single fresh fd instead of each opening their own
 * and splintering the shared refcount.
 */
function readFileRangeSync(file, buffer, position) {
    try {
        readSync(file.fd, buffer, 0, buffer.byteLength, position);
    }
    catch (error) {
        if (error.code !== 'EBADF') {
            throw error;
        }
        file.fd = reopenFd(file.filePath, file.fd);
        readSync(file.fd, buffer, 0, buffer.byteLength, position);
    }
}
/**
 * Recovers from a stale shared fd without desyncing the refcount other views
 * onto the same path rely on. If another view already refreshed this path
 * (its map entry no longer points at the fd that just failed), adopt that
 * fresh fd and count this call as one more live reference to it. Otherwise
 * this is the first to notice: open a new fd and carry the existing
 * refcount forward so later releaseFd calls still add up.
 */
function reopenFd(filePath, badFd) {
    const existing = openFds.get(filePath);
    if (existing && existing.fd !== badFd) {
        existing.refCount += 1;
        return existing.fd;
    }
    const fd = openSync(filePath, 'r');
    openFds.set(filePath, { fd, refCount: existing ? existing.refCount : 1 });
    try {
        closeSync(badFd);
    }
    catch {
        // already invalid — that's why we're here
    }
    return fd;
}
/**
 * A page miss used to allocate a fresh backing store, so a scan that walks a
 * large table churned one off-heap buffer per miss and left the evicted ones for
 * the next GC. Full-size pages are interchangeable, so the eviction that makes
 * room can also supply the storage for the incoming page: that caps a table's
 * off-heap footprint at `maxPages` pages no matter how many rows are read. The
 * caller overwrites every byte via `readFileRangeSync`, and no page reference
 * outlives the read that consumes it, so recycling cannot expose stale rows. The
 * final short page has its own size and is never recycled into a full page.
 */
function takePageBuffer(cache, maxPages, byteLength) {
    if (cache.size >= maxPages) {
        for (const [pageId, page] of cache) {
            if (page.byteLength !== byteLength) {
                continue;
            }
            cache.delete(pageId);
            return Buffer.from(page.buffer, page.byteOffset, byteLength);
        }
    }
    return Buffer.allocUnsafe(byteLength);
}
function cachePage(cache, pageId, page, maxPages) {
    cache.set(pageId, page);
    while (cache.size > maxPages) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey === undefined) {
            return;
        }
        cache.delete(oldestKey);
    }
}
export function findRange(table, keyColumns) {
    let low = 0;
    let high = table.count - 1;
    while (low <= high) {
        const mid = (low + high) >>> 1;
        const comparison = compareKeyAt(table, mid, keyColumns);
        if (comparison < 0) {
            low = mid + 1;
        }
        else if (comparison > 0) {
            high = mid - 1;
        }
        else {
            return {
                offset: rowValue(table, mid, table.width - 2),
                length: rowValue(table, mid, table.width - 1)
            };
        }
    }
    return null;
}
function compareKeyAt(table, rowIndex, keyColumns) {
    for (let index = 0; index < keyColumns.length; index += 1) {
        const left = rowValue(table, rowIndex, index);
        const right = keyColumns[index] ?? 0;
        if (left !== right) {
            return left - right;
        }
    }
    return 0;
}
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
export function writeFixedTable(rows, width) {
    const output = Buffer.allocUnsafe(8 + rows.length * width * 4);
    output.writeUInt32LE(rows.length, 0);
    output.writeUInt32LE(width, 4);
    const values = new Uint32Array(output.buffer, output.byteOffset + 8, rows.length * width);
    rows.forEach((row, rowIndex) => {
        for (let columnIndex = 0; columnIndex < width; columnIndex += 1) {
            values[rowIndex * width + columnIndex] = row[columnIndex] ?? 0;
        }
    });
    return output;
}
export function writeUint32Rows(rows) {
    const output = Buffer.allocUnsafe(4 + rows.length * 4);
    output.writeUInt32LE(rows.length, 0);
    new Uint32Array(output.buffer, output.byteOffset + 4, rows.length).set(rows);
    return output;
}
