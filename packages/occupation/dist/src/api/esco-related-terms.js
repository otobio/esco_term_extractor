import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { foldSearchText } from '../utils/texts.js';
import { loadEscoRelatedTermsArtifactRequired, lookupObjectRelatedTerms, lookupVerbRelatedTerms } from '../runtime/esco-related-terms-artifact.js';
const DEFAULT_RESULT_LIMIT = 25;
export async function giveVerbSynonym(verb, options = {}) {
    const queryVerb = normalizeTermInput(verb);
    if (!queryVerb) {
        throw new Error('giveVerbSynonym requires a non-empty verb.');
    }
    const sourceName = options.sourceName?.trim() || DEFAULT_ESCO_SOURCE_NAME;
    const locale = options.locale?.trim() || 'en';
    const limit = normalizeLimit(options.limit);
    const artifact = await loadEscoRelatedTermsArtifactRequired(sourceName, locale);
    return lookupVerbRelatedTerms(artifact, queryVerb, limit).map((row) => toVerbResult(queryVerb, row));
}
export async function giveObjectRelated(object, options = {}) {
    const queryObject = normalizeTermInput(object);
    if (!queryObject) {
        throw new Error('giveObjectRelated requires a non-empty object.');
    }
    const sourceName = options.sourceName?.trim() || DEFAULT_ESCO_SOURCE_NAME;
    const locale = options.locale?.trim() || 'en';
    const limit = normalizeLimit(options.limit);
    const artifact = await loadEscoRelatedTermsArtifactRequired(sourceName, locale);
    return lookupObjectRelatedTerms(artifact, queryObject, limit).map((row) => toObjectResult(queryObject, row));
}
export function mergeVerbRelatedRows(queryVerb, rows) {
    return mergeRelatedRows(queryVerb, rows).map((row) => ({
        queryVerb,
        relatedVerb: row.relatedTerm,
        relationshipType: row.relationshipType,
        direction: row.direction,
        evidenceCount: row.evidenceCount,
        sourceLabelExamples: row.sourceLabelExamples,
        relatedLabelExamples: row.relatedLabelExamples
    }));
}
export function mergeObjectRelatedRows(queryObject, rows) {
    return mergeRelatedRows(queryObject, rows).map((row) => ({
        queryObject,
        relatedObject: row.relatedTerm,
        relationshipType: row.relationshipType,
        direction: row.direction,
        evidenceCount: row.evidenceCount,
        sourceLabelExamples: row.sourceLabelExamples,
        relatedLabelExamples: row.relatedLabelExamples
    }));
}
function mergeRelatedRows(queryTerm, rows) {
    const byKey = new Map();
    for (const row of rows) {
        const querySideIsSource = row.source_term === queryTerm;
        const querySideIsRelated = row.related_term === queryTerm;
        if (!querySideIsSource && !querySideIsRelated) {
            continue;
        }
        const relatedTerm = querySideIsSource ? row.related_term : row.source_term;
        const sourceLabelExamples = parseStringArray(querySideIsSource ? row.source_label_examples_json : row.related_label_examples_json);
        const relatedLabelExamples = parseStringArray(querySideIsSource ? row.related_label_examples_json : row.source_label_examples_json);
        const key = `${row.relationship_type}\u0000${relatedTerm}`;
        const current = byKey.get(key);
        const next = {
            queryTerm,
            relatedTerm,
            relationshipType: row.relationship_type,
            direction: row.direction,
            evidenceCount: Number(row.evidence_count) || 0,
            sourceLabelExamples,
            relatedLabelExamples
        };
        if (!current) {
            byKey.set(key, next);
            continue;
        }
        const merged = {
            queryTerm,
            relatedTerm: current.relatedTerm,
            relationshipType: current.relationshipType,
            direction: current.direction === 'forward' ? 'forward' : next.direction,
            evidenceCount: Math.max(current.evidenceCount, next.evidenceCount),
            sourceLabelExamples: mergeUniqueStrings(current.sourceLabelExamples, next.sourceLabelExamples),
            relatedLabelExamples: mergeUniqueStrings(current.relatedLabelExamples, next.relatedLabelExamples)
        };
        byKey.set(key, merged);
    }
    return [...byKey.values()].sort((left, right) => right.evidenceCount - left.evidenceCount ||
        left.relationshipType.localeCompare(right.relationshipType) ||
        left.relatedTerm.localeCompare(right.relatedTerm) ||
        left.direction.localeCompare(right.direction));
}
function toVerbResult(queryVerb, row) {
    return {
        queryVerb,
        relatedVerb: row.relatedTerm,
        relationshipType: row.relationshipType,
        direction: row.direction,
        evidenceCount: row.evidenceCount,
        sourceLabelExamples: row.sourceLabelExamples,
        relatedLabelExamples: row.relatedLabelExamples
    };
}
function toObjectResult(queryObject, row) {
    return {
        queryObject,
        relatedObject: row.relatedTerm,
        relationshipType: row.relationshipType,
        direction: row.direction,
        evidenceCount: row.evidenceCount,
        sourceLabelExamples: row.sourceLabelExamples,
        relatedLabelExamples: row.relatedLabelExamples
    };
}
function parseStringArray(value) {
    if (Array.isArray(value)) {
        return value.filter((item) => typeof item === 'string');
    }
    if (typeof value !== 'string') {
        return [];
    }
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
        return [];
    }
    return parsed.filter((item) => typeof item === 'string');
}
function mergeUniqueStrings(left, right) {
    return [...new Set([...left, ...right])].sort((a, b) => a.localeCompare(b));
}
function normalizeTermInput(value) {
    return foldSearchText(value).trim();
}
function normalizeLimit(value) {
    if (!Number.isInteger(value) || !value || value < 1) {
        return DEFAULT_RESULT_LIMIT;
    }
    return value;
}
