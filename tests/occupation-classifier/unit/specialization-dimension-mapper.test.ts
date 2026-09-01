import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BASE_SPECIALIZATION_SCHEMA,
  DEFAULT_ROLE_HEAD_GROUPS,
  DEFAULT_SPECIALIZATION_SCHEMA,
  classifySpecializationQuery,
  classifySpecializationTitle
} from '../../../src/occupation-classifier/specialization/specialization-dimension-mapper.js';

// Ported from mpx-jobs-ai-search/tools/structural-classifier-check/specialization-dimension-mapper.spec.ts
// so this repo's classifier no longer depends on that repo's schema/tooling to stay covered.

test('classifySpecializationTitle maps sewing machine operator with work object ownership', () => {
  assert.deepEqual(classifySpecializationTitle('sewing machine operator').work_object, ['sewing', 'machine']);
  assert.deepEqual(classifySpecializationTitle('sewing machine operator').role_head, ['operator']);
});

test('classifySpecializationTitle maps school subject and exact school venue concepts', () => {
  const result = classifySpecializationTitle('biology teacher secondary school');

  assert.deepEqual(result.knowledge_domain, ['biology']);
  assert.deepEqual(result.venue, ['secondary', 'school']);
  assert.deepEqual(result.concept.venue, ['secondary', 'school']);
  assert.ok(['secondary', 'school'].every((value) => result.available.venue.includes(value)));
  assert.deepEqual(result.industry, []);
  assert.deepEqual(result.role_head, ['teacher']);
});

test('classifySpecializationTitle prefers exact leaf-backed concept phrases over weaker token-level fallbacks', () => {
  const result = classifySpecializationTitle('literature teacher at secondary school');

  assert.deepEqual(result.knowledge_domain, ['literature']);
  assert.deepEqual(result.venue, ['secondary', 'school']);
  assert.deepEqual(result.concept.knowledge_domain, ['literature']);
  assert.deepEqual(result.concept.venue, ['secondary', 'school']);
  assert.deepEqual(result.available.knowledge_domain, ['literature']);
  assert.ok(['secondary', 'school'].every((value) => result.available.venue.includes(value)));
  assert.deepEqual(result.industry, []);
  assert.deepEqual(result.unresolved, []);
  assert.deepEqual(result.role_head, ['teacher']);
});

test('classifySpecializationTitle maps software developer to work object, not role head', () => {
  const result = classifySpecializationTitle('software developer');
  assert.deepEqual(result.work_object, ['software']);
  assert.deepEqual(result.role_head, ['developer']);
});

test('classifySpecializationTitle keeps commercial goods in product when role is seller', () => {
  const result = classifySpecializationTitle('audio and video equipment specialised seller');
  assert.deepEqual(result.product, ['audio', 'video', 'equipment']);
  assert.deepEqual(result.industry, ['specialised']);
  assert.deepEqual(result.role_head, ['seller']);
});

test('classifySpecializationTitle accepts schema extensions for future synonym growth', () => {
  const schema = {
    ...DEFAULT_SPECIALIZATION_SCHEMA,
    concepts: [
      ...DEFAULT_SPECIALIZATION_SCHEMA.concepts,
      {
        aliases: ['back-end', 'backend'],
        dimension: 'task' as const,
        id: 'backend'
      }
    ]
  };

  const result = classifySpecializationTitle('back-end developer', { schema });
  assert.deepEqual(result.task, ['back-end']);
  assert.deepEqual(result.role_head, ['developer']);
});

test('classifySpecializationTitle maps front-end developer to the web concept through csv aliases', () => {
  const result = classifySpecializationTitle('front-end developer');
  assert.deepEqual(result.work_object, ['web']);
  assert.deepEqual(result.role_head, ['developer']);
});

test('classifySpecializationTitle preserves literal title evidence alongside concept expansion', () => {
  const result = classifySpecializationTitle('front-end developer');
  assert.deepEqual(result.available.work_object, ['front', 'web']);
  assert.deepEqual(result.concept.work_object, ['web']);
  assert.deepEqual(result.literal.work_object, ['front']);
});

test('classifySpecializationTitle maps devops engineer to cloud specialization through csv aliases', () => {
  const result = classifySpecializationTitle('devops engineer');
  assert.deepEqual(result.work_object, ['cloud']);
  assert.deepEqual(result.role_head, ['engineer']);
});

test('classifySpecializationTitle maps seo specialist and hr manager through title aliases', () => {
  assert.deepEqual(classifySpecializationTitle('SEO specialist').knowledge_domain, ['marketing']);
  assert.deepEqual(classifySpecializationTitle('SEO specialist').role_head, ['specialist']);

  assert.deepEqual(classifySpecializationTitle('HR manager').knowledge_domain, ['human', 'resources']);
  assert.deepEqual(classifySpecializationTitle('HR manager').role_head, ['manager']);
});

test('classifySpecializationTitle keeps explicit sales work on agent leaves without promoting it to a knowledge domain', () => {
  const result = classifySpecializationTitle('advertising sales agent');
  assert.deepEqual(result.task, ['advertising', 'sales']);
  assert.deepEqual(result.knowledge_domain, []);
  assert.deepEqual(result.role_head, ['agent']);
});

test('classifySpecializationTitle keeps wholesale merchant leaves on the commercial channel and product surface', () => {
  const result = classifySpecializationTitle('wholesale merchant in beverages');
  assert.deepEqual(result.channel, ['wholesale']);
  assert.deepEqual(result.product, ['beverages']);
  assert.deepEqual(result.role_head, ['merchant']);
});

test('classifySpecializationTitle keeps vocational teaching leaves structurally separated by owned dimensions', () => {
  const result = classifySpecializationTitle('business administration vocational teacher');
  assert.deepEqual(result.task, ['administration']);
  assert.deepEqual(result.industry, ['vocational']);
  assert.deepEqual(result.knowledge_domain, ['business']);
  assert.deepEqual(result.role_head, ['teacher']);
});

test('classifySpecializationTitle keeps commercial sales representative leaves on task and industry, not business knowledge', () => {
  const result = classifySpecializationTitle('commercial sales representative');
  assert.deepEqual(result.task, ['sales']);
  assert.deepEqual(result.industry, ['commercial']);
  assert.deepEqual(result.knowledge_domain, []);
  assert.deepEqual(result.role_head, ['representative']);
});

test('classifySpecializationTitle treats romanian sales-agent leafs as sales work instead of business knowledge', () => {
  const result = classifySpecializationTitle('Agent de vanzari', { locale: 'ro' });
  assert.deepEqual(result.task, ['sales']);
  assert.deepEqual(result.knowledge_domain, []);
  assert.deepEqual(result.role_head, ['agent']);
});

test('classifySpecializationTitle exports canonical role heads for locale alias titles', () => {
  const helper = classifySpecializationTitle('ajutor bucatar fast food', { locale: 'ro' });
  assert.deepEqual(helper.task, ['help']);
  assert.deepEqual(helper.work_object, ['food']);
  assert.deepEqual(helper.role_head, ['cook']);
  assert.deepEqual(helper.unresolved, ['fast']);

  const mechanic = classifySpecializationTitle('mecanic auto');
  assert.deepEqual(mechanic.industry, ['automotive']);
  assert.deepEqual(mechanic.role_head, ['mechanic']);

  const engineer = classifySpecializationTitle('software inginer');
  assert.deepEqual(engineer.work_object, ['software']);
  assert.deepEqual(engineer.role_head, ['engineer']);
});

test('classifySpecializationQuery loads locale concept aliases only when the matching locale is requested', () => {
  const noLocale = classifySpecializationQuery('számvitel');
  assert.deepEqual(noLocale.knowledge_domain, []);
  assert.deepEqual(noLocale.unresolved, ['szamvitel']);

  const withLocale = classifySpecializationQuery('számvitel', { locale: 'hu' });
  assert.deepEqual(withLocale.knowledge_domain, ['accounting']);
  assert.deepEqual(withLocale.concept.knowledge_domain, ['accounting']);
  assert.deepEqual(withLocale.unresolved, []);
});

test('classifySpecializationTitle keeps english concept aliases active when a locale-specific concept schema is requested', () => {
  const result = classifySpecializationTitle('front-end developer', { locale: 'hu' });
  assert.deepEqual(result.work_object, ['web']);
  assert.deepEqual(result.role_head, ['developer']);
});

test('classifySpecializationTitle exports canonical concepts outward while preserving surface literals for titles', () => {
  const frontEnd = classifySpecializationTitle('Front-end developer');
  assert.deepEqual(frontEnd.work_object, ['web']);
  assert.deepEqual(frontEnd.available.work_object, ['Front', 'web']);
  assert.deepEqual(frontEnd.concept.work_object, ['web']);
  assert.deepEqual(frontEnd.literal.work_object, ['Front']);
  assert.deepEqual(frontEnd.unresolved, []);

  const romanianEngineer = classifySpecializationTitle('Inginer construcții civile industriale', { locale: 'ro' });
  assert.deepEqual(romanianEngineer.industry, ['construction']);
  assert.deepEqual(romanianEngineer.available.industry, ['construcții', 'construction']);
  assert.deepEqual(romanianEngineer.concept.industry, ['construction']);
  assert.deepEqual(romanianEngineer.literal.industry, ['construcții']);
  assert.deepEqual(romanianEngineer.unresolved, []);
});

test('classifySpecializationTitle promotes exact contextual commodity concepts into canonical title output', () => {
  const result = classifySpecializationTitle('fish cook');
  assert.deepEqual(result.work_object, ['fish']);
  assert.deepEqual(result.concept.work_object, ['fish']);
  assert.deepEqual(result.literal.work_object, ['fish']);
  assert.deepEqual(result.role_head, ['cook']);
  assert.deepEqual(result.unresolved, []);
});

test('classifySpecializationTitle keeps leaf-derived head variants on their canonical role head without leaking stray tokens', () => {
  const pastryChef = classifySpecializationTitle('pastry chef');
  assert.deepEqual(pastryChef.work_object, ['pastry']);
  assert.deepEqual(pastryChef.role_head, ['chef']);
  assert.deepEqual(pastryChef.unresolved, []);

  const coPilot = classifySpecializationTitle('co-pilot');
  assert.deepEqual(coPilot.work_object, []);
  assert.deepEqual(coPilot.available.work_object, []);
  assert.deepEqual(coPilot.role_head, ['pilot']);
  assert.deepEqual(coPilot.unresolved, []);
});

test('classifySpecializationTitle keeps english sales-agent leafs on the sales task path', () => {
  const railway = classifySpecializationTitle('railway sales agent');
  assert.deepEqual(railway.venue, ['railway']);
  assert.deepEqual(railway.task, ['sales']);
  assert.deepEqual(railway.knowledge_domain, []);
  assert.deepEqual(railway.role_head, ['agent']);

  const ticket = classifySpecializationTitle('ticket sales agent');
  assert.deepEqual(ticket.task, ['ticket', 'sales']);
  assert.deepEqual(ticket.knowledge_domain, []);
  assert.deepEqual(ticket.role_head, ['agent']);
});

test('classifySpecializationTitle preserves non-sales agent leafs without forcing a commercial reading', () => {
  const travel = classifySpecializationTitle('travel agent');
  assert.deepEqual(travel.knowledge_domain, ['travel']);
  assert.deepEqual(travel.task, []);
  assert.deepEqual(travel.role_head, ['agent']);

  const callCentre = classifySpecializationTitle('call centre agent');
  assert.deepEqual(callCentre.channel, ['call', 'centre']);
  assert.deepEqual(callCentre.task, []);
  assert.deepEqual(callCentre.role_head, ['agent']);

  const realEstate = classifySpecializationTitle('real estate agent');
  assert.deepEqual(realEstate.industry, ['real', 'estate']);
  assert.deepEqual(realEstate.task, []);
  assert.deepEqual(realEstate.role_head, ['agent']);
});

test('classifySpecializationTitle covers newly audited leaf role heads from the leaf inventory', () => {
  assert.deepEqual(classifySpecializationTitle('tour organiser').role_head, ['organiser']);
  assert.deepEqual(classifySpecializationTitle('tour organizer').role_head, ['organiser']);
  assert.deepEqual(classifySpecializationTitle('book publisher').role_head, ['publisher']);
  assert.deepEqual(classifySpecializationTitle('bicycle courier').role_head, ['courier']);
  assert.deepEqual(classifySpecializationTitle('property appraiser').role_head, ['appraiser']);

  const concierge = classifySpecializationTitle('hotel concierge');
  assert.deepEqual(concierge.venue, ['hotel']);
  assert.deepEqual(concierge.role_head, ['concierge']);

  assert.deepEqual(classifySpecializationTitle('army captain').role_head, ['captain']);

  const judge = classifySpecializationTitle('supreme court judge');
  assert.deepEqual(judge.venue, ['court']);
  assert.deepEqual(judge.role_head, ['judge']);

  const osteopath = classifySpecializationTitle('animal osteopath');
  assert.deepEqual(osteopath.population, ['animal']);
  assert.deepEqual(osteopath.role_head, ['osteopath']);

  const paramedic = classifySpecializationTitle('paramedic in emergency responses');
  assert.deepEqual(paramedic.industry, ['emergency']);
  assert.deepEqual(paramedic.role_head, ['paramedic']);

  assert.deepEqual(classifySpecializationTitle('textile colourist').role_head, ['colourist']);
  assert.deepEqual(classifySpecializationTitle('dance répétiteur').role_head, ['repetiteur']);
  assert.deepEqual(classifySpecializationTitle('tyre vulcaniser').role_head, ['vulcaniser']);
});

test('classifySpecializationTitle fills recurring commodity and material dimensions even when role modes are neutral', () => {
  const banking = classifySpecializationTitle('banking products manager');
  assert.deepEqual(banking.industry, ['banking']);
  assert.deepEqual(banking.product, ['products']);
  assert.deepEqual(banking.unresolved, []);

  const distribution = classifySpecializationTitle('household goods distribution manager');
  assert.deepEqual(distribution.channel, ['distribution']);
  assert.deepEqual(distribution.product, ['household', 'goods']);

  assert.deepEqual(classifySpecializationTitle('leather goods designer').work_object, ['leather', 'goods']);
  assert.deepEqual(classifySpecializationTitle('textile designer').work_object, ['textile']);
  assert.deepEqual(classifySpecializationTitle('footwear designer').work_object, ['footwear']);

  const machinery = classifySpecializationTitle('machinery assembly coordinator');
  assert.deepEqual(machinery.task, ['assembly']);
  assert.deepEqual(machinery.work_object, ['machinery']);

  assert.deepEqual(classifySpecializationTitle('food technologist').work_object, ['food']);
  assert.deepEqual(classifySpecializationTitle('furniture designer').work_object, ['furniture']);
  assert.deepEqual(classifySpecializationTitle('aircraft dispatcher').work_object, ['aircraft']);
  assert.deepEqual(classifySpecializationTitle('data scientist').knowledge_domain, ['data']);

  const games = classifySpecializationTitle('digital games developer');
  assert.deepEqual(games.industry, ['digital']);
  assert.deepEqual(games.work_object, ['games']);

  assert.deepEqual(classifySpecializationTitle('wood painter').work_object, ['wood']);
});

test('classifySpecializationTitle covers an additional safe batch of remaining leaf role heads', () => {
  assert.deepEqual(classifySpecializationTitle('forest ranger').role_head, ['ranger']);
  assert.deepEqual(classifySpecializationTitle('foreign correspondent').role_head, ['correspondent']);
  assert.deepEqual(classifySpecializationTitle('government minister').role_head, ['minister']);
  assert.deepEqual(classifySpecializationTitle('professional athlete').role_head, ['professional', 'athlete']);
  assert.deepEqual(classifySpecializationTitle('temperature screener').role_head, ['screener']);
  assert.deepEqual(classifySpecializationTitle('parking valet').role_head, ['valet']);
});

test('classifySpecializationTitle covers a further bulk pass of leaf-only role heads and one-way head aliases', () => {
  assert.deepEqual(classifySpecializationTitle('casino pit boss').role_head, ['boss']);
  assert.deepEqual(classifySpecializationTitle('coffee taster').role_head, ['taster']);
  assert.deepEqual(classifySpecializationTitle('colonel').role_head, ['colonel']);
  assert.deepEqual(classifySpecializationTitle('disc jockey').role_head, ['jockey']);
  assert.deepEqual(classifySpecializationTitle('infantry soldier').role_head, ['soldier']);
  assert.deepEqual(classifySpecializationTitle('survey enumerator').role_head, ['enumerator']);
  assert.deepEqual(classifySpecializationTitle('tourism contract negotiator').role_head, ['negotiator']);
  assert.deepEqual(classifySpecializationTitle('wood treater').role_head, ['treater']);
  assert.deepEqual(classifySpecializationTitle('choirmaster/choirmistress').role_head, ['choirmaster']);
  assert.deepEqual(classifySpecializationTitle('doorman/doorwoman').role_head, ['doorman']);
  assert.deepEqual(classifySpecializationTitle('groundsman/groundswoman').role_head, ['groundsman']);
  assert.deepEqual(classifySpecializationTitle('masseuse').role_head, ['masseur']);
  assert.deepEqual(classifySpecializationTitle('postwoman').role_head, ['postman']);
  assert.deepEqual(classifySpecializationTitle('matrose').role_head, ['sailor']);
});

test('classifySpecializationTitle fills another audited batch of recurring unresolved leaf tokens', () => {
  assert.deepEqual(classifySpecializationTitle('computer scientist').work_object, ['computer']);
  assert.deepEqual(classifySpecializationTitle('computer shop manager').work_object, ['computer']);

  const contactCentre = classifySpecializationTitle('contact centre manager');
  assert.deepEqual(contactCentre.channel, ['contact']);
  assert.deepEqual(contactCentre.venue, ['centre']);

  assert.deepEqual(classifySpecializationTitle('cosmetics and perfume shop manager').product, ['perfume']);
  assert.deepEqual(classifySpecializationTitle('concrete finisher').work_object, ['concrete']);
  assert.deepEqual(classifySpecializationTitle('police commissioner').industry, ['police']);
  assert.deepEqual(classifySpecializationTitle('foreign exchange cashier').knowledge_domain, ['foreign', 'exchange']);
  assert.deepEqual(classifySpecializationTitle('hardwood floor layer').work_object, ['hardwood', 'floor']);

  const jewellery = classifySpecializationTitle('jewellery and watches shop manager');
  assert.deepEqual(jewellery.product, ['jewellery']);
  assert.deepEqual(jewellery.available.product, ['jewellery', 'watches']);
});

test('classifySpecializationTitle covers the next pass of remaining leaf-only dimension tokens', () => {
  const importExport = classifySpecializationTitle('import export manager in perfume and cosmetics');
  assert.deepEqual(importExport.task, ['import', 'export']);
  assert.deepEqual(importExport.product, ['perfume']);
  assert.deepEqual(importExport.work_object, ['cosmetic']);

  const cabinCrew = classifySpecializationTitle('cabin crew manager');
  assert.deepEqual(cabinCrew.venue, ['cabin']);
  assert.deepEqual(cabinCrew.population, ['crew']);

  const caseWorker = classifySpecializationTitle('community care case worker');
  assert.deepEqual(caseWorker.population, ['community']);
  assert.deepEqual(caseWorker.task, ['care', 'case']);

  assert.deepEqual(classifySpecializationTitle('traditional chinese medicine therapist').knowledge_domain, [
    'traditional',
    'chinese',
    'medicine'
  ]);

  const luggage = classifySpecializationTitle('hand luggage inspector');
  assert.deepEqual(luggage.role_head, ['hand', 'inspector']);
  assert.deepEqual(luggage.work_object, ['luggage']);

  const orderPicker = classifySpecializationTitle('warehouse order picker');
  assert.deepEqual(orderPicker.venue, ['warehouse']);
  assert.deepEqual(orderPicker.task, ['order']);

  assert.deepEqual(classifySpecializationTitle('pharmacy assistant').knowledge_domain, ['pharmacy']);
  assert.deepEqual(classifySpecializationTitle('soil scientist').knowledge_domain, ['soil']);

  const motorcycleCourier = classifySpecializationTitle('motorcycle delivery person');
  assert.deepEqual(motorcycleCourier.work_object, ['motorcycle']);
  assert.deepEqual(motorcycleCourier.task, ['delivery']);

  assert.deepEqual(classifySpecializationTitle('semiconductor processor').work_object, ['semiconductor']);
  // specialization-role-heads.csv keeps 'prosthetist' explicit rather than folding it into
  // 'orthotist', so this paired clinical-craft leaf resolves both role heads.
  assert.deepEqual(classifySpecializationTitle('prosthetist-orthotist').role_head, ['prosthetist', 'orthotist']);

  const stoneSetter = classifySpecializationTitle('precious stone setter');
  assert.deepEqual(stoneSetter.work_object, ['precious', 'stone']);
  assert.deepEqual(stoneSetter.unresolved, []);

  const surfaceMiner = classifySpecializationTitle('surface miner');
  assert.deepEqual(surfaceMiner.work_object, ['surface']);
  assert.deepEqual(surfaceMiner.role_head, ['miner']);
  assert.deepEqual(surfaceMiner.unresolved, []);
});

test('classifySpecializationTitle backs promoted leaf-only tokens with canonical concepts instead of literal-only fallback', () => {
  const result = classifySpecializationTitle('automation engineer');
  assert.deepEqual(result.task, ['automation']);
  assert.deepEqual(result.concept.task, ['automation']);
  assert.deepEqual(result.literal.task, ['automation']);
});

test('classifySpecializationQuery resolves role head and specialization concept separately for romanian job titles', () => {
  const result = classifySpecializationQuery('Mecanic auto');
  assert.deepEqual(result.industry, ['automotive']);
  assert.deepEqual(result.role_head, ['mechanic']);
  assert.deepEqual(result.unresolved, []);
});

test('classifySpecializationQuery resolves explicit concept aliases without title-shaped fallback aliases', () => {
  const result = classifySpecializationQuery('Front-end developer');
  assert.deepEqual(result.work_object, ['web']);
  assert.deepEqual(result.role_head, ['developer']);
  assert.deepEqual(result.unresolved, []);
});

test('classifySpecializationQuery exports canonical concepts outward while preserving surface literals for queries', () => {
  const frontEnd = classifySpecializationQuery('Front-end developer');
  assert.deepEqual(frontEnd.work_object, ['web']);
  assert.deepEqual(frontEnd.available.work_object, ['Front', 'web']);
  assert.deepEqual(frontEnd.concept.work_object, ['web']);
  assert.deepEqual(frontEnd.literal.work_object, ['Front']);
  assert.deepEqual(frontEnd.unresolved, []);

  const romanianEngineer = classifySpecializationQuery('Inginer construcții civile industriale', { locale: 'ro' });
  assert.deepEqual(romanianEngineer.industry, ['construction']);
  assert.deepEqual(romanianEngineer.available.industry, ['construcții', 'construction']);
  assert.deepEqual(romanianEngineer.concept.industry, ['construction']);
  assert.deepEqual(romanianEngineer.literal.industry, ['construcții']);
  assert.deepEqual(romanianEngineer.unresolved, []);
});

test('classifySpecializationQuery does not translate job seniority into the adult population concept', () => {
  const query = classifySpecializationQuery('Senior software engineer');
  assert.deepEqual(query.population, []);
  assert.deepEqual(query.work_object, ['software']);
  assert.deepEqual(query.role_head, ['engineer']);
  assert.deepEqual(query.unresolved, ['senior']);

  const title = classifySpecializationTitle('Senior software engineer');
  assert.deepEqual(title.population, []);
  assert.deepEqual(title.work_object, ['software']);
  assert.deepEqual(title.role_head, ['engineer']);
  assert.deepEqual(title.unresolved, ['Senior']);
});

test('classifySpecializationQuery promotes exact contextual commodity concepts into canonical query output', () => {
  const result = classifySpecializationQuery('fish cook');
  assert.deepEqual(result.work_object, ['fish']);
  assert.deepEqual(result.available.work_object, ['fish']);
  assert.deepEqual(result.concept.work_object, ['fish']);
  assert.deepEqual(result.literal.work_object, ['fish']);
  assert.deepEqual(result.role_head, ['cook']);
  assert.deepEqual(result.unresolved, []);
});

test('classifySpecializationQuery normalizes diacritics before strict concept matching', () => {
  const result = classifySpecializationQuery('Inginer construcții civile industriale', { locale: 'ro' });
  assert.deepEqual(result.industry, ['construction']);
  assert.deepEqual(result.role_head, ['engineer']);
  assert.deepEqual(result.unresolved, []);
});

test('classifySpecializationQuery returns matched concepts for downstream specialization gating', () => {
  const result = classifySpecializationQuery('software developer');

  assert.deepEqual(result.roleModes, ['technical']);
  assert.deepEqual(result.role_head, ['developer']);
  assert.deepEqual(result.work_object, ['software']);
  assert.deepEqual(result.unresolved, []);
  assert.ok(result.concepts.some((concept) => concept.conceptId === 'software_work_object' && concept.dimension === 'work_object'));
});

test('classifySpecializationQuery keeps literal query tokens when a phrase concept also resolves', () => {
  const result = classifySpecializationQuery('air traffic controller');
  assert.deepEqual(result.available.industry, ['traffic', 'aviation']);
  assert.deepEqual(result.concept.industry, ['aviation']);
  assert.deepEqual(result.literal.industry, ['traffic']);
  assert.deepEqual(result.role_head, ['controller']);
});

test('classifySpecializationQuery keeps mixed commercial query heads structurally differentiated by the surrounding leaf text', () => {
  const railway = classifySpecializationQuery('railway sales agent');
  assert.deepEqual(railway.venue, ['railway']);
  assert.deepEqual(railway.task, ['sales']);
  assert.deepEqual(railway.knowledge_domain, []);
  assert.deepEqual(railway.role_head, ['agent']);
  assert.deepEqual(railway.unresolved, []);

  const travel = classifySpecializationQuery('travel agent');
  assert.deepEqual(travel.knowledge_domain, ['travel']);
  assert.deepEqual(travel.task, []);
  assert.deepEqual(travel.role_head, ['agent']);
  assert.deepEqual(travel.unresolved, []);
});

test('classifySpecializationQuery treats romanian sales-agent queries as sales work instead of business knowledge', () => {
  const result = classifySpecializationQuery('Agent de vanzari', { locale: 'ro' });
  assert.deepEqual(result.task, ['sales']);
  assert.deepEqual(result.knowledge_domain, []);
  assert.deepEqual(result.role_head, ['agent']);
  assert.deepEqual(result.unresolved, []);
});

test('classifySpecializationQuery keeps neutral romanian sales-assistant queries from committing to the wrong dimension', () => {
  const result = classifySpecializationQuery('Asistent vânzări', { locale: 'ro' });
  assert.deepEqual(result.task, []);
  assert.deepEqual(result.knowledge_domain, []);
  assert.deepEqual(result.role_head, ['assistant']);
  assert.deepEqual(result.unresolved, ['vanzari']);
});

test('classifySpecializationQuery reuses canonical role modes through locale role-head aliases', () => {
  const analyst = classifySpecializationQuery('analist business', { locale: 'ro' });
  assert.deepEqual(analyst.knowledge_domain, ['business']);
  assert.deepEqual(analyst.role_head, ['analyst']);
  assert.deepEqual(analyst.roleModes, ['knowledge']);
  assert.deepEqual(analyst.unresolved, []);

  const mechanic = classifySpecializationQuery('mecanic auto', { locale: 'ro' });
  assert.deepEqual(mechanic.industry, ['automotive']);
  assert.deepEqual(mechanic.role_head, ['mechanic']);
  assert.deepEqual(mechanic.roleModes, ['technical']);
  assert.deepEqual(mechanic.unresolved, []);

  const engineer = classifySpecializationQuery('inginer auto', { locale: 'ro' });
  assert.deepEqual(engineer.industry, ['automotive']);
  assert.deepEqual(engineer.role_head, ['engineer']);
  assert.deepEqual(engineer.roleModes, ['technical']);
  assert.deepEqual(engineer.unresolved, []);

  const programmer = classifySpecializationQuery('programator software', { locale: 'ro' });
  assert.deepEqual(programmer.role_head, ['programmer']);
  assert.deepEqual(programmer.roleModes, ['technical']);
  assert.deepEqual(programmer.unresolved, []);

  const seller = classifySpecializationQuery('vanzator online', { locale: 'ro' });
  assert.deepEqual(seller.channel, ['online']);
  assert.deepEqual(seller.role_head, ['seller']);
  assert.deepEqual(seller.roleModes, ['commercial']);
  assert.deepEqual(seller.unresolved, []);

  const doctor = classifySpecializationQuery('medic business', { locale: 'ro' });
  assert.deepEqual(doctor.knowledge_domain, ['business']);
  assert.deepEqual(doctor.role_head, ['doctor']);
  assert.deepEqual(doctor.roleModes, ['knowledge']);
  assert.deepEqual(doctor.unresolved, []);
});

test('classifySpecializationQuery keeps british english role-head canonicals while accepting american english aliases', () => {
  assert.deepEqual(classifySpecializationQuery('advisor').role_head, ['adviser']);
  assert.deepEqual(classifySpecializationQuery('adviser').role_head, ['adviser']);
  assert.deepEqual(classifySpecializationQuery('counselor').role_head, ['counsellor']);
  assert.deepEqual(classifySpecializationQuery('counsellor').role_head, ['counsellor']);

  const modeller = classifySpecializationQuery('3D modeller');
  assert.deepEqual(modeller.work_object, ['3D']);
  assert.deepEqual(modeller.role_head, ['modeller']);

  const modeler = classifySpecializationQuery('3D modeler');
  assert.deepEqual(modeler.work_object, ['3D']);
  assert.deepEqual(modeler.role_head, ['modeller']);

  assert.deepEqual(classifySpecializationQuery('labourer').role_head, ['labourer']);
  assert.deepEqual(classifySpecializationQuery('laborer').role_head, ['labourer']);
});

test('classifySpecializationQuery keeps mixed generic role heads on the reviewed conservative defaults', () => {
  const importExport = classifySpecializationQuery('import export specialist');
  assert.deepEqual(importExport.task, ['import', 'export']);
  assert.deepEqual(importExport.role_head, ['specialist']);
  assert.deepEqual(importExport.roleModes, ['knowledge']);
  assert.deepEqual(importExport.unresolved, []);

  const consultant = classifySpecializationQuery('business consultant');
  assert.deepEqual(consultant.knowledge_domain, ['business']);
  assert.deepEqual(consultant.role_head, ['consultant']);
  assert.deepEqual(consultant.roleModes, ['knowledge']);
  assert.deepEqual(consultant.unresolved, []);

  const analyst = classifySpecializationQuery('business analyst');
  assert.deepEqual(analyst.knowledge_domain, ['business']);
  assert.deepEqual(analyst.role_head, ['analyst']);
  assert.deepEqual(analyst.roleModes, ['knowledge']);
  assert.deepEqual(analyst.unresolved, []);

  const officer = classifySpecializationQuery('academic support officer');
  assert.deepEqual(officer.task, ['support']);
  assert.deepEqual(officer.industry, ['academic']);
  assert.deepEqual(officer.role_head, ['officer']);
  assert.deepEqual(officer.roleModes, []);
  assert.deepEqual(officer.unresolved, []);

  const coordinator = classifySpecializationQuery('economic development coordinator');
  assert.deepEqual(coordinator.task, ['development']);
  assert.deepEqual(coordinator.industry, ['economic']);
  assert.deepEqual(coordinator.role_head, ['coordinator']);
  assert.deepEqual(coordinator.roleModes, []);
  assert.deepEqual(coordinator.unresolved, []);
});

test('classifySpecializationQuery keeps the runtime role-head alias set unique', () => {
  const aliasPairs = (DEFAULT_SPECIALIZATION_SCHEMA.roleHeadAliases ?? []).map(
    (row) => `${row.roleHead.toLowerCase()}${row.alias.toLowerCase()}`
  );

  assert.equal(new Set(aliasPairs).size, aliasPairs.length);
});

test('classifySpecializationQuery uses manually promoted safe role-head aliases and leaves uncertain ones unresolved', () => {
  const engineer = classifySpecializationQuery('mérnök');
  assert.deepEqual(engineer.role_head, ['engineer']);
  assert.deepEqual(engineer.roleModes, ['technical']);
  assert.deepEqual(engineer.unresolved, []);

  const doctor = classifySpecializationQuery('orvos');
  assert.deepEqual(doctor.role_head, ['doctor']);
  assert.deepEqual(doctor.roleModes, ['knowledge']);
  assert.deepEqual(doctor.unresolved, []);

  const actor = classifySpecializationQuery('színész');
  assert.deepEqual(actor.role_head, ['actor']);
  assert.deepEqual(actor.roleModes, []);
  assert.deepEqual(actor.unresolved, []);

  const consultant = classifySpecializationQuery('konsultant');
  assert.deepEqual(consultant.role_head, ['consultant']);
  assert.deepEqual(consultant.roleModes, ['knowledge']);
  assert.deepEqual(consultant.unresolved, []);

  const seller = classifySpecializationQuery('salesperson');
  assert.deepEqual(seller.role_head, ['seller']);
  assert.deepEqual(seller.roleModes, ['commercial']);
  assert.deepEqual(seller.unresolved, []);

  const senator = classifySpecializationQuery('legislator');
  assert.deepEqual(senator.role_head, ['senator']);
  assert.deepEqual(senator.roleModes, []);
  assert.deepEqual(senator.unresolved, []);

  const writer = classifySpecializationQuery('author');
  assert.deepEqual(writer.role_head, ['writer']);
  assert.deepEqual(writer.roleModes, []);
  assert.deepEqual(writer.unresolved, []);

  const aesthetician = classifySpecializationQuery('beautician');
  assert.deepEqual(aesthetician.role_head, ['aesthetician']);
  assert.deepEqual(aesthetician.roleModes, []);
  assert.deepEqual(aesthetician.unresolved, []);

  const landscaper = classifySpecializationQuery('gardener');
  assert.deepEqual(landscaper.role_head, ['landscaper']);
  assert.deepEqual(landscaper.roleModes, []);
  assert.deepEqual(landscaper.unresolved, []);

  const unresolved = classifySpecializationQuery('esteetik');
  assert.deepEqual(unresolved.role_head, []);
  assert.deepEqual(unresolved.roleModes, []);
  assert.deepEqual(unresolved.unresolved, ['esteetik']);
});

test('classifySpecializationQuery keeps fallback role modes conservative and exposes separate related role-head groups', () => {
  assert.deepEqual(BASE_SPECIALIZATION_SCHEMA.roleModes, {
    commercial: ['buyer', 'distributor', 'merchant', 'representative', 'seller', 'trader'],
    creative: ['animator', 'artist', 'designer', 'director', 'editor', 'journalist', 'producer'],
    education: ['coach', 'instructor', 'lecturer', 'teacher', 'trainer'],
    knowledge: [
      'analyst',
      'consultant',
      'editor',
      'interpreter',
      'journalist',
      'lecturer',
      'researcher',
      'specialist',
      'teacher',
      'trainer',
      'translator'
    ],
    technical: [
      'administrator',
      'architect',
      'assembler',
      'configurator',
      'developer',
      'engineer',
      'inspector',
      'installer',
      'mechanic',
      'operator',
      'repairer',
      'technician',
      'tester'
    ]
  });

  assert.deepEqual(DEFAULT_ROLE_HEAD_GROUPS.software_development, ['coder', 'developer', 'programmer']);
  assert.deepEqual(DEFAULT_ROLE_HEAD_GROUPS.teaching_instruction, [
    'coach',
    'educator',
    'instructor',
    'lecturer',
    'teacher',
    'trainer',
    'tutor'
  ]);
  assert.deepEqual(DEFAULT_ROLE_HEAD_GROUPS.sales_representation, [
    'agent',
    'canvasser',
    'demonstrator',
    'representative',
    'seller',
    'vendor'
  ]);
  assert.deepEqual(DEFAULT_ROLE_HEAD_GROUPS.food_service_waiting, ['attendant', 'steward', 'stewardess', 'waiter', 'waitress']);
  assert.ok(DEFAULT_ROLE_HEAD_GROUPS.biological_sciences.includes('microbiologist'));
  assert.ok(DEFAULT_ROLE_HEAD_GROUPS.engineering_disciplines.includes('technologist'));
  assert.ok(DEFAULT_ROLE_HEAD_GROUPS.archives_curation.includes('archivist'));
  assert.ok(DEFAULT_ROLE_HEAD_GROUPS.mental_health_counseling.includes('psychotherapist'));
  assert.ok(DEFAULT_ROLE_HEAD_GROUPS.executive_leadership.includes('head'));
  assert.deepEqual(DEFAULT_ROLE_HEAD_GROUPS.spiritual_clergy, ['chaplain', 'missionary', 'monk', 'nun', 'verger']);

  const groupedRoleHeads = new Set(Object.values(DEFAULT_ROLE_HEAD_GROUPS).flat());
  const roleHeads = new Set(DEFAULT_SPECIALIZATION_SCHEMA.roleHeads);
  for (const roleHead of groupedRoleHeads) {
    assert.equal(roleHeads.has(roleHead), true);
  }
  assert.ok(groupedRoleHeads.size > 250);
});
