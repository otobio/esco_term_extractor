import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readOptionalEnv } from '../config/env.js';
import { getDefaultRuntimeDir } from './runtime-dir.js';
import { isRecord, safeFileSegment } from '../utils/validation.js';
const CACHE = new Map();
const DEFAULT_CACHE_SIZE = 4;
export function defaultOccupationSemanticBootstrapManifestPath(locale) {
    return path.join(getDefaultRuntimeDir(), `semantic-bootstrap.${safeFileSegment(locale)}.json`);
}
export async function loadOccupationSemanticBootstrapArtifactIfAvailable(locale) {
    const configuredPath = readOptionalEnv('OCCUPATION_SEMANTIC_BOOTSTRAP_ARTIFACT_PATH');
    const manifestPath = configuredPath ?? defaultOccupationSemanticBootstrapManifestPath(locale);
    const cacheKey = path.resolve(manifestPath);
    const cached = CACHE.get(cacheKey);
    if (cached) {
        return cached;
    }
    const loaded = await loadArtifact(cacheKey, locale);
    if (loaded) {
        trimCache(CACHE, DEFAULT_CACHE_SIZE);
        CACHE.set(cacheKey, loaded);
    }
    return loaded;
}
export async function loadOccupationSemanticBootstrapArtifactRequired(locale) {
    const manifestPath = readOptionalEnv('OCCUPATION_SEMANTIC_BOOTSTRAP_ARTIFACT_PATH') ?? defaultOccupationSemanticBootstrapManifestPath(locale);
    const artifactEntry = await loadOccupationSemanticBootstrapArtifactIfAvailable(locale);
    if (!artifactEntry) {
        throw new Error([
            `Missing required occupation semantic bootstrap artifact for locale="${locale}".`,
            `Expected JSON: ${path.resolve(manifestPath)}`,
            'Run `npm run semantic:bootstrap:build` or set OCCUPATION_SEMANTIC_BOOTSTRAP_ARTIFACT_PATH.'
        ].join(' '));
    }
    return artifactEntry;
}
async function loadArtifact(manifestPath, locale) {
    try {
        await access(manifestPath);
    }
    catch {
        return null;
    }
    const raw = await readFile(manifestPath, 'utf8');
    const artifact = validateArtifact(JSON.parse(raw), manifestPath);
    if (artifact.locale !== locale) {
        return null;
    }
    return { manifestPath, artifact };
}
function validateArtifact(value, manifestPath) {
    if (!isRecord(value)) {
        throw new Error(`Occupation semantic bootstrap JSON at ${manifestPath} must be a JSON object.`);
    }
    const artifact = value;
    if (artifact.schemaVersion !== 1 ||
        typeof artifact.locale !== 'string' ||
        typeof artifact.headRule !== 'string' ||
        !isRecord(artifact.thresholds) ||
        !Array.isArray(artifact.tokenRules) ||
        !Array.isArray(artifact.phraseRules)) {
        throw new Error(`Invalid occupation semantic bootstrap metadata at ${manifestPath}.`);
    }
    if (!isThresholds(artifact.thresholds)) {
        throw new Error(`Invalid occupation semantic bootstrap thresholds at ${manifestPath}.`);
    }
    for (const [index, rule] of artifact.tokenRules.entries()) {
        validateTokenRule(rule, manifestPath, index);
    }
    for (const [index, rule] of artifact.phraseRules.entries()) {
        validatePhraseRule(rule, manifestPath, index);
    }
    return artifact;
}
function validateTokenRule(value, manifestPath, index) {
    if (!isRecord(value)) {
        throw new Error(`Invalid token rule at ${manifestPath}#tokenRules[${index}].`);
    }
    const rule = value;
    if (typeof rule.token !== 'string' ||
        typeof rule.kind !== 'string' ||
        typeof rule.occupationSignal !== 'number' ||
        typeof rule.penaltySignal !== 'number' ||
        typeof rule.note !== 'string') {
        throw new Error(`Invalid token rule at ${manifestPath}#tokenRules[${index}].`);
    }
}
function validatePhraseRule(value, manifestPath, index) {
    if (!isRecord(value)) {
        throw new Error(`Invalid phrase rule at ${manifestPath}#phraseRules[${index}].`);
    }
    const rule = value;
    if (typeof rule.phrase !== 'string' ||
        typeof rule.kind !== 'string' ||
        typeof rule.occupationSignal !== 'number' ||
        typeof rule.penaltySignal !== 'number' ||
        typeof rule.note !== 'string') {
        throw new Error(`Invalid phrase rule at ${manifestPath}#phraseRules[${index}].`);
    }
}
function isThresholds(value) {
    if (!isRecord(value)) {
        return false;
    }
    return [
        value.tokenHelpMinOccupationSignal,
        value.tokenHelpMaxPenaltySignal,
        value.tokenHurtMinPenaltySignal,
        value.tokenHurtMaxOccupationSignal,
        value.tokenNeutralNetBand,
        value.phraseHelpMinOccupationSignal,
        value.phraseHelpMaxPenaltySignal,
        value.phraseHurtMinPenaltySignal,
        value.phraseHurtMaxOccupationSignal,
        value.phraseNeutralNetBand
    ].every((item) => typeof item === 'number' && Number.isFinite(item) && item >= 0);
}
function trimCache(cache, maxSize) {
    while (cache.size > maxSize) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey === undefined) {
            return;
        }
        cache.delete(oldestKey);
    }
}
