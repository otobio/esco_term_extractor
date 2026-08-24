import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { cliRankFamilyLeaves } from '../../src/cli/rank-family-leaves-core.js';
import { cleanOccupationQuerySurface } from '../../src/query/occupation-query-cleaning.js';
import { prepareQuery } from '../../src/query/query-preparation.js';
import { loadOccupationLeafStructureArtifactRequired } from '../../src/runtime/occupation-leaf-structure-artifact.js';
import { loadOccupationSearchMetaArtifactRequired } from '../../src/runtime/occupation-search-meta-artifact.js';
import { foldSearchText } from '../../src/utils/texts.js';
const SOURCE = 'esco_1_2_1';
const LOCALE = 'ro';
const CASES = [
    // ['Electrician întreţinere şi reparaţii - Acăţari,jud.Mures', 'electrician'],
    // ['Brand Consultant TOBACCO PLOIESTI', 'tobacco specialised seller'],
    // ['Antrenor / instructor pentru gimnastica ritmica', 'sports coach'],
    // ['Sef tura patiserie Delissima Bakery', 'bakery production manager'],
    // ['FARMACIST', 'pharmacist'],
    // ['Manipulant marfuri', 'stevedore'],
    // ['Sales Advisor Nespresso Boutique Afi Cotroceni 8h', 'specialised seller'],
    // ['Lucrator depozit - picker si ambalator comenzi online', 'warehouse worker'],
    // ['Stivuitorist SIbiu', 'forklift truck operator'],
    // ['Junior Back Office with German', 'back office specialist'],
    // ['Junior Back Office with Italian', 'back office specialist'],
    // ['Mecanic utilaje industriale Brasov', 'industrial machinery mechanic'],
    // ['Operator facturare', 'billing clerk'],
    // ['Casier - Timisoara', 'cashier'],
    // ['Casier - Bucuresti', 'cashier'],
    // ['Sales Development Representative', 'sales representative'],
    // ['Senior Accountant -Outsourcing Accounting division', 'accountant'],
    // ['Quantity Surveyor Site Engineer - Bacau', 'quantity surveyor'],
    // ['Inginer Ofertare Drumuri, Poduri/Căi Ferate', 'transport engineer'],
    // ['Automation Sales Engineer', 'sales engineer'],
    // ['Inginer Ofertare Tehnic - Constructii', 'cost estimator'],
    // ['Buyer', 'purchasing agent'],
    // ['Fizioterapeut / Kinetoterapeut – Germania', 'physiotherapist'],
    // ['Cautam manager de tura! Venit net #pebune de la 4900 lei!', 'petroleum and natural gas processing plant operator'],
    // ['(Senior) Consultant SAP Cloud and Process Integration', 'ICT systems architect'],
    // ['Dealer Casino Online- average monthly income 4200 lei', 'gambling dealer'],
    // ['_Agent Servicii Clienti_Limba Italiana', 'customer service representative'],
    // ['Frigotehnist – fabrica de productie', 'refrigeration mechanic'],
    // ['FARMACIST - Baicoi', 'pharmacist'],
    // ['Sculer Matriter - Arges', 'tool and die maker'],
    // ['Electrician - Arges', 'electrician'],
    // ['ERP S4HANA BASIS Expert (On Premise / Cloud)', 'ICT system administrator'],
    // ['NC Programmer', 'CNC programmer'],
    // ['Operator la masini unelte semiautomate si automate - Frezor', 'milling machine operator'],
    // ['Manager Relatii Clienti Persoane Fizice - Targu Bujor', 'customer relationship manager'],
    // ['Sudor MIG/MAG', 'welder'],
    // ['Magaziner cu Autorizatie ISCIR | Arad', 'warehouse worker'],
    // ['Inginer Proiectare Energetică și Studii Fezabilitate PV', 'energy engineer'],
    // ['Medic dentist, medic stomatolog - Franta', 'dentist'],
    // ['Sculer Matriter (Electroeroziune cu Fir si Electrod Masiv)', 'tool and die maker'],
    // ['Operator Frezare CNC (3 si 5 Axe / Componente si Electrozi)', 'CNC milling machine operator'],
    // ['Operator Unelte Masini CNC (Asamblare si Ajustare Matrite)', 'CNC machine operator'],
    // ['Sef de Tura Balteni Judet Gorj', 'petroleum and natural gas processing plant operator'],
    // ['Casier Buzias Judet Timis', 'cashier'],
    // ['Casier Gataia Judet Timis', 'cashier'],
    // ['Vorbitori de limba GERMANA in SIGHISOARA - Relatii Clienti', 'customer service representative'],
    // ['Casier Balteni Judet Gorj', 'cashier'],
    // ['Casier Agnita Judet Sibiu', 'cashier'],
    // ['Electrician Siloz Giurgiu', 'electrician'],
    // ['Production Engineering Coordinator– Drobeta Turnu Severin', 'production engineering technician'],
    // ['Medic Specialist/Primar Medicina de Familie', 'general practitioner'],
    // ['Medic Veterinar', 'veterinarian'],
    // ['Stivuitorist - Zalau', 'forklift truck operator'],
    // ['Inginer automatist', 'automation engineer'],
    // ['Stivuitorist - SATU MARE', 'forklift truck operator'],
    // ['Call Center Travel Agent with German – Work from Office', 'travel agent'],
    // ['Site Electrical Engineers & Site Civil Engineers', 'electrical engineer'],
    // ['Responsabil de tură Buftea, Șos. București-Târgoviște (f/m)', 'shift manager'],
    // ['Electrician PRAM _ CE 110 KV Slatina', 'electrician'],
    // ['Farmacist Junior - Depozit Farmaceutic', 'pharmacist'],
    // ['Consilier de vânzări (m/f)', 'sales assistant'],
    // ['TEHNICIAN-ALPINIST TELECOMUNICATII', 'telecommunications engineering technician'],
    // ['Operator calculator - Magazin Online', 'data entry clerk'],
    // ['Manager Resurse Umane', 'human resources manager'],
    // ['Electrician -Tehnician retele echipamente electrice,date-voce', 'electrical engineering technician'],
    // ['Consultant Vanzari - Mobexpert Baia Mare', 'commercial sales representative'],
    // ['Reprezentant Tehnic si Receptioner Tura de Noapte', 'technical sales representative'],
    // ['Specialist management deplasări, secretariat, registratură', 'administrative assistant'],
    // ['Asistent Medical Generalist/ Kinetoterapeut/ Cosmetician', 'general care nurse'],
    // ['Lacatus mecanic asamblare', 'mechanical assembler'],
    // ['Jurist', 'legal professional'],
    // ['QUALITY PLANNING ENGINER', 'quality engineer'],
    // ['Inginer proiectant instalații', 'building services engineer'],
    // ['Customer Agent with English and Irish understanding', 'customer service representative'],
    // ['Asistent Medical Generalist Sectie Chirurgie generală', 'general care nurse'],
    // ['Asistent Manager Flota & Administrativ', 'fleet manager'],
    // ['Senior Specialist Aprovizionare (Piese de Schimb) OTOPENI', 'purchasing agent'],
    // ['Sales Network Specialist -  Divizia Suport Vanzari', 'sales support specialist'],
    // ['Contabil', 'accountant'],
    // ['Tehnician Service', 'service technician'],
    // ['Tehnician pe teren zona Harghita', 'road maintenance technician'],
    // ['Cautam colegi pentru Pizza Hut!', 'fast food preparer'],
    // ['Sales Representative -Sisteme Depozitare & Solutii Logistice', 'sales account manager'],
    // ['Tehnician audit de produs', 'quality control inspector'],
    // ['Inginer Tehnolog-Industria Cărnii (Experienta min. 5 ani)', 'food technologist'],
    // ['Manager Program', 'programme manager'],
    // ['Manipulant Marfa - NON BAT - Timisoara', 'warehouse worker'],
    // ['Maintenance Manager - top global company', 'maintenance manager'],
    // ['Interfata terti si alte departamente , Alexandria', 'accounting manager'],
    // ['Asistent de Farmacie in Lovrin', 'pharmacy assistant'],
    // ['Consultant IT SAP IS-U(244347)', 'SAP consultant'],
    // ['Asistent Manager', 'management assistant'],
    // ['Lucrator comercial / vanzator  mall - produse din inghetata', 'shop assistant'],
    // ['Project Manager Constructii (Regiune Vest - Transilvania)', 'construction project manager'],
    // ['ASISTENT VANZARI', 'sales assistant'],
    // ['Inginer Ofertare/Decontare - Constructii Civile', 'civil engineer'],
    // ['AGENT INCHIRIERI AUTO', 'car rental agent'],
    // ['Specialist obtinere avize/autorizatii - Piatra Olt', 'licensing officer'],
    // ['Consultant Financiar', 'financial consultant'],
    // ['Regional Sales Manager', 'regional sales manager']
    // ['Electrician întreţinere şi reparaţii - Acăţari,jud.Mures', 'mining electrician'],
    // ['Brand Consultant TOBACCO PLOIESTI', 'tobacco specialised seller'],
    // ['Antrenor / instructor pentru gimnastica ritmica', 'boxing instructor'],
    // ['Sef tura patiserie Delissima Bakery', 'refinery shift manager'],
    // ['FARMACIST', 'pharmacist'],
    // ['Manipulant marfuri', 'stevedore'],
    // ['Sales Advisor Nespresso Boutique Afi Cotroceni 8h', 'insurance broker'],
    // ['Lucrator depozit - picker si ambalator comenzi online', 'warehouse order picker'],
    // ['Stivuitorist SIbiu', 'forklift operator'],
    // ['Junior Back Office with German', 'back office specialist'],
    // ['Junior Back Office with Italian', 'back office specialist'],
    // ['Mecanic utilaje industriale Brasov', 'industrial machinery mechanic'],
    // ['Operator facturare', 'billing clerk'],
    // ['Casier - Timisoara', 'cashier'],
    // ['Casier - Bucuresti', 'cashier'],
    // ['Sales Development Representative', 'technical sales representative'],
    // ['Senior Accountant -Outsourcing Accounting division', 'accountant'],
    // ['Quantity Surveyor Site Engineer - Bacau', 'quantity surveyor'],
    // ['Inginer Ofertare Drumuri, Poduri/Căi Ferate', 'transport engineer'],
    // ['Automation Sales Engineer', 'sales engineer'],
    // ['Inginer Ofertare Tehnic - Constructii', 'calculation engineer'],
    // ['Buyer', 'purchaser'],
    // ['Fizioterapeut / Kinetoterapeut – Germania', 'kinesiologist'],
    // ['Cautam manager de tura! Venit net #pebune de la 4900 lei!', 'refinery shift manager'],
    // ['(Senior) Consultant SAP Cloud and Process Integration', 'cloud architect'],
    // ['Dealer Casino Online- average monthly income 4200 lei', 'casino pit boss'],
    // ['_Agent Servicii Clienti_Limba Italiana', 'customer service representative'],
    // ['Frigotehnist – fabrica de productie', 'wood factory manager'],
    // ['FARMACIST - Baicoi', 'pharmacist'],
    // ['Sculer Matriter - Arges', 'tool and die maker'],
    // ['Electrician - Arges', 'electrician'],
    // ['ERP S4HANA BASIS Expert (On Premise / Cloud)', 'cloud architect'],
    // ['NC Programmer', 'venue programmer'],
    // ['Operator la masini unelte semiautomate si automate - Frezor', 'surface-mount technology machine operator'],
    // ['Manager Relatii Clienti Persoane Fizice - Targu Bujor', 'client relations manager'],
    // ['Sudor MIG/MAG', 'boilermaker'],
    // ['Magaziner cu Autorizatie ISCIR | Arad', 'warehouse operators for clothing'],
    // ['Inginer Proiectare Energetică și Studii Fezabilitate PV', 'design engineer'],
    // ['Medic dentist, medic stomatolog - Franta', 'specialist dentist'],
    // ['Sculer Matriter (Electroeroziune cu Fir si Electrod Masiv)', 'tool and die maker'],
    // ['Operator Frezare CNC (3 si 5 Axe / Componente si Electrozi)', 'laser cutting machine operator'],
    // ['Operator Unelte Masini CNC (Asamblare si Ajustare Matrite)', 'tool grinder'],
    // ['Sef de Tura Balteni Judet Gorj', 'refinery shift manager'],
    // ['Casier Buzias Judet Timis', 'cashier'],
    // ['Casier Gataia Judet Timis', 'cashier'],
    // ['Vorbitori de limba GERMANA in SIGHISOARA - Relatii Clienti', 'client relations manager'],
    // ['Casier Balteni Judet Gorj', 'cashier'],
    // ['Casier Agnita Judet Sibiu', 'cashier'],
    // ['Electrician Siloz Giurgiu', 'electrician'],
    // ['Production Engineering Coordinator– Drobeta Turnu Severin', 'production engineering technician'],
    // ['Medic Specialist/Primar Medicina de Familie', 'coroner'],
    // ['Medic Veterinar', 'general veterinarian'],
    // ['Stivuitorist - Zalau', 'forklift operator'],
    // ['Inginer automatist', 'automation engineer'],
    // ['Stivuitorist - SATU MARE', 'forklift operator'],
    // ['Call Center Travel Agent with German – Work from Office', 'call centre agent'],
    // ['Site Electrical Engineers & Site Civil Engineers', 'mine electrical engineer'],
    // ['Responsabil de tură Buftea, Șos. București-Târgoviște (f/m)', 'refinery shift manager'],
    // ['Electrician PRAM _ CE 110 KV Slatina', 'electrician'],
    // ['Farmacist Junior - Depozit Farmaceutic', 'industrial pharmacist'],
    // ['Consilier de vânzări (m/f)', 'specialised seller'],
    // ['TEHNICIAN-ALPINIST TELECOMUNICATII', 'telecommunications technician'],
    // ['Operator calculator - Magazin Online', 'computer-aided design operator'],
    // ['Manager Resurse Umane', 'human resources manager'],
    // ['Electrician -Tehnician retele echipamente electrice,date-voce', 'office equipment repair technician'],
    // ['Consultant Vanzari - Mobexpert Baia Mare', 'commercial sales representative'],
    // ['Reprezentant Tehnic si Receptioner Tura de Noapte', 'technical sales representative in chemical products'],
    // ['Specialist management deplasări, secretariat, registratură', 'specialist pharmacist'],
    // ['Asistent Medical Generalist/ Kinetoterapeut/ Cosmetician', 'nurse responsible for general care'],
    // ['Lacatus mecanic asamblare', 'rotating equipment mechanic'],
    // ['Jurist', 'lawyer'],
    // ['QUALITY PLANNING ENGINER', 'quality engineer'],
    // ['Inginer proiectant instalații', 'database designer'],
    // ['Customer Agent with English and Irish understanding', 'customer service representative'],
    // ['Asistent Medical Generalist Sectie Chirurgie generală', 'medical administrative assistant'],
    // ['Asistent Manager Flota & Administrativ', 'branch manager'],
    // ['Senior Specialist Aprovizionare (Piese de Schimb) OTOPENI', 'specialist pharmacist'],
    // ['Sales Network Specialist -  Divizia Suport Vanzari', 'network marketer'],
    // ['Contabil', 'accountant'],
    // ['Tehnician Service', 'service manager'],
    // ['Tehnician pe teren zona Harghita', 'road maintenance technician'],
    // ['Cautam colegi pentru Pizza Hut!', 'accountant'],
    // ['Sales Representative -Sisteme Depozitare & Solutii Logistice', 'sales account manager'],
    // ['Tehnician audit de produs', 'sales engineer'],
    // ['Inginer Tehnolog-Industria Cărnii (Experienta min. 5 ani)', 'ammunition assembler'],
    // ['Manager Program', 'programme manager'],
    // ['Manipulant Marfa - NON BAT - Timisoara', 'art handler'],
    // ['Maintenance Manager - top global company', 'facilities manager'],
    // ['Interfata terti si alte departamente , Alexandria', 'accounting manager'],
    // ['Asistent de Farmacie in Lovrin', 'pharmacy assistant'],
    // ['Consultant IT SAP IS-U(244347)', 'green ICT consultant'],
    // ['Asistent Manager', 'management assistant'],
    // ['Lucrator comercial / vanzator  mall - produse din inghetata', 'shop assistant'],
    // ['Project Manager Constructii (Regiune Vest - Transilvania)', 'project manager'],
    // ['ASISTENT VANZARI', 'sales assistant'],
    // ['Inginer Ofertare/Decontare - Constructii Civile', 'civil engineer'],
    // ['AGENT INCHIRIERI AUTO', 'letting agent'],
    // ['Specialist obtinere avize/autorizatii - Piatra Olt', 'specialist pharmacist'],
    // ['Consultant Financiar', 'marketing consultant'],
    ['Regional Sales Manager', 'trade regional manager']
];
let searchMetaArtifact;
let leafStructureArtifact;
let allFamilyNodeIds;
before(async () => {
    const [loadedSearchMeta, loadedLeafStructure] = await Promise.all([
        loadOccupationSearchMetaArtifactRequired(SOURCE),
        loadOccupationLeafStructureArtifactRequired(SOURCE)
    ]);
    searchMetaArtifact = loadedSearchMeta;
    leafStructureArtifact = loadedLeafStructure;
    allFamilyNodeIds = Array.from(new Set(searchMetaArtifact
        .getAllCoreRecords()
        .map((record) => record.familyNodeId)
        .filter((familyNodeId) => familyNodeId !== null))).sort((left, right) => left - right);
});
test('leaf ranker can pick the expected top leaf when ranking across every family', async () => {
    const misses = [];
    for (const [jobTitle, expectedLeaf] of CASES) {
        const result = await rankAcrossAllFamilies(jobTitle);
        if (foldSearchText(result.topLeaf) !== foldSearchText(expectedLeaf)) {
            misses.push(`${jobTitle} -> "${result.topLeaf}" (${result.topFamily}) score=${result.topScore} expected="${expectedLeaf}" families=${allFamilyNodeIds.length} leaves=${result.leafCount}`);
        }
    }
    console.log([
        `all-family leaf-ranker sample (${CASES.length} titles)`,
        `families=${allFamilyNodeIds.length}`,
        `misses=${misses.length}/${CASES.length}`
    ].join('  '));
    for (const miss of misses) {
        console.log(`  ${miss}`);
    }
    assert.deepEqual(misses, []);
});
async function rankAcrossAllFamilies(jobTitle) {
    const cleanedQuery = await cleanOccupationQuerySurface(jobTitle, LOCALE);
    const effectiveQuery = cleanedQuery || jobTitle;
    const preparedQuery = await prepareQuery(effectiveQuery, LOCALE, { sourceName: SOURCE });
    const leaves = searchMetaArtifact.getLeafCoreRecordsForFamilies(allFamilyNodeIds);
    const rankedLeaves = cliRankFamilyLeaves(searchMetaArtifact, leafStructureArtifact, leaves, preparedQuery, effectiveQuery, LOCALE, jobTitle);
    const topLeaf = rankedLeaves[0] ?? null;
    const topLeafRecord = topLeaf ? (leaves.find((leaf) => leaf.graphNodeId === topLeaf.graphNodeId) ?? null) : null;
    return {
        topLeaf: topLeaf?.canonicalLabel ?? 'none',
        topFamily: topLeafRecord?.familyLabel ?? 'none',
        topScore: topLeaf?.totalScore ?? 'n/a',
        leafCount: leaves.length
    };
}
