import { DEFAULT_CANDIDATE_LIMIT, DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { DEFAULT_SIBLING_LIMIT } from '../retrieval/occupation-candidate-branches.js';
import { OccupationSearchPipeline, firstSelectableLeafInFamily } from '../search-pipeline/occupation-search-pipeline.js';
import { loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';
import { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
const DEFAULT_API_LOCALE = 'en';
const DEFAULT_API_LIMIT = 3;
const PIPELINE_CACHE = new Map();
export async function getCanonicalTerm(options) {
    return getCanonicalTermWithOptions(options);
}
async function getCanonicalTermWithOptions(options) {
    const input = options.input.trim();
    if (!input) {
        throw new Error('getCanonicalTerm requires a non-empty input.');
    }
    const limit = normalizeLimit(options.limit);
    const sourceName = options.sourceName ?? DEFAULT_ESCO_SOURCE_NAME;
    const pipeline = await loadRuntimePipeline(sourceName);
    const pipelineResult = await pipeline.run({
        query: input,
        locale: options.locale ?? DEFAULT_API_LOCALE,
        sourceName,
        limit: Math.max(DEFAULT_CANDIDATE_LIMIT, limit * 4),
        siblingLimit: options.siblingLimit ?? DEFAULT_SIBLING_LIMIT,
        topFamilyLimit: Math.max(limit, 10),
        topLeavesPerFamily: Math.max(limit, 3),
        jobFunction: options.jobFunction
    });
    const occupationContexts = await canonicalOccupationContexts(sourceName, pipelineResult, limit);
    return {
        input,
        locale: pipelineResult.queryContext.locale,
        occupationContexts
    };
}
function loadRuntimePipeline(sourceName) {
    const cacheKey = sourceName.trim() || DEFAULT_ESCO_SOURCE_NAME;
    let cached = PIPELINE_CACHE.get(cacheKey);
    if (!cached) {
        cached = OccupationRuntimeContext.load({ sourceName: cacheKey }).then((runtime) => OccupationSearchPipeline.withRuntime(runtime));
        PIPELINE_CACHE.set(cacheKey, cached);
    }
    return cached;
}
async function canonicalOccupationContexts(sourceName, result, limit) {
    const spanResults = result.spanResults.length > 0
        ? result.spanResults
        : [
            {
                spanIndex: 1,
                query: result.queryContext.query,
                decision: result.decision,
                coverageStatus: result.coverageStatus,
                rankedFamilies: result.rankedFamilies,
                preparedQuery: result.preparedQuery
            }
        ];
    const contexts = [];
    for (const span of spanResults) {
        const leafCanonicalTerms = topLeafTerms(span, limit);
        const familyCanonicalTerms = topFamilyTerms(span, limit);
        const isLeafDecision = span.decision.decisionType === 'leaf';
        const selectedLeafTerm = isLeafDecision
            ? (findByGraphNodeId(leafCanonicalTerms, span.decision.selectedNodeId) ?? {
                graphNodeId: span.decision.selectedNodeId ?? -1,
                canonicalTerm: span.decision.selectedLabel ?? '',
                confidence: span.decision.confidence
            })
            : null;
        const selectedFamilyTerm = span.decision.decisionType !== 'unresolved' ? (familyCanonicalTerms[0] ?? null) : null;
        const altLeafCanonicalTerms = selectedLeafTerm
            ? leafCanonicalTerms.filter((term) => term.graphNodeId !== selectedLeafTerm.graphNodeId)
            : leafCanonicalTerms;
        const altFamilyCanonicalTerms = selectedFamilyTerm
            ? familyCanonicalTerms.filter((term) => term.graphNodeId !== selectedFamilyTerm.graphNodeId)
            : familyCanonicalTerms;
        const capabilityLeafTerms = selectedLeafTerm ? [selectedLeafTerm] : [];
        contexts.push({
            spanIndex: span.spanIndex,
            input: span.query,
            decision: {
                decisionType: span.decision.decisionType,
                selectedCanonicalTerm: span.decision.selectedLabel,
                selectedGraphNodeId: span.decision.selectedNodeId,
                confidence: span.decision.confidence
            },
            coverageStatus: span.coverageStatus,
            selectedLeafTerm,
            selectedFamilyTerm,
            altLeafCanonicalTerms,
            altFamilyCanonicalTerms,
            capabilityTerms: await topCapabilityTerms(sourceName, capabilityLeafTerms, limit)
        });
    }
    return contexts;
}
function findByGraphNodeId(terms, graphNodeId) {
    if (graphNodeId === null) {
        return null;
    }
    return terms.find((term) => term.graphNodeId === graphNodeId) ?? null;
}
function topLeafTerms(result, limit) {
    const topFamily = result.rankedFamilies[0];
    const bestFamilyLeaves = topFamily?.leaves ?? [];
    const orderedLeaves = topFamily
        ? reorderSelectableLeafFirst(topFamily, bestFamilyLeaves, result.preparedQuery, result.rankedFamilies)
        : bestFamilyLeaves;
    return uniqueLeaves(orderedLeaves)
        .slice(0, limit)
        .map((leaf) => ({
        graphNodeId: leaf.graphNodeId,
        canonicalTerm: leaf.canonicalLabel,
        confidence: leaf.confidence,
        ...(leaf.familyScopedFit
            ? {
                fitTier: leaf.familyScopedFit.tier,
                fitReasons: leaf.familyScopedFit.reasons
            }
            : {})
    }));
}
// Consumers of this report (getCanonicalTerm callers, report-occupation-pipeline-comparison)
// read leafCanonicalTerms[0] as "the leaf", not as an unfiltered ranking -- so it should reflect
// the same leaf firstSelectableLeafInFamily would pick for a leaf-level decision, not the bare
// top-ranked-by-score leaf that may carry unrequested specialization the query never asked for.
function reorderSelectableLeafFirst(family, leaves, preparedQuery, rankedFamilies) {
    const selectableLeaf = firstSelectableLeafInFamily(family, preparedQuery, rankedFamilies, new Map());
    if (!selectableLeaf || selectableLeaf.graphNodeId === leaves[0]?.graphNodeId) {
        return leaves;
    }
    return [selectableLeaf, ...leaves.filter((leaf) => leaf.graphNodeId !== selectableLeaf.graphNodeId)];
}
function topFamilyTerms(result, limit) {
    return result.rankedFamilies.slice(0, limit).map((family) => ({
        graphNodeId: family.familyNodeId,
        canonicalTerm: family.familyLabel,
        confidence: family.confidence,
        fitTier: family.evidenceTier ?? undefined
    }));
}
function uniqueLeaves(leaves) {
    const seen = new Set();
    const unique = [];
    for (const leaf of leaves) {
        if (seen.has(leaf.graphNodeId)) {
            continue;
        }
        seen.add(leaf.graphNodeId);
        unique.push(leaf);
    }
    return unique;
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
