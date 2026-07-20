import { DEFAULT_CANDIDATE_LIMIT, DEFAULT_ESCO_SOURCE_NAME, DEFAULT_MODEL_KEY } from '../retrieval/occupation-candidates.js';
import { DEFAULT_SIBLING_LIMIT } from '../retrieval/occupation-candidate-branches.js';
import { OccupationSearchPipeline } from '../search-pipeline/occupation-search-pipeline.js';
import { hydrateRuntimeSearchMetaRecord, loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';
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
        modelKey: options.modelKey ?? DEFAULT_MODEL_KEY,
        limit: Math.max(DEFAULT_CANDIDATE_LIMIT, limit * 4),
        siblingLimit: options.siblingLimit ?? DEFAULT_SIBLING_LIMIT,
        topFamilyLimit: Math.max(limit, 3),
        topLeavesPerFamily: Math.max(limit, 3)
    });
    const occupationContexts = await canonicalOccupationContexts(sourceName, pipelineResult, limit);
    const leafCanonicalTerms = topLeafTerms(pipelineResult, limit);
    const familyCanonicalTerms = topFamilyTerms(pipelineResult, limit);
    const topLevelLeafTerms = leafCanonicalTerms.length > 0
        ? leafCanonicalTerms
        : aggregateContextTerms(occupationContexts.map((context) => context.leafCanonicalTerms), limit);
    const topLevelFamilyTerms = familyCanonicalTerms.length > 0
        ? familyCanonicalTerms
        : aggregateContextTerms(occupationContexts.map((context) => context.familyCanonicalTerms), limit);
    const capabilityTerms = await topCapabilityTerms(sourceName, topLevelLeafTerms, limit);
    return {
        input,
        locale: pipelineResult.queryContext.locale,
        decision: {
            decisionType: pipelineResult.decision.decisionType,
            selectedCanonicalTerm: pipelineResult.decision.selectedLabel,
            selectedGraphNodeId: pipelineResult.decision.selectedNodeId,
            confidence: pipelineResult.decision.confidence
        },
        coverageStatus: pipelineResult.coverageStatus,
        leafCanonicalTerms: topLevelLeafTerms,
        familyCanonicalTerms: topLevelFamilyTerms,
        capabilityTerms,
        occupationContexts
    };
}
function loadRuntimePipeline(sourceName) {
    const cacheKey = sourceName.trim() || DEFAULT_ESCO_SOURCE_NAME;
    let cached = PIPELINE_CACHE.get(cacheKey);
    if (!cached) {
        cached = OccupationRuntimeContext.load({ sourceName: cacheKey })
            .then((runtime) => OccupationSearchPipeline.withRuntime(runtime));
        PIPELINE_CACHE.set(cacheKey, cached);
    }
    return cached;
}
async function canonicalOccupationContexts(sourceName, result, limit) {
    const spanResults = result.spanResults.length > 0
        ? result.spanResults
        : [{
                spanIndex: 1,
                query: result.queryContext.query,
                decision: result.decision,
                coverageStatus: result.coverageStatus,
                rankedFamilies: result.rankedFamilies
            }];
    const contexts = [];
    for (const span of spanResults) {
        const leafCanonicalTerms = topLeafTerms(span, limit);
        const familyCanonicalTerms = topFamilyTerms(span, limit);
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
            leafCanonicalTerms,
            familyCanonicalTerms,
            capabilityTerms: await topCapabilityTerms(sourceName, leafCanonicalTerms, limit)
        });
    }
    return contexts;
}
function topLeafTerms(result, limit) {
    const bestFamilyLeaves = result.rankedFamilies[0]?.leaves ?? [];
    return uniqueLeaves(bestFamilyLeaves)
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
function topFamilyTerms(result, limit) {
    return result.rankedFamilies.slice(0, limit).map((family) => ({
        graphNodeId: family.familyNodeId,
        canonicalTerm: family.familyLabel,
        confidence: family.confidence,
        fitTier: family.evidenceTier ?? undefined
    }));
}
function aggregateContextTerms(contextTerms, limit) {
    const primaryTerms = contextTerms
        .map((terms) => terms[0])
        .filter((term) => term !== undefined);
    const fallbackTerms = contextTerms.flatMap((terms) => terms.slice(1));
    return uniqueCanonicalTerms([...primaryTerms, ...fallbackTerms]).slice(0, limit);
}
function uniqueCanonicalTerms(terms) {
    const byNodeId = new Map();
    const orderedTerms = [];
    for (const term of terms) {
        const existing = byNodeId.get(term.graphNodeId);
        if (!existing || term.confidence > existing.confidence) {
            if (!existing) {
                orderedTerms.push(term);
            }
            byNodeId.set(term.graphNodeId, term);
        }
    }
    return orderedTerms.map((term) => byNodeId.get(term.graphNodeId) ?? term);
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
        const coreRecord = artifactEntry.recordsByNodeId.get(leafTerm.graphNodeId);
        if (!coreRecord) {
            continue;
        }
        const record = await hydrateRuntimeSearchMetaRecord(artifactEntry, coreRecord);
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
