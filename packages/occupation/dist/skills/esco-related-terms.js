import { foldSearchText, tokenizeNormalizedText } from '../query/query-preparation.js';
const DEFAULT_MIN_OCCURRENCES = 2;
const MAX_SHARED_TERM_GROUP_SIZE = 64;
export function buildEscoRelatedTermsDataset(labels, relations = [], options = {}) {
    const facts = dedupeLabelFacts(labels.map((label) => buildLabelFact(label)).filter((fact) => fact !== null));
    const minVerbOccurrences = normalizeMinOccurrences(options.minVerbOccurrences, DEFAULT_MIN_OCCURRENCES);
    const minObjectOccurrences = normalizeMinOccurrences(options.minObjectOccurrences, DEFAULT_MIN_OCCURRENCES);
    const verbInventory = buildInventory(facts, 'verb', minVerbOccurrences);
    const objectInventory = buildInventory(facts, 'object', minObjectOccurrences);
    const allowedVerbs = new Set(verbInventory.map((row) => row.term));
    const allowedObjects = new Set(objectInventory.map((row) => row.term));
    const verbRows = new Map();
    const objectRows = new Map();
    accumulateSameSkillRows(facts, allowedVerbs, allowedObjects, verbRows, objectRows);
    accumulateSameObjectRows(facts, allowedObjects, allowedVerbs, verbRows);
    accumulateSameVerbRows(facts, allowedVerbs, allowedObjects, objectRows);
    accumulateRelationRows(relations, allowedVerbs, allowedObjects, verbRows, objectRows);
    return {
        verbInventory,
        objectInventory,
        verbRelatedRows: finalizeVerbRows(verbRows),
        objectRelatedRows: finalizeObjectRows(objectRows)
    };
}
export function buildEscoVerbInventory(labels, minOccurrences = DEFAULT_MIN_OCCURRENCES) {
    const facts = labels.map((label) => buildLabelFact(label)).filter((fact) => fact !== null);
    return buildInventory(facts, 'verb', normalizeMinOccurrences(minOccurrences, DEFAULT_MIN_OCCURRENCES));
}
export function buildEscoObjectInventory(labels, minOccurrences = DEFAULT_MIN_OCCURRENCES) {
    const facts = labels.map((label) => buildLabelFact(label)).filter((fact) => fact !== null);
    return buildInventory(facts, 'object', normalizeMinOccurrences(minOccurrences, DEFAULT_MIN_OCCURRENCES));
}
export function extractEscoLabelFact(label) {
    const normalizedLabel = normalizeSkillLabel(label);
    if (!normalizedLabel) {
        return null;
    }
    const tokens = tokenizeNormalizedText(normalizedLabel);
    if (tokens.length === 0) {
        return null;
    }
    const verb = tokens[0] ?? null;
    const object = tokens.length > 1 ? tokens.slice(1).join(' ') : null;
    return {
        normalizedLabel,
        verb,
        object
    };
}
function accumulateSameSkillRows(facts, allowedVerbs, allowedObjects, verbRows, objectRows) {
    const groupedFacts = groupFactsBySkill(facts);
    for (const group of groupedFacts.values()) {
        const verbTerms = uniqueTerms(group, 'verb', allowedVerbs);
        const objectTerms = uniqueTerms(group, 'object', allowedObjects);
        addSymmetricPairs(verbRows, verbTerms, 'same_skill', 'verb');
        addSymmetricPairs(objectRows, objectTerms, 'same_skill', 'object');
    }
}
function accumulateSameObjectRows(facts, allowedObjects, allowedVerbs, verbRows) {
    for (const group of collectFactGroupsWithinLimit(facts, 'object', allowedObjects, MAX_SHARED_TERM_GROUP_SIZE).values()) {
        const verbFacts = uniqueFactsByTerm(group, 'verb', allowedVerbs);
        addSymmetricFactPairs(verbRows, verbFacts, 'same_object', 'verb');
    }
}
function accumulateSameVerbRows(facts, allowedVerbs, allowedObjects, objectRows) {
    for (const group of collectFactGroupsWithinLimit(facts, 'verb', allowedVerbs, MAX_SHARED_TERM_GROUP_SIZE).values()) {
        const objectFacts = uniqueFactsByTerm(group, 'object', allowedObjects);
        addSymmetricFactPairs(objectRows, objectFacts, 'same_verb', 'object');
    }
}
function accumulateRelationRows(relations, allowedVerbs, allowedObjects, verbRows, objectRows) {
    for (const relation of relations) {
        const sourceFact = buildRelationFact(relation.sourceSkillId, relation.sourceSkillUri, relation.sourceLabel);
        const relatedFact = buildRelationFact(relation.relatedSkillId, relation.relatedSkillUri, relation.relatedLabel);
        if (relation.relationKind === 'skill_skill') {
            if (sourceFact.verb && relatedFact.verb && allowedVerbs.has(sourceFact.verb) && allowedVerbs.has(relatedFact.verb)) {
                addDirectedPair(verbRows, sourceFact, relatedFact, 'esco_related_skill', 'verb', relation.relationId);
                addDirectedPair(verbRows, relatedFact, sourceFact, 'esco_related_skill', 'verb', relation.relationId);
            }
            if (sourceFact.object && relatedFact.object && allowedObjects.has(sourceFact.object) && allowedObjects.has(relatedFact.object)) {
                addDirectedPair(objectRows, sourceFact, relatedFact, 'esco_related_skill', 'object', relation.relationId);
                addDirectedPair(objectRows, relatedFact, sourceFact, 'esco_related_skill', 'object', relation.relationId);
            }
            continue;
        }
        if (relation.relationKind === 'broader_skill') {
            if (sourceFact.verb && relatedFact.verb && allowedVerbs.has(sourceFact.verb) && allowedVerbs.has(relatedFact.verb)) {
                addDirectedPair(verbRows, sourceFact, relatedFact, 'broader_skill', 'verb', relation.relationId);
                addDirectedPair(verbRows, relatedFact, sourceFact, 'narrower_skill', 'verb', relation.relationId);
            }
            if (sourceFact.object && relatedFact.object && allowedObjects.has(sourceFact.object) && allowedObjects.has(relatedFact.object)) {
                addDirectedPair(objectRows, sourceFact, relatedFact, 'broader_skill', 'object', relation.relationId);
                addDirectedPair(objectRows, relatedFact, sourceFact, 'narrower_skill', 'object', relation.relationId);
            }
        }
    }
}
function buildLabelFact(label) {
    const extracted = extractEscoLabelFact(label.label);
    if (!extracted) {
        return null;
    }
    return {
        skillId: label.skillId,
        skillUri: label.skillUri,
        label: label.sourceLabel,
        labelType: label.labelType,
        normalizedLabel: extracted.normalizedLabel,
        verb: extracted.verb,
        object: extracted.object
    };
}
function dedupeLabelFacts(facts) {
    const bySkillAndLabel = new Map();
    for (const fact of facts) {
        const key = `${fact.skillId}\u0000${fact.normalizedLabel}`;
        const existing = bySkillAndLabel.get(key);
        if (!existing || compareLabelFacts(fact, existing) < 0) {
            bySkillAndLabel.set(key, fact);
        }
    }
    return [...bySkillAndLabel.values()];
}
function buildRelationFact(skillId, skillUri, label) {
    const extracted = extractEscoLabelFact(label);
    return {
        skillId,
        skillUri,
        label,
        labelType: 'preferred_label',
        normalizedLabel: extracted?.normalizedLabel ?? normalizeSkillLabel(label),
        verb: extracted?.verb ?? null,
        object: extracted?.object ?? null
    };
}
function buildInventory(facts, field, minOccurrences) {
    const counts = new Map();
    for (const fact of facts) {
        const term = field === 'verb' ? fact.verb : fact.object;
        if (!term) {
            continue;
        }
        const entry = counts.get(term) ?? {
            occurrenceCount: 0,
            skillIds: new Set(),
            labelCount: 0
        };
        entry.occurrenceCount += 1;
        entry.labelCount += 1;
        entry.skillIds.add(fact.skillId);
        counts.set(term, entry);
    }
    return [...counts.entries()]
        .filter(([, entry]) => entry.occurrenceCount >= minOccurrences)
        .map(([term, entry]) => ({
        term,
        occurrenceCount: entry.occurrenceCount,
        skillCount: entry.skillIds.size,
        labelCount: entry.labelCount
    }))
        .sort((left, right) => right.occurrenceCount - left.occurrenceCount || left.term.localeCompare(right.term));
}
function compareLabelFacts(left, right) {
    if (left.labelType !== right.labelType) {
        return labelTypeRank(left.labelType) - labelTypeRank(right.labelType);
    }
    return left.label.localeCompare(right.label);
}
function labelTypeRank(value) {
    switch (value) {
        case 'preferred_label':
            return 0;
        case 'alt_label':
            return 1;
        case 'hidden_label':
            return 2;
    }
}
function groupFactsBySkill(facts) {
    const groups = new Map();
    for (const fact of facts) {
        const group = groups.get(fact.skillId) ?? [];
        group.push(fact);
        groups.set(fact.skillId, group);
    }
    return groups;
}
function uniqueTerms(facts, field, allowedTerms) {
    const seen = new Map();
    for (const fact of facts) {
        const term = field === 'verb' ? fact.verb : fact.object;
        if (!term || !allowedTerms.has(term) || seen.has(term)) {
            continue;
        }
        seen.set(term, fact);
    }
    return [...seen.values()];
}
function uniqueFactsByTerm(facts, field, allowedTerms) {
    return uniqueTerms(facts, field, allowedTerms);
}
function collectFactGroupsWithinLimit(facts, field, allowedTerms, maxSize) {
    const counts = new Map();
    for (const fact of facts) {
        const term = field === 'verb' ? fact.verb : fact.object;
        if (!term || !allowedTerms.has(term)) {
            continue;
        }
        counts.set(term, (counts.get(term) ?? 0) + 1);
    }
    const groups = new Map();
    for (const fact of facts) {
        const term = field === 'verb' ? fact.verb : fact.object;
        if (!term || !allowedTerms.has(term) || (counts.get(term) ?? 0) > maxSize) {
            continue;
        }
        const bucket = groups.get(term) ?? [];
        bucket.push(fact);
        groups.set(term, bucket);
    }
    return groups;
}
function addSymmetricPairs(accumulator, facts, relationshipType, field) {
    for (let leftIndex = 0; leftIndex < facts.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < facts.length; rightIndex += 1) {
            addDirectedPair(accumulator, facts[leftIndex], facts[rightIndex], relationshipType, field, null);
            addDirectedPair(accumulator, facts[rightIndex], facts[leftIndex], relationshipType, field, null);
        }
    }
}
function addSymmetricFactPairs(accumulator, facts, relationshipType, field) {
    addSymmetricPairs(accumulator, facts, relationshipType, field);
}
function addDirectedPair(accumulator, sourceFact, relatedFact, relationshipType, field, relationId) {
    const sourceTerm = field === 'verb' ? sourceFact.verb : sourceFact.object;
    const relatedTerm = field === 'verb' ? relatedFact.verb : relatedFact.object;
    if (sourceTerm === null || relatedTerm === null || sourceTerm === relatedTerm) {
        return;
    }
    const key = `${relationshipType}\u0000${sourceTerm}\u0000${relatedTerm}`;
    const entry = accumulator.get(key) ?? {
        evidenceCount: 0,
        sourceSkillIds: new Set(),
        relatedSkillIds: new Set(),
        sourceSkillUris: new Set(),
        relatedSkillUris: new Set(),
        sourceLabelExamples: new Set(),
        relatedLabelExamples: new Set()
    };
    entry.evidenceCount += 1;
    entry.sourceSkillIds.add(sourceFact.skillId);
    entry.relatedSkillIds.add(relatedFact.skillId);
    entry.sourceSkillUris.add(sourceFact.skillUri);
    entry.relatedSkillUris.add(relatedFact.skillUri);
    entry.sourceLabelExamples.add(sourceFact.label);
    entry.relatedLabelExamples.add(relatedFact.label);
    if (relationId !== null) {
        entry.sourceLabelExamples.add(`relation:${relationId}`);
    }
    accumulator.set(key, entry);
}
function finalizeVerbRows(rows) {
    return [...rows.entries()].map(([key, entry]) => finalizeRow(key, entry, 'verb')).sort(sortRelatedRows);
}
function finalizeObjectRows(rows) {
    return [...rows.entries()].map(([key, entry]) => finalizeRow(key, entry, 'object')).sort(sortRelatedRows);
}
function finalizeRow(key, entry, kind) {
    const [relationshipType, sourceTerm, relatedTerm] = key.split('\u0000');
    if (kind === 'verb') {
        return {
            source_verb: sourceTerm ?? '',
            related_verb: relatedTerm ?? '',
            relationship_type: relationshipType,
            evidence_count: entry.evidenceCount,
            source_skill_ids: [...entry.sourceSkillIds].sort((left, right) => left - right),
            related_skill_ids: [...entry.relatedSkillIds].sort((left, right) => left - right),
            source_skill_uris: [...entry.sourceSkillUris].sort(),
            related_skill_uris: [...entry.relatedSkillUris].sort(),
            source_label_examples: [...entry.sourceLabelExamples].sort(),
            related_label_examples: [...entry.relatedLabelExamples].sort()
        };
    }
    return {
        source_object: sourceTerm ?? '',
        related_object: relatedTerm ?? '',
        relationship_type: relationshipType,
        evidence_count: entry.evidenceCount,
        source_skill_ids: [...entry.sourceSkillIds].sort((left, right) => left - right),
        related_skill_ids: [...entry.relatedSkillIds].sort((left, right) => left - right),
        source_skill_uris: [...entry.sourceSkillUris].sort(),
        related_skill_uris: [...entry.relatedSkillUris].sort(),
        source_label_examples: [...entry.sourceLabelExamples].sort(),
        related_label_examples: [...entry.relatedLabelExamples].sort()
    };
}
function sortRelatedRows(left, right) {
    return (right.evidence_count - left.evidence_count ||
        left.relationship_type.localeCompare(right.relationship_type) ||
        relatedTermForRow(left).localeCompare(relatedTermForRow(right)) ||
        sourceTermForRow(left).localeCompare(sourceTermForRow(right)));
}
function relatedTermForRow(row) {
    return 'related_verb' in row ? row.related_verb : row.related_object;
}
function sourceTermForRow(row) {
    return 'source_verb' in row ? row.source_verb : row.source_object;
}
function normalizeSkillLabel(value) {
    return foldSearchText(value).trim();
}
function normalizeMinOccurrences(value, fallback) {
    if (!Number.isInteger(value ?? fallback) || (value ?? fallback) < 1) {
        return fallback;
    }
    return value ?? fallback;
}
