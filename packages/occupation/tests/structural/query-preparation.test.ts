import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareOccupationRetrievalQuery } from '../../src/query/occupation-retrieval-query.js';
import {
  prepareQuery,
  preparedQueryNormalizedRecallSurfaces,
  preparedQueryNormalizedRecallTokenSequences,
  preparedQueryFoldedRecallSurfaces,
  preparedQueryFoldedRecallTokenSequences,
  preparedQueryUsefulFoldedRecallTokenSequences,
  preparedQueryUsefulNormalizedRecallTokenSequences
} from '../../src/query/query-preparation.js';

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

test('capability verb seeds use locale-specific agent-noun morphology instead of english heuristics', async () => {
  const romanian = await prepareQuery('vanzator', 'ro', { sourceName: SOURCE });
  assert.deepEqual(romanian.capabilityVerbFoldedAdditionTokens, ['vanzator', 'vanza']);

  const hungarian = await prepareQuery('elado', 'hu', { sourceName: SOURCE });
  assert.deepEqual(hungarian.capabilityVerbFoldedAdditionTokens, ['elado', 'elad']);

  const estonian = await prepareQuery('muuja', 'et', { sourceName: SOURCE });
  assert.deepEqual(estonian.capabilityVerbFoldedAdditionTokens, ['muuja', 'muu', 'muuma']);

  // "operator" happens to end in the english "-or" agent suffix, but for a Hungarian query it
  // must not be mangled into english fragments like "operat"/"operating".
  const borrowedWord = await prepareQuery('operator', 'hu', { sourceName: SOURCE });
  assert.deepEqual(borrowedWord.capabilityVerbFoldedAdditionTokens, ['operator']);
});

test('acronym preparation preserves acronym token and expands controlled long form', async () => {
  const prepared = await prepareQuery('HVAC technician', 'en', { sourceName: SOURCE });

  assert.deepEqual(prepared.acronymTokens, ['HVAC']);
  assert.ok(prepared.usefulFoldedRecallTokens.includes('HVAC'));
  assert.ok(prepared.usefulFoldedRecallTokens.includes('heating'));
  assert.ok(prepared.usefulFoldedRecallTokens.includes('ventilation'));
  assert.ok(prepared.usefulFoldedRecallTokens.includes('air'));
  assert.ok(prepared.usefulFoldedRecallTokens.includes('conditioning'));
  assert.ok(prepared.intent.roleTokens.includes('technician'));
  assert.deepEqual(prepared.intent.roleHeadTokens, ['technician']);
});

test('job level noise does not dominate useful role tokens', async () => {
  const prepared = await prepareQuery('Senior Data Analyst', 'en', { sourceName: SOURCE });

  assert.ok(prepared.modifierTokens.includes('senior'));
  assert.ok(!prepared.usefulFoldedRecallTokens.includes('senior'));
  assert.ok(prepared.usefulFoldedRecallTokens.includes('data'));
  assert.ok(prepared.usefulFoldedRecallTokens.includes('analyst'));
});

test('direct query preparation does not apply cleaning implicitly', async () => {
  const prepared = await prepareQuery('Cautam colegi pentru Pizza Hut!', 'ro', { sourceName: SOURCE });

  assert.equal(prepared.normalized, 'cautam colegi pentru pizza hut!');
  assert.deepEqual(prepared.tokens, ['cautam', 'colegi', 'pentru', 'pizza', 'hut']);
  assert.ok(prepared.usefulFoldedRecallTokens.includes('pizza'));
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
  assert.ok(!leadPrepared.usefulFoldedRecallTokens.includes('lead'));
  assert.ok(leadPrepared.usefulFoldedRecallTokens.includes('software'));
  assert.ok(leadPrepared.usefulFoldedRecallTokens.includes('engineer'));

  const principalPrepared = await prepareQuery('Principal Product Designer', 'en', { sourceName: SOURCE });
  assert.ok(principalPrepared.modifierTokens.includes('principal'));
  assert.ok(!principalPrepared.usefulFoldedRecallTokens.includes('principal'));
  assert.ok(principalPrepared.usefulFoldedRecallTokens.includes('product'));
  assert.ok(principalPrepared.usefulFoldedRecallTokens.includes('designer'));
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

test('query preparation carries additive compound-expanded variants for Hungarian mixed queries', async () => {
  const prepared = await prepareQuery('senior projektvezeto', 'hu', { sourceName: SOURCE });

  assert.equal(prepared.normalized, 'senior projektvezeto');
  assert.deepEqual(prepared.foldedTokens, ['senior', 'projektvezeto']);
  assert.deepEqual(prepared.compoundExpandedTokens, ['senior', 'projekt', 'vezeto']);
  assert.deepEqual(prepared.compoundExpandedFoldedTokens, ['senior', 'projekt', 'vezeto']);
  assert.deepEqual(preparedQueryNormalizedRecallSurfaces(prepared), ['senior projektvezeto', 'senior projekt vezeto']);
  assert.ok(preparedQueryFoldedRecallSurfaces(prepared).includes('senior projekt vezeto'));
  assert.deepEqual(preparedQueryNormalizedRecallTokenSequences(prepared), [prepared.tokens, prepared.compoundExpandedTokens]);
  assert.ok(preparedQueryFoldedRecallTokenSequences(prepared).some((tokens) => tokens.join(' ') === 'senior projekt vezeto'));
  assert.deepEqual(preparedQueryUsefulNormalizedRecallTokenSequences(prepared), [
    prepared.usefulRecallTokens,
    ['projekt', 'vezeto']
  ]);
  assert.deepEqual(preparedQueryUsefulFoldedRecallTokenSequences(prepared), [
    prepared.usefulFoldedRecallTokens,
    ['projekt', 'vezeto']
  ]);
  assert.ok(prepared.usefulFoldedRecallTokens.includes('projektvezeto'));
  assert.ok(prepared.usefulFoldedRecallTokens.includes('projekt'));
  assert.ok(prepared.usefulFoldedRecallTokens.includes('vezeto'));
});

test('non compound english queries keep compound-expanded variants empty', async () => {
  const prepared = await prepareQuery('software developer', 'en', { sourceName: SOURCE });

  assert.deepEqual(prepared.compoundExpandedTokens, []);
  assert.deepEqual(preparedQueryNormalizedRecallSurfaces(prepared), [prepared.normalized]);
  assert.deepEqual(preparedQueryNormalizedRecallTokenSequences(prepared), [prepared.tokens]);
  assert.deepEqual(preparedQueryFoldedRecallTokenSequences(prepared), [prepared.foldedTokens]);
  assert.deepEqual(preparedQueryUsefulNormalizedRecallTokenSequences(prepared), [prepared.usefulRecallTokens]);
  assert.deepEqual(preparedQueryUsefulFoldedRecallTokenSequences(prepared), [prepared.usefulFoldedRecallTokens]);
});

test('romanian token expansion supports repeated gender, plural, and synonym variants', async () => {
  const accountantPrepared = await prepareQuery('contabile', 'ro', { sourceName: SOURCE });
  assert.ok(accountantPrepared.usefulFoldedVariantTokens.includes('contabil'));
  assert.ok(accountantPrepared.intent.roleHeadTokens.length > 0);

  const developerPrepared = await prepareQuery('dezvoltatoare software', 'ro', { sourceName: SOURCE });
  assert.ok(developerPrepared.usefulFoldedVariantTokens.includes('dezvoltator'));
  assert.ok(developerPrepared.intent.roleTokens.length > 0);
  assert.deepEqual(developerPrepared.intent.occupationClassPreference.preferredFamilyGroups, []);

  const forkliftPrepared = await prepareQuery('stivuitorist', 'ro', { sourceName: SOURCE });
  assert.ok(forkliftPrepared.usefulFoldedVariantTokens.includes('forklift'));

  const doctorPrepared = await prepareQuery('medici cardiologie', 'ro', { sourceName: SOURCE });
  assert.ok(doctorPrepared.usefulFoldedVariantTokens.includes('doctor'));
  assert.ok(doctorPrepared.intent.roleHeadTokens.length > 0);
});

test('english generic fallback keeps the rightmost useful token as head', async () => {
  const prepared = await prepareQuery('software data', 'en', { sourceName: SOURCE });

  assert.deepEqual(prepared.intent.roleTokens, ['data']);
  assert.deepEqual(prepared.intent.roleHeadTokens, ['data']);
  assert.deepEqual(prepared.intent.unresolvedModifierTokens, ['software']);
});

test('romanian generic fallback prefers the leftmost useful token', async () => {
  const prepared = await prepareQuery('rolx helperx', 'ro', { sourceName: SOURCE });

  assert.deepEqual(prepared.intent.roleTokens, ['rolx']);
  assert.deepEqual(prepared.intent.roleHeadTokens, ['rolx']);
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
