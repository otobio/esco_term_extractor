import { createHash } from 'node:crypto';
import { readFile, stat, readdir } from 'node:fs/promises';
import path from 'node:path';
import unzipper from 'unzipper';
export async function locateEscoPack(downloadsDir, version, locale) {
    const baseName = `ESCO dataset - v${version} - classification - ${locale} - csv`;
    const directoryPath = path.join(downloadsDir, baseName);
    try {
        const directoryStat = await stat(directoryPath);
        if (directoryStat.isDirectory()) {
            return { type: 'directory', path: directoryPath };
        }
    }
    catch {
        // fall through
    }
    const zipPath = path.join(downloadsDir, `${baseName}.zip`);
    try {
        const zipStat = await stat(zipPath);
        if (zipStat.isFile()) {
            return { type: 'zip', path: zipPath };
        }
    }
    catch {
        // fall through
    }
    throw new Error(`ESCO locale pack not found for locale "${locale}" under ${downloadsDir}`);
}
export async function listEscoCsvFiles(pack) {
    if (pack.type === 'directory') {
        const entries = await readdir(pack.path, { withFileTypes: true });
        return entries
            .filter((entry) => entry.isFile() && entry.name.endsWith('.csv'))
            .map((entry) => entry.name)
            .sort((left, right) => left.localeCompare(right));
    }
    const directory = (await unzipper.Open.file(pack.path));
    return directory.files
        .map((entry) => path.basename(entry.path))
        .filter((entryName) => entryName.endsWith('.csv'))
        .sort((left, right) => left.localeCompare(right));
}
export async function readEscoFile(pack, fileName) {
    if (pack.type === 'directory') {
        const absolutePath = path.join(pack.path, fileName);
        const buffer = await readFile(absolutePath);
        return {
            sourcePath: absolutePath,
            checksumSha256: createHash('sha256').update(buffer).digest('hex'),
            content: buffer.toString('utf8')
        };
    }
    const directory = (await unzipper.Open.file(pack.path));
    const entry = directory.files.find((candidate) => path.basename(candidate.path) === fileName);
    if (!entry) {
        throw new Error(`Unable to find ${fileName} inside ${pack.path}`);
    }
    const contentBuffer = await entry.buffer();
    return {
        sourcePath: `${pack.path}#${entry.path}`,
        checksumSha256: createHash('sha256').update(contentBuffer).digest('hex'),
        content: contentBuffer.toString('utf8')
    };
}
