import path from 'node:path';
import { readOptionalEnv } from './env.js';
const DEFAULT_ESCO_VERSION = '1.2.1';
const DEFAULT_ESCO_LOCALES = ['en'];
function parseLocales(value) {
    const rawLocales = (value ?? '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);
    if (rawLocales.length === 0) {
        return [...DEFAULT_ESCO_LOCALES];
    }
    return Array.from(new Set(rawLocales));
}
function sanitizeVersionForName(version) {
    return version.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}
export function getEscoConfig(overrides = {}) {
    const version = overrides.version ?? readOptionalEnv('ESCO_VERSION') ?? DEFAULT_ESCO_VERSION;
    const downloadsDir = overrides.downloadsDir ?? readOptionalEnv('ESCO_DOWNLOADS_DIR');
    if (!downloadsDir) {
        throw new Error('Missing ESCO_DOWNLOADS_DIR. Set it to the directory containing the ESCO locale packs before running the importer.');
    }
    const locales = overrides.locales ?? parseLocales(readOptionalEnv('ESCO_LOCALES'));
    const sourceName = `esco_${sanitizeVersionForName(version)}`;
    return {
        downloadsDir: path.resolve(downloadsDir),
        locales,
        version,
        sourceKind: 'esco',
        sourceName
    };
}
