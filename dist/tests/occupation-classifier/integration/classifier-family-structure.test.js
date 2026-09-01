import assert from 'node:assert/strict';
import { test } from 'node:test';
import { occupationFamilies } from '../../../src/api/occupation-family-taxonomy.js';
import { LEAF_LEVEL_KINDS } from '../../../src/runtime/occupation-leaf-structure-rules.js';
import { loadOccupationSearchMetaArtifactRequired } from '../../../src/runtime/occupation-search-meta-artifact.js';
import { OccupationRuntimeContext } from '../../../src/runtime/occupation-runtime-context.js';
import { classifyOccupationTitleDebug } from '../../../src/occupation-classifier/index.js';
import { compareFamilyStructureToQuery } from '../../../src/occupation-classifier/family-structure/family-structure-debug.js';
import { rankPromotableLeaves } from '../../../src/occupation-classifier/candidates.js';
import { selectDecision } from '../../../src/occupation-classifier/decision.js';
import { validateFamilies } from '../../../src/occupation-classifier/families.js';
import { buildQueryStructuralProfile } from '../../../src/occupation-classifier/preparation.js';
import { gateFamilyStructureForQuery, getFamilyStructureRules, prepareFamilyStructureQuery, shortlistFamilyStructureMatches, validateFamilyStructureRules } from '../../../src/occupation-classifier/family-structure/family-structure.js';
test('classifier family structure rules cover every taxonomy family exactly once', () => {
    const validation = validateFamilyStructureRules();
    assert.deepEqual(validation.errors, []);
    assert.equal(validation.valid, true);
    const rules = getFamilyStructureRules();
    assert.equal(rules.length, occupationFamilies.length);
    assert.deepEqual(new Set(rules.map((rule) => rule.familyNodeId)), new Set(occupationFamilies.map((family) => family.id)));
});
test('classifier family rules include every leaf-derived role head in their family', async () => {
    const searchMeta = await loadOccupationSearchMetaArtifactRequired('esco_1_2_1');
    const rules = new Map(getFamilyStructureRules().map((rule) => [rule.familyNodeId, rule]));
    const failures = [];
    for (const record of searchMeta.getAllCoreRecords()) {
        if (record.familyNodeId === null || record.graphNodeId === record.familyNodeId) {
            continue;
        }
        const rule = rules.get(record.familyNodeId);
        const profile = buildQueryStructuralProfile(record.canonicalLabel);
        const expectedRoleHeads = profile.profile.role_head.filter((roleHead) => !['professional', 'personnel', 'staff'].includes(roleHead));
        for (const roleHead of expectedRoleHeads) {
            if (!rule?.roleHeads.includes(roleHead)) {
                failures.push(`${record.familyNodeId} ${record.familyLabel}: missing ${roleHead} from ${record.canonicalLabel}`);
            }
        }
    }
    assert.deepEqual(failures, []);
});
test('classifier family rules include every leaf-derived dimension concept in their family', async () => {
    const searchMeta = await loadOccupationSearchMetaArtifactRequired('esco_1_2_1');
    const rules = new Map(getFamilyStructureRules().map((rule) => [rule.familyNodeId, rule]));
    const failures = [];
    for (const record of searchMeta.getAllCoreRecords()) {
        if (record.familyNodeId === null || record.graphNodeId === record.familyNodeId) {
            continue;
        }
        const rule = rules.get(record.familyNodeId);
        const profile = buildQueryStructuralProfile(record.canonicalLabel);
        for (const concept of profile.profile.concepts) {
            if (!rule?.conceptsByDimension.get(concept.dimension)?.includes(concept.conceptId)) {
                failures.push(`${record.familyNodeId} ${record.familyLabel}: missing ${concept.dimension}:${concept.conceptId} from ${record.canonicalLabel}`);
            }
        }
    }
    assert.deepEqual(failures, []);
});
test('classifier family structure reuses existing authority levels', () => {
    const knownLevels = new Set(LEAF_LEVEL_KINDS);
    for (const rule of getFamilyStructureRules()) {
        for (const level of rule.authorityLevels) {
            assert.equal(knownLevels.has(level), true, `${rule.familyNodeId} uses unknown authority level ${level}`);
        }
    }
});
test('classifier family structure rejects domain-only aviation drift for auditor roles', () => {
    const aviation = compareFamilyStructureToQuery(14867, 'Airline Compliance Auditors');
    assert.equal(aviation.familyLabel, 'Ship And Aircraft Controllers And Technicians');
    assert.equal(aviation.decision, 'reject');
    assert.deepEqual(aviation.missingRoleHeads, ['auditor']);
    assert.ok(aviation.reasons.some((reason) => reason.includes('role_head mismatch')));
    const finance = compareFamilyStructureToQuery(14787, 'Airline Compliance Auditors');
    assert.equal(finance.familyLabel, 'Finance Professionals');
    assert.equal(finance.decision, 'accept');
    assert.deepEqual(finance.matchedRoleHeads, ['auditor']);
});
test('classifier family structure uses shared role-head aliases for locale queries', () => {
    for (const query of ['cook', 'bucatar', 'szakács', 'kokk']) {
        const cooks = compareFamilyStructureToQuery(14998, query);
        assert.equal(cooks.familyLabel, 'Cooks');
        assert.equal(cooks.decision, 'accept', query);
        assert.deepEqual(cooks.matchedRoleHeads, ['cook']);
    }
});
test('classifier family structure hard-rejects concrete object mismatch after role match', () => {
    const heavyTruck = compareFamilyStructureToQuery(15215, 'truck driver');
    assert.equal(heavyTruck.familyLabel, 'Heavy Truck And Bus Drivers');
    assert.equal(heavyTruck.decision, 'accept');
    assert.deepEqual(heavyTruck.matchedRoleHeads, ['driver']);
    assert.ok(heavyTruck.matchedConcepts.some((match) => match.dimension === 'work_object' && match.values.includes('truck_work_object')));
    const lightRoad = compareFamilyStructureToQuery(15212, 'truck driver');
    assert.equal(lightRoad.familyLabel, 'Car Van And Motorcycle Drivers');
    assert.equal(lightRoad.decision, 'reject');
    assert.deepEqual(lightRoad.matchedRoleHeads, ['driver']);
    assert.ok(lightRoad.contradictedDimensions.includes('work_object'));
});
test('classifier family structure accepts narrow machine-operator leaf role heads', () => {
    const rubberMachineOperators = compareFamilyStructureToQuery(15180, 'v-belt coverer');
    assert.equal(rubberMachineOperators.familyLabel, 'Rubber Plastic And Paper Products Machine Operators');
    assert.equal(rubberMachineOperators.decision, 'accept');
    assert.deepEqual(rubberMachineOperators.matchedRoleHeads, ['coverer']);
    assert.ok(rubberMachineOperators.matchedConcepts.some((match) => match.dimension === 'work_object' && match.values.includes('v_belt_work_object')));
});
test('classifier family structure does not reject management variants of a matched occupational head', () => {
    const cooks = compareFamilyStructureToQuery(14998, 'head pastry chef');
    assert.equal(cooks.familyLabel, 'Cooks');
    assert.equal(cooks.decision, 'accept');
    assert.deepEqual(cooks.matchedRoleHeads, ['chef']);
    assert.equal(cooks.authorityMatched, true);
});
test('classifier keeps exact narrow leaf when family role head is known', async () => {
    const runtime = await OccupationRuntimeContext.load({
        sourceName: 'esco_1_2_1',
        retrievalBackend: 'binary-cache',
        aliasNgramLocales: ['en', 'ro'],
        leafStructureRuntime: true
    });
    const result = await classifyOccupationTitleDebug({
        query: 'v-belt coverer',
        locale: 'en',
        runtime
    });
    assert.equal(result.runtime.decision.type, 'leaf');
    assert.equal(result.runtime.leaf?.graphNodeId, 18063);
    assert.equal(result.runtime.leaf?.familyNodeId, 15180);
});
test('classifier family structure shortlist exposes accepted and rejected buckets', () => {
    const shortlist = shortlistFamilyStructureMatches('Airline Compliance Auditors');
    assert.ok(shortlist.accepted.some((comparison) => comparison.familyNodeId === 14787));
    assert.ok(shortlist.rejected.some((comparison) => comparison.familyNodeId === 14867));
    assert.equal(shortlist.accepted.some((comparison) => comparison.familyNodeId === 14867), false);
});
test('classifier family structure production gate returns only filter state', () => {
    assert.deepEqual(gateFamilyStructureForQuery(14867, 'Airline Compliance Auditors'), {
        familyNodeId: 14867,
        decision: 'reject'
    });
});
test('classifier family structure prepared query reuses role heads and concepts across family checks', () => {
    const prepared = prepareFamilyStructureQuery('truck driver');
    assert.deepEqual(prepared.roleHeads, ['driver']);
    assert.ok(prepared.conceptIdsByDimension.get('work_object')?.includes('truck_work_object'));
    assert.deepEqual(gateFamilyStructureForQuery(15215, prepared), {
        familyNodeId: 15215,
        decision: 'accept'
    });
    assert.deepEqual(gateFamilyStructureForQuery(15212, prepared), {
        familyNodeId: 15212,
        decision: 'reject'
    });
});
test('classifier family structure resolves locale role-head aliases to the same family role head ids', () => {
    for (const query of ['cook', 'bucatar', 'szakács', 'kokk']) {
        assert.deepEqual(prepareFamilyStructureQuery(query).roleHeads, ['cook'], query);
        assert.equal(gateFamilyStructureForQuery(14998, query).decision, 'accept', query);
    }
    for (const query of ['nurse', 'ápoló', 'õde']) {
        assert.deepEqual(prepareFamilyStructureQuery(query).roleHeads, ['nurse'], query);
        assert.equal(gateFamilyStructureForQuery(14750, query).decision, 'accept', query);
    }
});
test('classifier family validation uses structural filtering without debug payloads', () => {
    const families = validateFamilies({}, new Map([
        [
            1,
            {
                familyNodeId: 14867,
                familyLabel: 'Ship And Aircraft Controllers And Technicians',
                status: 'promotable',
                canonical: {
                    roleResemblanceTier: 'exact',
                    score: 0.8
                }
            }
        ]
    ]), [], { englishTokens: [], modifierTokens: [], unresolvedTokens: [], canonicalExactKeys: [], resolvedRoleHeadTokens: [], localRoleHeadTokens: [] }, buildQueryStructuralProfile('Airline Compliance Auditors'));
    const aviation = families.find((family) => family.familyNodeId === 14867);
    assert.equal(aviation?.structureDecision, 'reject');
    assert.equal('reasons' in (aviation ?? {}), false);
    assert.equal('matchedConcepts' in (aviation ?? {}), false);
});
test('classifier leaf ranking only sees promotable candidates from structurally surviving families', () => {
    const comparisonQuery = { englishTokens: [], modifierTokens: [], unresolvedTokens: [], canonicalExactKeys: [], resolvedRoleHeadTokens: [], localRoleHeadTokens: [] };
    const queryProfile = buildQueryStructuralProfile('Airline Compliance Auditors');
    const candidateLedger = new Map([
        [
            1,
            {
                graphNodeId: 1,
                canonicalLabel: 'pilot',
                familyNodeId: 14867,
                familyLabel: 'Ship And Aircraft Controllers And Technicians',
                status: 'promotable',
                canonical: { score: 0.95, roleResemblanceTier: 'exact' }
            }
        ],
        [
            2,
            {
                graphNodeId: 2,
                canonicalLabel: 'auditor',
                familyNodeId: 14787,
                familyLabel: 'Finance Professionals',
                status: 'near_miss',
                canonical: { score: 0.8, roleResemblanceTier: 'exact' }
            }
        ]
    ]);
    const families = validateFamilies({}, candidateLedger, [], comparisonQuery, queryProfile);
    const rankedLeaves = rankPromotableLeaves(candidateLedger, families);
    const decision = selectDecision(rankedLeaves, families, candidateLedger, comparisonQuery);
    assert.deepEqual(rankedLeaves.map((leaf) => leaf.canonicalLabel), []);
    assert.equal(families.find((family) => family.familyNodeId === 14867)?.structureDecision, 'reject');
    assert.equal(decision.decision.type, 'family');
    assert.equal(decision.selectedFamily?.familyNodeId, 14787);
});
test('classifier keeps sales advisor in a sales family without promoting unsupported specialised leaves', async () => {
    const runtime = await OccupationRuntimeContext.load({
        sourceName: 'esco_1_2_1',
        retrievalBackend: 'binary-cache',
        aliasNgramLocales: ['en', 'ro'],
        leafStructureRuntime: true
    });
    const result = await classifyOccupationTitleDebug({
        query: 'Sales Advisor',
        locale: 'ro',
        runtime
    });
    assert.equal(result.runtime.decision.type, 'family');
    assert.equal(result.runtime.family?.familyNodeId, 14796);
    assert.equal(result.runtime.leaf, null);
    assert.equal(result.familyAssessments.some((family) => family.familyNodeId === 14723 && family.structureDecision !== 'reject'), false);
});
test('classifier maps Romanian goods handler wording to transport and storage labourers', async () => {
    const runtime = await OccupationRuntimeContext.load({
        sourceName: 'esco_1_2_1',
        retrievalBackend: 'binary-cache',
        aliasNgramLocales: ['en', 'ro'],
        leafStructureRuntime: true
    });
    const result = await classifyOccupationTitleDebug({
        query: 'Manipulant Marfa - Bucuresti- Ilfov (f/m)',
        locale: 'ro',
        runtime
    });
    assert.equal(result.runtime.decision.type, 'family');
    assert.equal(result.runtime.family?.familyNodeId, 15251);
    assert.deepEqual(result.familyAssessments.filter((family) => family.structureDecision === 'accept').map((family) => family.familyNodeId), [15251]);
});
test('classifier keeps logistics leader unresolved instead of drifting to armed forces', async () => {
    const runtime = await OccupationRuntimeContext.load({
        sourceName: 'esco_1_2_1',
        retrievalBackend: 'binary-cache',
        aliasNgramLocales: ['en', 'ro'],
        leafStructureRuntime: true
    });
    const result = await classifyOccupationTitleDebug({
        query: 'B2C Logistics Leader',
        locale: 'ro',
        runtime
    });
    assert.equal(result.runtime.decision.type, 'unresolved');
    assert.equal(result.runtime.family, null);
    assert.equal(result.familyAssessments.some((family) => family.familyNodeId === 14659 && family.structureDecision === 'accept'), false);
});
test('classifier uses legal industry support to choose legal professionals for compliance coordinator wording', async () => {
    const runtime = await OccupationRuntimeContext.load({
        sourceName: 'esco_1_2_1',
        retrievalBackend: 'binary-cache',
        aliasNgramLocales: ['en', 'ro'],
        leafStructureRuntime: true
    });
    const result = await classifyOccupationTitleDebug({
        query: 'Legal Counsel - Compliance Coordinator',
        locale: 'ro',
        runtime
    });
    assert.equal(result.runtime.decision.type, 'family');
    assert.equal(result.runtime.family?.familyNodeId, 14814);
    assert.deepEqual(result.familyAssessments.filter((family) => family.structureDecision === 'accept').map((family) => family.familyNodeId), [14814]);
});
