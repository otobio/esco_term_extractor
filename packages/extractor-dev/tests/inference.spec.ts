import { describe, expect, it } from 'vitest';
import { levelFeatures, vectorize } from '../../../src/classifier/level-features.ts';
import { inferLevelLr, type LevelLrModel, loadLevelLr, predictProbs } from '../../../src/classifier/level-lr.ts';
import { inferBenefits } from '../../../src/inference/benefits.ts';
import { inferCompanyType } from '../../../src/inference/company-type.ts';
import { inferCompensation } from '../../../src/inference/compensation.ts';
import { inferEmployment } from '../../../src/inference/employment.ts';
import { facetCollisionErrors } from '../../../src/inference/facets.ts';
import { inferLevel } from '../../../src/inference/level.ts';
import { inferQualifications } from '../../../src/inference/qualifications.ts';
import { inferSchedule } from '../../../src/inference/schedule.ts';
import { inferWorkplace } from '../../../src/inference/workplace.ts';
import { LexicalIndex } from '../../../src/lexical-index.ts';
import type { Clause } from '../../../src/tokenizer.ts';
import type { DictionaryTerm } from '../../../src/types.ts';
import { VectorStore } from '../../../src/vector-store.ts';
import type { LevelExemplarGroup } from '../src/classifier/level-exemplars.ts';
import { LevelExemplarIndex, makeLevelClassifier } from '../src/classifier/level-semantic.ts';
import type { TextEmbedder } from '../src/embedder.ts';
import { TermExtractor } from '../src/extractor.ts';

const C = (t: string): Clause[] => [{ text: t, source: 'text' }];
const empKeys = (t: string) => inferEmployment(C(t)).map((x) => x.canonicalKey);
const companyTypeKeys = (t: string) => inferCompanyType(C(t)).map((x) => x.canonicalKey);
const companyTypeKeysEt = (t: string) => inferCompanyType(C(t), ['et']).map((x) => x.canonicalKey);
const schKeys = (t: string) => inferSchedule(C(t)).map((x) => x.canonicalKey);
const workplaceKeys = (t: string) => inferWorkplace(C(t)).map((x) => x.canonicalKey);
const benefitsKeys = (t: string) => inferBenefits(C(t)).map((x) => x.canonicalKey);
const compKeys = (t: string) => inferCompensation(C(t)).map((x) => x.canonicalKey);
const lvlKeys = (t: string) => inferLevel(C(t)).map((x) => x.canonicalKey);
const qKeys = (t: string) => inferQualifications(C(t)).map((x) => x.canonicalKey);

describe('employment inference', () => {
  it('reads weekly hours', () => {
    expect(empKeys('40 hours per week')).toContain('employment:full_time');
    expect(empKeys('20h/week')).toContain('employment:part_time');
    expect(empKeys('20 ore pe saptamana')).toContain('employment:part_time');
  });
  it('reads daily hours', () => {
    expect(empKeys('program de 8 ore pe zi')).toContain('employment:full_time');
    expect(empKeys('part-time 4 h')).toContain('employment:part_time');
  });
  it('reads contract-type idioms (multilingual)', () => {
    expect(empKeys('contract pe perioada determinata')).toContain('employment:temporary');
    expect(empKeys('colaborare / PFA')).toContain('employment:contract');
    expect(empKeys('stagiu de practica')).toContain('employment:internship');
    expect(empKeys('munca sezoniera')).toContain('employment:seasonal');
    expect(empKeys('határozott idejű szerződés')).toContain('employment:temporary');
  });
  it('respects negation', () => {
    expect(empKeys('nu oferim part-time')).not.toContain('employment:part_time');
  });
  it('maps structured external employment labels', () => {
    expect(empKeys('Internship & Graduate')).toContain('employment:internship');
    expect(empKeys('Program Full Time')).toContain('employment:full_time');
    expect(empKeys('Program Part Time')).toContain('employment:part_time');
    expect(empKeys('Practica / voluntariat')).toContain('employment:internship');
  });
  it('maps Hungarian structured employment labels', () => {
    expect(empKeys('Alkalmi munka')).toContain('employment:temporary');
    expect(empKeys('Szakmai gyakorlat')).toContain('employment:internship');
    expect(empKeys('Diákmunka')).toContain('employment:internship');
    expect(empKeys('Alkalmazotti jogviszony')).toContain('employment:full_time');
  });
  it('maps Estonian structured employment labels', () => {
    expect(inferEmployment(C('Täistööaeg'), ['et']).map((x) => x.canonicalKey)).toContain('employment:full_time');
    expect(inferEmployment(C('Osaline tööaeg'), ['et']).map((x) => x.canonicalKey)).toContain('employment:part_time');
    expect(inferEmployment(C('Praktikakoht'), ['et']).map((x) => x.canonicalKey)).toContain('employment:internship');
    expect(inferEmployment(C('Töövõtuleping'), ['et']).map((x) => x.canonicalKey)).toContain('employment:contract');
    expect(inferEmployment(C('Ajutine töö'), ['et']).map((x) => x.canonicalKey)).toContain('employment:temporary');
    expect(inferEmployment(C('Hooajaline töö'), ['et']).map((x) => x.canonicalKey)).toContain('employment:seasonal');
  });
  it('maps Estonian source employment labels', () => {
    expect(inferEmployment(C('Praktika'), ['et']).map((x) => x.canonicalKey)).toEqual(['employment:internship']);
    expect(inferEmployment(C('Hooaja-/ajutine töö'), ['et']).map((x) => x.canonicalKey)).toEqual([
      'employment:seasonal',
      'employment:temporary',
    ]);
    expect(inferEmployment(C('Palgatöötaja'), ['et']).map((x) => x.canonicalKey)).toEqual(['employment:full_time']);
    expect(inferEmployment(C('Lepinguline / vabakutseline'), ['et']).map((x) => x.canonicalKey)).toEqual([
      'employment:contract',
    ]);
    expect(inferEmployment(C('Ametnik'), ['et']).map((x) => x.canonicalKey)).toEqual([]);
  });
});

describe('company_type inference — structured external facets', () => {
  it('has no generated finite-facet alias collisions', () => {
    expect(facetCollisionErrors()).toEqual([]);
  });

  it('maps English category and industry labels to canonical company types', () => {
    expect(companyTypeKeys('Farming & Agriculture')).toEqual(['company_type:agriculture_agri_business']);
    expect(companyTypeKeys('IT & Telecoms')).toEqual(['company_type:information_technology', 'company_type:telecom']);
    expect(companyTypeKeys('Banking, Finance & Insurance')).toEqual([
      'company_type:banking_financial_services',
      'company_type:insurance',
    ]);
    expect(companyTypeKeys('Automotive & Aviation')).toEqual(['company_type:automotive', 'company_type:aviation']);
  });

  it('maps Romanian industry labels to canonical company types', () => {
    expect(companyTypeKeys('Administrație / Sector Public')).toEqual(['company_type:government']);
    expect(companyTypeKeys('Call-center / BPO')).toEqual(['company_type:outsourcing_shared_services']);
    expect(companyTypeKeys('IT / Telecom')).toEqual(['company_type:information_technology', 'company_type:telecom']);
    expect(companyTypeKeys('Transport / Logistică / Import - Export')).toEqual([
      'company_type:transportation',
      'company_type:warehouse_logistics',
    ]);
    expect(companyTypeKeys('Turism / HoReCa')).toEqual(['company_type:hospitality']);
  });

  it('maps Romanian job-category labels to canonical company types', () => {
    expect(companyTypeKeys('Relații clienți / Call center')).toEqual(['company_type:outsourcing_shared_services']);
    expect(companyTypeKeys('Grafică / Webdesign / DTP')).toEqual(['company_type:media_advertising']);
    expect(companyTypeKeys('Internet / e-Commerce')).toEqual([
      'company_type:information_technology',
      'company_type:retailer',
    ]);
    expect(companyTypeKeys('Naval / Aeronautic')).toEqual(['company_type:transportation', 'company_type:aviation']);
    expect(companyTypeKeys('Turism / Hotel staff')).toEqual(['company_type:hospitality']);
  });

  it.each([
    ['Adminisztráció, Irodai munka', ['company_type:outsourcing_shared_services']],
    ['Bank, Biztosítás, Bróker', ['company_type:banking_financial_services', 'company_type:insurance']],
    ['Cégvezetés, Menedzsment', ['company_type:professional_services']],
    ['Egészségügy, Gyógyszeripar', ['company_type:hospital_healthcare', 'company_type:pharma_biotech']],
    ['Építőipar, Ingatlan', ['company_type:construction', 'company_type:real_estate_property']],
    ['Értékesítés, Kereskedelem', ['company_type:retailer']],
    ['Fizikai, Segéd, Betanított munka', ['company_type:industrial_services']],
    ['Gyártás, Termelés', ['company_type:manufacturing']],
    ['HR, Munkaügy', ['company_type:agency']],
    ['IT programozás, Fejlesztés', ['company_type:information_technology']],
    ['IT üzemeltetés, Telekom', ['company_type:information_technology', 'company_type:telecom']],
    ['Jog, Jogi tanácsadás', ['company_type:professional_services']],
    ['Közigazgatás', ['company_type:government']],
    ['Marketing, Média, PR', ['company_type:media_advertising']],
    ['Mérnök', ['company_type:industrial_services']],
    ['Mezőgazdaság, Környezet', ['company_type:agriculture_agri_business', 'company_type:nonprofit']],
    ['Oktatás, Tudomány, Sport', ['company_type:education']],
    ['Pénzügy, Könyvelés', ['company_type:professional_services', 'company_type:banking_financial_services']],
    ['Szakmunka', ['company_type:industrial_services']],
    ['Szállítás, Beszerzés, Logisztika', ['company_type:transportation', 'company_type:warehouse_logistics']],
    ['Ügyfélszolgálat, Vevőszolgálat', ['company_type:outsourcing_shared_services']],
    ['Üzleti támogató központok', ['company_type:outsourcing_shared_services']],
    ['Vendéglátás, Idegenforgalom', ['company_type:hospitality']],
  ])('maps Hungarian job category facet "%s"', (surface, expected) => {
    expect(companyTypeKeys(surface)).toEqual(expected);
  });

  it('abstains on source labels without a precise company_type canonical target', () => {
    expect(companyTypeKeys('Altele')).toEqual([]);
  });

  it.each([
    ['Administrație / Sector Public', ['company_type:government']],
    ['Agrară', ['company_type:agriculture_agri_business']],
    ['Alimentară', ['company_type:food_beverage']],
    ['Artă / Entertainment', ['company_type:media_advertising']],
    ['Asigurări', ['company_type:insurance']],
    ['Bănci / Servicii financiare', ['company_type:banking_financial_services']],
    ['Call-center / BPO', ['company_type:outsourcing_shared_services']],
    ['Chimică', ['company_type:industrial_services']],
    ['Comerț / Retail', ['company_type:retailer']],
    ['Construcții', ['company_type:construction']],
    ['Drept', ['company_type:professional_services']],
    ['Educație / Training', ['company_type:education']],
    ['Energetică', ['company_type:energy']],
    ['Farma', ['company_type:pharma_biotech']],
    ['Imobiliară', ['company_type:real_estate_property']],
    ['IT / Telecom', ['company_type:information_technology', 'company_type:telecom']],
    ['Lemn / PVC', ['company_type:manufacturing']],
    ['Mașini / Auto', ['company_type:automotive']],
    ['Media / Internet', ['company_type:media_advertising', 'company_type:information_technology']],
    ['Medicină / Sănătate', ['company_type:hospital_healthcare']],
    ['Navală / Aeronautică', ['company_type:transportation', 'company_type:aviation']],
    ['Pază și protecție', ['company_type:security']],
    ['Petrol / Gaze', ['company_type:energy']],
    ['Prestări servicii', ['company_type:professional_services']],
    ['Producție', ['company_type:manufacturing']],
    ['Protecția mediului', ['company_type:nonprofit']],
    ['Publicitate / Marketing / PR', ['company_type:media_advertising']],
    ['Sport / Frumusețe', ['company_type:hospital_healthcare']],
    ['Textilă', ['company_type:manufacturing']],
    ['Transport / Logistică / Import - Export', ['company_type:transportation', 'company_type:warehouse_logistics']],
    ['Turism / HoReCa', ['company_type:hospitality']],
  ])('maps Romanian industry facet "%s"', (surface, expected) => {
    expect(companyTypeKeys(surface)).toEqual(expected);
  });

  it.each([
    ['Achiziții', ['company_type:professional_services']],
    ['Administrativ / Logistică', ['company_type:warehouse_logistics']],
    ['Agricultură', ['company_type:agriculture_agri_business']],
    ['Alimentație / HoReCa', ['company_type:hospitality', 'company_type:food_beverage']],
    ['Altele', []],
    ['Arhitectură / Design interior', ['company_type:construction']],
    ['Asigurări', ['company_type:insurance']],
    ['Au pair / Babysitter / Curățenie', ['company_type:cleaning_facilities']],
    ['Audit / Consultanță', ['company_type:professional_services']],
    ['Auto / Echipamente', ['company_type:automotive']],
    ['Automatizări', ['company_type:industrial_services']],
    ['Bănci', ['company_type:banking_financial_services']],
    ['Cercetare - dezvoltare', ['company_type:professional_services']],
    ['Chimie / Biochimie', ['company_type:industrial_services', 'company_type:pharma_biotech']],
    ['Confecții / Design vestimentar', ['company_type:manufacturing']],
    ['Construcții / Instalații', ['company_type:construction']],
    ['Controlul calității', ['company_type:manufacturing']],
    ['Crewing / Casino / Entertainment', ['company_type:hospitality', 'company_type:media_advertising']],
    ['Educație / Training / Arte', ['company_type:education', 'company_type:media_advertising']],
    ['Farmacie', ['company_type:pharma_biotech']],
    ['Financiar / Contabilitate', ['company_type:professional_services', 'company_type:banking_financial_services']],
    ['Funcții publice', ['company_type:government']],
    ['Grafică / Webdesign / DTP', ['company_type:media_advertising']],
    ['Imobiliare', ['company_type:real_estate_property']],
    ['Import - export', ['company_type:transportation']],
    ['Inginerie', ['company_type:industrial_services']],
    ['Instalații electrice', ['company_type:industrial_services']],
    ['Instalații sanitare', ['company_type:industrial_services']],
    ['Instalații termice', ['company_type:industrial_services']],
    ['Internet / e-Commerce', ['company_type:information_technology', 'company_type:retailer']],
    ['IT Hardware', ['company_type:information_technology']],
    ['IT Software', ['company_type:information_technology']],
    ['Juridic', ['company_type:professional_services']],
    ['Jurnalism / Editorial', ['company_type:media_advertising']],
    ['Management', ['company_type:professional_services']],
    ['Marketing', ['company_type:media_advertising']],
    ['Medicină alternativă', ['company_type:hospital_healthcare']],
    ['Medicină umană', ['company_type:hospital_healthcare']],
    ['Medicină veterinară', ['company_type:hospital_healthcare']],
    ['Merchandising / Promoteri', ['company_type:retailer']],
    ['MLM / Vânzări directe', ['company_type:retailer']],
    ['Naval / Aeronautic', ['company_type:transportation', 'company_type:aviation']],
    ['Office / Back-office / Secretariat', ['company_type:outsourcing_shared_services']],
    ['ONG / Voluntariat', ['company_type:nonprofit']],
    ['Pază și protecție / Militar', ['company_type:security']],
    ['Personal calificat', ['company_type:industrial_services']],
    ['Petrol / Gaze', ['company_type:energy']],
    ['Prelucrarea lemnului / PVC', ['company_type:manufacturing']],
    ['Producție', ['company_type:manufacturing']],
    ['Proiectare civilă / industrială', ['company_type:construction', 'company_type:industrial_services']],
    ['Project Management', ['company_type:professional_services']],
    ['Protecția mediului', ['company_type:nonprofit']],
    ['Protecția muncii', ['company_type:hospital_healthcare']],
    ['Publicitate', ['company_type:media_advertising']],
    ['Relații clienți / Call center', ['company_type:outsourcing_shared_services']],
    ['Relații publice', ['company_type:media_advertising']],
    ['Resurse umane / Psihologie', ['company_type:agency']],
    ['Saloane / Clinici frumusețe', ['company_type:hospital_healthcare']],
    ['Service / Reparații', ['company_type:industrial_services']],
    ['Specialiști / Tehnicieni', ['company_type:industrial_services']],
    ['Sport / Wellness', ['company_type:hospital_healthcare']],
    ['Statistică / Matematică', ['company_type:professional_services']],
    ['Telecomunicații', ['company_type:telecom']],
    ['Tipografii / Edituri', ['company_type:media_advertising']],
    ['Traduceri', ['company_type:professional_services']],
    ['Transport / Distribuție', ['company_type:transportation', 'company_type:warehouse_logistics']],
    ['Turism / Hotel staff', ['company_type:hospitality']],
    ['Vânzări', ['company_type:retailer']],
  ])('maps Romanian job category facet "%s"', (surface, expected) => {
    expect(companyTypeKeys(surface)).toEqual(expected);
  });

  it('maps generated punctuation, diacritic, count, and synonym variants', () => {
    expect(companyTypeKeys('Ugyfelszolgalat / Vevoszolgalat (12)')).toEqual([
      'company_type:outsourcing_shared_services',
    ]);
    expect(companyTypeKeys('IT telekommunikacio')).toEqual([
      'company_type:information_technology',
      'company_type:telecom',
    ]);
    expect(companyTypeKeys('Turism HoReCa (8)')).toEqual(['company_type:hospitality']);
  });

  it('maps Estonian category and industry labels to canonical company types', () => {
    expect(companyTypeKeysEt('Põllumajandus, kalandus ja metsandus')).toEqual([
      'company_type:agriculture_agri_business',
    ]);
    expect(companyTypeKeysEt('Pangandus, finants ja kindlustus')).toEqual([
      'company_type:banking_financial_services',
      'company_type:insurance',
    ]);
    expect(companyTypeKeysEt('IT / Telekom')).toEqual(['company_type:information_technology', 'company_type:telecom']);
    expect(companyTypeKeysEt('Transport ja logistika')).toEqual([
      'company_type:transportation',
      'company_type:warehouse_logistics',
    ]);
    expect(companyTypeKeysEt('Meditsiin ja farmaatsia')).toEqual([
      'company_type:hospital_healthcare',
      'company_type:pharma_biotech',
    ]);
    expect(companyTypeKeysEt('Kinnisvara ja kinnisvarahaldus')).toEqual(['company_type:real_estate_property']);
    expect(companyTypeKeysEt('Autotööstus ja lennundus')).toEqual(['company_type:automotive', 'company_type:aviation']);
  });

  it.each([
    ['Assisteerimine / Administreerimine', ['company_type:outsourcing_shared_services']],
    ['Ehitus / Kinnisvara', ['company_type:construction', 'company_type:real_estate_property']],
    ['Elektroonika / Telekommunikatsioon', ['company_type:industrial_services', 'company_type:telecom']],
    ['Energeetika / Loodusvarad', ['company_type:energy']],
    ['Finants', ['company_type:banking_financial_services']],
    ['Haridus / Teadus', ['company_type:education']],
    ['Infotehnoloogia', ['company_type:information_technology']],
    ['Juhtimine', ['company_type:professional_services']],
    ['Klienditeenindus', ['company_type:outsourcing_shared_services']],
    ['Koolitus / Personalitöö', ['company_type:education', 'company_type:agency']],
    ['Korrakaitse / Turva / Julgeolek', ['company_type:security']],
    ['Kultuur / Meelelahutus', ['company_type:media_advertising']],
    ['Meedia / Loomemajandus / Tõlkimine', ['company_type:media_advertising']],
    ['Mehaanika / Tehnika', ['company_type:industrial_services']],
    ['Merendus', ['company_type:transportation']],
    ['Müük', ['company_type:retailer']],
    ['Pangandus', ['company_type:banking_financial_services']],
    ['Põllumajandus / Metsandus', ['company_type:agriculture_agri_business']],
    ['Riigi- ja avalik haldus', ['company_type:government']],
    ['Tervishoid / Sotsiaaltöö', ['company_type:hospital_healthcare']],
    ['Toitlustus', ['company_type:hospitality', 'company_type:food_beverage']],
    ['Transport / Logistika', ['company_type:transportation', 'company_type:warehouse_logistics']],
    ['Turism / Hotellindus / Iluteenused', ['company_type:hospitality', 'company_type:hospital_healthcare']],
    ['Turundus / Reklaam / PR', ['company_type:media_advertising']],
    ['Tööstus / Tootmine', ['company_type:manufacturing']],
    ['Vabatahtlik töö', ['company_type:nonprofit']],
    ['Õigusala', ['company_type:professional_services']],
    ['Підходить і для українців', []],
  ])('maps Estonian source company-type label "%s"', (surface, expected) => {
    expect(companyTypeKeysEt(surface)).toEqual(expected);
  });

  it('keeps Estonian finite facets locale-scoped and normalized', () => {
    expect(companyTypeKeysEt('IT telekommunikatsioon (3)')).toEqual([
      'company_type:information_technology',
      'company_type:telecom',
    ]);
    expect(inferCompanyType(C('IT / Telekom'), ['ro']).map((x) => x.canonicalKey)).toEqual([]);
  });

  it('keeps acronym-only facet aliases case-sensitive', () => {
    expect(companyTypeKeys('HR')).toEqual(['company_type:agency']);
    expect(companyTypeKeys('hr')).toEqual([]);
    expect(companyTypeKeys('stray hr')).toEqual([]);
  });
});

describe('schedule inference', () => {
  it('reads shift idioms and counts', () => {
    expect(schKeys('lucru in 2 schimburi')).toContain('schedule:rotational_shift');
    expect(schKeys('tura de noapte')).toContain('schedule:night_shift');
    expect(schKeys('program flexibil')).toContain('schedule:flexible_hours');
  });
  it('reads clock time-ranges', () => {
    expect(schKeys('program 22:00-06:00')).toContain('schedule:night_shift');
    expect(schKeys('program 09:00-17:00')).toContain('schedule:9_to_5');
    expect(schKeys('luni-vineri')).toContain('schedule:9_to_5');
  });
  it('does not treat "1-3 years" as a time range', () => {
    expect(schKeys('1-3 years of experience required')).toEqual([]);
  });
  it('respects negation for weekend', () => {
    expect(schKeys('weekends only')).toContain('schedule:weekend_only');
    expect(schKeys('fara weekend')).not.toContain('schedule:weekend_only');
  });
  it('maps Hungarian structured schedule labels', () => {
    expect(schKeys('Kötött munkarend')).toContain('schedule:9_to_5');
    expect(schKeys('Kötetlen munkarend')).toContain('schedule:flexible_hours');
    expect(schKeys('2 műszakos munkarend')).toContain('schedule:rotational_shift');
    expect(schKeys('3 műszakos munkarend')).toContain('schedule:rotational_shift');
    expect(schKeys('Több műszakos munkarend')).toContain('schedule:rotational_shift');
  });
});

describe('workplace inference', () => {
  it('maps Hungarian structured workplace labels with optional count suffixes', () => {
    expect(workplaceKeys('Hibrid/Home office (83)')).toContain('workplace:hybrid');
    expect(workplaceKeys('Hibrid / Home office')).toContain('workplace:hybrid');
    expect(workplaceKeys('Távmunka/Remote (4)')).toContain('workplace:remote');
    expect(workplaceKeys('Tavmunka / Remote')).toContain('workplace:remote');
  });
});

describe('benefits inference', () => {
  it("reads bare medical-benefit mentions as health_insurance, not private_medical (avoids double-firing the dictionary's own bare alias)", () => {
    expect(benefitsKeys('asigurare medicala si salariu fix')).toContain('benefits:health_insurance');
    expect(benefitsKeys('asigurare medicala si salariu fix')).not.toContain('benefits:private_medical');
    expect(benefitsKeys('servicii medicale gratuite si asigurare de viata')).toContain('benefits:health_insurance');
  });
  it('reads "transport gratuit" as transport provided', () => {
    expect(benefitsKeys('transport gratuit de la tine de acasa')).toContain('benefits:transport_provided');
  });
  it('reads bare "training" mentions, including the RO plural', () => {
    expect(benefitsKeys('oferim training in vederea sporirii abilitatilor')).toContain('benefits:paid_training');
    expect(benefitsKeys('training-uri constante')).toContain('benefits:paid_training');
    expect(benefitsKeys('traininguri constante')).toContain('benefits:paid_training');
  });
  it('reads the reordered "zile de concediu suplimentare" as extra vacation days', () => {
    expect(benefitsKeys('oferim zile de concediu suplimentare')).toContain('benefits:extra_vacation_days');
  });
  it('reads bare Hungarian medical/transport/training mentions', () => {
    expect(benefitsKeys('egészségbiztosítás és bér')).toContain('benefits:health_insurance');
    expect(benefitsKeys('egészségbiztosítás és bér')).not.toContain('benefits:private_medical');
    expect(benefitsKeys('ingyenes szállítás a munkahelyre')).toContain('benefits:transport_provided');
    expect(benefitsKeys('rendszeres képzés')).toContain('benefits:paid_training');
    expect(benefitsKeys('céges tréning program')).toContain('benefits:paid_training');
  });
  it('reads bare Estonian transport/training mentions', () => {
    expect(benefitsKeys('tasuta transport töökohta')).toContain('benefits:transport_provided');
    expect(benefitsKeys('pidev koolitus')).toContain('benefits:paid_training');
  });
  it('reads EN "medical aid", bare "pension", and "leave allowance"', () => {
    expect(benefitsKeys('medical aid and pension')).toContain('benefits:health_insurance');
    expect(benefitsKeys('medical aid and pension')).toContain('benefits:pension_scheme');
    expect(benefitsKeys('annual leave allowance paid out')).toContain('benefits:paid_time_off');
  });
  it('reads "car allowance" as transport_allowance and "housing allowance" as a new housing_allowance key, across RO/HU/ET/EN', () => {
    expect(benefitsKeys('salary plus car allowance')).toContain('benefits:transport_allowance');
    expect(benefitsKeys('housing allowance provided')).toContain('benefits:housing_allowance');
    expect(benefitsKeys('oferim indemnizatie auto')).toContain('benefits:transport_allowance');
    expect(benefitsKeys('oferim indemnizatie de cazare')).toContain('benefits:housing_allowance');
    expect(benefitsKeys('autohozzajarulas biztositott')).toContain('benefits:transport_allowance');
    expect(benefitsKeys('lakhatasi tamogatas jar')).toContain('benefits:housing_allowance');
    expect(benefitsKeys('autohuvitis tagatud')).toContain('benefits:transport_allowance');
    expect(benefitsKeys('pakume eluasemetoetus')).toContain('benefits:housing_allowance');
  });
});

describe('compensation inference', () => {
  it('reads the RO plural and "prima" synonym for performance bonus', () => {
    expect(compKeys('bonusuri de performanta')).toContain('compensation:performance_bonus');
    expect(compKeys('prima de performanta lunara')).toContain('compensation:performance_bonus');
  });
  it('reads "sales bonus" as a performance bonus', () => {
    expect(compKeys('a competitive fixed salary and sales bonus')).toContain('compensation:performance_bonus');
  });
  it('reads the Hungarian plural/premium synonym and sales bonus', () => {
    expect(compKeys('teljesítmény bonuszok havonta')).toContain('compensation:performance_bonus');
    expect(compKeys('teljesítmény prémium')).toContain('compensation:performance_bonus');
    expect(compKeys('értékesítési bónusz')).toContain('compensation:performance_bonus');
  });
  it('reads the Estonian premium synonym and sales bonus', () => {
    expect(compKeys('tulemuspreemia iga kuu')).toContain('compensation:performance_bonus');
    expect(compKeys('müügiboonus')).toContain('compensation:performance_bonus');
  });
});

describe('level inference', () => {
  it('maps years of experience to a seniority level', () => {
    expect(lvlKeys('minim 1 an experienta')).toContain('level:junior');
    expect(lvlKeys('at least 2 years experience')).toContain('level:junior');
    expect(lvlKeys('3-5 years of experience')).toContain('level:mid_level'); // lower bound 3
    expect(lvlKeys('5+ years experience')).toContain('level:senior');
    expect(lvlKeys('peste 7 ani experienta')).toContain('level:senior');
  });
  it('reads explicit tokens and abbreviations', () => {
    expect(lvlKeys('Sr. Software Engineer')).toContain('level:senior');
    expect(lvlKeys('Jr Developer')).toContain('level:junior');
    expect(lvlKeys('Head of Marketing')).toContain('level:director');
    expect(lvlKeys('CTO / C-level role')).toContain('level:executive');
    expect(lvlKeys('debutant, fara experienta')).toContain('level:entry_level');
  });
  it('reads team-management idioms (multilingual)', () => {
    expect(lvlKeys('vei coordona o echipa')).toContain('level:lead');
    expect(lvlKeys('responsabil de echipa')).toContain('level:manager');
  });
  it('maps Estonian structured level labels', () => {
    expect(inferLevel(C('Algtase'), ['et']).map((x) => x.canonicalKey)).toContain('level:entry_level');
    expect(inferLevel(C('Juunior tase'), ['et']).map((x) => x.canonicalKey)).toContain('level:junior');
    expect(inferLevel(C('Kesktase'), ['et']).map((x) => x.canonicalKey)).toContain('level:mid_level');
    expect(inferLevel(C('Vanemspetsialist'), ['et']).map((x) => x.canonicalKey)).toContain('level:senior');
    expect(inferLevel(C('Meeskonnajuht'), ['et']).map((x) => x.canonicalKey)).toContain('level:lead');
    expect(inferLevel(C('Osakonnajuht'), ['et']).map((x) => x.canonicalKey)).toContain('level:manager');
    expect(inferLevel(C('C-tase'), ['et']).map((x) => x.canonicalKey)).toContain('level:executive');
  });
  it('does not treat "1-3 years" numeric range edges as hours', () => {
    expect(lvlKeys('program 1-3')).toEqual([]); // no years word -> nothing
  });
});

describe('semantic level classifier', () => {
  // Structural tests over SYNTHETIC exemplars + a deterministic stub embedder — no
  // real model, no per-locale production phrases asserted. Vectors are hand-placed
  // in a tiny 3-d space so cosine geometry (near / orthogonal / locale-gated) is
  // exact and readable; the classifier's behaviour is asserted, not the corpus.
  const unit = (v: number[]): Float32Array => {
    const n = Math.hypot(...v) || 1;
    return new Float32Array(v.map((x) => x / n));
  };
  // A stub embedder: known text → placed vector; anything unmapped → zero vector
  // (cosine 0 to everything → always abstains). Serves both index build and queries.
  const stubEmbedder = (map: Record<string, number[]>): TextEmbedder => {
    const at = (t: string) => unit(map[t] ?? [0, 0, 0]);
    return {
      model: 'stub',
      async embed(ts) {
        return ts.map(at);
      },
      async embedOne(t) {
        return at(t);
      },
    };
  };

  const GROUPS: LevelExemplarGroup[] = [
    { key: 'level:lead', locale: 'ro', phrases: ['LEAD_PHRASE'] },
    { key: 'level:manager', locale: 'ro', phrases: ['MANAGER_PHRASE'] },
    { key: 'level:senior', locale: 'hu', phrases: ['HU_ONLY_PHRASE'] }, // locale-gated
  ];
  const VEC: Record<string, number[]> = {
    LEAD_PHRASE: [1, 0, 0],
    MANAGER_PHRASE: [0, 1, 0],
    HU_ONLY_PHRASE: [0, 0, 1],
    near_lead: [0.9, 0.1, 0], // clearly closest to LEAD
    between: [1, 1, 0], // equidistant lead/manager → deterministic tie-break
    orthogonal: [0, 0, 1], // matches only the hu-gated exemplar's direction
  };

  const buildIndex = () => LevelExemplarIndex.build(stubEmbedder(VEC), GROUPS);

  it('classifies a clause to its nearest band above threshold', async () => {
    const index = await buildIndex();
    const best = index.classify(unit(VEC.near_lead), new Set(['ro', 'en', 'global']), 0.5);
    expect(best?.key).toBe('level:lead');
    expect(best?.score).toBeGreaterThan(0.9);
  });

  it('abstains (null) when the nearest band is below threshold', async () => {
    const index = await buildIndex();
    // cosine(near_lead, LEAD) ≈ 0.994 — a threshold above it forces abstention.
    expect(index.classify(unit(VEC.near_lead), new Set(['ro']), 0.999)).toBeNull();
    // an unmapped clause embeds to the zero vector → cosine 0 to every band.
    expect(index.classify(unit([0, 0, 0]), new Set(['ro']), 0.5)).toBeNull();
  });

  it('restricts comparison to the query locale set (a hu-only exemplar is unseen for ro)', async () => {
    const index = await buildIndex();
    // The only exemplar aligned with `orthogonal` is the hu-gated one. Under ro+en it
    // is filtered out, so no band clears threshold; under hu it resolves.
    expect(index.classify(unit(VEC.orthogonal), new Set(['ro', 'en', 'global']), 0.5)).toBeNull();
    expect(index.classify(unit(VEC.orthogonal), new Set(['hu']), 0.5)?.key).toBe('level:senior');
  });

  it('breaks exact ties deterministically by exemplar order', async () => {
    const index = await buildIndex();
    const a = index.classify(unit(VEC.between), new Set(['ro']), 0.5);
    const b = index.classify(unit(VEC.between), new Set(['ro']), 0.5);
    expect(a?.key).toBe('level:lead'); // lead precedes manager in GROUPS
    expect(b?.key).toBe(a?.key); // stable across calls
  });

  it('makeLevelClassifier emits an InferredTerm per near clause and abstains otherwise', async () => {
    const embedder = stubEmbedder(VEC);
    const index = await LevelExemplarIndex.build(embedder, GROUPS);
    const classify = makeLevelClassifier(embedder, index, { threshold: 0.5 });

    const hit = await classify([{ text: 'near_lead', source: 'text' }], 'ro');
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ canonicalKey: 'level:lead', evidence: 'near_lead' });
    expect(hit[0].score).toBeGreaterThan(0.9);

    // Unmapped clause → zero vector → abstain → no terms.
    expect(await classify([{ text: 'unrelated occupation', source: 'text' }], 'ro')).toEqual([]);
    // Empty input → empty (never loads/queries).
    expect(await classify([], 'ro')).toEqual([]);
  });
});

describe('logistic-regression level classifier', () => {
  it('extracts word uni/bigrams and boundary char-grams deterministically', () => {
    const f = levelFeatures('Sef de tura');
    expect(levelFeatures('Sef de tura')).toEqual(f); // deterministic
    expect(f).toContain('w:sef'); // unigram, diacritic/case folded
    expect(f).toContain('w2:sef_de'); // bigram — the compositional signal
    expect(f).toContain('w2:de_tura');
    expect(f).toContain('c:^se'); // boundary-anchored char trigram of "sef"
    expect(f.some((x) => x.startsWith('c:'))).toBe(true);
  });

  it('vectorizes to an L2-normalized sparse vector and drops out-of-vocab features', () => {
    const vocab = new Map([
      ['w:senior', 0],
      ['w:manager', 1],
    ]);
    const v = vectorize('senior manager', vocab);
    expect([...v.keys()].sort()).toEqual([0, 1]);
    const norm = Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0));
    expect(norm).toBeCloseTo(1, 6);
    // A title whose features are all OOV → empty vector (no weight to apply).
    expect(vectorize('zzz qqq', vocab).size).toBe(0);
  });

  // A tiny hand-built model: 3 classes, one discriminative unigram each. Lets us
  // assert the softmax/abstain LOGIC structurally without training a real model.
  const model: LevelLrModel = {
    classes: ['level:lead', 'level:manager', 'none'],
    vocab: { 'w:lead': 0, 'w:manager': 1, 'w:zugrav': 2 },
    bias: [0, 0, 0],
    weights: [{ 0: 6 }, { 1: 6 }, { 2: 6 }], // each class keyed to its own feature
  };

  it('produces a proper probability distribution (sums to 1)', () => {
    const probs = predictProbs(loadLevelLr(model), 'lead role');
    expect(probs.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 6);
    expect(probs[0]).toBeGreaterThan(probs[1]); // 'lead' feature present → lead wins
  });

  it('emits the top band above threshold, abstains on none-dominant or low-confidence titles', () => {
    const m = loadLevelLr(model);
    const classify = (text: string) => inferLevelLr([{ text, source: 'text' }], m, { threshold: 0.5 });
    // Clear band signal → emitted.
    const lead = classify('lead productie');
    expect(lead).toEqual([{ canonicalKey: 'level:lead', score: expect.any(Number), evidence: 'lead productie' }]);
    expect(lead[0].score).toBeGreaterThan(0.5);
    // 'none' feature dominates → abstain.
    expect(classify('zugrav')).toEqual([]);
    // No known features → flat softmax, top prob 1/3 < threshold → abstain.
    expect(classify('complet necunoscut')).toEqual([]);
  });

  it('dedupes a band across clauses, keeping the higher-confidence evidence', () => {
    const out = inferLevelLr(
      [
        { text: 'lead', source: 'text' },
        { text: 'lead manager', source: 'text' }, // weaker lead signal (manager competes)
      ],
      loadLevelLr(model),
      { threshold: 0.5 },
    );
    expect(out.filter((t) => t.canonicalKey === 'level:lead')).toHaveLength(1);
  });
});

describe('inferLevel with the LR fold (enableLr)', () => {
  // A tiny model whose only feature maps "supervizor" → lead. The RO regex maps the
  // same word → manager, so this exercises the disagreement/override path structurally.
  const overrideModel = loadLevelLr({
    classes: ['level:lead', 'level:manager', 'none'],
    vocab: { 'w:supervizor': 0 },
    bias: [0, 0, 0],
    weights: [{ 0: 6 }, {}, {}],
  });

  it('is pure regex by default (enableLr off) — no behavior change, no model dependency', () => {
    expect(lvlKeys('supervizor')).toEqual(['level:manager']); // via the existing helper (no options)
    expect(inferLevel(C('supervizor'), ['ro'], { enableLr: false }).map((t) => t.canonicalKey)).toEqual([
      'level:manager',
    ]);
  });

  it('lets a confident LR band OVERRIDE the disagreeing regex band on the same clause', () => {
    const folded = inferLevel(C('supervizor'), ['ro'], { enableLr: true, lrModel: overrideModel, lrThreshold: 0.5 });
    const keys = folded.map((t) => t.canonicalKey);
    expect(keys).toContain('level:lead'); // LR's band
    expect(keys).not.toContain('level:manager'); // regex's band suppressed by the override
  });

  it('keeps the regex band when the LR is silent on the clause (no wrongful suppression)', () => {
    // "junior" has no feature in overrideModel → LR abstains → regex junior preserved.
    const folded = inferLevel(C('junior'), ['ro'], { enableLr: true, lrModel: overrideModel, lrThreshold: 0.5 });
    expect(folded.map((t) => t.canonicalKey)).toEqual(['level:junior']);
  });
});

describe('qualification inference — driving license (strict)', () => {
  it('reads a license class only with a license word present', () => {
    expect(qKeys('permis categoria B')).toContain('qualification:license:driving_license_b');
    expect(qKeys('driving licence category C')).toContain('qualification:license:driving_license_c');
    expect(qKeys('class CE license required')).toContain('qualification:license:driving_license_ce');
    expect(qKeys('permis cat. D')).toContain('qualification:license:driving_license_d');
  });
  it('does NOT fire on a bare letter without a license word', () => {
    expect(qKeys('category B products')).toEqual([]);
    expect(qKeys('go with plan B')).toEqual([]);
    expect(qKeys('option C is best')).toEqual([]);
  });
  it('ignores classes not in the taxonomy (A, BE)', () => {
    expect(qKeys('permis categoria A')).toEqual([]);
  });
});

describe('qualification inference — language requirement (strict)', () => {
  it('reads a language only with a requirement cue nearby', () => {
    expect(qKeys('limba engleza nivel avansat')).toContain('qualification:language_requirement:english');
    expect(qKeys('fluent English required')).toContain('qualification:language_requirement:english');
    expect(qKeys('cunostinte de limba franceza')).toContain('qualification:language_requirement:french');
    expect(qKeys('magyar nyelvtudas')).toContain('qualification:language_requirement:hungarian');
  });
  it('does NOT fire on an incidental language mention', () => {
    expect(qKeys('send your English CV')).toEqual([]);
    expect(qKeys('a Romanian company based in Cluj')).toEqual([]);
  });
});

describe('inference through the extractor', () => {
  const TERMS: DictionaryTerm[] = [
    {
      canonicalKey: 'employment:full_time',
      bucket: 'employment',
      termType: 'employment_type',
      displayName: 'Full Time',
      value: 'Full Time',
      languageCode: 'en',
      aliases: ['full time'],
    },
    {
      canonicalKey: 'schedule:night_shift',
      bucket: 'schedule',
      termType: 'schedule_type',
      displayName: 'Night Shift',
      value: 'Night Shift',
      languageCode: 'en',
      aliases: ['night shift'],
    },
  ];
  const embedder: TextEmbedder = {
    model: 'stub',
    async embed(t) {
      return t.map(() => new Float32Array(2));
    },
    async embedOne() {
      return new Float32Array(2);
    },
  };
  const extractor = TermExtractor.fromComponents({
    store: VectorStore.fromEntries(
      'stub',
      2,
      TERMS.map((t) => ({ term: t, vector: new Float32Array([1, 0]) })),
    ),
    lexical: LexicalIndex.fromTerms(TERMS),
    embedder,
  });

  it('adds an inferred employment term with method "inferred" and real display', async () => {
    const r = await extractor.extract('Program 8 ore pe zi.', { targetBuckets: ['employment'] });
    const ft = r.matchesByBucket.employment?.[0];
    expect(ft?.canonicalKey).toBe('employment:full_time');
    expect(ft?.method).toBe('inferred');
    expect(ft?.displayName).toBe('Full Time'); // enriched from the store
  });

  it('an explicit alias outranks and relabels the inferred hit', async () => {
    // "night shift" is an exact alias AND inferred -> method should be lexical (explicit).
    const r = await extractor.extract('Night shift, program 22:00-06:00', { targetBuckets: ['schedule'] });
    const ns = r.matchesByBucket.schedule?.find((t) => t.canonicalKey === 'schedule:night_shift');
    expect(ns?.method).toBe('lexical');
  });
});
