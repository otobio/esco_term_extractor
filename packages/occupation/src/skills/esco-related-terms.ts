import { foldSearchText, tokenizeNormalizedText } from '../utils/texts.js';

export type EscoSkillLabelRecord = {
  skillId: number;
  skillUri: string;
  label: string;
  labelType: 'preferred_label' | 'alt_label' | 'hidden_label';
  sourceLabel: string;
};

export type EscoSkillRelationRecord = {
  relationId: number;
  relationKind: 'skill_skill' | 'broader_skill';
  localeCode: string;
  sourceSkillId: number;
  sourceSkillUri: string;
  sourceLabel: string;
  relatedSkillId: number;
  relatedSkillUri: string;
  relatedLabel: string;
};

export type EscoTermInventoryRow = {
  term: string;
  occurrenceCount: number;
  skillCount: number;
  labelCount: number;
};

export type EscoVerbRelatedRow = {
  source_verb: string;
  related_verb: string;
  relationship_type: 'same_skill' | 'same_object' | 'esco_related_skill' | 'broader_skill' | 'narrower_skill';
  evidence_count: number;
  source_skill_ids: number[];
  related_skill_ids: number[];
  source_skill_uris: string[];
  related_skill_uris: string[];
  source_label_examples: string[];
  related_label_examples: string[];
};

export type EscoObjectRelatedRow = {
  source_object: string;
  related_object: string;
  relationship_type: 'same_skill' | 'same_verb' | 'esco_related_skill' | 'broader_skill' | 'narrower_skill';
  evidence_count: number;
  source_skill_ids: number[];
  related_skill_ids: number[];
  source_skill_uris: string[];
  related_skill_uris: string[];
  source_label_examples: string[];
  related_label_examples: string[];
};

export type EscoRelatedTermsDataset = {
  verbInventory: EscoTermInventoryRow[];
  objectInventory: EscoTermInventoryRow[];
  verbRelatedRows: EscoVerbRelatedRow[];
  objectRelatedRows: EscoObjectRelatedRow[];
};

export type EscoRelatedTermsBuildOptions = {
  minVerbOccurrences?: number;
  minObjectOccurrences?: number;
};

type LabelFact = {
  skillId: number;
  skillUri: string;
  label: string;
  labelType: EscoSkillLabelRecord['labelType'];
  normalizedLabel: string;
  verb: string | null;
  object: string | null;
};

type PairAccumulator = {
  evidenceCount: number;
  sourceSkillIds: Set<number>;
  relatedSkillIds: Set<number>;
  sourceSkillUris: Set<string>;
  relatedSkillUris: Set<string>;
  sourceLabelExamples: Set<string>;
  relatedLabelExamples: Set<string>;
};

const DEFAULT_MIN_OCCURRENCES = 2;
const MAX_SHARED_TERM_GROUP_SIZE = 64;

export function buildEscoRelatedTermsDataset(
  labels: EscoSkillLabelRecord[],
  relations: EscoSkillRelationRecord[] = [],
  options: EscoRelatedTermsBuildOptions = {}
): EscoRelatedTermsDataset {
  const facts = dedupeLabelFacts(labels.map((label) => buildLabelFact(label)).filter((fact): fact is LabelFact => fact !== null));
  const minVerbOccurrences = normalizeMinOccurrences(options.minVerbOccurrences, DEFAULT_MIN_OCCURRENCES);
  const minObjectOccurrences = normalizeMinOccurrences(options.minObjectOccurrences, DEFAULT_MIN_OCCURRENCES);
  const verbInventory = buildInventory(facts, 'verb', minVerbOccurrences);
  const objectInventory = buildInventory(facts, 'object', minObjectOccurrences);
  const allowedVerbs = new Set(verbInventory.map((row) => row.term));
  const allowedObjects = new Set(objectInventory.map((row) => row.term));
  const verbRows = new Map<string, PairAccumulator>();
  const objectRows = new Map<string, PairAccumulator>();

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

export function buildEscoVerbInventory(labels: EscoSkillLabelRecord[], minOccurrences = DEFAULT_MIN_OCCURRENCES): EscoTermInventoryRow[] {
  const facts = labels.map((label) => buildLabelFact(label)).filter((fact): fact is LabelFact => fact !== null);

  return buildInventory(facts, 'verb', normalizeMinOccurrences(minOccurrences, DEFAULT_MIN_OCCURRENCES));
}

export function buildEscoObjectInventory(labels: EscoSkillLabelRecord[], minOccurrences = DEFAULT_MIN_OCCURRENCES): EscoTermInventoryRow[] {
  const facts = labels.map((label) => buildLabelFact(label)).filter((fact): fact is LabelFact => fact !== null);

  return buildInventory(facts, 'object', normalizeMinOccurrences(minOccurrences, DEFAULT_MIN_OCCURRENCES));
}

export function extractEscoLabelFact(label: string): Pick<LabelFact, 'normalizedLabel' | 'verb' | 'object'> | null {
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

function accumulateSameSkillRows(
  facts: LabelFact[],
  allowedVerbs: Set<string>,
  allowedObjects: Set<string>,
  verbRows: Map<string, PairAccumulator>,
  objectRows: Map<string, PairAccumulator>
): void {
  const groupedFacts = groupFactsBySkill(facts);

  for (const group of groupedFacts.values()) {
    const verbTerms = uniqueTerms(group, 'verb', allowedVerbs);
    const objectTerms = uniqueTerms(group, 'object', allowedObjects);

    addSymmetricPairs(verbRows, verbTerms, 'same_skill', 'verb');
    addSymmetricPairs(objectRows, objectTerms, 'same_skill', 'object');
  }
}

function accumulateSameObjectRows(
  facts: LabelFact[],
  allowedObjects: Set<string>,
  allowedVerbs: Set<string>,
  verbRows: Map<string, PairAccumulator>
): void {
  for (const group of collectFactGroupsWithinLimit(facts, 'object', allowedObjects, MAX_SHARED_TERM_GROUP_SIZE).values()) {
    const verbFacts = uniqueFactsByTerm(group, 'verb', allowedVerbs);
    addSymmetricFactPairs(verbRows, verbFacts, 'same_object', 'verb');
  }
}

function accumulateSameVerbRows(
  facts: LabelFact[],
  allowedVerbs: Set<string>,
  allowedObjects: Set<string>,
  objectRows: Map<string, PairAccumulator>
): void {
  for (const group of collectFactGroupsWithinLimit(facts, 'verb', allowedVerbs, MAX_SHARED_TERM_GROUP_SIZE).values()) {
    const objectFacts = uniqueFactsByTerm(group, 'object', allowedObjects);
    addSymmetricFactPairs(objectRows, objectFacts, 'same_verb', 'object');
  }
}

function accumulateRelationRows(
  relations: EscoSkillRelationRecord[],
  allowedVerbs: Set<string>,
  allowedObjects: Set<string>,
  verbRows: Map<string, PairAccumulator>,
  objectRows: Map<string, PairAccumulator>
): void {
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

function buildLabelFact(label: EscoSkillLabelRecord): LabelFact | null {
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

function dedupeLabelFacts(facts: LabelFact[]): LabelFact[] {
  const bySkillAndLabel = new Map<string, LabelFact>();

  for (const fact of facts) {
    const key = `${fact.skillId}\u0000${fact.normalizedLabel}`;
    const existing = bySkillAndLabel.get(key);

    if (!existing || compareLabelFacts(fact, existing) < 0) {
      bySkillAndLabel.set(key, fact);
    }
  }

  return [...bySkillAndLabel.values()];
}

function buildRelationFact(skillId: number, skillUri: string, label: string): LabelFact {
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

function buildInventory(facts: LabelFact[], field: 'verb' | 'object', minOccurrences: number): EscoTermInventoryRow[] {
  const counts = new Map<string, { occurrenceCount: number; skillIds: Set<number>; labelCount: number }>();

  for (const fact of facts) {
    const term = field === 'verb' ? fact.verb : fact.object;

    if (!term) {
      continue;
    }

    const entry = counts.get(term) ?? {
      occurrenceCount: 0,
      skillIds: new Set<number>(),
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

function compareLabelFacts(left: LabelFact, right: LabelFact): number {
  if (left.labelType !== right.labelType) {
    return labelTypeRank(left.labelType) - labelTypeRank(right.labelType);
  }

  return left.label.localeCompare(right.label);
}

function labelTypeRank(value: LabelFact['labelType']): number {
  switch (value) {
    case 'preferred_label':
      return 0;
    case 'alt_label':
      return 1;
    case 'hidden_label':
      return 2;
  }
}

function groupFactsBySkill(facts: LabelFact[]): Map<number, LabelFact[]> {
  const groups = new Map<number, LabelFact[]>();

  for (const fact of facts) {
    const group = groups.get(fact.skillId) ?? [];
    group.push(fact);
    groups.set(fact.skillId, group);
  }

  return groups;
}

function uniqueTerms(facts: LabelFact[], field: 'verb' | 'object', allowedTerms: Set<string>): LabelFact[] {
  const seen = new Map<string, LabelFact>();

  for (const fact of facts) {
    const term = field === 'verb' ? fact.verb : fact.object;

    if (!term || !allowedTerms.has(term) || seen.has(term)) {
      continue;
    }

    seen.set(term, fact);
  }

  return [...seen.values()];
}

function uniqueFactsByTerm(facts: LabelFact[], field: 'verb' | 'object', allowedTerms: Set<string>): LabelFact[] {
  return uniqueTerms(facts, field, allowedTerms);
}

function collectFactGroupsWithinLimit(
  facts: LabelFact[],
  field: 'verb' | 'object',
  allowedTerms: Set<string>,
  maxSize: number
): Map<string, LabelFact[]> {
  const counts = new Map<string, number>();

  for (const fact of facts) {
    const term = field === 'verb' ? fact.verb : fact.object;

    if (!term || !allowedTerms.has(term)) {
      continue;
    }

    counts.set(term, (counts.get(term) ?? 0) + 1);
  }

  const groups = new Map<string, LabelFact[]>();

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

function addSymmetricPairs(
  accumulator: Map<string, PairAccumulator>,
  facts: LabelFact[],
  relationshipType: EscoVerbRelatedRow['relationship_type'] | EscoObjectRelatedRow['relationship_type'],
  field: 'verb' | 'object'
): void {
  for (let leftIndex = 0; leftIndex < facts.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < facts.length; rightIndex += 1) {
      addDirectedPair(accumulator, facts[leftIndex], facts[rightIndex], relationshipType, field, null);
      addDirectedPair(accumulator, facts[rightIndex], facts[leftIndex], relationshipType, field, null);
    }
  }
}

function addSymmetricFactPairs(
  accumulator: Map<string, PairAccumulator>,
  facts: LabelFact[],
  relationshipType: EscoVerbRelatedRow['relationship_type'] | EscoObjectRelatedRow['relationship_type'],
  field: 'verb' | 'object'
): void {
  addSymmetricPairs(accumulator, facts, relationshipType, field);
}

function addDirectedPair(
  accumulator: Map<string, PairAccumulator>,
  sourceFact: LabelFact,
  relatedFact: LabelFact,
  relationshipType: EscoVerbRelatedRow['relationship_type'] | EscoObjectRelatedRow['relationship_type'],
  field: 'verb' | 'object',
  relationId: number | null
): void {
  const sourceTerm = field === 'verb' ? sourceFact.verb : sourceFact.object;
  const relatedTerm = field === 'verb' ? relatedFact.verb : relatedFact.object;

  if (sourceTerm === null || relatedTerm === null || sourceTerm === relatedTerm) {
    return;
  }

  const key = `${relationshipType}\u0000${sourceTerm}\u0000${relatedTerm}`;
  const entry = accumulator.get(key) ?? {
    evidenceCount: 0,
    sourceSkillIds: new Set<number>(),
    relatedSkillIds: new Set<number>(),
    sourceSkillUris: new Set<string>(),
    relatedSkillUris: new Set<string>(),
    sourceLabelExamples: new Set<string>(),
    relatedLabelExamples: new Set<string>()
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

function finalizeVerbRows(rows: Map<string, PairAccumulator>): EscoVerbRelatedRow[] {
  return [...rows.entries()].map(([key, entry]) => finalizeRow(key, entry, 'verb') as EscoVerbRelatedRow).sort(sortRelatedRows);
}

function finalizeObjectRows(rows: Map<string, PairAccumulator>): EscoObjectRelatedRow[] {
  return [...rows.entries()].map(([key, entry]) => finalizeRow(key, entry, 'object') as EscoObjectRelatedRow).sort(sortRelatedRows);
}

function finalizeRow(key: string, entry: PairAccumulator, kind: 'verb' | 'object'): EscoVerbRelatedRow | EscoObjectRelatedRow {
  const [relationshipType, sourceTerm, relatedTerm] = key.split('\u0000');

  if (kind === 'verb') {
    return {
      source_verb: sourceTerm ?? '',
      related_verb: relatedTerm ?? '',
      relationship_type: relationshipType as EscoVerbRelatedRow['relationship_type'],
      evidence_count: entry.evidenceCount,
      source_skill_ids: [...entry.sourceSkillIds].sort((left, right) => left - right),
      related_skill_ids: [...entry.relatedSkillIds].sort((left, right) => left - right),
      source_skill_uris: [...entry.sourceSkillUris].sort(),
      related_skill_uris: [...entry.relatedSkillUris].sort(),
      source_label_examples: normalizeDisplayExamples(entry.sourceLabelExamples),
      related_label_examples: normalizeDisplayExamples(entry.relatedLabelExamples)
    };
  }

  return {
    source_object: sourceTerm ?? '',
    related_object: relatedTerm ?? '',
    relationship_type: relationshipType as EscoObjectRelatedRow['relationship_type'],
    evidence_count: entry.evidenceCount,
    source_skill_ids: [...entry.sourceSkillIds].sort((left, right) => left - right),
    related_skill_ids: [...entry.relatedSkillIds].sort((left, right) => left - right),
    source_skill_uris: [...entry.sourceSkillUris].sort(),
    related_skill_uris: [...entry.relatedSkillUris].sort(),
    source_label_examples: normalizeDisplayExamples(entry.sourceLabelExamples),
    related_label_examples: normalizeDisplayExamples(entry.relatedLabelExamples)
  };
}

function sortRelatedRows(left: EscoVerbRelatedRow | EscoObjectRelatedRow, right: EscoVerbRelatedRow | EscoObjectRelatedRow): number {
  return (
    right.evidence_count - left.evidence_count ||
    left.relationship_type.localeCompare(right.relationship_type) ||
    relatedTermForRow(left).localeCompare(relatedTermForRow(right)) ||
    sourceTermForRow(left).localeCompare(sourceTermForRow(right))
  );
}

function relatedTermForRow(row: EscoVerbRelatedRow | EscoObjectRelatedRow): string {
  return 'related_verb' in row ? row.related_verb : row.related_object;
}

function sourceTermForRow(row: EscoVerbRelatedRow | EscoObjectRelatedRow): string {
  return 'source_verb' in row ? row.source_verb : row.source_object;
}

function normalizeSkillLabel(value: string): string {
  return foldSearchText(value).trim();
}

function normalizeDisplayExamples(values: Iterable<string>): string[] {
  const byNormalized = new Map<string, string>();

  for (const value of values) {
    if (value.startsWith('relation:')) {
      byNormalized.set(value, value);
      continue;
    }

    const normalized = normalizeSkillLabel(value);

    if (!normalized) {
      continue;
    }

    const current = byNormalized.get(normalized);

    if (!current || compareDisplayExample(value, current) < 0) {
      byNormalized.set(normalized, value);
    }
  }

  return [...byNormalized.values()].sort((left, right) => left.localeCompare(right));
}

function compareDisplayExample(left: string, right: string): number {
  return left.length - right.length || left.localeCompare(right);
}

function normalizeMinOccurrences(value: number | undefined, fallback: number): number {
  if (!Number.isInteger(value ?? fallback) || (value ?? fallback) < 1) {
    return fallback;
  }

  return value ?? fallback;
}
