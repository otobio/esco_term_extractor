import { DEFAULT_ROLE_HEAD_GROUPS, DEFAULT_SPECIALIZATION_SCHEMA, SPECIALIZATION_EVIDENCE_DIMENSIONS, classifySpecializationQuery, getDefaultIndustryConceptIdsForRoleHeads, tokenizeTitle } from './specialization-dimension-mapper.js';
import conceptLeafFrequencyJson from './specialization-schema/concept-leaf-frequency.json' with { type: 'json' };
export const SPECIALIZATION_DATA_DIMENSIONS = SPECIALIZATION_EVIDENCE_DIMENSIONS;
const CONCEPT_DIMENSIONS_BY_ID = buildConceptDimensionsById();
const ROLE_HEAD_GROUPS_BY_HEAD = buildRoleHeadGroupsByHead();
const CONCEPT_EQUIVALENCE_BY_DIMENSION = loadConceptEquivalenceByDimension(CONCEPT_DIMENSIONS_BY_ID);
const CONCEPT_IDS_BY_DIMENSION_VALUE = buildConceptIdsByDimensionValue(CONCEPT_DIMENSIONS_BY_ID);
const CONCEPT_LEAF_FREQUENCY_TOTAL_LEAVES = conceptLeafFrequencyJson.totalLeaves;
const CONCEPT_LEAF_FREQUENCY_BY_ID = conceptLeafFrequencyJson.leafCountByConceptId;
const CONCEPT_LEAF_FREQUENCY_BY_ROLE_HEAD = conceptLeafFrequencyJson.roleHeadLeafFrequency ?? {};
const INDIRECT_ROLE_ATTACHMENT_CAP = 0.65;
export function specializationGate(queryInput, leafInput, options = {}) {
    const queryClassification = resolveGateInput(queryInput, options);
    const leafClassification = resolveGateInput(leafInput, options);
    const querySignals = collectGateSignals(queryClassification);
    const leafSignals = collectGateSignals(leafClassification);
    const defaultIndustryConceptIds = getDefaultIndustryConceptIdsForRoleHeads(getQueryWeightRoleHeads(queryClassification), options);
    let judgments = [];
    for (const dimension of SPECIALIZATION_DATA_DIMENSIONS) {
        const queryDimension = querySignals[dimension];
        if (queryDimension.values.length === 0 && queryDimension.conceptIds.length === 0) {
            continue;
        }
        judgments.push(judgeDimension(dimension, queryDimension, leafSignals[dimension], defaultIndustryConceptIds));
    }
    judgments = upgradeSiblingUnknownJudgments(queryClassification, leafClassification, querySignals, leafSignals, judgments);
    const compatibleDimensions = [];
    const contradictionDimensions = [];
    const equivalentDimensions = [];
    const unknownDimensions = [];
    for (const judgment of judgments) {
        if (judgment.kind === 'contradiction') {
            contradictionDimensions.push(judgment.dimension);
            continue;
        }
        if (judgment.kind === 'equivalent_concept') {
            equivalentDimensions.push(judgment.dimension);
            continue;
        }
        if (judgment.kind === 'unknown') {
            unknownDimensions.push(judgment.dimension);
            continue;
        }
        compatibleDimensions.push(judgment.dimension);
    }
    let decision;
    if (contradictionDimensions.length > 0) {
        decision = 'reject';
    }
    else if (equivalentDimensions.length === 0 && compatibleDimensions.length === judgments.length && judgments.length > 0) {
        decision = 'pass_strict';
    }
    else {
        decision = 'pass_partial';
    }
    const roleHeadRelatedness = deriveRoleHeadRelatedness(queryClassification.role_head, leafClassification.role_head);
    const reinforcedDimensions = judgments
        .filter((judgment) => judgment.kind !== 'unknown' && judgment.kind !== 'contradiction')
        .map((judgment) => judgment.dimension);
    return {
        accepted: decision !== 'reject',
        compatibleDimensions,
        contradictionDimensions,
        decision,
        equivalentDimensions,
        judgments,
        queryWeights: {
            concepts: buildQueryConceptWeights(judgments, querySignals, queryClassification)
        },
        queriedDimensions: judgments.map((judgment) => judgment.dimension),
        relatedness: {
            reinforcedDimensions: roleHeadRelatedness.sameFamily ? reinforcedDimensions : [],
            reinforcedEquivalentDimensions: roleHeadRelatedness.sameFamily ? equivalentDimensions : [],
            roleHead: {
                ...roleHeadRelatedness,
                strength: !roleHeadRelatedness.sameFamily ? 'none' : reinforcedDimensions.length > 0 ? 'role_and_dimensions' : 'role_only'
            }
        },
        unknownDimensions
    };
}
export function failsHardContradiction(queryInput, leafInput, options = {}) {
    return specializationGate(queryInput, leafInput, options).decision === 'reject';
}
function resolveGateInput(input, options = {}) {
    if (typeof input === 'string') {
        return classifySpecializationQuery(input, options);
    }
    return input;
}
function collectGateSignals(classification) {
    const conceptIdsByDimension = createEmptyConceptBuckets();
    const explicitConceptIdsByDimension = createEmptyConceptBuckets();
    const conceptValuesByDimension = createEmptyConceptValueBuckets();
    if ('concepts' in classification) {
        for (const concept of classification.concepts) {
            if (!isSpecializationEvidenceDimension(concept.dimension)) {
                continue;
            }
            const conceptIds = conceptIdsByDimension[concept.dimension];
            if (!conceptIds.includes(concept.conceptId)) {
                conceptIds.push(concept.conceptId);
            }
            const explicitConceptIds = explicitConceptIdsByDimension[concept.dimension];
            if (!explicitConceptIds.includes(concept.conceptId)) {
                explicitConceptIds.push(concept.conceptId);
            }
            addConceptValue(conceptValuesByDimension[concept.dimension], concept.conceptId, concept.canonicalTokens.join(' '));
        }
    }
    for (const dimension of SPECIALIZATION_DATA_DIMENSIONS) {
        for (const value of classification.concept[dimension]) {
            for (const conceptId of CONCEPT_IDS_BY_DIMENSION_VALUE[dimension].get(normalizeGateValue(value)) ?? []) {
                const conceptIds = conceptIdsByDimension[dimension];
                if (!conceptIds.includes(conceptId)) {
                    conceptIds.push(conceptId);
                }
                addConceptValue(conceptValuesByDimension[dimension], conceptId, value);
            }
        }
    }
    const signals = {};
    for (const dimension of SPECIALIZATION_DATA_DIMENSIONS) {
        const values = classification[dimension];
        const recoverableValues = classification.available[dimension].length > 0 ? classification.available[dimension] : values;
        signals[dimension] = {
            conceptIds: conceptIdsByDimension[dimension],
            conceptValuesById: conceptValuesByDimension[dimension],
            recoverablePartSet: new Set(recoverableValues.flatMap((value) => tokenizeTitle(value).map((part) => normalizeGateValue(part)))),
            recoverableValues,
            values,
            weightConceptIds: explicitConceptIdsByDimension[dimension].length > 0 ? explicitConceptIdsByDimension[dimension] : conceptIdsByDimension[dimension]
        };
    }
    return signals;
}
function buildQueryConceptWeights(judgments, querySignals, queryClassification) {
    const weights = [];
    const scopeRoleHeads = getQueryWeightRoleHeads(queryClassification);
    const queryConceptIds = getQueryWeightConceptIds(querySignals);
    const compositionHeadConceptIds = findCompositionHeadConceptIds(queryConceptIds, scopeRoleHeads);
    for (const judgment of judgments) {
        if (judgment.kind === 'role_head_default_industry') {
            continue;
        }
        const queryDimension = querySignals[judgment.dimension];
        for (const conceptId of queryDimension.weightConceptIds) {
            const globalWeight = conceptFrequencyWeight(CONCEPT_LEAF_FREQUENCY_TOTAL_LEAVES, CONCEPT_LEAF_FREQUENCY_BY_ID[conceptId]);
            const roleHeadScope = findBestRoleHeadConceptScope(conceptId, scopeRoleHeads);
            const frequencyWeight = roleHeadScope ? Number((roleHeadScope.weight * 0.85 + globalWeight * 0.15).toFixed(4)) : globalWeight;
            const roleHeadConcept = compositionHeadConceptIds.size > 0 ? compositionHeadConceptIds.has(conceptId) : (roleHeadScope?.directLeafCount ?? 0) > 0;
            weights.push({
                conceptId,
                dimension: judgment.dimension,
                rawWeight: roleHeadConcept ? Number((frequencyWeight * 1.15).toFixed(4)) : frequencyWeight,
                roleHeadConcept,
                values: queryDimension.conceptValuesById.get(conceptId) ?? [],
                weight: frequencyWeight
            });
        }
    }
    return normalizeQueryConceptWeights(weights);
}
function getQueryWeightRoleHeads(classification) {
    const roleHeads = new Set();
    for (const roleHead of classification.role_head) {
        const normalized = normalizeGateValue(roleHead);
        if (normalized.length > 0) {
            roleHeads.add(normalized);
        }
    }
    for (const combination of classification.structural_combination) {
        for (const roleHead of combination.derivedRoleHeads) {
            const normalized = normalizeGateValue(roleHead);
            if (normalized.length > 0) {
                roleHeads.add(normalized);
            }
        }
    }
    return [...roleHeads].sort();
}
function getQueryWeightConceptIds(querySignals) {
    const conceptIds = new Set();
    for (const dimension of SPECIALIZATION_DATA_DIMENSIONS) {
        for (const conceptId of querySignals[dimension].weightConceptIds) {
            conceptIds.add(conceptId);
        }
    }
    return [...conceptIds].sort();
}
function findCompositionHeadConceptIds(queryConceptIds, roleHeads) {
    const querySet = new Set(queryConceptIds);
    const headConceptIds = new Set();
    let bestScore = 0;
    for (const roleHead of roleHeads) {
        const roleHeadStats = CONCEPT_LEAF_FREQUENCY_BY_ROLE_HEAD[roleHead];
        if (!roleHeadStats?.conceptCompositions) {
            continue;
        }
        for (const composition of roleHeadStats.conceptCompositions) {
            const compositionSet = new Set(composition.conceptIds);
            const queryContainedByComposition = queryConceptIds.every((conceptId) => compositionSet.has(conceptId));
            const compositionContainedByQuery = composition.conceptIds.every((conceptId) => querySet.has(conceptId));
            if (!queryContainedByComposition && !compositionContainedByQuery) {
                continue;
            }
            const score = (queryContainedByComposition ? 100 : 0) +
                (compositionContainedByQuery ? 50 : 0) +
                composition.conceptIds.length * 2 +
                composition.leafCount;
            if (score < bestScore) {
                continue;
            }
            if (score > bestScore) {
                headConceptIds.clear();
                bestScore = score;
            }
            for (const conceptId of composition.headConceptIds) {
                if (querySet.has(conceptId)) {
                    headConceptIds.add(conceptId);
                }
            }
        }
    }
    return headConceptIds;
}
function findBestRoleHeadConceptScope(conceptId, roleHeads) {
    let bestScope = null;
    for (const roleHead of roleHeads) {
        const roleHeadStats = CONCEPT_LEAF_FREQUENCY_BY_ROLE_HEAD[roleHead];
        if (!roleHeadStats) {
            continue;
        }
        const conceptLeafCount = roleHeadStats.leafCountByConceptId[conceptId];
        if (!conceptLeafCount || conceptLeafCount <= 0) {
            continue;
        }
        const scope = {
            conceptLeafCount,
            directLeafCount: roleHeadStats.directLeafCountByConceptId?.[conceptId] ?? 0,
            leafCount: roleHeadStats.leafCount,
            roleHead,
            weight: conceptFrequencyWeight(roleHeadStats.leafCount, conceptLeafCount)
        };
        if (!bestScope || scope.weight > bestScope.weight || (scope.weight === bestScope.weight && scope.leafCount > bestScope.leafCount)) {
            bestScope = scope;
        }
    }
    return bestScope;
}
function normalizeQueryConceptWeights(weights) {
    if (weights.length === 0) {
        return [];
    }
    const hasRoleHeadConcept = weights.some((weight) => weight.roleHeadConcept);
    const bestRoleHeadConceptWeight = Math.max(...weights.filter((weight) => weight.roleHeadConcept).map((weight) => weight.rawWeight), 0);
    const adjustedWeights = weights.map((weight) => {
        const rawWeight = hasRoleHeadConcept && !weight.roleHeadConcept
            ? Math.min(weight.rawWeight, bestRoleHeadConceptWeight * INDIRECT_ROLE_ATTACHMENT_CAP)
            : weight.rawWeight;
        return {
            conceptId: weight.conceptId,
            dimension: weight.dimension,
            values: weight.values,
            weight: rawWeight
        };
    });
    const maxWeight = Math.max(...adjustedWeights.map((weight) => weight.weight), 0);
    return adjustedWeights
        .map((weight) => ({
        ...weight,
        weight: maxWeight > 0 ? Number((weight.weight / maxWeight).toFixed(4)) : 0.5
    }))
        .sort((left, right) => right.weight - left.weight || left.dimension.localeCompare(right.dimension) || left.conceptId.localeCompare(right.conceptId));
}
function conceptFrequencyWeight(totalLeaves, leafCount) {
    if (!leafCount || leafCount <= 0) {
        return 0.5;
    }
    if (totalLeaves <= 1) {
        return 1;
    }
    const specificity = Math.log(totalLeaves / leafCount) / Math.log(totalLeaves);
    return Number(Math.max(0, Math.min(1, specificity)).toFixed(4));
}
function upgradeSiblingUnknownJudgments(queryClassification, leafClassification, querySignals, leafSignals, judgments) {
    if (judgments.length === 0) {
        return judgments;
    }
    if (!judgments.some((judgment) => judgment.kind === 'unknown')) {
        return judgments;
    }
    if (judgments.some((judgment) => judgment.kind !== 'unknown')) {
        return judgments;
    }
    if (!shareRoleHeadFamily(queryClassification.role_head, leafClassification.role_head)) {
        return judgments;
    }
    if (!hasExplicitSpecializationSignals(querySignals) || !hasExplicitSpecializationSignals(leafSignals)) {
        return judgments;
    }
    return judgments.map((judgment) => {
        if (judgment.kind !== 'unknown') {
            return judgment;
        }
        return {
            ...judgment,
            kind: 'contradiction'
        };
    });
}
function judgeDimension(dimension, query, leaf, defaultIndustryConceptIds) {
    const conceptMatch = intersectValues(query.conceptIds, leaf.conceptIds);
    if (conceptMatch.length > 0) {
        return {
            dimension,
            kind: 'exact_concept',
            leafConceptIds: leaf.conceptIds,
            leafRecoverableValues: leaf.recoverableValues,
            leafValues: leaf.values,
            matchedValues: conceptMatch,
            queryConceptIds: query.conceptIds,
            queryRecoverableValues: query.recoverableValues,
            queryValues: query.values
        };
    }
    const equivalentConceptMatch = findEquivalentConceptMatch(dimension, query.conceptIds, leaf.conceptIds);
    if (equivalentConceptMatch.length > 0) {
        return {
            dimension,
            kind: 'equivalent_concept',
            leafConceptIds: leaf.conceptIds,
            leafRecoverableValues: leaf.recoverableValues,
            leafValues: leaf.values,
            matchedValues: equivalentConceptMatch,
            queryConceptIds: query.conceptIds,
            queryRecoverableValues: query.recoverableValues,
            queryValues: query.values
        };
    }
    const exactLiteralMatch = findExactLiteralMatch(query.values, leaf.values);
    if (exactLiteralMatch.length > 0) {
        return {
            dimension,
            kind: 'exact_literal',
            leafConceptIds: leaf.conceptIds,
            leafRecoverableValues: leaf.recoverableValues,
            leafValues: leaf.values,
            matchedValues: exactLiteralMatch,
            queryConceptIds: query.conceptIds,
            queryRecoverableValues: query.recoverableValues,
            queryValues: query.values
        };
    }
    const recoverableMatch = findRecoverableMatch(query.values, leaf.recoverablePartSet);
    if (recoverableMatch.length > 0) {
        return {
            dimension,
            kind: 'recoverable_available',
            leafConceptIds: leaf.conceptIds,
            leafRecoverableValues: leaf.recoverableValues,
            leafValues: leaf.values,
            matchedValues: recoverableMatch,
            queryConceptIds: query.conceptIds,
            queryRecoverableValues: query.recoverableValues,
            queryValues: query.values
        };
    }
    if (query.conceptIds.length > 0 && leaf.conceptIds.length > 0) {
        return {
            dimension,
            kind: 'contradiction',
            leafConceptIds: leaf.conceptIds,
            leafRecoverableValues: leaf.recoverableValues,
            leafValues: leaf.values,
            matchedValues: [],
            queryConceptIds: query.conceptIds,
            queryRecoverableValues: query.recoverableValues,
            queryValues: query.values
        };
    }
    const roleHeadDefaultIndustryMatch = findRoleHeadDefaultIndustryMatch(dimension, query, leaf, defaultIndustryConceptIds);
    if (roleHeadDefaultIndustryMatch.length > 0) {
        return {
            dimension,
            kind: 'role_head_default_industry',
            leafConceptIds: leaf.conceptIds,
            leafRecoverableValues: leaf.recoverableValues,
            leafValues: leaf.values,
            matchedValues: roleHeadDefaultIndustryMatch,
            queryConceptIds: query.conceptIds,
            queryRecoverableValues: query.recoverableValues,
            queryValues: query.values
        };
    }
    if (leaf.values.length === 0 && leaf.conceptIds.length === 0 && leaf.recoverableValues.length === 0) {
        return {
            dimension,
            kind: 'unknown',
            leafConceptIds: leaf.conceptIds,
            leafRecoverableValues: leaf.recoverableValues,
            leafValues: leaf.values,
            matchedValues: [],
            queryConceptIds: query.conceptIds,
            queryRecoverableValues: query.recoverableValues,
            queryValues: query.values
        };
    }
    return {
        dimension,
        kind: 'contradiction',
        leafConceptIds: leaf.conceptIds,
        leafRecoverableValues: leaf.recoverableValues,
        leafValues: leaf.values,
        matchedValues: [],
        queryConceptIds: query.conceptIds,
        queryRecoverableValues: query.recoverableValues,
        queryValues: query.values
    };
}
function findRoleHeadDefaultIndustryMatch(dimension, query, leaf, defaultIndustryConceptIds) {
    if (dimension !== 'industry') {
        return [];
    }
    if (query.conceptIds.length === 0 || defaultIndustryConceptIds.length === 0) {
        return [];
    }
    if (leaf.values.length > 0 || leaf.conceptIds.length > 0 || leaf.recoverableValues.length > 0) {
        return [];
    }
    const defaultIndustryConceptSet = new Set(defaultIndustryConceptIds);
    const supportedConceptIds = query.conceptIds.filter((conceptId) => defaultIndustryConceptSet.has(conceptId));
    if (supportedConceptIds.length !== query.conceptIds.length) {
        return [];
    }
    return supportedConceptIds;
}
function createEmptyConceptBuckets() {
    return {
        venue: [],
        channel: [],
        product: [],
        population: [],
        task: [],
        industry: [],
        knowledge_domain: [],
        work_object: []
    };
}
function createEmptyConceptValueBuckets() {
    return {
        venue: new Map(),
        channel: new Map(),
        product: new Map(),
        population: new Map(),
        task: new Map(),
        industry: new Map(),
        knowledge_domain: new Map(),
        work_object: new Map()
    };
}
function addConceptValue(valuesByConceptId, conceptId, value) {
    const normalizedValue = value.trim();
    if (normalizedValue.length === 0) {
        return;
    }
    const values = valuesByConceptId.get(conceptId) ?? [];
    if (!values.includes(normalizedValue)) {
        values.push(normalizedValue);
        valuesByConceptId.set(conceptId, values);
    }
}
function intersectValues(left, right) {
    const rightSet = new Set(right.map((value) => normalizeGateValue(value)));
    return left.filter((value, index, values) => {
        const normalized = normalizeGateValue(value);
        return rightSet.has(normalized) && values.findIndex((candidate) => normalizeGateValue(candidate) === normalized) === index;
    });
}
function findEquivalentConceptMatch(dimension, queryConceptIds, leafConceptIds) {
    const dimensionEquivalences = CONCEPT_EQUIVALENCE_BY_DIMENSION[dimension];
    if (queryConceptIds.length === 0 || leafConceptIds.length === 0 || dimensionEquivalences.size === 0) {
        return [];
    }
    const matches = [];
    for (const queryConceptId of queryConceptIds) {
        const equivalents = dimensionEquivalences.get(queryConceptId);
        if (!equivalents) {
            continue;
        }
        for (const leafConceptId of leafConceptIds) {
            if (!equivalents.has(leafConceptId) || matches.includes(leafConceptId)) {
                continue;
            }
            matches.push(leafConceptId);
        }
    }
    return matches;
}
function findExactLiteralMatch(queryValues, leafValues) {
    const normalizedQueryValues = [
        ...new Set(queryValues.map((value) => normalizeGateValue(value)).filter((value) => value.length > 0))
    ].sort();
    const normalizedLeafValues = [
        ...new Set(leafValues.map((value) => normalizeGateValue(value)).filter((value) => value.length > 0))
    ].sort();
    if (normalizedQueryValues.length === 0 || normalizedQueryValues.length !== normalizedLeafValues.length) {
        return [];
    }
    for (let index = 0; index < normalizedQueryValues.length; index += 1) {
        if (normalizedQueryValues[index] !== normalizedLeafValues[index]) {
            return [];
        }
    }
    return queryValues;
}
function findRecoverableMatch(queryValues, leafRecoverablePartSet) {
    const matches = [];
    for (const value of queryValues) {
        const parts = tokenizeTitle(value).map((part) => normalizeGateValue(part));
        if (parts.length === 0) {
            continue;
        }
        let covered = true;
        for (const part of parts) {
            if (!leafRecoverablePartSet.has(part)) {
                covered = false;
                break;
            }
        }
        if (covered && !matches.includes(value)) {
            matches.push(value);
        }
    }
    return matches;
}
function normalizeGateValue(value) {
    return value
        .normalize('NFKD')
        .replaceAll(/\p{M}+/gu, '')
        .replaceAll(/['’`]+/g, '')
        .toLowerCase()
        .split(/\s+/g)
        .map((part) => singularizeGateToken(part))
        .join(' ')
        .trim();
}
function loadConceptEquivalenceByDimension(conceptDimensionsById) {
    const equivalences = createEmptyEquivalenceBuckets();
    const rows = DEFAULT_SPECIALIZATION_SCHEMA.conceptEquivalences;
    for (const row of rows) {
        const dimension = row.dimension;
        const uniqueConceptIds = row.conceptIds;
        for (const conceptId of uniqueConceptIds) {
            const conceptDimension = conceptDimensionsById.get(conceptId);
            if (!conceptDimension) {
                throw new Error(`Unknown concept equivalence concept_id: ${conceptId}`);
            }
            if (conceptDimension !== dimension) {
                throw new Error(`Cross-dimension concept equivalence: ${conceptId} is ${conceptDimension}, not ${dimension}`);
            }
        }
        for (const conceptId of uniqueConceptIds) {
            const related = equivalences[dimension].get(conceptId) ?? new Set();
            for (const relatedConceptId of uniqueConceptIds) {
                if (relatedConceptId !== conceptId) {
                    related.add(relatedConceptId);
                }
            }
            equivalences[dimension].set(conceptId, related);
        }
    }
    return equivalences;
}
function buildConceptDimensionsById() {
    const conceptDimensionsById = new Map();
    for (const concept of DEFAULT_SPECIALIZATION_SCHEMA.concepts) {
        const dimensions = new Set();
        if (concept.dimension && isSpecializationEvidenceDimension(concept.dimension)) {
            dimensions.add(concept.dimension);
        }
        for (const rule of concept.rules ?? []) {
            if (isSpecializationEvidenceDimension(rule.dimension)) {
                dimensions.add(rule.dimension);
            }
        }
        if (dimensions.size !== 1) {
            continue;
        }
        const [dimension] = [...dimensions];
        if (dimension) {
            conceptDimensionsById.set(concept.id, dimension);
        }
    }
    return conceptDimensionsById;
}
function createEmptyEquivalenceBuckets() {
    return {
        venue: new Map(),
        channel: new Map(),
        product: new Map(),
        population: new Map(),
        task: new Map(),
        industry: new Map(),
        knowledge_domain: new Map(),
        work_object: new Map()
    };
}
function buildConceptIdsByDimensionValue(conceptDimensionsById) {
    const conceptIdsByDimensionValue = {
        venue: new Map(),
        channel: new Map(),
        product: new Map(),
        population: new Map(),
        task: new Map(),
        industry: new Map(),
        knowledge_domain: new Map(),
        work_object: new Map()
    };
    for (const concept of DEFAULT_SPECIALIZATION_SCHEMA.concepts) {
        const dimension = conceptDimensionsById.get(concept.id);
        if (!dimension || !concept.canonical) {
            continue;
        }
        const normalizedCanonical = normalizeGateValue(concept.canonical);
        const conceptIds = conceptIdsByDimensionValue[dimension].get(normalizedCanonical) ?? [];
        if (!conceptIds.includes(concept.id)) {
            conceptIds.push(concept.id);
            conceptIdsByDimensionValue[dimension].set(normalizedCanonical, conceptIds);
        }
    }
    return conceptIdsByDimensionValue;
}
function buildRoleHeadGroupsByHead() {
    const groupsByHead = new Map();
    for (const [groupName, roleHeads] of Object.entries(DEFAULT_ROLE_HEAD_GROUPS)) {
        for (const roleHead of roleHeads) {
            const normalizedRoleHead = normalizeGateValue(roleHead);
            const groups = groupsByHead.get(normalizedRoleHead) ?? new Set();
            groups.add(groupName);
            groupsByHead.set(normalizedRoleHead, groups);
        }
    }
    return groupsByHead;
}
function deriveRoleHeadRelatedness(queryRoleHeads, leafRoleHeads) {
    const normalizedQueryRoleHeads = [...new Set(queryRoleHeads.map(normalizeGateValue).filter((value) => value.length > 0))];
    const normalizedLeafRoleHeads = [...new Set(leafRoleHeads.map(normalizeGateValue).filter((value) => value.length > 0))];
    if (normalizedQueryRoleHeads.length === 0 || normalizedLeafRoleHeads.length === 0) {
        return {
            exact: false,
            leafRoleHeads: normalizedLeafRoleHeads,
            queryRoleHeads: normalizedQueryRoleHeads,
            sameFamily: false,
            sharedGroups: []
        };
    }
    const queryRoleHeadSet = new Set(normalizedQueryRoleHeads);
    for (const leafRoleHead of normalizedLeafRoleHeads) {
        if (queryRoleHeadSet.has(leafRoleHead)) {
            return {
                exact: true,
                leafRoleHeads: normalizedLeafRoleHeads,
                queryRoleHeads: normalizedQueryRoleHeads,
                sameFamily: true,
                sharedGroups: []
            };
        }
    }
    const queryGroups = new Set();
    for (const queryRoleHead of normalizedQueryRoleHeads) {
        const groups = ROLE_HEAD_GROUPS_BY_HEAD.get(queryRoleHead);
        if (!groups) {
            continue;
        }
        for (const group of groups) {
            queryGroups.add(group);
        }
    }
    if (queryGroups.size === 0) {
        return {
            exact: false,
            leafRoleHeads: normalizedLeafRoleHeads,
            queryRoleHeads: normalizedQueryRoleHeads,
            sameFamily: false,
            sharedGroups: []
        };
    }
    const sharedGroups = new Set();
    for (const leafRoleHead of normalizedLeafRoleHeads) {
        const groups = ROLE_HEAD_GROUPS_BY_HEAD.get(leafRoleHead);
        if (!groups) {
            continue;
        }
        for (const group of groups) {
            if (queryGroups.has(group)) {
                sharedGroups.add(group);
            }
        }
    }
    return {
        exact: false,
        leafRoleHeads: normalizedLeafRoleHeads,
        queryRoleHeads: normalizedQueryRoleHeads,
        sameFamily: sharedGroups.size > 0,
        sharedGroups: [...sharedGroups].sort()
    };
}
function shareRoleHeadFamily(queryRoleHeads, leafRoleHeads) {
    return deriveRoleHeadRelatedness(queryRoleHeads, leafRoleHeads).sameFamily;
}
function hasExplicitSpecializationSignals(signals) {
    for (const dimension of SPECIALIZATION_DATA_DIMENSIONS) {
        const signal = signals[dimension];
        if (signal.values.length > 0 || signal.conceptIds.length > 0) {
            return true;
        }
    }
    return false;
}
function isSpecializationEvidenceDimension(value) {
    return (value === 'venue' ||
        value === 'channel' ||
        value === 'product' ||
        value === 'population' ||
        value === 'task' ||
        value === 'industry' ||
        value === 'knowledge_domain' ||
        value === 'work_object');
}
function singularizeGateToken(token) {
    if (token.endsWith('sis') || token.endsWith('ics')) {
        return token;
    }
    if (token.endsWith('ies') && token.length > 3) {
        return `${token.slice(0, -3)}y`;
    }
    if (token.endsWith('sses') && token.length > 4) {
        return token.slice(0, -2);
    }
    if (token.endsWith('ses') && token.length > 3) {
        return token.slice(0, -2);
    }
    if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
        return token.slice(0, -1);
    }
    return token;
}
