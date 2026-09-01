import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SPECIALIZATION_DATA_DIMENSIONS,
  failsHardContradiction,
  specializationGate
} from '../../../src/occupation-classifier/specialization/specialization-gate.js';
import {
  classifySpecializationQuery,
  classifySpecializationTitle,
  loadSpecializationSchemaFromCsv
} from '../../../src/occupation-classifier/specialization/specialization-dimension-mapper.js';
import type {
  QuerySpecializationClassification,
  ResolvedSpecializationConcept,
  SpecializationDimension
} from '../../../src/occupation-classifier/specialization/specialization-dimension-mapper.js';

type DataDimension = Exclude<SpecializationDimension, 'role_head'>;
type DimensionRecord = Record<SpecializationDimension, string[]>;

function emptyDimensionRecord(): DimensionRecord {
  return {
    venue: [],
    channel: [],
    product: [],
    population: [],
    task: [],
    industry: [],
    knowledge_domain: [],
    work_object: [],
    role_head: []
  };
}

function concept(dimension: DataDimension, conceptId: string, canonicalTokens: string[] = [conceptId]): ResolvedSpecializationConcept {
  return { aliases: [], canonicalTokens, conceptId, dimension, end: 0, priority: 100, start: 0 };
}

function classification(
  params: { values?: Partial<DimensionRecord>; available?: Partial<DimensionRecord>; concepts?: ResolvedSpecializationConcept[] } = {}
): QuerySpecializationClassification {
  return {
    ...emptyDimensionRecord(),
    ...params.values,
    available: { ...emptyDimensionRecord(), ...params.available },
    concept: emptyDimensionRecord(),
    literal: emptyDimensionRecord(),
    tokens: [],
    unresolved: [],
    concepts: params.concepts ?? [],
    roleModes: []
  };
}

// -- judgment-kind coverage: the four ways a dimension can be judged compatible or not --

test('specializationGate matches on shared concept ids even when literal wording differs (exact_concept)', () => {
  const query = classification({
    values: { work_object: ['software'] },
    concepts: [concept('work_object', 'software_work_object')]
  });
  const leaf = classification({
    values: { work_object: ['program'] },
    concepts: [concept('work_object', 'software_work_object')]
  });

  const result = specializationGate(query, leaf);

  assert.equal(result.judgments.length, 1);
  assert.equal(result.judgments[0]?.kind, 'exact_concept');
  assert.deepEqual(result.compatibleDimensions, ['work_object']);
  assert.equal(result.decision, 'pass_strict');
  assert.equal(result.accepted, true);
});

test('specializationGate matches identical literal value sets even without concept ids (exact_literal)', () => {
  const query = classification({ values: { venue: ['hospital'] } });
  const leaf = classification({ values: { venue: ['hospital'] } });

  const result = specializationGate(query, leaf);

  assert.equal(result.judgments[0]?.kind, 'exact_literal');
  assert.equal(result.decision, 'pass_strict');
});

test('specializationGate accepts a query value that is recoverable from a more specific leaf value set', () => {
  const query = classification({ values: { work_object: ['software'] } });
  const leaf = classification({
    values: { work_object: ['software', 'hardware'] },
    available: { work_object: ['software', 'hardware'] }
  });

  const result = specializationGate(query, leaf);

  // The value sets differ in size (1 vs 2), so this cannot be an exact_literal match; it falls
  // through to the recoverable check, which covers the query value from the leaf's word bag instead.
  assert.equal(result.judgments[0]?.kind, 'recoverable_available');
  assert.deepEqual(result.judgments[0]?.matchedValues, ['software']);
  assert.equal(result.decision, 'pass_strict');
  assert.equal(result.accepted, true);
});

test('specializationGate treats a leaf with zero signal for a queried dimension as unknown, not a contradiction', () => {
  const query = classification({ values: { venue: ['hospital'] } });
  const leaf = classification({});

  const result = specializationGate(query, leaf);

  assert.equal(result.judgments[0]?.kind, 'unknown');
  assert.deepEqual(result.unknownDimensions, ['venue']);
  assert.deepEqual(result.contradictionDimensions, []);
  assert.equal(result.decision, 'pass_partial');
  assert.equal(result.accepted, true);
});

test('specializationGate rejects concept ids that name different, non-overlapping things in the same dimension', () => {
  const query = classification({
    values: { work_object: ['software'] },
    concepts: [concept('work_object', 'software_work_object')]
  });
  const leaf = classification({
    values: { work_object: ['hardware'] },
    concepts: [concept('work_object', 'hardware_work_object')]
  });

  const result = specializationGate(query, leaf);

  assert.equal(result.judgments[0]?.kind, 'contradiction');
  assert.deepEqual(result.contradictionDimensions, ['work_object']);
  assert.equal(result.decision, 'reject');
  assert.equal(result.accepted, false);
});

test('specializationGate rejects a non-overlapping literal value even when neither side carries concept ids', () => {
  const query = classification({ values: { venue: ['hospital'] } });
  const leaf = classification({
    values: { venue: ['restaurant'] },
    available: { venue: ['restaurant'] }
  });

  const result = specializationGate(query, leaf);

  assert.equal(result.judgments[0]?.kind, 'contradiction');
  assert.equal(result.decision, 'reject');
});

// -- which dimensions get judged at all --

test('specializationGate only judges dimensions the query itself specifies, ignoring leaf-only specificity', () => {
  const query = classification({ values: { task: ['cooking'] } });
  const leaf = classification({ values: { venue: ['hospital'], industry: ['banking'] } });

  const result = specializationGate(query, leaf);

  assert.deepEqual(result.queriedDimensions, ['task']);
  assert.equal(result.judgments.length, 1);
});

test('specializationGate ignores role_head entirely: it is never a judged structural dimension', () => {
  const query = classification({ values: { role_head: ['manager'] } });
  const leaf = classification({ values: { role_head: ['assistant'] } });

  const result = specializationGate(query, leaf);

  assert.deepEqual(result.judgments, []);
  assert.equal(result.decision, 'pass_partial');
  assert.equal(result.accepted, true);
  assert.deepEqual(SPECIALIZATION_DATA_DIMENSIONS.includes('role_head' as DataDimension), false);
});

test('specializationGate accepts (pass_partial) when the query carries no specialization signal at all', () => {
  const query = classification({});
  const leaf = classification({ values: { venue: ['restaurant'] } });

  const result = specializationGate(query, leaf);

  assert.deepEqual(result.judgments, []);
  assert.equal(result.decision, 'pass_partial');
  assert.equal(result.accepted, true);
});

// -- decision aggregation across multiple dimensions --

test('specializationGate requires every judged dimension to be confirmed compatible for pass_strict', () => {
  const query = classification({ values: { venue: ['hospital'], task: ['cooking'] } });
  const leaf = classification({ values: { venue: ['hospital'] } });

  const result = specializationGate(query, leaf);

  assert.deepEqual(result.compatibleDimensions, ['venue']);
  assert.deepEqual(result.unknownDimensions, ['task']);
  assert.equal(result.decision, 'pass_partial');
  assert.equal(result.accepted, true);
});

test('specializationGate rejects overall the instant any judged dimension contradicts, even with other dimensions matching', () => {
  const query = classification({
    values: { venue: ['hospital'], work_object: ['software'] },
    concepts: [concept('work_object', 'software_work_object')]
  });
  const leaf = classification({
    values: { venue: ['hospital'], work_object: ['hardware'] },
    concepts: [concept('work_object', 'hardware_work_object')]
  });

  const result = specializationGate(query, leaf);

  assert.deepEqual(result.compatibleDimensions, ['venue']);
  assert.deepEqual(result.contradictionDimensions, ['work_object']);
  assert.equal(result.decision, 'reject');
  assert.equal(result.accepted, false);
});

test('failsHardContradiction mirrors the gate reject decision exactly', () => {
  const query = classification({
    values: { work_object: ['software'] },
    concepts: [concept('work_object', 'software_work_object')]
  });
  const contradictingLeaf = classification({
    values: { work_object: ['hardware'] },
    concepts: [concept('work_object', 'hardware_work_object')]
  });
  const compatibleLeaf = classification({
    values: { work_object: ['software'] },
    concepts: [concept('work_object', 'software_work_object')]
  });

  assert.equal(failsHardContradiction(query, contradictingLeaf), true);
  assert.equal(failsHardContradiction(query, compatibleLeaf), false);
});

// -- value normalization: diacritics, apostrophes, case, and plural/singular forms --

test('specializationGate strips diacritics before comparing values', () => {
  const query = classification({ values: { venue: ['café'] } });
  const leaf = classification({ values: { venue: ['cafe'] } });

  assert.equal(specializationGate(query, leaf).judgments[0]?.kind, 'exact_literal');
});

test('specializationGate strips apostrophes and ignores case before comparing values', () => {
  const query = classification({ values: { population: ["Children's"] } });
  const leaf = classification({ values: { population: ['childrens'] } });

  assert.equal(specializationGate(query, leaf).judgments[0]?.kind, 'exact_literal');
});

test('specializationGate treats singular and plural forms of the same value as equivalent', () => {
  const query = classification({ values: { work_object: ['buses'] } });
  const leaf = classification({ values: { work_object: ['bus'] } });

  assert.equal(specializationGate(query, leaf).judgments[0]?.kind, 'exact_literal');
});

test('specializationGate treats singular and plural concept ids for the same object as the same concept', () => {
  const query = classification({
    values: { work_object: ['vehicles'] },
    concepts: [concept('work_object', 'vehicles', ['vehicles'])]
  });
  const leaf = classification({
    values: { work_object: ['vehicle'] },
    concepts: [concept('work_object', 'vehicle', ['vehicle'])]
  });

  const result = specializationGate(query, leaf);

  assert.equal(result.judgments[0]?.kind, 'exact_concept');
  assert.equal(result.decision, 'pass_strict');
});

test('specializationGate preserves words ending in -sis/-ics rather than mis-singularizing them', () => {
  const query = classification({ values: { knowledge_domain: ['electronics'] } });
  const leafSameWord = classification({ values: { knowledge_domain: ['electronics'] } });
  const leafDifferentWord = classification({
    values: { knowledge_domain: ['electronic'] },
    available: { knowledge_domain: ['electronic'] }
  });

  assert.equal(specializationGate(query, leafSameWord).judgments[0]?.kind, 'exact_literal');
  // If "electronics" were stripped down to "electronic" like an ordinary plural, this would wrongly
  // match "electronic" too. It must not: the two stay distinct and this dimension contradicts.
  assert.equal(specializationGate(query, leafDifferentWord).judgments[0]?.kind, 'contradiction');
});

// -- end-to-end integration through the real classifier, on the live schema --

test('specializationGate (real classifier) rejects a work-object mismatch between two concrete occupations', () => {
  const result = specializationGate('software developer', 'hardware developer');

  assert.equal(result.decision, 'reject');
  assert.deepEqual(result.contradictionDimensions, ['work_object']);
  assert.equal(failsHardContradiction('software developer', 'hardware developer'), true);
});

test('specializationGate (real classifier) accepts identical titles at pass_strict', () => {
  const result = specializationGate('software developer', 'software developer');

  assert.equal(result.decision, 'pass_strict');
  assert.deepEqual(result.compatibleDimensions, ['work_object']);
});

test('specializationGate (real classifier) accepts a generic leaf for a more specific query on an unmodeled dimension', () => {
  const result = specializationGate('hospital cook', 'cook');

  assert.deepEqual(result.unknownDimensions, ['venue']);
  assert.equal(result.decision, 'pass_partial');
  assert.equal(result.accepted, true);
});

test('specializationGate (real classifier) rejects two concrete but different venues for the same role', () => {
  const result = specializationGate('hospital cook', 'restaurant cook');

  assert.equal(result.decision, 'reject');
  assert.deepEqual(result.contradictionDimensions, ['venue']);
});

test('specializationGate (real classifier) rejects two concrete but different channels for the same role', () => {
  const result = specializationGate('call centre operator', 'online operator');

  assert.equal(result.decision, 'reject');
  assert.deepEqual(result.contradictionDimensions, ['channel']);
});

test('specializationGate (real classifier) accepts a broader multi-concept query against a leaf naming only one of the concepts', () => {
  const result = specializationGate('software and hardware developer', 'software developer');

  assert.equal(result.decision, 'pass_strict');
  assert.deepEqual(result.compatibleDimensions, ['work_object']);
});

test('specializationGate (real classifier) ignores role_head differences (operator vs manager) that carry the same channel', () => {
  const result = specializationGate('call centre operator', 'call centre manager');

  assert.equal(result.decision, 'pass_strict');
  assert.deepEqual(result.compatibleDimensions, ['channel']);
});

// -- ported from mpx-jobs-ai-search/tools/structural-classifier-check/specialization-gate.spec.ts,
// so this repo's classifier no longer depends on that repo's spec suite to stay covered.

test('specializationGate returns a strict pass when all requested specialization dimensions are covered', () => {
  const result = specializationGate('Freinet school teacher', 'Freinet school teacher');

  assert.equal(result.accepted, true);
  assert.deepEqual(result.compatibleDimensions, ['venue', 'knowledge_domain']);
  assert.deepEqual(result.contradictionDimensions, []);
  assert.equal(result.decision, 'pass_strict');
  assert.deepEqual(result.unknownDimensions, []);
});

test('specializationGate returns a partial pass when a leaf only covers part of the query specialization', () => {
  const result = specializationGate('Freinet school teacher', 'primary school teacher');

  assert.equal(result.accepted, true);
  assert.deepEqual(result.compatibleDimensions, ['venue']);
  assert.deepEqual(result.contradictionDimensions, []);
  assert.equal(result.decision, 'pass_partial');
  assert.deepEqual(result.unknownDimensions, ['knowledge_domain']);
});

test('specializationGate rejects a leaf when the same dimension points to an explicit different specialization', () => {
  const result = specializationGate('software developer', 'sewing machine operator');

  assert.equal(result.accepted, false);
  assert.deepEqual(result.contradictionDimensions, ['work_object']);
  assert.deepEqual(result.equivalentDimensions, []);
  assert.equal(result.decision, 'reject');
  assert.equal(failsHardContradiction('software developer', 'sewing machine operator'), true);
});

test('specializationGate reports unknown when the leaf is missing a requested specialization dimension', () => {
  const result = specializationGate('Freinet school teacher', 'school teacher');

  assert.equal(result.decision, 'pass_partial');
  assert.ok(result.judgments.some((judgment) => judgment.dimension === 'knowledge_domain' && judgment.kind === 'unknown'));
});

test('specializationGate accepts concept-vs-literal alignment through the standard comparison surface', () => {
  const query = 'front-end developer';
  const leaf = classifySpecializationTitle('web developer');

  const result = specializationGate(query, leaf);

  assert.equal(result.accepted, true);
  assert.deepEqual(result.compatibleDimensions, ['work_object']);
  assert.deepEqual(result.contradictionDimensions, []);
  assert.equal(result.decision, 'pass_strict');
  assert.ok(
    result.judgments.some(
      (judgment) =>
        judgment.dimension === 'work_object' && judgment.kind === 'exact_concept' && judgment.matchedValues?.includes('web_work_object')
    )
  );
});

test('specializationGate uses role-head context to avoid treating the same token as the same specialization', () => {
  const result = specializationGate('software developer', 'software seller');

  assert.equal(result.accepted, true);
  assert.deepEqual(result.compatibleDimensions, []);
  assert.deepEqual(result.contradictionDimensions, []);
  assert.equal(result.decision, 'pass_partial');
  assert.deepEqual(result.unknownDimensions, ['work_object']);
  assert.ok(result.judgments.some((judgment) => judgment.dimension === 'work_object' && judgment.kind === 'unknown'));
});

test('specializationGate prefers sales-agent leaves over business leaves for romanian sales-agent queries', () => {
  const romanianSalesAgent = classifySpecializationQuery('Agent de vanzari', { locale: 'ro' });

  const salesAgentResult = specializationGate(romanianSalesAgent, 'railway sales agent');
  assert.equal(salesAgentResult.accepted, true);
  assert.deepEqual(salesAgentResult.contradictionDimensions, []);
  assert.deepEqual(salesAgentResult.equivalentDimensions, []);
  assert.equal(salesAgentResult.decision, 'pass_strict');

  const businessAnalystResult = specializationGate(romanianSalesAgent, 'business analyst');
  assert.equal(businessAnalystResult.accepted, true);
  assert.deepEqual(businessAnalystResult.contradictionDimensions, []);
  assert.deepEqual(businessAnalystResult.equivalentDimensions, []);
  assert.equal(businessAnalystResult.decision, 'pass_partial');
  assert.deepEqual(businessAnalystResult.unknownDimensions, ['task']);
});

test('specializationGate rejects same-family role heads when the leaf carries a different explicit specialization path', () => {
  const travelAgent = specializationGate('travel agent', 'call centre agent');
  assert.equal(travelAgent.accepted, false);
  assert.deepEqual(travelAgent.contradictionDimensions, ['knowledge_domain']);
  assert.equal(travelAgent.decision, 'reject');

  const softwareDeveloper = specializationGate('software developer', 'digital games developer');
  assert.equal(softwareDeveloper.accepted, false);
  assert.deepEqual(softwareDeveloper.contradictionDimensions, ['work_object']);
  assert.equal(softwareDeveloper.decision, 'reject');
});

test('specializationGate keeps same-family leaves when they still cover at least one explicit queried dimension', () => {
  const result = specializationGate('school teacher', 'art teacher secondary school');

  assert.equal(result.accepted, true);
  assert.deepEqual(result.compatibleDimensions, ['venue']);
  assert.deepEqual(result.contradictionDimensions, []);
  assert.deepEqual(result.equivalentDimensions, []);
  assert.equal(result.decision, 'pass_strict');
});

test('specializationGate reports related role-head families reinforced by shared specialization dimensions', () => {
  const softwareResult = specializationGate('software developer', 'software programmer');
  assert.equal(softwareResult.accepted, true);
  assert.equal(softwareResult.decision, 'pass_strict');
  assert.deepEqual(softwareResult.relatedness.reinforcedDimensions, ['work_object']);
  assert.deepEqual(softwareResult.relatedness.reinforcedEquivalentDimensions, []);
  assert.equal(softwareResult.relatedness.roleHead.exact, false);
  assert.equal(softwareResult.relatedness.roleHead.sameFamily, true);
  assert.equal(softwareResult.relatedness.roleHead.strength, 'role_and_dimensions');
  assert.ok(softwareResult.relatedness.roleHead.sharedGroups.includes('software_development'));

  const salesResult = specializationGate('sales representative', 'sales agent');
  assert.equal(salesResult.accepted, true);
  assert.equal(salesResult.decision, 'pass_strict');
  assert.deepEqual(salesResult.relatedness.reinforcedDimensions, ['task']);
  assert.deepEqual(salesResult.relatedness.reinforcedEquivalentDimensions, []);
  assert.equal(salesResult.relatedness.roleHead.exact, false);
  assert.equal(salesResult.relatedness.roleHead.sameFamily, true);
  assert.equal(salesResult.relatedness.roleHead.strength, 'role_and_dimensions');
  assert.ok(salesResult.relatedness.roleHead.sharedGroups.includes('sales_representation'));
});

test('specializationGate softens narrow concept contradictions when canonicals share an equivalence family', () => {
  const result = specializationGate('Customer Support Representative', 'customer service representative');

  assert.equal(result.accepted, true);
  assert.deepEqual(result.compatibleDimensions, ['population']);
  assert.deepEqual(result.contradictionDimensions, []);
  assert.deepEqual(result.equivalentDimensions, ['task']);
  assert.equal(result.decision, 'pass_partial');
  assert.deepEqual(result.unknownDimensions, []);
  assert.equal(failsHardContradiction('Customer Support Representative', 'customer service representative'), false);
});

test('specializationGate still rejects broad contradictions when no concept equivalence family exists', () => {
  const result = specializationGate('Customer Support Representative', 'sales representative');

  assert.equal(result.accepted, false);
  assert.deepEqual(result.compatibleDimensions, []);
  assert.deepEqual(result.contradictionDimensions, ['task']);
  assert.deepEqual(result.equivalentDimensions, []);
  assert.equal(result.decision, 'reject');
});

test('keeps the concept-equivalence inventory materially populated across dimensions', () => {
  const schema = loadSpecializationSchemaFromCsv();
  assert.notEqual(schema, null);

  const covered = new Map<string, string>();
  for (const row of schema?.conceptEquivalences ?? []) {
    for (const conceptId of row.conceptIds) {
      covered.set(conceptId, row.dimension);
    }
  }

  const counts: Record<string, number> = {};
  const totals: Record<string, number> = {};
  for (const concept of schema?.concepts ?? []) {
    const dimensions = new Set<string>((concept.rules ?? []).map((rule) => rule.dimension));
    if (concept.dimension) {
      dimensions.add(concept.dimension);
    }

    for (const dimension of dimensions) {
      totals[dimension] = (totals[dimension] ?? 0) + 1;
      if (covered.get(concept.id) === dimension) {
        counts[dimension] = (counts[dimension] ?? 0) + 1;
      }
    }
  }

  assert.ok((counts.task ?? 0) >= 60);
  assert.ok((counts.knowledge_domain ?? 0) >= 96);
  assert.ok((counts.industry ?? 0) >= 65);
  assert.ok((counts.product ?? 0) >= 112);
  assert.ok((counts.work_object ?? 0) >= 62);
  assert.ok((counts.venue ?? 0) >= 34);
  assert.ok((counts.population ?? 0) >= 35);
  assert.ok((counts.channel ?? 0) >= 13);
  assert.equal(totals.channel, 18);
  assert.equal(totals.population, 42);
});
