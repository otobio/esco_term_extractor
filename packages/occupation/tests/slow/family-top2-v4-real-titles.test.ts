import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { cleanOccupationQuerySurface } from '../../src/query/occupation-query-cleaning.js';
import { prepareQuery } from '../../src/query/query-preparation.js';
import { loadOccupationFamilyProfileArtifactRequired } from '../../src/runtime/occupation-family-profile-artifact.js';
import { loadOccupationFamilyTokenRelevanceArtifactRequired } from '../../src/runtime/occupation-family-token-relevance-artifact.js';
import { loadOccupationLeafStructureArtifactRequired } from '../../src/runtime/occupation-leaf-structure-artifact.js';
import { loadOccupationSearchMetaArtifactRequired } from '../../src/runtime/occupation-search-meta-artifact.js';
import { rankFamilyTop2V4, type FamilyTop2V4ClassifierQuery } from '../../src/cli/rank-family-top2-v4-core.js';

const SOURCE = 'esco_1_2_1';
const LOCALE = 'ro';
const RANK_FAMILY_TOP2_V4_ENABLED = false;

const CASES = [
  ['Electrician întreţinere şi reparaţii - Acăţari,jud.Mures', 'Electrical equipment installers and repairers'],
  ['Brand Consultant TOBACCO PLOIESTI', 'Sales, marketing and public relations professionals'],
  ['Antrenor / instructor pentru gimnastica ritmica', 'Sports and fitness workers'],
  ['Sef tura patiserie Delissima Bakery', 'Cooks'],
  ['FARMACIST', 'Other health professionals'],
  ['Manipulant marfuri', 'Transport and storage labourers'],
  ['Sales Advisor Nespresso Boutique Afi Cotroceni 8h', 'Shop salespersons'],
  ['Lucrator depozit - picker si ambalator comenzi online', 'Transport and storage labourers'],
  ['Stivuitorist SIbiu', 'Mobile plant operators'],
  ['Junior Back Office with German', 'Numerical clerks'],
  ['Junior Back Office with Italian', 'Numerical clerks'],
  ['Mecanic utilaje industriale Brasov', 'Machinery mechanics and repairers'],
  ['Operator facturare', 'Numerical clerks'],
  ['Casier - Timisoara', 'Cashiers and ticket clerks'],
  ['Casier - Bucuresti', 'Cashiers and ticket clerks'],
  ['Sales Development Representative', 'Sales and purchasing agents and brokers'],
  ['Senior Accountant -Outsourcing Accounting division', 'Finance professionals'],
  ['Quantity Surveyor Site Engineer - Bacau', 'Engineering professionals (excluding electrotechnology)'],
  ['Inginer Ofertare Drumuri, Poduri/Căi Ferate', 'Engineering professionals (excluding electrotechnology)'],
  ['Automation Sales Engineer', 'Sales, marketing and public relations professionals'],
  ['Inginer Ofertare Tehnic - Constructii', 'Engineering professionals (excluding electrotechnology)'],
  ['Buyer', 'Sales and purchasing agents and brokers'],
  ['Fizioterapeut / Kinetoterapeut – Germania', 'Other health professionals'],
  ['Cautam manager de tura! Venit net #pebune de la 4900 lei!', 'Process control technicians'],
  ['(Senior) Consultant SAP Cloud and Process Integration', 'Software and applications developers and analysts'],
  ['Dealer Casino Online- average monthly income 4200 lei', 'Tellers, money collectors and related clerks'],
  ['_Agent Servicii Clienti_Limba Italiana', 'Client information workers'],
  ['Frigotehnist – fabrica de productie', 'Physical and engineering science technicians'],
  ['FARMACIST - Baicoi', 'Other health professionals'],
  ['Sculer Matriter - Arges', 'Blacksmiths, toolmakers and related trades workers'],
  ['Electrician - Arges', 'Electrical equipment installers and repairers'],
  ['ERP S4HANA BASIS Expert (On Premise / Cloud)', 'Software and applications developers and analysts'],
  ['NC Programmer', 'Software and applications developers and analysts'],
  ['Operator la masini unelte semiautomate si automate - Frezor', 'Blacksmiths, toolmakers and related trades workers'],
  ['Manager Relatii Clienti Persoane Fizice - Targu Bujor', 'Client information workers'],
  ['Sudor MIG/MAG', 'Sheet and structural metal workers, moulders and welders, and related workers'],
  ['Magaziner cu Autorizatie ISCIR | Arad', 'Material-recording and transport clerks'],
  ['Inginer Proiectare Energetică și Studii Fezabilitate PV', 'Engineering professionals (excluding electrotechnology)'],
  ['Medic dentist, medic stomatolog - Franta', 'Other health professionals'],
  ['Sculer Matriter (Electroeroziune cu Fir si Electrod Masiv)', 'Blacksmiths, toolmakers and related trades workers'],
  ['Operator Frezare CNC (3 si 5 Axe / Componente si Electrozi)', 'Blacksmiths, toolmakers and related trades workers'],
  ['Operator Unelte Masini CNC (Asamblare si Ajustare Matrite)', 'Blacksmiths, toolmakers and related trades workers'],
  ['Sef de Tura Balteni Judet Gorj', 'Process control technicians'],
  ['Casier Buzias Judet Timis', 'Cashiers and ticket clerks'],
  ['Casier Gataia Judet Timis', 'Cashiers and ticket clerks'],
  ['Vorbitori de limba GERMANA in SIGHISOARA - Relatii Clienti', 'Client information workers'],
  ['Casier Balteni Judet Gorj', 'Cashiers and ticket clerks'],
  ['Casier Agnita Judet Sibiu', 'Cashiers and ticket clerks'],
  ['Electrician Siloz Giurgiu', 'Electrical equipment installers and repairers'],
  ['Production Engineering Coordinator– Drobeta Turnu Severin', 'Physical and engineering science technicians'],
  ['Medic Specialist/Primar Medicina de Familie', 'Medical doctors'],
  ['Medic Veterinar', 'Veterinarians'],
  ['Stivuitorist - Zalau', 'Mobile plant operators'],
  ['Inginer automatist', 'Engineering professionals (excluding electrotechnology)'],
  ['Stivuitorist - SATU MARE', 'Mobile plant operators'],
  ['Call Center Travel Agent with German – Work from Office', 'Other sales workers'],
  ['Site Electrical Engineers & Site Civil Engineers', 'Electrotechnology engineers'],
  ['Responsabil de tură Buftea, Șos. București-Târgoviște (f/m)', 'Process control technicians'],
  ['Electrician PRAM _ CE 110 KV Slatina', 'Electrical equipment installers and repairers'],
  ['Farmacist Junior - Depozit Farmaceutic', 'Other health professionals'],
  // Below: 50 more human-reviewed (selected="yes") title/family pairs pulled from ejobs_out_2.csv,
  // to widen the regression net beyond the original 50-title sample.
  ['Consilier de vânzări (m/f)', 'Shop salespersons'],
  ['TEHNICIAN-ALPINIST TELECOMUNICATII', 'Electronics and telecommunications installers and repairers'],
  ['Operator calculator - Magazin Online', 'Process control technicians'],
  ['Manager Resurse Umane', 'Business services and administration managers'],
  ['Electrician -Tehnician retele echipamente electrice,date-voce', 'Electrical equipment installers and repairers'],
  ['Consultant Vanzari - Mobexpert Baia Mare', 'Sales and purchasing agents and brokers'],
  ['Reprezentant Tehnic si Receptioner Tura de Noapte', 'Sales, marketing and public relations professionals'],
  ['Asistent Medical Generalist/ Kinetoterapeut/ Cosmetician', 'Personal care workers in health services'],
  ['Lacatus mecanic asamblare', 'Assemblers'],
  ['Jurist', 'Legal professionals'],
  ['Inginer proiectant instalații', 'Engineering professionals (excluding electrotechnology)'],
  ['Customer Agent with English and Irish understanding', 'Client information workers'],
  ['Asistent Medical Generalist Sectie Chirurgie generală', 'Personal care workers in health services'],
  ['Sales Network Specialist -  Divizia Suport Vanzari', 'Sales, marketing and public relations professionals'],
  ['Contabil', 'Finance professionals'],
  ['Tehnician Service', 'Physical and engineering science technicians'],
  ['Tehnician pe teren zona Harghita', 'Physical and engineering science technicians'],
  ['Sales Representative -Sisteme Depozitare & Solutii Logistice', 'Sales and purchasing agents and brokers'],
  ['Tehnician audit de produs', 'Physical and engineering science technicians'],
  ['Inginer Tehnolog-Industria Cărnii (Experienta min. 5 ani)', 'Engineering professionals (excluding electrotechnology)'],
  ['Manager Program', 'Business services and administration managers'],
  ['Manipulant Marfa - NON BAT - Timisoara', 'Transport and storage labourers'],
  ['Maintenance Manager - top global company', 'Business services and administration managers'],
  ['Asistent de Farmacie in Lovrin', 'Personal care workers in health services'],
  ['Asistent Manager', 'Administrative and specialised secretaries'],
  ['Lucrator comercial / vanzator  mall - produse din inghetata', 'Shop salespersons'],
  ['Project Manager Constructii (Regiune Vest - Transilvania)', 'Business services and administration managers'],
  ['ASISTENT VANZARI', 'Shop salespersons'],
  ['Inginer Ofertare/Decontare - Constructii Civile', 'Engineering professionals (excluding electrotechnology)'],
  ['Consultant Financiar', 'Finance professionals'],
  ['Regional Sales Manager', 'Retail and wholesale trade managers'],
  ['Lucrator comercial Full Time - Hervis Alba Iulia', 'Shop salespersons'],
  ['Operator musa Brasov', 'Food and related products machine operators'],
  ['Sales Assistant - Tom Tailor - Afi Cotroceni', 'Shop salespersons'],
  ['Coordonator Logistică - Balotești', 'Material-recording and transport clerks'],
  ['OPERATOR MAȘINI-UNELTE CU COMANDĂ NUMERICĂ (CNC) TÂRGOVIȘTE', 'Textile, fur and leather products machine operators'],
  ['🚀 Key Account Manager B2B – Retail România & EU', 'Retail and wholesale trade managers'],
  ['INGINER ELECTRONIST/ ELECTRONIST in  Cluj-Napoca', 'Engineering professionals (excluding electrotechnology)'],
  ['Electrician reparatii utilaje industriale Brasov', 'Electrical equipment installers and repairers'],
  ['Manager Magazin in sistem CODO', 'Retail and wholesale trade managers'],
  ['QA/QC Inspector', 'Other craft and related workers'],
  ['Manipulant marfa', 'Transport and storage labourers'],
  ['Stivuitorist(manipulant marfa) Arad', 'Transport and storage labourers'],
  ['Operator productie Arad', 'Chemical and photographic products plant and machine operators'],
  ['Operator productie(platforma Dunca) Timisoara', 'Chemical and photographic products plant and machine operators'],
  ['Frigotehnist/Tehnician service HORECA', 'Building finishers and related trades workers'],
  ['Lucrător logistică (m/f)', 'Material-recording and transport clerks'],
  ['Lacatus mecanic reparatii utilaje de constructii', 'Machinery mechanics and repairers'],
  ['Branch Manager Deva & Hunedoara', 'Business services and administration managers'],
  ['Branch Manager - Targu-Mures', 'Business services and administration managers'],
  ['Reprezentant vanzari - Bucuresti/Ilfov', 'Sales and purchasing agents and brokers'],
  ['Agent / Broker Imobiliar', 'Business services agents'],
  ['Project Assistant - Bacau', 'Administrative and specialised secretaries'],
  ['Manager vanzari', 'Sales, marketing and development managers'],
  ['Site Engineer', 'Engineering professionals (excluding electrotechnology)'],
  ['Emirates Cabin Crew', 'Travel attendants, conductors and guides'],
  ['Operational / Sea Freight Specialist', 'Physical and earth science professionals'],
  ['Sef Șantier Rețele Edilitare', 'Manufacturing, mining, construction, and distribution managers'],
  ['Merchants Sales Account Manager', 'Retail and wholesale trade managers'],
  ['Senior Procurement Specialist', 'Sales and purchasing agents and brokers']
] as const;

let familyProfileArtifact: Awaited<ReturnType<typeof loadOccupationFamilyProfileArtifactRequired>>;
let familyTokenRelevanceArtifact: Awaited<ReturnType<typeof loadOccupationFamilyTokenRelevanceArtifactRequired>>;
let searchMetaArtifact: Awaited<ReturnType<typeof loadOccupationSearchMetaArtifactRequired>>;
let leafStructureArtifact: Awaited<ReturnType<typeof loadOccupationLeafStructureArtifactRequired>>;

const top2V4Test = RANK_FAMILY_TOP2_V4_ENABLED ? test : test.skip;

if (RANK_FAMILY_TOP2_V4_ENABLED) {
  before(async () => {
    const [loadedFamilyProfiles, loadedFamilyTokenRelevance, loadedSearchMeta, loadedLeafStructure] = await Promise.all([
      loadOccupationFamilyProfileArtifactRequired(SOURCE),
      Promise.resolve(loadOccupationFamilyTokenRelevanceArtifactRequired(SOURCE)),
      loadOccupationSearchMetaArtifactRequired(SOURCE),
      loadOccupationLeafStructureArtifactRequired(SOURCE)
    ]);

    familyProfileArtifact = loadedFamilyProfiles;
    familyTokenRelevanceArtifact = loadedFamilyTokenRelevance;
    searchMetaArtifact = loadedSearchMeta;
    leafStructureArtifact = loadedLeafStructure;
  });
}

top2V4Test('v4 family top-2 classifier is disabled because the current pipeline no longer uses top2-v4 selection', async () => {
  const misses: string[] = [];
  let exactHits = 0;

  for (const [jobTitle, expectedFamily] of CASES) {
    const result = await classify(jobTitle);
    const topFamily = result.rankedFamilies[0]?.familyLabel ?? 'none';

    if (topFamily === expectedFamily) {
      exactHits += 1;
      continue;
    }

    misses.push(`${jobTitle} -> ${topFamily} (expected ${expectedFamily})`);
  }

  console.log(
    [
      `v4 eJobs curated sample (${CASES.length} titles)`,
      `exact=${exactHits}/${CASES.length}`,
      misses.length > 0 ? `misses=${misses.length}` : 'misses=0'
    ].join('  ')
  );

  for (const miss of misses.slice(0, 10)) {
    console.log(`  ${miss}`);
  }

  assert.ok(exactHits === CASES.length, `exact hits = ${exactHits}/${CASES.length}`);
});

async function classify(jobTitle: string) {
  const cleanedQuery = await cleanOccupationQuerySurface(jobTitle, LOCALE);
  const effectiveQuery = cleanedQuery || jobTitle;
  const preparedQuery = await prepareQuery(effectiveQuery, LOCALE, { sourceName: SOURCE });
  const query: FamilyTop2V4ClassifierQuery = {
    preparedQuery,
    rawQuery: jobTitle,
    effectiveQuery,
    locale: LOCALE,
    sourceName: SOURCE
  };

  return rankFamilyTop2V4({
    familyProfileArtifact,
    searchMetaArtifact,
    leafStructureArtifact,
    familyTokenRelevanceArtifact,
    query,
    limit: 2
  });
}
