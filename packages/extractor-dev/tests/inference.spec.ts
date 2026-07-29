import { describe, expect, it } from 'vitest';
import { levelFeatures, vectorize } from '../../../src/classifier/level-features.ts';
import { inferLevelLr, type LevelLrModel, loadLevelLr, predictProbs } from '../../../src/classifier/level-lr.ts';
import { inferEmployment } from '../../../src/inference/employment.ts';
import { facetCollisionErrors } from '../../../src/inference/facets.ts';
import { inferJobFunction } from '../../../src/inference/job-function.ts';
import { inferLevel } from '../../../src/inference/level.ts';
import { inferQualifications } from '../../../src/inference/qualifications.ts';
import { inferSchedule } from '../../../src/inference/schedule.ts';
import { inferSector } from '../../../src/inference/sector.ts';
import { deriveBenefitVariations } from '../../../src/inference/benefits.ts';
import { deriveCompensationVariations } from '../../../src/inference/compensation.ts';
import { inferWorkplace } from '../../../src/inference/workplace.ts';
import type { Clause } from '../../../src/tokenizer.ts';
import type { DictionaryTerm } from '../../../src/types.ts';
import { VectorStore } from '../../../src/vector-store.ts';
import { buildLexicalIndex } from '../../../test/support/lexical.ts';
import type { LevelExemplarGroup } from '../src/classifier/level-exemplars.ts';
import { LevelExemplarIndex, makeLevelClassifier } from '../src/classifier/level-semantic.ts';
import type { TextEmbedder } from '../src/embedder.ts';
import { TermExtractor } from '../src/extractor.ts';

const C = (t: string): Clause[] => [{ text: t, source: 'text' }];
const empKeys = (t: string) => inferEmployment(C(t)).map((x) => x.canonicalKey);
const sectorKeys = (t: string, languages?: Parameters<typeof inferSector>[1]) =>
  inferSector(C(t), languages).map((x) => x.canonicalKey);
const jobFunctionKeys = (t: string, languages?: Parameters<typeof inferJobFunction>[1]) =>
  inferJobFunction(C(t), languages).map((x) => x.canonicalKey);
const schKeys = (t: string) => inferSchedule(C(t)).map((x) => x.canonicalKey);
const workplaceKeys = (t: string) => inferWorkplace(C(t)).map((x) => x.canonicalKey);
const benefitsKeys = (t: string) => deriveBenefitVariations(C(t)).map((x) => x.canonicalKey);
const compKeys = (t: string) => deriveCompensationVariations(C(t)).map((x) => x.canonicalKey);
const lvlKeys = (t: string) => inferLevel(C(t)).map((x) => x.canonicalKey);
const qKeys = (
  t: string,
  languages?: Parameters<typeof inferQualifications>[1],
  options?: Parameters<typeof inferQualifications>[2],
) => inferQualifications(C(t), languages, options).map((x) => x.canonicalKey);

const HU_BENEFITS_PENDING = [
  { phrase: 'Céges üdülés, üdültetés', locale: 'hu', seenCount: 1 },
  { phrase: 'Lakhatási támogatás', locale: 'hu', seenCount: 1 },
  { phrase: 'Beiskolázási támogatás', locale: 'hu', seenCount: 1 },
] as const;

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

describe('sector and job_function inference — split source facets', () => {
  it('maps English sectors to sector', () => {
    expect(sectorKeys('Banking, Finance & Insurance')).toEqual([
      'sector:banking_financial_services',
      'sector:insurance',
    ]);
    expect(sectorKeys('IT & Telecoms')).toEqual(['sector:information_technology', 'sector:telecom']);
    expect(sectorKeys('Retail, Fashion & FMCG')).toEqual(['sector:retailer', 'sector:food_beverage']);
    expect(sectorKeys('Finance')).toEqual(['sector:banking_financial_services']);
    expect(sectorKeys('Insurance')).toEqual(['sector:insurance']);
    expect(sectorKeys('Technology')).toEqual(['sector:information_technology']);
  });

  it('maps English job functions to job_function', () => {
    expect(jobFunctionKeys('Accounting, Auditing & Finance')).toEqual(['job_function:finance_accounting']);
    expect(jobFunctionKeys('Auditing')).toEqual(['job_function:finance_accounting']);
    expect(jobFunctionKeys('Micro-finance')).toEqual(['job_function:banking']);
    expect(jobFunctionKeys('micro_finance')).toEqual(['job_function:banking']);
    expect(jobFunctionKeys('Supply Chain & Procurement')).toEqual([
      'job_function:operations_logistics',
      'job_function:procurement',
    ]);
    expect(jobFunctionKeys('Management & Business Development')).toEqual([
      'job_function:management',
      'job_function:business_development',
    ]);
    expect(jobFunctionKeys('Employability & Soft Skills')).toEqual([]);
  });

  it('maps Romanian sectors to sector and job functions to job_function', () => {
    expect(sectorKeys('Administrație / Sector Public', ['ro'])).toEqual(['sector:government']);
    expect(sectorKeys('Media / Internet', ['ro'])).toEqual([
      'sector:media_advertising',
      'sector:information_technology',
    ]);
    const expectedSectors: Array<[string, string[]]> = [
      ['Publicitate, media si comunicare', ['sector:media_advertising']],
      ['Agricultura, pescuit si silvicultura', ['sector:agriculture_agri_business']],
      ['Industria Auto', ['sector:automotive']],
      ['Bancar, finante si asigurari', ['sector:banking_financial_services']],
      ['Constructii si infrastructura', ['sector:construction']],
      ['Educatie', ['sector:education']],
      ['Energie si utilitati', ['sector:energy']],
      ['Paza si securitate', ['sector:security']],
      ['Divertisment si arta', ['sector:media_advertising']],
      ['Sector public', ['sector:government']],
      ['Medicina si farmaceutica', ['sector:hospital_healthcare']],
      ['Hoteluri, restaurante si catering', ['sector:hospitality']],
      ['IT si telecomunicatii', ['sector:information_technology']],
      ['Lege si conformitate', ['sector:professional_services']],
      ['Productie si depozitare', ['sector:manufacturing', 'sector:warehouse_logistics']],
      ['Minerit', ['sector:energy']],
      ['ONG, caritate si protectia mediului', ['sector:nonprofit']],
      ['Imobiliare si managementul proprietatilor', ['sector:real_estate_property']],
      ['Recrutare', ['sector:professional_services']],
      ['Retail, moda si bunuri de larg consum', ['sector:retailer']],
      ['Transport si logistica', ['sector:transportation', 'sector:warehouse_logistics']],
      ['Turism si recreere', ['sector:hospitality']],
      ['Industria Aeronautica', ['sector:aviation']],
      ['Industria Navala', ['sector:transportation']],
      ['Sport si welness', ['sector:media_advertising']],
    ];
    for (const [text, keys] of expectedSectors) {
      expect(sectorKeys(text, ['ro'])).toEqual(keys);
    }
    const exactSectorLabels: Array<[string, string[]]> = [
      ['Agrară', ['sector:agriculture_agri_business']],
      ['Alimentară', ['sector:food_beverage']],
      ['Artă / Entertainment', ['sector:media_advertising']],
      ['Asigurări', ['sector:insurance']],
      ['Bănci / Servicii financiare', ['sector:banking_financial_services']],
      ['Call-center / BPO', ['sector:professional_services']],
      ['Chimică', ['sector:industrial_services']],
      ['Comerț / Retail', ['sector:retailer']],
      ['Construcții', ['sector:construction']],
      ['Drept', ['sector:professional_services']],
      ['Educație / Training', ['sector:education']],
      ['Energetică', ['sector:energy']],
      ['Farma', ['sector:pharma_biotech']],
      ['Imobiliară', ['sector:real_estate_property']],
      ['IT / Telecom', ['sector:information_technology', 'sector:telecom']],
      ['Lemn / PVC', ['sector:manufacturing']],
      ['Mașini / Auto', ['sector:automotive']],
      ['Media / Internet', ['sector:media_advertising', 'sector:information_technology']],
      ['Medicină / Sănătate', ['sector:hospital_healthcare']],
      ['Navală / Aeronautică', ['sector:transportation', 'sector:aviation']],
      ['Pază și protecție', ['sector:security']],
      ['Petrol / Gaze', ['sector:energy']],
      ['Prestări servicii', ['sector:professional_services']],
      ['Producție', ['sector:manufacturing']],
      ['Protecția mediului', ['sector:nonprofit']],
      ['Publicitate / Marketing / PR', ['sector:media_advertising']],
      ['Sport / Frumusețe', ['sector:media_advertising']],
      ['Textilă', ['sector:manufacturing']],
      ['Transport / Logistică / Import - Export', ['sector:transportation', 'sector:warehouse_logistics']],
      ['Turism / HoReCa', ['sector:hospitality']],
    ];
    for (const [text, keys] of exactSectorLabels) {
      expect(sectorKeys(text, ['ro'])).toEqual(keys);
    }
    const expected: Array<[string, string[]]> = [
      ['Vânzări', ['job_function:sales_commerce']],
      ['vanzari', ['job_function:sales_commerce']],
      ['IT Hardware', ['job_function:it_software_data']],
      ['IT Software', ['job_function:it_software_data']],
      ['Internet / e-Commerce', ['job_function:it_software_data']],
      ['Telecomunicații', ['job_function:it_software_data']],
      ['Construcții / Instalații', ['job_function:skilled_trades']],
      ['Achiziții', ['job_function:procurement']],
      ['Specialiști / Tehnicieni', ['job_function:mechanical_technical']],
      ['Office / Back-office / Secretariat', ['job_function:administration']],
      ['office-secretariat', ['job_function:administration']],
      ['Producție', ['job_function:skilled_trades']],
      ['Imobiliare', ['job_function:sales_commerce']],
      ['Relații clienți / Call center', ['job_function:customer_support']],
      ['Medicină umană', ['job_function:healthcare']],
      ['Instalații electrice', ['job_function:skilled_trades']],
      ['Altele', []],
      ['Resurse umane / Psihologie', ['job_function:human_resources']],
      ['Financiar / Contabilitate', ['job_function:finance_accounting']],
      ['Bănci', ['job_function:banking']],
      ['Management', ['job_function:management']],
      ['Personal calificat', ['job_function:skilled_trades']],
      ['Inginerie', ['job_function:engineering']],
      ['Crewing / Casino / Entertainment', ['job_function:arts_entertainment']],
      ['Administrativ / Logistică', ['job_function:administration', 'job_function:operations_logistics']],
      ['Service / Reparații', ['job_function:mechanical_technical']],
      ['Asigurări', ['job_function:insurance']],
      ['Audit / Consultanță', ['job_function:finance_accounting', 'job_function:consulting_strategy']],
      ['Transport / Distribuție', ['job_function:transport_driving', 'job_function:operations_logistics']],
      ['Alimentație / HoReCa', ['job_function:hospitality_food_service']],
      ['Farmacie', ['job_function:healthcare']],
      ['Controlul calității', ['job_function:quality_assurance']],
      ['Automatizări', ['job_function:engineering', 'job_function:mechanical_technical']],
      ['Auto / Echipamente', ['job_function:mechanical_technical']],
      ['Turism / Hotel staff', ['job_function:hospitality_food_service']],
      ['Instalații sanitare', ['job_function:skilled_trades']],
      ['Instalații termice', ['job_function:skilled_trades']],
      ['Arhitectură / Design interior', ['job_function:architecture_design']],
      ['Merchandising / Promoteri', ['job_function:sales_commerce']],
      ['Project Management', ['job_function:project_management']],
      ['Proiectare civilă / industrială', ['job_function:architecture_design', 'job_function:engineering']],
      ['Naval / Aeronautic', ['job_function:mechanical_technical']],
      ['MLM / Vânzări directe', ['job_function:sales_commerce']],
      ['Marketing', ['job_function:marketing_communications']],
      ['Chimie / Biochimie', ['job_function:research_development']],
    ];
    for (const [surface, keys] of expected) expect(jobFunctionKeys(surface, ['ro'])).toEqual(keys);
  });

  it('maps Hungarian physical job functions', () => {
    expect(jobFunctionKeys('Anyagmozgatás, Rakodás', ['hu'])).toEqual([
      'job_function:operations_logistics',
      'job_function:physical_manual_work',
    ]);
    expect(jobFunctionKeys('Takarítás, Tisztítás', ['hu'])).toEqual(['job_function:animal_care_childcare_cleaning']);
    expect(sectorKeys('Takarítás, Tisztítás', ['hu'])).toEqual(['sector:professional_services']);
  });

  it('maps the Hungarian structured job-function labels to the existing finite set', () => {
    expect(jobFunctionKeys('Adminisztráció, Asszisztens, Irodai munka', ['hu'])).toEqual([
      'job_function:administration',
    ]);
    expect(jobFunctionKeys('Bank, Biztosítás, Bróker', ['hu'])).toEqual([
      'job_function:banking',
      'job_function:insurance',
    ]);
    expect(jobFunctionKeys('Cégvezetés, Menedzsment', ['hu'])).toEqual(['job_function:management']);
    expect(jobFunctionKeys('Egészségügy, Gyógyszeripar', ['hu'])).toEqual(['job_function:healthcare']);
    expect(jobFunctionKeys('Építőipar, Ingatlan', ['hu'])).toEqual([
      'job_function:skilled_trades',
      'job_function:sales_commerce',
    ]);
    expect(jobFunctionKeys('Értékesítés, Kereskedelem', ['hu'])).toEqual(['job_function:sales_commerce']);
    expect(jobFunctionKeys('Fizikai, Segéd, Betanított munka', ['hu'])).toEqual(['job_function:physical_manual_work']);
    expect(jobFunctionKeys('Gyártás, Termelés', ['hu'])).toEqual(['job_function:skilled_trades']);
    expect(jobFunctionKeys('HR, Munkaügy', ['hu'])).toEqual(['job_function:human_resources']);
    expect(jobFunctionKeys('IT programozás, Fejlesztés', ['hu'])).toEqual(['job_function:it_software_data']);
    expect(jobFunctionKeys('IT üzemeltetés, Telekommunikáció', ['hu'])).toEqual(['job_function:it_software_data']);
    expect(jobFunctionKeys('Jog, Jogi tanácsadás', ['hu'])).toEqual(['job_function:legal_compliance']);
    expect(jobFunctionKeys('Közigazgatás', ['hu'])).toEqual(['job_function:administration']);
    expect(jobFunctionKeys('Marketing, Média, PR', ['hu'])).toEqual([
      'job_function:marketing_communications',
      'job_function:arts_entertainment',
    ]);
    expect(jobFunctionKeys('Mérnök', ['hu'])).toEqual(['job_function:engineering']);
    expect(jobFunctionKeys('Mezőgazdaság, Környezet', ['hu'])).toEqual(['job_function:skilled_trades']);
    expect(jobFunctionKeys('Oktatás, Tudomány, Sport', ['hu'])).toEqual([
      'job_function:education_training',
      'job_function:research_development',
    ]);
    expect(jobFunctionKeys('Pénzügy, Könyvelés', ['hu'])).toEqual(['job_function:finance_accounting']);
    expect(jobFunctionKeys('Szakmunka', ['hu'])).toEqual(['job_function:skilled_trades']);
    expect(jobFunctionKeys('Szállítás, Beszerzés, Logisztika', ['hu'])).toEqual([
      'job_function:transport_driving',
      'job_function:operations_logistics',
      'job_function:procurement',
    ]);
    expect(jobFunctionKeys('Ügyfélszolgálat, Vevőszolgálat', ['hu'])).toEqual(['job_function:customer_support']);
    expect(jobFunctionKeys('Üzleti támogató központok', ['hu'])).toEqual(['job_function:administration']);
    expect(jobFunctionKeys('Vendéglátás, Hotel, Idegenforgalom', ['hu'])).toEqual([
      'job_function:hospitality_food_service',
    ]);
  });

  it('maps Estonian job functions and optional sectors', () => {
    expect(jobFunctionKeys('Tervishoid / Sotsiaaltöö', ['et'])).toEqual([
      'job_function:healthcare',
      'job_function:community_social_services',
    ]);
    expect(jobFunctionKeys('Transport / Logistika', ['et'])).toEqual([
      'job_function:transport_driving',
      'job_function:operations_logistics',
    ]);
    expect(sectorKeys('Autotööstus ja lennundus', ['et'])).toEqual(['sector:automotive', 'sector:aviation']);
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
    expect(schKeys('Kötött')).toContain('schedule:fixed_shift');
    expect(schKeys('Kötött munkarend')).toContain('schedule:fixed_shift');
    expect(schKeys('Kötetlen munkarend')).toContain('schedule:flexible_hours');
    expect(schKeys('2 műszak')).toContain('schedule:rotational_shift');
    expect(schKeys('2 műszakos munkarend')).toContain('schedule:rotational_shift');
    expect(schKeys('3 műszak')).toContain('schedule:rotational_shift');
    expect(schKeys('3 műszakos munkarend')).toContain('schedule:rotational_shift');
    expect(schKeys('Több műszak')).toContain('schedule:rotational_shift');
    expect(schKeys('Több műszakos munkarend')).toContain('schedule:rotational_shift');
  });
});

describe('workplace inference', () => {
  it('maps structured workplace labels to the existing finite set', () => {
    expect(workplaceKeys('Fixed location')).toContain('workplace:onsite');
    expect(workplaceKeys('Flexible')).toContain('workplace:flexible');
    expect(workplaceKeys('Hybrid')).toContain('workplace:hybrid');
    expect(workplaceKeys('Remote')).toContain('workplace:remote');
  });
  it('maps Hungarian structured workplace labels with optional count suffixes', () => {
    expect(workplaceKeys('Helyhez kötött')).toContain('workplace:onsite');
    expect(workplaceKeys('Terület/régió')).toContain('workplace:flexible');
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
  it('reads finite HU benefit phrases without introducing new benefit keys', () => {
    expect(benefitsKeys('Étkezési jegy')).toContain('benefits:meal_vouchers');
    expect(benefitsKeys('Céges autó')).toContain('benefits:company_car');
    expect(benefitsKeys('Mobiltelefon')).toContain('benefits:phone_provided');
    expect(benefitsKeys('Egészségpénztár')).toContain('benefits:private_medical');
    expect(benefitsKeys('Szakmai tréningek')).toContain('benefits:paid_training');
    expect(benefitsKeys('Nyelvtanulás támogatása')).toContain('benefits:paid_training');
    expect(benefitsKeys('Munkába járás támogatás')).toContain('benefits:transport_allowance');
    expect(benefitsKeys('Egészségbiztosítás')).toContain('benefits:health_insurance');
    expect(benefitsKeys('Sport támogatás')).toContain('benefits:wellness_allowance');
    expect(benefitsKeys('Élet- és balesetbiztosítás')).toContain('benefits:life_insurance');
    expect(benefitsKeys('Nyugdíjpénztár')).toContain('benefits:pension_scheme');
    expect(benefitsKeys('Céges üdülés, üdültetés')).toEqual([]);
    expect(benefitsKeys('Lakhatási támogatás')).toEqual([]);
    expect(benefitsKeys('Beiskolázási támogatás')).toEqual([]);
  });
  it('keeps the known-but-unsupported HU benefit surfaces documented only as pending observations', () => {
    for (const item of HU_BENEFITS_PENDING) {
      expect(item.locale).toBe('hu');
      expect(item.seenCount).toBe(1);
      expect(benefitsKeys(item.phrase)).toEqual([]);
    }
  });
  it('reads "car allowance" as transport_allowance across RO/HU/ET/EN', () => {
    expect(benefitsKeys('salary plus car allowance')).toContain('benefits:transport_allowance');
    expect(benefitsKeys('oferim indemnizatie auto')).toContain('benefits:transport_allowance');
    expect(benefitsKeys('autohozzajarulas biztositott')).toContain('benefits:transport_allowance');
    expect(benefitsKeys('autohuvitis tagatud')).toContain('benefits:transport_allowance');
  });

  it('resolves phrasings a literal alias never anticipated, via head+modifier composition', () => {
    // A modifier the dictionary's own alias doesn't carry ("private health insurance"
    // vs. the dictionary's "private medical insurance") still narrows to the right key.
    expect(benefitsKeys('we offer private health insurance')).toContain('benefits:private_medical');
    // A bare, unqualified mention of the head noun falls to the family default.
    expect(benefitsKeys('25 days of annual leave')).toContain('benefits:paid_time_off');
    expect(benefitsKeys('25 days of annual leave')).not.toContain('benefits:extra_vacation_days');
  });

  it('resolves each mention independently when the same family fires twice in one clause', () => {
    const keys = benefitsKeys('private health insurance and life insurance included');
    expect(keys).toContain('benefits:private_medical');
    expect(keys).toContain('benefits:life_insurance');
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
  it('reads Estonian fused bonus compounds that a word-boundary regex cannot decompose', () => {
    expect(compKeys('aastaboonus makstakse detsembris')).toContain('compensation:annual_bonus');
    expect(compKeys('liitumisboonus uutele töötajatele')).toContain('compensation:sign_on_bonus');
    expect(compKeys('pysivusboonus 6 kuu järel')).toContain('compensation:retention_bonus');
    expect(compKeys('jouluboonus kõigile')).toContain('compensation:christmas_bonus');
    expect(compKeys('soiduboonus ja koormaboonus')).toContain('compensation:dispatch_bonus');
  });
  it('resolves a modifier a literal alias never anticipated ("night premium")', () => {
    expect(compKeys('night premium paid weekly')).toContain('compensation:night_premium');
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

describe('qualification inference', () => {
  it('standardizes the education ladder onto the newer generic degree keys', () => {
    expect(qKeys('Általános iskola')).toContain('qualification:education_requirement:school_level_degree');
    expect(qKeys('Középiskola')).toContain('qualification:education_requirement:school_level_degree');
    expect(qKeys('Szakiskola / szakmunkás képző')).toContain(
      'qualification:education_requirement:short_cycle_tertiary_degree',
    );
    expect(qKeys('Felsőoktatási szakképzés')).toContain(
      'qualification:education_requirement:short_cycle_tertiary_degree',
    );
    expect(qKeys('Főiskola')).toContain('qualification:education_requirement:1c_degree');
    expect(qKeys('Egyetem')).toContain('qualification:education_requirement:1c_degree');
  });

  it('keeps the broader education aliases on the same canonical ladder', () => {
    expect(qKeys('high school diploma')).toContain('qualification:education_requirement:school_level_degree');
    expect(qKeys('vocational diploma')).toContain('qualification:education_requirement:short_cycle_tertiary_degree');
    expect(qKeys('bachelor degree')).toContain('qualification:education_requirement:1c_degree');
    expect(qKeys('master degree')).toContain('qualification:education_requirement:2c_degree');
    expect(qKeys('graduate degree')).toContain('qualification:education_requirement:2c_degree');
    expect(qKeys('MBA')).toContain('qualification:education_requirement:2c_degree');
    expect(qKeys('MSc')).toContain('qualification:education_requirement:2c_degree');
    expect(qKeys('Masters Degree', undefined, { titleMode: true })).toContain(
      'qualification:education_requirement:2c_degree',
    );
    expect(qKeys('Degree', undefined, { titleMode: true })).toContain('qualification:education_requirement:1c_degree');
    expect(qKeys('Diploma', undefined, { titleMode: true })).toContain(
      'qualification:education_requirement:short_cycle_tertiary_degree',
    );
    expect(qKeys('Unskilled', undefined, { titleMode: true })).toContain(
      'qualification:education_requirement:school_level_degree',
    );
    expect(qKeys('Student', undefined, { titleMode: true })).toContain(
      'qualification:education_requirement:school_level_degree',
    );
    expect(qKeys('Qualified', undefined, { titleMode: true })).toContain(
      'qualification:education_requirement:short_cycle_tertiary_degree',
    );
    expect(qKeys('Graduate', undefined, { titleMode: true })).toContain(
      'qualification:education_requirement:1c_degree',
    );
    expect(qKeys('HND', undefined, { titleMode: true })).toContain(
      'qualification:education_requirement:short_cycle_tertiary_degree',
    );
    expect(qKeys('MBBS', undefined, { titleMode: true })).toContain('qualification:education_requirement:1c_degree');
    expect(qKeys('MPhil', undefined, { titleMode: true })).toContain('qualification:education_requirement:2c_degree');
    expect(qKeys('N.C.E', undefined, { titleMode: true })).toContain(
      'qualification:education_requirement:short_cycle_tertiary_degree',
    );
    expect(qKeys('OND', undefined, { titleMode: true })).toContain(
      'qualification:education_requirement:short_cycle_tertiary_degree',
    );
    expect(qKeys('Vocational', undefined, { titleMode: true })).toContain(
      'qualification:education_requirement:short_cycle_tertiary_degree',
    );
    expect(qKeys('PhD')).toContain('qualification:education_requirement:3c_degree');
    expect(qKeys('doctorate')).toContain('qualification:education_requirement:3c_degree');
  });

  it('respects locale-scoped education idioms when a language is known', () => {
    expect(qKeys('Főiskola', ['hu'])).toContain('qualification:education_requirement:1c_degree');
    expect(qKeys('Egyetem', ['hu'])).toContain('qualification:education_requirement:1c_degree');
    expect(qKeys('Főiskola', ['ro'])).toEqual([]);
    expect(qKeys('Egyetem', ['ro'])).toEqual([]);
  });

  it('maps the Romanian education labels onto the same canonical ladder', () => {
    expect(qKeys('Doctorat', ['ro'])).toContain('qualification:education_requirement:3c_degree');
    expect(qKeys('Masterat', ['ro'])).toContain('qualification:education_requirement:2c_degree');
    expect(qKeys('Facultate', ['ro'])).toContain('qualification:education_requirement:1c_degree');
    expect(qKeys('Colegiu', ['ro'])).toContain('qualification:education_requirement:short_cycle_tertiary_degree');
    expect(qKeys('Studii postliceale', ['ro'])).toContain(
      'qualification:education_requirement:short_cycle_tertiary_degree',
    );
    expect(qKeys('Liceu', ['ro'])).toContain('qualification:education_requirement:school_level_degree');
    expect(qKeys('Scoala profesionala', ['ro'])).toContain(
      'qualification:education_requirement:short_cycle_tertiary_degree',
    );
    expect(qKeys('Scoala generala', ['ro'])).toContain('qualification:education_requirement:school_level_degree');
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
    expect(qKeys('driving licence category A')).toContain('qualification:license:driving_license_a');
    expect(qKeys('permis categoria B')).toContain('qualification:license:driving_license_b');
    expect(qKeys('driving licence category C')).toContain('qualification:license:driving_license_c');
    expect(qKeys('class CE license required')).toContain('qualification:license:driving_license_ce');
    expect(qKeys('class BE license required')).toContain('qualification:license:driving_license_be');
    expect(qKeys('class DE license required')).toContain('qualification:license:driving_license_de');
    expect(qKeys('driving licence category B+E')).toContain('qualification:license:driving_license_be');
    expect(qKeys('driving licence category C+E')).toContain('qualification:license:driving_license_ce');
    expect(qKeys('driving licence category D+E')).toContain('qualification:license:driving_license_de');
    expect(qKeys('permis cat. D')).toContain('qualification:license:driving_license_d');
  });
  it('does NOT fire on a bare letter without a license word', () => {
    expect(qKeys('category B products')).toEqual([]);
    expect(qKeys('go with plan B')).toEqual([]);
    expect(qKeys('option C is best')).toEqual([]);
  });
  it('does not fire on a bare letter without a license word even for the new classes', () => {
    expect(qKeys('category A products')).toEqual([]);
    expect(qKeys('option D+E is best')).toEqual([]);
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

  it('reads the broader supported language spellings', () => {
    expect(qKeys('Nem kell nyelvtudás')).toContain('qualification:language_requirement:no_language_required');
    expect(qKeys('Angol nyelvtudás')).toContain('qualification:language_requirement:english');
    expect(qKeys('Német nyelvtudás')).toContain('qualification:language_requirement:german');
    expect(qKeys('Francia nyelvtudás')).toContain('qualification:language_requirement:french');
    expect(qKeys('Román nyelvtudás')).toContain('qualification:language_requirement:romanian');
    expect(qKeys('Angol', undefined, { titleMode: true })).toContain('qualification:language_requirement:english');
    expect(qKeys('Afrikai', undefined, { titleMode: true })).toContain('qualification:language_requirement:afrikaans');
    expect(qKeys('Magyar jelnyelv', undefined, { titleMode: true })).toContain(
      'qualification:language_requirement:hungarian_sign_language',
    );
    expect(qKeys('Rétoromán', undefined, { titleMode: true })).toContain('qualification:language_requirement:romansh');
    expect(qKeys('Roma', undefined, { titleMode: true })).toContain('qualification:language_requirement:romani');
    expect(qKeys('Tagalog', undefined, { titleMode: true })).toContain('qualification:language_requirement:tagalog');
    expect(qKeys('Egyéb', undefined, { titleMode: true })).toContain('qualification:language_requirement:other');
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
    lexical: buildLexicalIndex(TERMS),
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
