import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { getOccupationFamilyContext } from '../../api/occupation-family-taxonomy.js';
import { OccupationRuntimeContext } from '../../runtime/occupation-runtime-context.js';
import { OccupationSearchPipeline } from '../../search-pipeline/occupation-search-pipeline.js';
const SOURCE = 'esco_1_2_1';
let pipeline;
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
    assert.equal(topFamily?.selectionAuthority?.groupAgreement, 1);
    assert.equal(topFamily?.selectionAuthority?.groupMismatch, 0);
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
    assert.ok((result.rankedFamilies[0]?.evidence ?? []).some((evidence) => evidence.channel === 'generic_head_family_prior'));
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
