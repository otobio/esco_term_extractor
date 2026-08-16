import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareOccupationRetrievalQuery } from '../../src/query/occupation-retrieval-query.js';
import { prepareQuery } from '../../src/query/query-preparation.js';

const SOURCE = 'esco_1_2_1';

test('query preparation preserves multi-occupation spans as independent contexts', async () => {
  const prepared = await prepareOccupationRetrievalQuery({
    sourceName: SOURCE,
    locale: 'ro',
    originalQuery: 'LUCRATOR COMERCIAL / AJUTOR BUCATAR FAST FOOD'
  });

  assert.deepEqual(prepared.querySpans, ['LUCRATOR COMERCIAL', 'AJUTOR BUCATAR FAST FOOD']);
  assert.equal(prepared.query, 'LUCRATOR COMERCIAL AJUTOR BUCATAR FAST FOOD');
  assert.deepEqual(prepared.keptQuerySignals, ['LUCRATOR COMERCIAL', 'AJUTOR BUCATAR FAST FOOD']);
});

test('query preparation merges slash-separated role plus field fragments before multi-span handling', async () => {
  const prepared = await prepareOccupationRetrievalQuery({
    sourceName: SOURCE,
    locale: 'ro',
    originalQuery: 'Specialist planificare/ logistica'
  });

  assert.deepEqual(prepared.querySpans, ['Specialist planificare logistica']);
  assert.equal(prepared.query, 'Specialist planificare logistica');
  assert.deepEqual(prepared.keptQuerySignals, ['Specialist planificare', 'logistica']);
});

test('query preparation merges slash-separated synonym and specialization fragments into one span', async () => {
  const prepared = await prepareOccupationRetrievalQuery({
    sourceName: SOURCE,
    locale: 'ro',
    originalQuery: 'Antrenor / instructor pentru gimnastica ritmica'
  });

  assert.deepEqual(prepared.querySpans, ['Antrenor instructor pentru gimnastica ritmica']);
});

test('query preparation merges dash-separated role and domain fragments into one span', async () => {
  const prepared = await prepareOccupationRetrievalQuery({
    sourceName: SOURCE,
    locale: 'ro',
    originalQuery: 'Project manager - lucrari constructii'
  });

  assert.deepEqual(prepared.querySpans, ['Project manager - lucrari constructii']);
});

test('query preparation merges department and administrative tails into one span', async () => {
  const departmentPrepared = await prepareOccupationRetrievalQuery({
    sourceName: SOURCE,
    locale: 'ro',
    originalQuery: 'COLECTOR CREANTE DEBITE - DEPARTAMENT SALES SUPPORT'
  });
  assert.deepEqual(departmentPrepared.querySpans, ['COLECTOR CREANTE DEBITE - DEPARTAMENT SALES SUPPORT']);

  const administrativePrepared = await prepareOccupationRetrievalQuery({
    sourceName: SOURCE,
    locale: 'ro',
    originalQuery: 'Asistent Manager Flota & Administrativ'
  });
  assert.deepEqual(administrativePrepared.querySpans, ['Asistent Manager Flota & Administrativ']);
});

test('query preparation merges context prefixes with trailing coordinator roles', async () => {
  const prepared = await prepareOccupationRetrievalQuery({
    sourceName: SOURCE,
    locale: 'ro',
    originalQuery: 'COMMUNITY & EVENTS COORDINATOR'
  });

  assert.deepEqual(prepared.querySpans, ['COMMUNITY & EVENTS COORDINATOR']);
});

test('intent classifier keeps role terms primary and domain terms supporting', async () => {
  const prepared = await prepareQuery('Airline Compliance Auditors', 'en', { sourceName: SOURCE });

  assert.deepEqual(prepared.intent.domainTokens, ['airline']);
  assert.deepEqual(prepared.intent.roleTokens, ['compliance', 'auditors']);
  assert.deepEqual(prepared.intent.roleHeadTokens, ['auditors']);
  assert.ok(prepared.intent.confidence >= 0.8);
});

test('client advisor keeps client inside occupational intent rather than domain context', async () => {
  const prepared = await prepareQuery('Client Advisor', 'en', { sourceName: SOURCE });

  assert.deepEqual(prepared.intent.domainTokens, []);
  assert.ok(prepared.intent.roleTokens.includes('client'));
  assert.ok(prepared.intent.roleTokens.includes('advisor'));
  assert.deepEqual(prepared.intent.roleHeadTokens, ['advisor']);
});

test('acronym preparation preserves acronym token and expands controlled long form', async () => {
  const prepared = await prepareQuery('HVAC technician', 'en', { sourceName: SOURCE });

  assert.deepEqual(prepared.acronymTokens, ['HVAC']);
  assert.ok(prepared.usefulFoldedTokens.includes('HVAC'));
  assert.ok(prepared.usefulFoldedTokens.includes('heating'));
  assert.ok(prepared.usefulFoldedTokens.includes('ventilation'));
  assert.ok(prepared.usefulFoldedTokens.includes('air'));
  assert.ok(prepared.usefulFoldedTokens.includes('conditioning'));
  assert.ok(prepared.intent.roleTokens.includes('technician'));
  assert.deepEqual(prepared.intent.roleHeadTokens, ['technician']);
});

test('job level noise does not dominate useful role tokens', async () => {
  const prepared = await prepareQuery('Senior Data Analyst', 'en', { sourceName: SOURCE });

  assert.ok(prepared.modifierTokens.includes('senior'));
  assert.ok(!prepared.usefulFoldedTokens.includes('senior'));
  assert.ok(prepared.usefulFoldedTokens.includes('data'));
  assert.ok(prepared.usefulFoldedTokens.includes('analyst'));
});

test('direct query preparation does not apply cleaning implicitly', async () => {
  const prepared = await prepareQuery('Cautam colegi pentru Pizza Hut!', 'ro', { sourceName: SOURCE });

  assert.equal(prepared.normalized, 'cautam colegi pentru pizza hut!');
  assert.deepEqual(prepared.tokens, ['cautam', 'colegi', 'pentru', 'pizza', 'hut']);
  assert.ok(prepared.usefulFoldedTokens.includes('pizza'));
});

test('direct query preparation keeps noisy recruiter surfaces unless caller cleans first', async () => {
  const prepared = await prepareQuery('Sales Advisor Nespresso Boutique Afi Cotroceni 8h', 'ro', { sourceName: SOURCE });

  assert.equal(prepared.normalized, 'sales advisor nespresso boutique afi cotroceni 8h');
  assert.ok(prepared.tokens.includes('nespresso'));
  assert.ok(prepared.tokens.includes('cotroceni'));
});

test('safe english lead and principal modifiers peel without dropping the role', async () => {
  const leadPrepared = await prepareQuery('Lead Software Engineer', 'en', { sourceName: SOURCE });
  assert.ok(leadPrepared.modifierTokens.includes('lead'));
  assert.ok(!leadPrepared.usefulFoldedTokens.includes('lead'));
  assert.ok(leadPrepared.usefulFoldedTokens.includes('software'));
  assert.ok(leadPrepared.usefulFoldedTokens.includes('engineer'));

  const principalPrepared = await prepareQuery('Principal Product Designer', 'en', { sourceName: SOURCE });
  assert.ok(principalPrepared.modifierTokens.includes('principal'));
  assert.ok(!principalPrepared.usefulFoldedTokens.includes('principal'));
  assert.ok(principalPrepared.usefulFoldedTokens.includes('product'));
  assert.ok(principalPrepared.usefulFoldedTokens.includes('designer'));
});

test('curated common role phrases canonicalize before fallback heads', async () => {
  const prepared = await prepareQuery('Customer suport ceha sau slovaca', 'en', { sourceName: SOURCE });

  assert.deepEqual(prepared.intent.roleTokens, ['customer', 'support']);
  assert.deepEqual(prepared.intent.roleHeadTokens, ['support']);
  assert.equal(prepared.commonRolePhraseMatch?.canonicalEnglish, 'customer support');
  assert.equal(prepared.commonRolePhraseMatch?.surfaceTokens.join(' ').toLowerCase(), 'customer suport');
});

test('curated common role phrases tolerate a single locale linker token', async () => {
  const prepared = await prepareQuery('Consilier de vânzări', 'ro', { sourceName: SOURCE });

  assert.equal(prepared.commonRolePhraseMatch?.canonicalEnglish, 'specialised sales advisor');
  assert.equal(prepared.commonRolePhraseMatch?.surfaceTokens.join(' ').toLowerCase(), 'consilier de vânzări');
  assert.deepEqual(prepared.intent.roleTokens, ['specialised', 'sales', 'advisor']);
  assert.deepEqual(prepared.intent.roleHeadTokens, ['advisor']);
});

test('reviewed common role phrases anchor repeated market phrases', async () => {
  const prepared = await prepareQuery('Sef depozit', 'ro', { sourceName: SOURCE });

  assert.equal(prepared.commonRolePhraseMatch?.canonicalEnglish, 'warehouse supervisor');
  assert.deepEqual(prepared.intent.roleTokens, ['warehouse', 'supervisor']);
  assert.deepEqual(prepared.intent.roleHeadTokens, ['supervisor']);
  assert.deepEqual(prepared.intent.authoritativeRoleHeadTokens, ['supervisor']);
});

test('venue context stays separate from the role head for generic supervisor queries', async () => {
  const prepared = await prepareQuery('restaurant supervisor', 'en', { sourceName: SOURCE });

  assert.deepEqual(prepared.intent.roleHeadTokens, ['supervisor']);
  assert.deepEqual(prepared.intent.authoritativeRoleHeadTokens, ['supervisor']);
  assert.deepEqual(prepared.intent.venueTokens, ['restaurant']);
  assert.deepEqual(prepared.intent.domainTokens, []);
});

test('bare generic heads stay non-authoritative after query preparation', async () => {
  const prepared = await prepareQuery('manager', 'en', { sourceName: SOURCE });

  assert.deepEqual(prepared.intent.roleHeadTokens, ['manager']);
  assert.deepEqual(prepared.intent.authoritativeRoleHeadTokens, []);
  assert.equal(prepared.intent.roleHeadRequiresContext, true);
  assert.equal(prepared.intent.roleHeadHasContext, false);
});

test('curated family aliases canonicalize low-confidence locale titles', async () => {
  const prepared = await prepareQuery('lucrator depozit', 'ro', { sourceName: SOURCE });

  assert.equal(prepared.commonRolePhraseMatch, null);
  assert.equal(prepared.familyAliasMatch?.canonicalEnglish, 'warehouse worker');
  assert.deepEqual(prepared.intent.roleTokens, ['warehouse', 'worker']);
  assert.deepEqual(prepared.intent.roleHeadTokens, ['worker']);
  assert.deepEqual(prepared.intent.occupationClassPreference.preferredFamilyGroups, []);
});

test('reviewed family alias anchors rescue repeated market family wording', async () => {
  const prepared = await prepareQuery('Depozit marfa', 'ro', { sourceName: SOURCE });

  assert.equal(prepared.familyAliasMatch?.canonicalEnglish, 'warehouse worker');
  assert.deepEqual(prepared.intent.roleTokens, ['warehouse', 'worker']);
  assert.deepEqual(prepared.intent.roleHeadTokens, ['worker']);
  assert.deepEqual(prepared.intent.authoritativeRoleHeadTokens, ['worker']);
});

test('domain context keeps generic heads authoritative after query preparation', async () => {
  const prepared = await prepareQuery('airline manager', 'en', { sourceName: SOURCE });

  assert.deepEqual(prepared.intent.domainTokens, ['airline']);
  assert.deepEqual(prepared.intent.roleHeadTokens, ['manager']);
  assert.deepEqual(prepared.intent.authoritativeRoleHeadTokens, ['manager']);
  assert.equal(prepared.intent.roleHeadHasContext, true);
});

test('role modifiers keep generic heads authoritative after query preparation', async () => {
  const prepared = await prepareQuery('project manager', 'en', { sourceName: SOURCE });

  assert.deepEqual(prepared.intent.roleTokens, ['project', 'manager']);
  assert.deepEqual(prepared.intent.roleHeadTokens, ['manager']);
  assert.deepEqual(prepared.intent.authoritativeRoleHeadTokens, ['manager']);
  assert.equal(prepared.intent.roleHeadHasContext, true);
});

test('new repeated retail and shift phrases canonicalize structurally', async () => {
  const storePrepared = await prepareQuery('Director de magazin', 'ro', { sourceName: SOURCE });
  assert.equal(storePrepared.commonRolePhraseMatch?.canonicalEnglish, 'store manager');
  assert.deepEqual(storePrepared.intent.occupationClassPreference.preferredFamilyGroups, ['executive']);

  const shiftPrepared = await prepareQuery('Sef de tura', 'ro', { sourceName: SOURCE });
  assert.equal(shiftPrepared.commonRolePhraseMatch?.canonicalEnglish, 'shift supervisor');
});

test('new repeated industrial and service phrases canonicalize structurally', async () => {
  const cncPrepared = await prepareQuery('Programator CNC', 'ro', { sourceName: SOURCE });
  assert.equal(cncPrepared.commonRolePhraseMatch?.canonicalEnglish, 'CNC programmer');

  const plumberPrepared = await prepareQuery('Instalator sanitar', 'ro', { sourceName: SOURCE });
  assert.equal(plumberPrepared.commonRolePhraseMatch?.canonicalEnglish, 'plumber');

  const programmePrepared = await prepareQuery('Manager program', 'ro', { sourceName: SOURCE });
  assert.equal(programmePrepared.commonRolePhraseMatch?.canonicalEnglish, 'programme manager');

  const assemblerPrepared = await prepareQuery('Operator montaj', 'ro', { sourceName: SOURCE });
  assert.equal(assemblerPrepared.commonRolePhraseMatch?.canonicalEnglish, 'assembler');

  const handlerPrepared = await prepareQuery('Manipulant marfa', 'ro', { sourceName: SOURCE });
  assert.equal(handlerPrepared.commonRolePhraseMatch?.canonicalEnglish, 'material handler');
});

test('Hungarian and Estonian management phrases canonicalize structurally', async () => {
  const hungarianPrepared = await prepareQuery('projekt menedzser', 'hu', { sourceName: SOURCE });
  assert.equal(hungarianPrepared.commonRolePhraseMatch?.canonicalEnglish, 'project manager');
  assert.deepEqual(hungarianPrepared.intent.occupationClassPreference.preferredFamilyGroups, ['executive']);

  const estonianPrepared = await prepareQuery('poe juht', 'et', { sourceName: SOURCE });
  assert.equal(estonianPrepared.commonRolePhraseMatch?.canonicalEnglish, 'store manager');
  assert.deepEqual(estonianPrepared.intent.occupationClassPreference.preferredFamilyGroups, ['executive']);
});

test('romanian token expansion supports repeated gender, plural, and synonym variants', async () => {
  const accountantPrepared = await prepareQuery('contabile', 'ro', { sourceName: SOURCE });
  assert.ok(accountantPrepared.expandedFoldedTokens.includes('contabil'));
  assert.ok(accountantPrepared.intent.roleHeadTokens.length > 0);

  const developerPrepared = await prepareQuery('dezvoltatoare software', 'ro', { sourceName: SOURCE });
  assert.ok(developerPrepared.expandedFoldedTokens.includes('dezvoltator'));
  assert.ok(developerPrepared.intent.roleTokens.length > 0);
  assert.deepEqual(developerPrepared.intent.occupationClassPreference.preferredFamilyGroups, []);

  const forkliftPrepared = await prepareQuery('stivuitorist', 'ro', { sourceName: SOURCE });
  assert.ok(forkliftPrepared.expandedFoldedTokens.includes('forklift'));

  const doctorPrepared = await prepareQuery('medici cardiologie', 'ro', { sourceName: SOURCE });
  assert.ok(doctorPrepared.expandedFoldedTokens.includes('doctor'));
  assert.ok(doctorPrepared.intent.roleHeadTokens.length > 0);
});

test('english generic fallback keeps the rightmost useful token as head', async () => {
  const prepared = await prepareQuery('software data', 'en', { sourceName: SOURCE });

  assert.deepEqual(prepared.intent.roleTokens, ['data']);
  assert.deepEqual(prepared.intent.roleHeadTokens, ['data']);
  assert.deepEqual(prepared.intent.unresolvedModifierTokens, ['software']);
});

test('romanian generic fallback prefers the leftmost useful token', async () => {
  const prepared = await prepareQuery('depozit helperx', 'ro', { sourceName: SOURCE });

  assert.deepEqual(prepared.intent.roleTokens, ['depozit']);
  assert.deepEqual(prepared.intent.roleHeadTokens, ['depozit']);
  assert.deepEqual(prepared.intent.unresolvedModifierTokens, ['helperx']);
});

test('hungarian generic fallback prefers the leftmost useful token', async () => {
  const prepared = await prepareQuery('depozit raktar', 'hu', { sourceName: SOURCE });

  assert.deepEqual(prepared.intent.roleTokens, ['depozit']);
  assert.deepEqual(prepared.intent.roleHeadTokens, ['depozit']);
  assert.deepEqual(prepared.intent.venueTokens, ['raktar']);
});

test('ordered frame markers prefer the higher generic head when stacked', async () => {
  const prepared = await prepareQuery('assistant manager', 'en', { sourceName: SOURCE });

  assert.deepEqual(prepared.intent.roleHeadTokens, ['manager']);
  assert.ok(prepared.intent.roleTokens.includes('assistant'));
  assert.ok(prepared.intent.roleTokens.includes('manager'));
});

test('clean occupation titles stay out of the ambiguous phrase atlas', async () => {
  const prepared = await prepareQuery('software developer', 'en', { sourceName: SOURCE });

  assert.equal(prepared.commonRolePhraseMatch, null);
});
