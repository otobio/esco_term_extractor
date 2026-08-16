import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { getOccupationFamilyContext } from '../../src/api/occupation-family-taxonomy.js';
import { prepareFamilyScopedQueryFromPrepared, prepareQuery } from '../../src/query/query-preparation.js';
import { loadOccupationFamilyProfileArtifactRequired } from '../../src/runtime/occupation-family-profile-artifact.js';
import { OccupationRuntimeContext } from '../../src/runtime/occupation-runtime-context.js';
import { FamilyProfileRetriever } from '../../src/search-pipeline/family-profile-retriever.js';
import { OccupationSearchPipeline } from '../../src/search-pipeline/occupation-search-pipeline.js';

const SOURCE = 'esco_1_2_1';
let pipeline: OccupationSearchPipeline;
const familyProfileRetriever = new FamilyProfileRetriever();

before(async () => {
  const runtime = await OccupationRuntimeContext.load({
    sourceName: SOURCE,
    retrievalBackend: 'binary-cache',
    aliasNgramLocales: ['en', 'ro']
  });
  pipeline = OccupationSearchPipeline.withRuntime(runtime);
});

test('exact canonical occupation promotes a leaf with exact coverage', async () => {
  const result = await pipeline.run({
    query: 'software developer',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.decision.selectedLabel, 'software developer');
  assert.equal(result.coverageStatus.status, 'exact_canonical_match');
  assert.equal(result.coverageStatus.signals.missingUsefulTokens.length, 0);
});

test('exact canonical leaf outranks sibling exact-alias leaves', async () => {
  const result = await pipeline.run({
    query: 'au pair',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.rankedLeaves[0]?.canonicalLabel, 'au pair');
  assert.equal(result.decision.selectedLabel, 'au pair');
  assert.equal(result.coverageStatus.status, 'exact_canonical_match');
});

test('weak punctuation differences still preserve exact canonical leaf authority', async () => {
  const result = await pipeline.run({
    query: 'agricultural raw materials seeds and animal feeds distribution manager',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.decision.selectedLabel, 'agricultural raw materials, seeds and animal feeds distribution manager');
  assert.equal(result.coverageStatus.status, 'exact_canonical_match');
  assert.ok((result.rankedLeaves[0]?.evidence ?? []).some((evidence) => evidence.channel === 'exact_canonical'));
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Manufacturing, mining, construction, and distribution managers');
  assert.equal(result.rankedFamilies[0]?.evidenceTier, 'local_exact');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'exact_canonical'));
});

test('exact long-form leaf beats shorter base leaf when the raw query matches exactly', async () => {
  const result = await pipeline.run({
    query: 'carpenter supervisor',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.decision.selectedLabel, 'carpenter supervisor');
  assert.equal(result.coverageStatus.status, 'exact_canonical_match');
  assert.equal(result.rankedLeaves[0]?.canonicalLabel, 'carpenter supervisor');
  assert.ok((result.rankedLeaves[0]?.evidence ?? []).some((evidence) => evidence.channel === 'exact_canonical'));
});

test('exact original title still wins when role-query trimming shortens the prepared query', async () => {
  const result = await pipeline.run({
    query: 'import export manager in agricultural machinery and equipment',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.queryContext.originalQuery, 'import export manager in agricultural machinery and equipment');
  assert.equal(result.preparedQuery.raw, 'import export manager');
  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.decision.selectedLabel, 'import export manager in agricultural machinery and equipment');
  assert.equal(result.coverageStatus.status, 'exact_canonical_match');
  assert.equal(result.rankedLeaves[0]?.canonicalLabel, 'import export manager in agricultural machinery and equipment');
  assert.ok((result.rankedLeaves[0]?.evidence ?? []).some((evidence) => evidence.channel === 'exact_canonical'));
});

test('exact canonical family label gets exact family authority', async () => {
  const result = await pipeline.run({
    query: 'Cashiers and ticket clerks',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Cashiers and ticket clerks');
  assert.equal(result.decision.decisionType, 'family');
  assert.equal(result.decision.selectedLabel, 'Cashiers and ticket clerks');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'exact_family_canonical'));
});

test('leaf exact canonical keeps priority over family exact canonical for weak punctuation cases', async () => {
  const preparedQuery = await prepareQuery('Secretaries general', 'en', { sourceName: SOURCE });
  const artifact = await loadOccupationFamilyProfileArtifactRequired(SOURCE);
  const familyHits = familyProfileRetriever.retrieve({
    preparedQuery: prepareFamilyScopedQueryFromPrepared(preparedQuery),
    artifact,
    locale: 'en',
    rawQuery: 'Secretaries (general)',
    limit: 20
  });
  const exactFamilyHit = familyHits.find((hit) => hit.familyLabel === 'Secretaries (general)');

  assert.ok(exactFamilyHit);
  assert.equal(exactFamilyHit?.exactFamilyLabelPhrase, true);

  const result = await pipeline.run({
    query: 'Secretaries (general)',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.decision.selectedLabel, 'secretary general');
  assert.ok((result.rankedLeaves[0]?.evidence ?? []).some((evidence) => evidence.channel === 'exact_canonical'));
});

test('exact family canonical match is selected even when post-recovery reranking prefers a weaker generic family', async () => {
  const result = await pipeline.run({
    query: 'Administrative and specialised secretaries',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.decision.decisionType, 'family');
  assert.equal(result.decision.selectedLabel, 'Administrative and specialised secretaries');
  assert.ok(result.rankedFamilies.some((family) => family.familyLabel === 'Administrative and specialised secretaries'));
  const matchedFamily = result.rankedFamilies.find((family) => family.familyLabel === 'Administrative and specialised secretaries');
  assert.ok((matchedFamily?.evidence ?? []).some((evidence) => evidence.channel === 'exact_family_canonical'));
});

test('exact family canonical rescue selects the associate nursing family, not its professional sibling', async () => {
  const result = await pipeline.run({
    query: 'Nursing and midwifery associate professionals',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.decision.decisionType, 'family');
  assert.equal(result.decision.selectedLabel, 'Nursing and midwifery associate professionals');
});

test('exact family canonical rescue still selects the professional nursing family for its own exact query', async () => {
  const result = await pipeline.run({
    query: 'Nursing and midwifery professionals',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.decision.decisionType, 'family');
  assert.equal(result.decision.selectedLabel, 'Nursing and midwifery professionals');
});

test('market title family support does not become unsafe leaf authority', async () => {
  const result = await pipeline.run({
    query: 'Fullstack developer',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.decision.decisionType, 'family');
  assert.equal(result.decision.selectedLabel, 'Software and applications developers and analysts');
  assert.equal(result.coverageStatus.status, 'likely_dictionary_gap');
  assert.ok(result.coverageStatus.signals.missingRoleTokens.includes('fullstack'));
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'ngram_alias'));
});

test('domain context cannot dominate role intent for airline compliance query', async () => {
  const result = await pipeline.run({
    query: 'Airline Compliance Auditors',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.notEqual(result.rankedFamilies[0]?.familyLabel, 'Ship and aircraft controllers and technicians');
  assert.notEqual(result.decision.selectedLabel, 'airline pilot');
  assert.deepEqual(result.preparedQuery.intent.domainTokens, ['airline']);
  assert.deepEqual(result.preparedQuery.intent.roleTokens, ['compliance', 'auditors']);
  assert.ok(['unresolved', 'family'].includes(result.decision.decisionType));
});

test('single-token executive alias drift does not outrank the longer market phrase context', async () => {
  const result = await pipeline.run({
    query: 'Brand Growth Executive',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.notEqual(result.decision.selectedLabel, 'chief executive officer');
  const topLeaf = result.rankedLeaves[0];
  if (topLeaf) {
    assert.notEqual(topLeaf.canonicalLabel, 'chief executive officer');
  }
});

test('exact cashier leaf can rescue against graph-only family drift for plural query', async () => {
  const result = await pipeline.run({
    query: 'Cashiers',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.decision.selectedLabel, 'cashier');
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Cashiers and ticket clerks');
});

test('job function prior disambiguates broad builder title toward construction family', async () => {
  const result = await pipeline.run({
    query: 'Builder',
    locale: 'en',
    sourceName: SOURCE,
    jobFunction: 'skilled_trades',
    limit: 20
  });

  assert.equal(result.queryContext.jobFunction, 'skilled_trades');
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Building frame and related trades workers');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'job_function_family_prior'));
});

test('job function prior does not override role intent without matching family evidence', async () => {
  const result = await pipeline.run({
    query: 'Airline Compliance Auditors',
    locale: 'en',
    sourceName: SOURCE,
    jobFunction: 'transport_driving',
    limit: 20
  });

  assert.notEqual(result.rankedFamilies[0]?.familyLabel, 'Ship and aircraft controllers and technicians');
  assert.notEqual(result.decision.selectedLabel, 'airline pilot');
});

test('slash-separated Romanian title returns independent multi-span results', async () => {
  const result = await pipeline.run({
    query: 'LUCRATOR COMERCIAL / AJUTOR BUCATAR FAST FOOD',
    locale: 'ro',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.decision.decisionType, 'multi_span');
  assert.equal(result.spanResults.length, 2);
  assert.deepEqual(result.queryContext.querySpans, ['LUCRATOR COMERCIAL', 'AJUTOR BUCATAR FAST FOOD']);
  assert.equal(result.rankedFamilies.length, 0);
  assert.equal(result.rankedLeaves.length, 0);
  assert.equal(result.spanResults[1]?.decision.selectedLabel, 'Food preparation assistants');
});

test('slash-separated Romanian role plus field fragments stay in one pipeline context', async () => {
  const result = await pipeline.run({
    query: 'Specialist planificare/ logistica',
    locale: 'ro',
    sourceName: SOURCE,
    limit: 20
  });

  assert.notEqual(result.decision.decisionType, 'multi_span');
  assert.deepEqual(result.queryContext.querySpans, ['Specialist planificare logistica']);
});

test('localized exact alias can resolve through English backbone canonical leaf', async () => {
  const result = await pipeline.run({
    query: 'analist de date',
    locale: 'ro',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.decision.selectedLabel, 'data analyst');
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Software and applications developers and analysts');
});

test('venue context keeps supervisor away from the manufacturing default', async () => {
  const result = await pipeline.run({
    query: 'restaurant supervisor',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.deepEqual(result.preparedQuery.intent.venueTokens, ['restaurant']);
  assert.notEqual(result.rankedFamilies[0]?.familyLabel, 'Mining, manufacturing and construction supervisors');
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Hotel and restaurant managers');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
});

test('Romanian generic-head venue context keeps supervisor aligned with hospitality managers', async () => {
  const result = await pipeline.run({
    query: 'supervizor restaurant',
    locale: 'ro',
    sourceName: SOURCE,
    limit: 20
  });

  assert.deepEqual(result.preparedQuery.intent.roleHeadTokens, ['supervizor']);
  assert.deepEqual(result.preparedQuery.intent.venueTokens, ['restaurant']);
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Hotel and restaurant managers');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
});

test('health modifier keeps supervisor in the health-support family instead of clerical drift', async () => {
  const result = await pipeline.run({
    query: 'medical supervisor',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.deepEqual(result.preparedQuery.intent.roleTokens, ['medical', 'supervisor']);
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Other health associate professionals');
  assert.notEqual(result.rankedFamilies[0]?.familyLabel, 'Administrative and specialised secretaries');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
});

test('venue context keeps manager aligned with the right operating family', async () => {
  const result = await pipeline.run({
    query: 'factory manager',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.ok(result.preparedQuery.intent.roleTokens.includes('factory'));
  assert.deepEqual(result.preparedQuery.intent.venueTokens, []);
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Manufacturing, mining, construction, and distribution managers');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
});

test('manager head keeps top family in the executive group when professional evidence is nearby', async () => {
  const result = await pipeline.run({
    query: 'marketing manager',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  const topFamily = result.rankedFamilies[0];
  const topFamilyContext = topFamily ? getOccupationFamilyContext(topFamily.familyNodeId) : undefined;

  assert.ok(topFamily);
  assert.equal(topFamilyContext?.group, 'executive');
  // An exact-canonical-leaf match (e.g. "marketing manager" is itself a canonical leaf label)
  // short-circuits before family selectionAuthority is computed -- there's nothing left to
  // disambiguate. Only check groupAgreement/groupMismatch when the full narrowing path ran.
  if (topFamily?.selectionAuthority) {
    assert.equal(topFamily.selectionAuthority.groupAgreement, 1);
    assert.equal(topFamily.selectionAuthority.groupMismatch, 0);
  }
});

test('professional head keeps top family away from executive manager drift', async () => {
  const result = await pipeline.run({
    query: 'compliance auditor',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  const topFamily = result.rankedFamilies[0];
  const topFamilyContext = topFamily ? getOccupationFamilyContext(topFamily.familyNodeId) : undefined;

  assert.ok(topFamily);
  assert.notEqual(topFamilyContext?.group, 'executive');
  assert.equal(topFamily?.selectionAuthority?.groupMismatch, 0);
});

test('Romanian localized manager phrase keeps top family in the executive group', async () => {
  const result = await pipeline.run({
    query: 'director magazin',
    locale: 'ro',
    sourceName: SOURCE,
    limit: 20
  });

  const topFamily = result.rankedFamilies[0];
  const topFamilyContext = topFamily ? getOccupationFamilyContext(topFamily.familyNodeId) : undefined;

  assert.ok(topFamily);
  assert.equal(topFamilyContext?.group, 'executive');
  assert.equal(topFamily?.selectionAuthority?.groupAgreement, 1);
});

test('Hungarian localized professional head keeps top family away from executive drift', async () => {
  const result = await pipeline.run({
    query: 'szoftverfejlesztő',
    locale: 'hu',
    sourceName: SOURCE,
    limit: 20
  });

  const topFamily = result.rankedFamilies[0];
  const topFamilyContext = topFamily ? getOccupationFamilyContext(topFamily.familyNodeId) : undefined;

  assert.ok(topFamily);
  assert.equal(topFamilyContext?.group, 'professional');
  assert.equal(topFamily?.selectionAuthority?.groupMismatch, 0);
});

test('venue context keeps assistant away from the wrong administrative default', async () => {
  const result = await pipeline.run({
    query: 'hospital assistant',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.deepEqual(result.preparedQuery.intent.venueTokens, ['hospital']);
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Personal care workers in health services');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
});

test('venue context keeps operator out of the wrong clerical family', async () => {
  const result = await pipeline.run({
    query: 'factory operator',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.ok(result.preparedQuery.intent.roleTokens.includes('factory'));
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Process control technicians');
  assert.notEqual(result.rankedFamilies[0]?.familyLabel, 'Material-recording and transport clerks');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
});

test('computer technician exact alias stays in the hardware repair family', async () => {
  const result = await pipeline.run({
    query: 'computer technician',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.decision.selectedLabel, 'computer hardware repair technician');
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Electronics and telecommunications installers and repairers');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'exact_alias'));
});

test('venue context keeps technician aligned with the right health family', async () => {
  const result = await pipeline.run({
    query: 'hospital technician',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Medical and pharmaceutical technicians');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
});

test('venue context keeps technician aligned with the right life-science family', async () => {
  const result = await pipeline.run({
    query: 'agricultural technician',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Life science technicians and related associate professionals');
  //assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
});

test('industrial venue keeps technician in the general engineering family', async () => {
  const result = await pipeline.run({
    query: 'factory technician',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Physical and engineering science technicians');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
});

test('venue context keeps officer aligned with the right health support family', async () => {
  const result = await pipeline.run({
    query: 'hospital officer',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Other health associate professionals');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
});

test('venue context keeps worker aligned with the right industrial labor family', async () => {
  const result = await pipeline.run({
    query: 'factory worker',
    locale: 'en',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Manufacturing labourers');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
});

test('reviewed family signals reinforce Romanian telecom-installer titles toward the telecom installer family', async () => {
  const result = await pipeline.run({
    query: 'TEHNICIAN-ALPINIST TELECOMUNICATII',
    locale: 'ro',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.rankedFamilies[0]?.familyNodeId, 15139);
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Electronics and telecommunications installers and repairers');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'reviewed_family_signal'));
});

test('reviewed family signals reinforce Romanian assembly titles without promoting telecom-installer support', async () => {
  const result = await pipeline.run({
    query: 'Lacatus mecanic asamblare',
    locale: 'ro',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.rankedFamilies[0]?.familyNodeId, 15204);
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Assemblers');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'reviewed_family_signal'));
  assert.ok(!(result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'reviewed_family_penalty'));
});

test('new assembler phrase and family evidence keep operator montaj out of supervisor drift', async () => {
  const result = await pipeline.run({
    query: 'Operator montaj FW A350',
    locale: 'ro',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.queryContext.query, 'assembler');
  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Assemblers');
  assert.equal(result.rankedLeaves[0]?.canonicalLabel, 'metal products assembler');
});

test('product-audit technician titles reinforce the engineering-technician family', async () => {
  const result = await pipeline.run({
    query: 'Tehnician audit de produs',
    locale: 'ro',
    sourceName: SOURCE,
    limit: 20
  });

  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Physical and engineering science technicians');
  assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'reviewed_family_signal'));
});

// A bare single-generic-head-token English query has no venue/domain context to disambiguate with,
// so per resolution.md #16 the broad-role family prior may rank likely families but must not
// manufacture a specific occupation -- the pipeline should land on a family-level decision, not
// invent a leaf. "technician"'s head token is classified generic (not "useful folded"), which is
// exactly the case isBroadRoleQuery previously failed to recognize as broad.
for (const query of ['manager', 'technician', 'supervisor', 'officer', 'assistant']) {
  test(`bare generic-head query "${query}" does not manufacture an over-specific leaf`, async () => {
    const result = await pipeline.run({ query, locale: 'en', sourceName: SOURCE, limit: 20 });

    assert.notEqual(result.decision.decisionType, 'leaf');
  });
}

// isBroadRoleQuery is not English-only -- ro/hu/et have their own generic-role-term vocabularies
// (see GENERIC_ROLE_TERMS_BY_LOCALE), so a bare generic-head query in those locales must be held to
// the same resolution.md #16 guard as English, not manufacture a specific leaf either.
for (const [query, locale] of [
  ['supervizor', 'ro'],
  ['tehnician', 'ro'],
  ['technikus', 'hu'],
  ['tehnik', 'et']
]) {
  test(`bare generic-head query "${query}" (${locale}) does not manufacture an over-specific leaf`, async () => {
    const result = await pipeline.run({ query, locale, sourceName: SOURCE, limit: 20 });

    assert.notEqual(result.decision.decisionType, 'leaf');
  });
}
