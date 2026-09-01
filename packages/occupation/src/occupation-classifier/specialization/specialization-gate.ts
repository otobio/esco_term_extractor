import {
  DEFAULT_ROLE_HEAD_GROUPS,
  DEFAULT_SPECIALIZATION_SCHEMA,
  SPECIALIZATION_DIMENSIONS,
  classifySpecializationQuery,
  tokenizeTitle,
  type ClassifierOptions,
  type QuerySpecializationClassification,
  type SpecializationDimension,
  type TitleClassification
} from './specialization-dimension-mapper.js';

export const SPECIALIZATION_DATA_DIMENSIONS = SPECIALIZATION_DIMENSIONS.filter(
  (dimension): dimension is Exclude<SpecializationDimension, 'role_head'> => dimension !== 'role_head'
);

export type SpecializationGateInput = QuerySpecializationClassification | TitleClassification | string;
export type SpecializationGateDecision = 'pass_strict' | 'pass_partial' | 'reject';
export type SpecializationDimensionJudgmentKind =
  | 'exact_concept'
  | 'equivalent_concept'
  | 'exact_literal'
  | 'recoverable_available'
  | 'unknown'
  | 'contradiction';

export type SpecializationDimensionJudgment = {
  dimension: Exclude<SpecializationDimension, 'role_head'>;
  kind: SpecializationDimensionJudgmentKind;
  leafConceptIds: string[];
  leafRecoverableValues: string[];
  leafValues: string[];
  matchedValues: string[];
  queryConceptIds: string[];
  queryRecoverableValues: string[];
  queryValues: string[];
};

export type SpecializationGateResult = {
  accepted: boolean;
  compatibleDimensions: Exclude<SpecializationDimension, 'role_head'>[];
  contradictionDimensions: Exclude<SpecializationDimension, 'role_head'>[];
  decision: SpecializationGateDecision;
  equivalentDimensions: Exclude<SpecializationDimension, 'role_head'>[];
  judgments: SpecializationDimensionJudgment[];
  queriedDimensions: Exclude<SpecializationDimension, 'role_head'>[];
  relatedness: {
    reinforcedDimensions: Exclude<SpecializationDimension, 'role_head'>[];
    reinforcedEquivalentDimensions: Exclude<SpecializationDimension, 'role_head'>[];
    roleHead: {
      exact: boolean;
      queryRoleHeads: string[];
      leafRoleHeads: string[];
      sameFamily: boolean;
      sharedGroups: string[];
      strength: 'none' | 'role_only' | 'role_and_dimensions';
    };
  };
  unknownDimensions: Exclude<SpecializationDimension, 'role_head'>[];
};

type GateDimensionSignals = {
  conceptIds: string[];
  recoverablePartSet: Set<string>;
  recoverableValues: string[];
  values: string[];
};

type GateSignals = Record<Exclude<SpecializationDimension, 'role_head'>, GateDimensionSignals>;

const CONCEPT_DIMENSIONS_BY_ID = buildConceptDimensionsById();
const ROLE_HEAD_GROUPS_BY_HEAD = buildRoleHeadGroupsByHead();
const CONCEPT_EQUIVALENCE_BY_DIMENSION = loadConceptEquivalenceByDimension(CONCEPT_DIMENSIONS_BY_ID);
const CONCEPT_IDS_BY_DIMENSION_VALUE = buildConceptIdsByDimensionValue(CONCEPT_DIMENSIONS_BY_ID);

export function specializationGate(
  queryInput: SpecializationGateInput,
  leafInput: SpecializationGateInput,
  options: ClassifierOptions = {}
): SpecializationGateResult {
  const queryClassification = resolveGateInput(queryInput, options);
  const leafClassification = resolveGateInput(leafInput, options);
  const querySignals = collectGateSignals(queryClassification);
  const leafSignals = collectGateSignals(leafClassification);
  let judgments: SpecializationDimensionJudgment[] = [];

  for (const dimension of SPECIALIZATION_DATA_DIMENSIONS) {
    const queryDimension = querySignals[dimension];
    if (queryDimension.values.length === 0 && queryDimension.conceptIds.length === 0) {
      continue;
    }

    judgments.push(judgeDimension(dimension, queryDimension, leafSignals[dimension]));
  }

  judgments = upgradeSiblingUnknownJudgments(queryClassification, leafClassification, querySignals, leafSignals, judgments);

  const compatibleDimensions: Exclude<SpecializationDimension, 'role_head'>[] = [];
  const contradictionDimensions: Exclude<SpecializationDimension, 'role_head'>[] = [];
  const equivalentDimensions: Exclude<SpecializationDimension, 'role_head'>[] = [];
  const unknownDimensions: Exclude<SpecializationDimension, 'role_head'>[] = [];

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

  const decision =
    contradictionDimensions.length > 0
      ? 'reject'
      : equivalentDimensions.length === 0 && compatibleDimensions.length === judgments.length && judgments.length > 0
        ? 'pass_strict'
        : 'pass_partial';
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

export function failsHardContradiction(
  queryInput: SpecializationGateInput,
  leafInput: SpecializationGateInput,
  options: ClassifierOptions = {}
) {
  return specializationGate(queryInput, leafInput, options).decision === 'reject';
}

function resolveGateInput(
  input: SpecializationGateInput,
  options: ClassifierOptions = {}
): QuerySpecializationClassification | TitleClassification {
  if (typeof input === 'string') {
    return classifySpecializationQuery(input, options);
  }

  return input;
}

function collectGateSignals(classification: QuerySpecializationClassification | TitleClassification): GateSignals {
  const conceptIdsByDimension = createEmptyConceptBuckets();
  if ('concepts' in classification) {
    for (const concept of classification.concepts) {
      const conceptIds = conceptIdsByDimension[concept.dimension];
      if (!conceptIds.includes(concept.conceptId)) {
        conceptIds.push(concept.conceptId);
      }
    }
  }

  for (const dimension of SPECIALIZATION_DATA_DIMENSIONS) {
    for (const value of classification.concept[dimension]) {
      for (const conceptId of CONCEPT_IDS_BY_DIMENSION_VALUE[dimension].get(normalizeGateValue(value)) ?? []) {
        const conceptIds = conceptIdsByDimension[dimension];
        if (!conceptIds.includes(conceptId)) {
          conceptIds.push(conceptId);
        }
      }
    }
  }

  const signals = {} as GateSignals;
  for (const dimension of SPECIALIZATION_DATA_DIMENSIONS) {
    const values = classification[dimension];
    const recoverableValues = classification.available[dimension].length > 0 ? classification.available[dimension] : values;

    signals[dimension] = {
      conceptIds: conceptIdsByDimension[dimension],
      recoverablePartSet: new Set(recoverableValues.flatMap((value) => tokenizeTitle(value).map((part) => normalizeGateValue(part)))),
      recoverableValues,
      values
    };
  }

  return signals;
}

function upgradeSiblingUnknownJudgments(
  queryClassification: QuerySpecializationClassification | TitleClassification,
  leafClassification: QuerySpecializationClassification | TitleClassification,
  querySignals: GateSignals,
  leafSignals: GateSignals,
  judgments: SpecializationDimensionJudgment[]
) {
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
      kind: 'contradiction' as const
    };
  });
}

function judgeDimension(
  dimension: Exclude<SpecializationDimension, 'role_head'>,
  query: GateDimensionSignals,
  leaf: GateDimensionSignals
): SpecializationDimensionJudgment {
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

function createEmptyConceptBuckets(): Record<Exclude<SpecializationDimension, 'role_head'>, string[]> {
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

function intersectValues(left: string[], right: string[]) {
  const rightSet = new Set(right.map((value) => normalizeGateValue(value)));
  return left.filter((value, index, values) => {
    const normalized = normalizeGateValue(value);
    return rightSet.has(normalized) && values.findIndex((candidate) => normalizeGateValue(candidate) === normalized) === index;
  });
}

function findEquivalentConceptMatch(
  dimension: Exclude<SpecializationDimension, 'role_head'>,
  queryConceptIds: string[],
  leafConceptIds: string[]
) {
  const dimensionEquivalences = CONCEPT_EQUIVALENCE_BY_DIMENSION[dimension];
  if (queryConceptIds.length === 0 || leafConceptIds.length === 0 || dimensionEquivalences.size === 0) {
    return [];
  }

  const matches: string[] = [];
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

function findExactLiteralMatch(queryValues: string[], leafValues: string[]) {
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

function findRecoverableMatch(queryValues: string[], leafRecoverablePartSet: Set<string>) {
  const matches: string[] = [];

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

function normalizeGateValue(value: string) {
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

function loadConceptEquivalenceByDimension(conceptDimensionsById: Map<string, Exclude<SpecializationDimension, 'role_head'>>) {
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
      const related = equivalences[dimension].get(conceptId) ?? new Set<string>();
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
  const conceptDimensionsById = new Map<string, Exclude<SpecializationDimension, 'role_head'>>();

  for (const concept of DEFAULT_SPECIALIZATION_SCHEMA.concepts) {
    const dimensions = new Set<Exclude<SpecializationDimension, 'role_head'>>();
    if (concept.dimension) {
      dimensions.add(concept.dimension);
    }
    for (const rule of concept.rules ?? []) {
      dimensions.add(rule.dimension);
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
    venue: new Map<string, Set<string>>(),
    channel: new Map<string, Set<string>>(),
    product: new Map<string, Set<string>>(),
    population: new Map<string, Set<string>>(),
    task: new Map<string, Set<string>>(),
    industry: new Map<string, Set<string>>(),
    knowledge_domain: new Map<string, Set<string>>(),
    work_object: new Map<string, Set<string>>()
  } satisfies Record<Exclude<SpecializationDimension, 'role_head'>, Map<string, Set<string>>>;
}

function buildConceptIdsByDimensionValue(conceptDimensionsById: Map<string, Exclude<SpecializationDimension, 'role_head'>>) {
  const conceptIdsByDimensionValue = {
    venue: new Map<string, string[]>(),
    channel: new Map<string, string[]>(),
    product: new Map<string, string[]>(),
    population: new Map<string, string[]>(),
    task: new Map<string, string[]>(),
    industry: new Map<string, string[]>(),
    knowledge_domain: new Map<string, string[]>(),
    work_object: new Map<string, string[]>()
  } satisfies Record<Exclude<SpecializationDimension, 'role_head'>, Map<string, string[]>>;

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
  const groupsByHead = new Map<string, Set<string>>();

  for (const [groupName, roleHeads] of Object.entries(DEFAULT_ROLE_HEAD_GROUPS)) {
    for (const roleHead of roleHeads) {
      const normalizedRoleHead = normalizeGateValue(roleHead);
      const groups = groupsByHead.get(normalizedRoleHead) ?? new Set<string>();
      groups.add(groupName);
      groupsByHead.set(normalizedRoleHead, groups);
    }
  }

  return groupsByHead;
}

function deriveRoleHeadRelatedness(queryRoleHeads: string[], leafRoleHeads: string[]) {
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

  const queryGroups = new Set<string>();
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

  const sharedGroups = new Set<string>();
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

function shareRoleHeadFamily(queryRoleHeads: string[], leafRoleHeads: string[]) {
  return deriveRoleHeadRelatedness(queryRoleHeads, leafRoleHeads).sameFamily;
}

function hasExplicitSpecializationSignals(signals: GateSignals) {
  for (const dimension of SPECIALIZATION_DATA_DIMENSIONS) {
    const signal = signals[dimension];
    if (signal.values.length > 0 || signal.conceptIds.length > 0) {
      return true;
    }
  }

  return false;
}

function singularizeGateToken(token: string) {
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
