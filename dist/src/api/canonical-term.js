import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';
import { classifyOccupationTitle } from '../occupation-classifier/index.js';
import { classifyOccupationTitleViaEscoApi } from '../occupation-esco-api-classifier/index.js';
const DEFAULT_API_LOCALE = 'en';
const DEFAULT_API_LIMIT = 3;
const ESCO_LABEL_NODE_INDEX_CACHE = new Map();
const ESCO_API_COVERAGE_STATUS = {
    empty_query: 'insufficient_evidence',
    multi_span: 'multi_span',
    exact_preferred_label_leaf: 'exact_canonical_match',
    exact_alternative_label_leaf: 'exact_canonical_match',
    exact_hidden_label_leaf: 'exact_canonical_match',
    exact_family_label: 'exact_canonical_match',
    family_leaf_ambiguity: 'closest_available_match',
    family_dictionary_gap: 'likely_dictionary_gap',
    unresolved_weak_evidence: 'insufficient_evidence',
    unresolved_no_candidates: 'insufficient_evidence'
};
export async function getCanonicalTerm(options) {
    if (options.mode === 'v3') {
        return getCanonicalTermV3(options);
    }
    return getCanonicalTermV2(options);
}
async function getCanonicalTermV2(options) {
    const input = options.input.trim();
    if (!input) {
        throw new Error('getCanonicalTerm requires a non-empty input.');
    }
    const limit = normalizeLimit(options.limit);
    const sourceName = DEFAULT_ESCO_SOURCE_NAME;
    const runtimeResult = await classifyOccupationTitle({
        query: input,
        locale: options.locale,
        sourceName
    });
    const spanResults = runtimeResult.spans ?? [{ query: input, result: runtimeResult }];
    const occupationContexts = [];
    for (let spanIndex = 0; spanIndex < spanResults.length; spanIndex++) {
        const span = spanResults[spanIndex];
        occupationContexts.push(await canonicalOccupationContextFromRuntimeResult(sourceName, spanIndex + 1, span.query, span.result, limit));
    }
    return {
        input,
        locale: options.locale ?? DEFAULT_API_LOCALE,
        occupationContexts
    };
}
async function canonicalOccupationContextFromRuntimeResult(sourceName, spanIndex, query, result, limit) {
    const selectedLeafTerm = result.leaf
        ? { graphNodeId: result.leaf.graphNodeId, canonicalTerm: result.leaf.canonicalLabel, confidence: result.decision.confidence }
        : null;
    const selectedFamilyTerm = result.family
        ? { graphNodeId: result.family.familyNodeId, canonicalTerm: result.family.familyLabel, confidence: result.decision.confidence }
        : null;
    const altLeafCanonicalTerms = toAltLeafCanonicalTerms(result.altLeafCanonicalTerms, limit);
    const capabilityLeafTerms = selectedLeafTerm ? [selectedLeafTerm] : [];
    return {
        spanIndex,
        input: query,
        decision: {
            decisionType: result.decision.type,
            selectedCanonicalTerm: result.leaf?.canonicalLabel ?? result.family?.familyLabel ?? null,
            selectedGraphNodeId: result.leaf?.graphNodeId ?? result.family?.familyNodeId ?? null,
            confidence: result.decision.confidence
        },
        coverageStatus: result.coverage.status,
        selectedLeafTerm,
        selectedFamilyTerm,
        altLeafCanonicalTerms,
        altFamilyCanonicalTerms: [],
        capabilityTerms: await topCapabilityTerms(sourceName, capabilityLeafTerms, limit)
    };
}
async function getCanonicalTermV3(options) {
    const input = options.input.trim();
    if (!input) {
        throw new Error('getCanonicalTerm requires a non-empty input.');
    }
    const limit = normalizeLimit(options.limit);
    const locale = options.locale ?? DEFAULT_API_LOCALE;
    const sourceName = DEFAULT_ESCO_SOURCE_NAME;
    const [result, nodeIndex] = await Promise.all([
        classifyOccupationTitleViaEscoApi({ query: input, locale }),
        loadEscoLabelNodeIndex(sourceName)
    ]);
    const spanResults = result.spans ?? [{ query: input, result }];
    const occupationContexts = [];
    for (let spanIndex = 0; spanIndex < spanResults.length; spanIndex++) {
        const span = spanResults[spanIndex];
        occupationContexts.push(await canonicalOccupationContextFromEscoApiResult(sourceName, nodeIndex, spanIndex + 1, span.query, span.result, limit));
    }
    return { input, locale, occupationContexts };
}
async function canonicalOccupationContextFromEscoApiResult(sourceName, nodeIndex, spanIndex, query, result, limit) {
    const selectedLeafTerm = result.leaf ? escoLeafTerm(nodeIndex, result.leaf) : null;
    const selectedFamilyTerm = result.family ? escoFamilyTerm(nodeIndex, result.family) : null;
    const selectedTerm = selectedLeafTerm ?? selectedFamilyTerm;
    const altLeafCanonicalTerms = result.altLeaves.map((leaf) => escoLeafTerm(nodeIndex, leaf)).filter(isMappedTerm).slice(0, limit);
    const altFamilyCanonicalTerms = result.altFamilies.map((family) => escoFamilyTerm(nodeIndex, family)).filter(isMappedTerm).slice(0, limit);
    const capabilityLeafTerms = selectedLeafTerm && isMappedTerm(selectedLeafTerm) ? [selectedLeafTerm] : [];
    return {
        spanIndex,
        input: query,
        decision: {
            decisionType: result.decision.type,
            selectedCanonicalTerm: selectedTerm?.canonicalTerm ?? null,
            selectedGraphNodeId: selectedTerm?.graphNodeId ?? null,
            confidence: result.decision.confidence
        },
        coverageStatus: ESCO_API_COVERAGE_STATUS[result.decision.reason],
        selectedLeafTerm,
        selectedFamilyTerm,
        altLeafCanonicalTerms,
        altFamilyCanonicalTerms,
        capabilityTerms: await topCapabilityTerms(sourceName, capabilityLeafTerms, limit)
    };
}
function escoLeafTerm(nodeIndex, leaf) {
    return { graphNodeId: nodeIndex.leafNodeIdByLabel.get(leaf.label) ?? -1, canonicalTerm: leaf.label, confidence: leaf.confidence };
}
function escoFamilyTerm(nodeIndex, family) {
    return { graphNodeId: nodeIndex.familyNodeIdByLabel.get(family.label) ?? -1, canonicalTerm: family.label, confidence: family.confidence };
}
function isMappedTerm(term) {
    return term.graphNodeId >= 0;
}
function loadEscoLabelNodeIndex(sourceName) {
    let cached = ESCO_LABEL_NODE_INDEX_CACHE.get(sourceName);
    if (!cached) {
        cached = loadOccupationSearchMetaArtifactRequired(sourceName).then(buildEscoLabelNodeIndex);
        ESCO_LABEL_NODE_INDEX_CACHE.set(sourceName, cached);
    }
    return cached;
}
function buildEscoLabelNodeIndex(artifactEntry) {
    const leafNodeIdByLabel = new Map();
    const familyNodeIdByLabel = new Map();
    for (const record of artifactEntry.getAllCoreRecords()) {
        leafNodeIdByLabel.set(record.canonicalLabel, record.graphNodeId);
        if (record.familyNodeId !== null && record.familyLabel !== null) {
            familyNodeIdByLabel.set(record.familyLabel, record.familyNodeId);
        }
    }
    return { leafNodeIdByLabel, familyNodeIdByLabel };
}
function toAltLeafCanonicalTerms(terms, limit) {
    return terms.slice(0, limit).map((term) => ({
        graphNodeId: term.graphNodeId,
        canonicalTerm: term.canonicalTerm,
        confidence: term.confidence
    }));
}
async function topCapabilityTerms(sourceName, leafTerms, limit) {
    if (leafTerms.length === 0) {
        return [];
    }
    const artifactEntry = await loadOccupationSearchMetaArtifactRequired(sourceName);
    const byCapabilityId = new Map();
    for (const leafTerm of leafTerms) {
        const record = artifactEntry.getDetails(leafTerm.graphNodeId);
        if (!record) {
            continue;
        }
        for (const capability of sortRuntimeCapabilities(record.capabilityLabels)) {
            mergeCapabilityTerm(byCapabilityId, capability, leafTerm.confidence);
        }
    }
    return Array.from(byCapabilityId.values())
        .sort((left, right) => right.confidence - left.confidence || left.canonicalTerm.localeCompare(right.canonicalTerm))
        .slice(0, limit);
}
function mergeCapabilityTerm(byCapabilityId, capability, leafConfidence) {
    const hintWeight = capability.weight ?? 0.7;
    const hintKindMultiplier = capability.hintKind === 'essential' ? 1 : capability.hintKind === 'optional' ? 0.72 : 0.86;
    const confidence = clampScore(leafConfidence * hintWeight * hintKindMultiplier);
    const existing = byCapabilityId.get(capability.capabilityId);
    if (existing && existing.confidence >= confidence) {
        return;
    }
    byCapabilityId.set(capability.capabilityId, {
        capabilityId: capability.capabilityId,
        canonicalTerm: capability.label,
        capabilityType: capability.capabilityType,
        confidence
    });
}
function sortRuntimeCapabilities(capabilities) {
    return [...capabilities].sort((left, right) => capabilityKindOrder(left.hintKind) - capabilityKindOrder(right.hintKind) ||
        (right.weight ?? 0) - (left.weight ?? 0) ||
        left.label.localeCompare(right.label));
}
function capabilityKindOrder(hintKind) {
    if (hintKind === 'essential') {
        return 1;
    }
    if (hintKind === 'knowledge') {
        return 2;
    }
    if (hintKind === 'tool') {
        return 3;
    }
    if (hintKind === 'software') {
        return 4;
    }
    if (hintKind === 'optional') {
        return 5;
    }
    return 6;
}
function normalizeLimit(value) {
    const limit = value ?? DEFAULT_API_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
        throw new Error(`getCanonicalTerm limit must be an integer from 1 to 10. Received "${limit}".`);
    }
    return limit;
}
function clampScore(value) {
    const rounded = Number(Math.max(0, Math.min(1, value)).toFixed(6));
    return Object.is(rounded, -0) ? 0 : rounded;
}
