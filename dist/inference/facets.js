/**
 * Structured finite-facet aliases for source systems whose category values are
 * already deliberate bucket signals.
 *
 * Matching stays exact after deterministic variant generation: diacritic folding,
 * punctuation folding, optional count suffix stripping, and a small set of
 * approved locale synonyms. This gives recall for spelling/style variants without
 * introducing fuzzy finite-bucket guesses.
 *
 * `buildLookup`'s registration is locale-scoped: only a same-locale prior entry
 * can shadow a new one. A different locale's registration sharing the same
 * normalized variant string (e.g. an 'en' row's synonym expansion landing on the
 * same string as an unrelated 'ro' row) must not block this locale's entry from
 * being added — `localeAllowed` is what disambiguates between them at lookup
 * time. `collectFacetCollisions` scopes its dedup key by locale for the same
 * reason: a cross-locale coincidence is not a real collision.
 */
import { collector } from './shared.js';
const SCORE = 0.93;
const RECORDS = [
    r('employment', 'en', ['Internship & Graduate'], ['employment:internship']),
    r('employment', 'ro', ['Program Full Time'], ['employment:full_time']),
    r('employment', 'ro', ['Program Part Time'], ['employment:part_time']),
    r('employment', 'ro', ['Practica / voluntariat'], ['employment:internship']),
    r('employment', 'ro', ['Contractor'], ['employment:contract']),
    r('employment', 'ro', ['Temporar'], ['employment:temporary']),
    r('employment', 'hu', ['Alkalmi munka'], ['employment:temporary']),
    r('employment', 'hu', ['Szakmai gyakorlat'], ['employment:internship']),
    r('employment', 'hu', ['Diákmunka'], ['employment:internship']),
    r('employment', 'hu', ['Alkalmazotti jogviszony'], ['employment:full_time']),
    r('employment', 'et', ['Täistööaeg', 'Täiskohaga töö', 'Püsiv töösuhe'], ['employment:full_time']),
    r('employment', 'et', ['Osaline tööaeg', 'Osalise koormusega töö'], ['employment:part_time']),
    r('employment', 'et', ['Praktika', 'Praktikakoht', 'Õpipoisi koht'], ['employment:internship']),
    r('employment', 'et', ['Lepinguline töö', 'Töövõtuleping', 'Käsundusleping'], ['employment:contract']),
    r('employment', 'et', ['Lepinguline / vabakutseline'], ['employment:contract']),
    r('employment', 'et', ['Ajutine töö', 'Tähtajaline töö'], ['employment:temporary']),
    r('employment', 'et', ['Hooaja-/ajutine töö'], ['employment:seasonal', 'employment:temporary']),
    r('employment', 'et', ['Hooajaline töö'], ['employment:seasonal']),
    r('employment', 'et', ['Palgatöötaja'], ['employment:full_time']),
    r('level', 'ro', ['Nivel C: CEO / COO / CIO / CFO / CTO / CPO'], ['level:executive']),
    r('level', 'ro', ['Manageri senior: șef de departament / șef de echipă'], ['level:manager']),
    r('level', 'ro', ['Team lead: supervizor / șef de unitate'], ['level:lead']),
    r('level', 'ro', ['Nivel Junior: Asociat / Ofițer'], ['level:junior']),
    r('level', 'et', ['Algtase', 'Algaja', 'Ilma kogemuseta'], ['level:entry_level']),
    r('level', 'et', ['Juunior', 'Juunior tase'], ['level:junior']),
    r('level', 'et', ['Kesktase', 'Vahetase', 'Mõõduka kogemusega'], ['level:mid_level']),
    r('level', 'et', ['Seenior', 'Vanemspetsialist', 'Kogenud spetsialist'], ['level:senior']),
    r('level', 'et', ['Tiimijuht', 'Meeskonnajuht', 'Vahetusevanem'], ['level:lead']),
    r('level', 'et', ['Juhataja', 'Osakonnajuht', 'Juht'], ['level:manager']),
    r('level', 'et', ['Direktor', 'Tegevjuht', 'C-tase'], ['level:executive']),
    r('schedule', 'hu', ['Kötött munkarend'], ['schedule:9_to_5']),
    r('schedule', 'hu', ['Kötetlen munkarend'], ['schedule:flexible_hours']),
    r('schedule', 'hu', ['2 műszakos munkarend'], ['schedule:rotational_shift']),
    r('schedule', 'hu', ['3 műszakos munkarend'], ['schedule:rotational_shift']),
    r('schedule', 'hu', ['Több műszakos munkarend'], ['schedule:rotational_shift']),
    r('workplace', 'hu', ['Hibrid/Home office'], ['workplace:hybrid']),
    r('workplace', 'hu', ['Távmunka/Remote'], ['workplace:remote']),
    // English company category/industry facets.
    r('company_type', 'en', ['Farming & Agriculture', 'Agriculture, Fishing & Forestry'], ['company_type:agriculture_agri_business']),
    r('company_type', 'en', ['Accounting, Auditing & Finance'], ['company_type:professional_services', 'company_type:banking_financial_services']),
    r('company_type', 'en', ['Banking & Micro-finance'], ['company_type:banking_financial_services']),
    r('company_type', 'en', ['Government'], ['company_type:government']),
    r('company_type', 'en', ['Software & Data', 'Technology'], ['company_type:information_technology']),
    r('company_type', 'en', ['Legal Services', 'Law & Compliance'], ['company_type:professional_services']),
    r('company_type', 'en', ['Manufacturing/Production'], ['company_type:manufacturing']),
    r('company_type', 'en', ['Marketing & Communications'], ['company_type:media_advertising']),
    r('company_type', 'en', ['Security', 'Enforcement & Security'], ['company_type:security']),
    r('company_type', 'en', ['Medical & Pharmaceutical'], ['company_type:hospital_healthcare', 'company_type:pharma_biotech']),
    r('company_type', 'en', ['Consulting & Strategy'], ['company_type:professional_services']),
    r('company_type', 'en', ['Retail'], ['company_type:retailer']),
    r('company_type', 'en', ['Tourism & Travel', 'Hospitality & Hotel'], ['company_type:hospitality']),
    r('company_type', 'en', ['Insurance'], ['company_type:insurance']),
    r('company_type', 'en', ['Estate Agents & Property Management', 'Real Estate'], ['company_type:real_estate_property']),
    r('company_type', 'en', ['Hospitality & Leisure'], ['company_type:hospitality']),
    r('company_type', 'en', ['Building & Architecture', 'Construction'], ['company_type:construction']),
    r('company_type', 'en', ['Food Services & Catering'], ['company_type:hospitality', 'company_type:food_beverage']),
    r('company_type', 'en', ['Driver & Transport Services'], ['company_type:transportation']),
    r('company_type', 'en', ['Natural Sciences'], ['company_type:pharma_biotech']),
    r('company_type', 'en', ['Health & Safety', 'Healthcare'], ['company_type:hospital_healthcare']),
    r('company_type', 'en', ['Banking, Finance & Insurance'], ['company_type:banking_financial_services', 'company_type:insurance']),
    r('company_type', 'en', ['Education'], ['company_type:education']),
    r('company_type', 'en', ['Energy & Utilities'], ['company_type:energy', 'company_type:utility_provider']),
    r('company_type', 'en', ['Recruitment'], ['company_type:agency']),
    r('company_type', 'en', ['IT & Telecoms'], ['company_type:information_technology', 'company_type:telecom']),
    r('company_type', 'en', ['Shipping & Logistics'], ['company_type:warehouse_logistics', 'company_type:transportation']),
    r('company_type', 'en', ['Manufacturing & Warehousing'], ['company_type:manufacturing', 'company_type:warehouse_logistics']),
    r('company_type', 'en', ['Advertising, Media & Communications', 'Digital, Media & Communications'], ['company_type:media_advertising']),
    r('company_type', 'en', ['Mining, Energy & Metals'], ['company_type:energy']),
    r('company_type', 'en', ['NGO, NPO & Charity'], ['company_type:nonprofit']),
    r('company_type', 'en', ['Retail, Fashion & FMCG'], ['company_type:retailer', 'company_type:food_beverage']),
    r('company_type', 'en', ['Automotive & Aviation'], ['company_type:automotive', 'company_type:aviation']),
    // Romanian company category/industry facets.
    r('company_type', 'ro', ['Agenti imobiliari & managementul proprietatilor'], ['company_type:real_estate_property']),
    r('company_type', 'ro', ['Agricultura & horticultura'], ['company_type:agriculture_agri_business']),
    r('company_type', 'ro', ['Cercetare, predare & instruire'], ['company_type:education']),
    r('company_type', 'ro', ['Constructii & arhitectura'], ['company_type:construction']),
    r('company_type', 'ro', ['Consultanta & strategie'], ['company_type:professional_services']),
    r('company_type', 'ro', ['Contabilitate, audit & finante'], ['company_type:professional_services', 'company_type:banking_financial_services']),
    r('company_type', 'ro', ['Creativ & design'], ['company_type:media_advertising']),
    r('company_type', 'ro', ['Inginerie & tehnologie'], ['company_type:industrial_services']),
    r('company_type', 'ro', ['Marketing & comunicare'], ['company_type:media_advertising']),
    r('company_type', 'ro', ['Medical & farmaceutic'], ['company_type:hospital_healthcare', 'company_type:pharma_biotech']),
    r('company_type', 'ro', ['Meserii & servicii'], ['company_type:industrial_services']),
    r('company_type', 'ro', ['Ospitalitate & timp liber'], ['company_type:hospitality']),
    r('company_type', 'ro', ['Sanatate & siguranta'], ['company_type:hospital_healthcare']),
    r('company_type', 'ro', ['Functionari Publici'], ['company_type:government']),
    r('company_type', 'ro', ['Servicii alimentare & catering'], ['company_type:hospitality', 'company_type:food_beverage']),
    r('company_type', 'ro', ['Servicii juridice'], ['company_type:professional_services']),
    r('company_type', 'ro', ['Servicii pentru clienti & suport'], ['company_type:outsourcing_shared_services']),
    r('company_type', 'ro', ['Sofer & servicii de transport'], ['company_type:transportation']),
    r('company_type', 'ro', ['Software & analiza datelor'], ['company_type:information_technology']),
    r('company_type', 'ro', ['Vanzari & comert'], ['company_type:retailer']),
    r('company_type', 'ro', ['Publicitate, media si comunicare'], ['company_type:media_advertising']),
    r('company_type', 'ro', ['Agricultura, pescuit si silvicultura'], ['company_type:agriculture_agri_business']),
    r('company_type', 'ro', ['Industria Auto'], ['company_type:automotive']),
    r('company_type', 'ro', ['Bancar, finante si asigurari'], ['company_type:banking_financial_services', 'company_type:insurance']),
    r('company_type', 'ro', ['Constructii si infrastructura'], ['company_type:construction']),
    r('company_type', 'ro', ['Educatie'], ['company_type:education']),
    r('company_type', 'ro', ['Energie si utilitati'], ['company_type:energy', 'company_type:utility_provider']),
    r('company_type', 'ro', ['Paza si securitate'], ['company_type:security']),
    r('company_type', 'ro', ['Divertisment si arta'], ['company_type:media_advertising']),
    r('company_type', 'ro', ['Sector public'], ['company_type:government']),
    r('company_type', 'ro', ['Medicina si farmaceutica'], ['company_type:hospital_healthcare', 'company_type:pharma_biotech']),
    r('company_type', 'ro', ['Hoteluri, restaurante si catering'], ['company_type:hospitality', 'company_type:food_beverage']),
    r('company_type', 'ro', ['IT si telecomunicatii'], ['company_type:information_technology', 'company_type:telecom']),
    r('company_type', 'ro', ['Lege si conformitate'], ['company_type:professional_services']),
    r('company_type', 'ro', ['Productie si depozitare'], ['company_type:manufacturing', 'company_type:warehouse_logistics']),
    r('company_type', 'ro', ['Minerit'], ['company_type:energy']),
    r('company_type', 'ro', ['ONG, caritate si protectia mediului'], ['company_type:nonprofit']),
    r('company_type', 'ro', ['Imobiliare si managementul proprietatilor'], ['company_type:real_estate_property']),
    r('company_type', 'ro', ['Recrutare'], ['company_type:agency']),
    r('company_type', 'ro', ['Retail, moda si bunuri de larg consum'], ['company_type:retailer', 'company_type:food_beverage']),
    r('company_type', 'ro', ['Transport si logistica'], ['company_type:transportation', 'company_type:warehouse_logistics']),
    r('company_type', 'ro', ['Turism si recreere'], ['company_type:hospitality']),
    r('company_type', 'ro', ['Industria Aeronautica'], ['company_type:aviation']),
    r('company_type', 'ro', ['Industria Navala'], ['company_type:transportation']),
    r('company_type', 'ro', ['Administrație / Sector Public'], ['company_type:government']),
    r('company_type', 'ro', ['Agrară'], ['company_type:agriculture_agri_business']),
    r('company_type', 'ro', ['Alimentară'], ['company_type:food_beverage']),
    r('company_type', 'ro', ['Artă / Entertainment'], ['company_type:media_advertising']),
    r('company_type', 'ro', ['Asigurări'], ['company_type:insurance']),
    r('company_type', 'ro', ['Bănci / Servicii financiare'], ['company_type:banking_financial_services']),
    r('company_type', 'ro', ['Call-center / BPO'], ['company_type:outsourcing_shared_services']),
    r('company_type', 'ro', ['Chimică'], ['company_type:industrial_services']),
    r('company_type', 'ro', ['Comerț / Retail'], ['company_type:retailer']),
    r('company_type', 'ro', ['Construcții'], ['company_type:construction']),
    r('company_type', 'ro', ['Drept'], ['company_type:professional_services']),
    r('company_type', 'ro', ['Educație / Training'], ['company_type:education']),
    r('company_type', 'ro', ['Energetică'], ['company_type:energy']),
    r('company_type', 'ro', ['Farma'], ['company_type:pharma_biotech']),
    r('company_type', 'ro', ['Imobiliară'], ['company_type:real_estate_property']),
    r('company_type', 'ro', ['IT / Telecom'], ['company_type:information_technology', 'company_type:telecom']),
    r('company_type', 'ro', ['Lemn / PVC'], ['company_type:manufacturing']),
    r('company_type', 'ro', ['Mașini / Auto'], ['company_type:automotive']),
    r('company_type', 'ro', ['Media / Internet'], ['company_type:media_advertising', 'company_type:information_technology']),
    r('company_type', 'ro', ['Medicină / Sănătate'], ['company_type:hospital_healthcare']),
    r('company_type', 'ro', ['Navală / Aeronautică'], ['company_type:transportation', 'company_type:aviation']),
    r('company_type', 'ro', ['Pază și protecție'], ['company_type:security']),
    r('company_type', 'ro', ['Petrol / Gaze'], ['company_type:energy']),
    r('company_type', 'ro', ['Prestări servicii'], ['company_type:professional_services']),
    r('company_type', 'ro', ['Producție'], ['company_type:manufacturing']),
    r('company_type', 'ro', ['Protecția mediului'], ['company_type:nonprofit']),
    r('company_type', 'ro', ['Publicitate / Marketing / PR'], ['company_type:media_advertising']),
    r('company_type', 'ro', ['Sport / Frumusețe'], ['company_type:hospital_healthcare']),
    r('company_type', 'ro', ['Textilă'], ['company_type:manufacturing']),
    r('company_type', 'ro', ['Transport / Logistică / Import - Export'], ['company_type:transportation', 'company_type:warehouse_logistics']),
    r('company_type', 'ro', ['Turism / HoReCa'], ['company_type:hospitality']),
    r('company_type', 'ro', ['Achiziții'], ['company_type:professional_services']),
    r('company_type', 'ro', ['Administrativ / Logistică'], ['company_type:warehouse_logistics']),
    r('company_type', 'ro', ['Agricultură'], ['company_type:agriculture_agri_business']),
    r('company_type', 'ro', ['Alimentație / HoReCa'], ['company_type:hospitality', 'company_type:food_beverage']),
    r('company_type', 'ro', ['Arhitectură / Design interior'], ['company_type:construction']),
    r('company_type', 'ro', ['Au pair / Babysitter / Curățenie'], ['company_type:cleaning_facilities']),
    r('company_type', 'ro', ['Audit / Consultanță'], ['company_type:professional_services']),
    r('company_type', 'ro', ['Auto / Echipamente'], ['company_type:automotive']),
    r('company_type', 'ro', ['Automatizări'], ['company_type:industrial_services']),
    r('company_type', 'ro', ['Bănci'], ['company_type:banking_financial_services']),
    r('company_type', 'ro', ['Cercetare - dezvoltare'], ['company_type:professional_services']),
    r('company_type', 'ro', ['Chimie / Biochimie'], ['company_type:industrial_services', 'company_type:pharma_biotech']),
    r('company_type', 'ro', ['Confecții / Design vestimentar'], ['company_type:manufacturing']),
    r('company_type', 'ro', ['Construcții / Instalații'], ['company_type:construction']),
    r('company_type', 'ro', ['Controlul calității'], ['company_type:manufacturing']),
    r('company_type', 'ro', ['Crewing / Casino / Entertainment'], ['company_type:hospitality', 'company_type:media_advertising']),
    r('company_type', 'ro', ['Educație / Training / Arte'], ['company_type:education', 'company_type:media_advertising']),
    r('company_type', 'ro', ['Farmacie'], ['company_type:pharma_biotech']),
    r('company_type', 'ro', ['Financiar / Contabilitate'], ['company_type:professional_services', 'company_type:banking_financial_services']),
    r('company_type', 'ro', ['Funcții publice'], ['company_type:government']),
    r('company_type', 'ro', ['Grafică / Webdesign / DTP'], ['company_type:media_advertising']),
    r('company_type', 'ro', ['Imobiliare'], ['company_type:real_estate_property']),
    r('company_type', 'ro', ['Import - export'], ['company_type:transportation']),
    r('company_type', 'ro', ['Inginerie'], ['company_type:industrial_services']),
    r('company_type', 'ro', ['Instalații electrice', 'Instalații sanitare', 'Instalații termice'], ['company_type:industrial_services']),
    r('company_type', 'ro', ['Internet / e-Commerce'], ['company_type:information_technology', 'company_type:retailer']),
    r('company_type', 'ro', ['IT Hardware', 'IT Software'], ['company_type:information_technology']),
    r('company_type', 'ro', ['Juridic'], ['company_type:professional_services']),
    r('company_type', 'ro', ['Jurnalism / Editorial'], ['company_type:media_advertising']),
    r('company_type', 'ro', ['Management'], ['company_type:professional_services']),
    r('company_type', 'ro', ['Marketing'], ['company_type:media_advertising']),
    r('company_type', 'ro', ['Medicină alternativă', 'Medicină umană', 'Medicină veterinară'], ['company_type:hospital_healthcare']),
    r('company_type', 'ro', ['Merchandising / Promoteri', 'MLM / Vânzări directe'], ['company_type:retailer']),
    r('company_type', 'ro', ['Naval / Aeronautic'], ['company_type:transportation', 'company_type:aviation']),
    r('company_type', 'ro', ['Office / Back-office / Secretariat'], ['company_type:outsourcing_shared_services']),
    r('company_type', 'ro', ['ONG / Voluntariat'], ['company_type:nonprofit']),
    r('company_type', 'ro', ['Pază și protecție / Militar'], ['company_type:security']),
    r('company_type', 'ro', ['Personal calificat'], ['company_type:industrial_services']),
    r('company_type', 'ro', ['Prelucrarea lemnului / PVC'], ['company_type:manufacturing']),
    r('company_type', 'ro', ['Proiectare civilă / industrială'], ['company_type:construction', 'company_type:industrial_services']),
    r('company_type', 'ro', ['Project Management'], ['company_type:professional_services']),
    r('company_type', 'ro', ['Protecția muncii'], ['company_type:hospital_healthcare']),
    r('company_type', 'ro', ['Publicitate'], ['company_type:media_advertising']),
    r('company_type', 'ro', ['Relații clienți / Call center'], ['company_type:outsourcing_shared_services']),
    r('company_type', 'ro', ['Relații publice'], ['company_type:media_advertising']),
    r('company_type', 'ro', ['Resurse umane / Psihologie'], ['company_type:agency']),
    r('company_type', 'ro', ['Saloane / Clinici frumusețe', 'Sport / Wellness'], ['company_type:hospital_healthcare']),
    r('company_type', 'ro', ['Service / Reparații', 'Specialiști / Tehnicieni'], ['company_type:industrial_services']),
    r('company_type', 'ro', ['Statistică / Matematică', 'Traduceri'], ['company_type:professional_services']),
    r('company_type', 'ro', ['Telecomunicații'], ['company_type:telecom']),
    r('company_type', 'ro', ['Tipografii / Edituri'], ['company_type:media_advertising']),
    r('company_type', 'ro', ['Transport / Distribuție'], ['company_type:transportation', 'company_type:warehouse_logistics']),
    r('company_type', 'ro', ['Turism / Hotel staff'], ['company_type:hospitality']),
    r('company_type', 'ro', ['Vânzări'], ['company_type:retailer']),
    // Estonian company category/industry facets.
    r('company_type', 'et', ['Haldus ja kontoritöö'], ['company_type:outsourcing_shared_services']),
    r('company_type', 'et', ['Põllumajandus, kalandus ja metsandus'], ['company_type:agriculture_agri_business']),
    r('company_type', 'et', ['Kunst ja disain', 'Kunst / meelelahutus'], ['company_type:media_advertising']),
    r('company_type', 'et', ['Ehitus', 'Ehitus ja arhitektuur'], ['company_type:construction']),
    r('company_type', 'et', ['Pangandus, finants ja kindlustus'], ['company_type:banking_financial_services', 'company_type:insurance']),
    r('company_type', 'et', ['Pangandus ja finantsteenused'], ['company_type:banking_financial_services']),
    r('company_type', 'et', ['Kindlustus'], ['company_type:insurance']),
    r('company_type', 'et', ['Haridus ja koolitus', 'Haridus'], ['company_type:education']),
    r('company_type', 'et', ['Energeetika ja kommunaalteenused'], ['company_type:energy', 'company_type:utility_provider']),
    r('company_type', 'et', ['Energeetika', 'Nafta ja gaas'], ['company_type:energy']),
    r('company_type', 'et', ['Avalik sektor', 'Riigisektor'], ['company_type:government']),
    r('company_type', 'et', ['Tervishoid ja meditsiin'], ['company_type:hospital_healthcare']),
    r('company_type', 'et', ['Meditsiin ja farmaatsia'], ['company_type:hospital_healthcare', 'company_type:pharma_biotech']),
    r('company_type', 'et', ['Farmaatsia', 'Biotehnoloogia'], ['company_type:pharma_biotech']),
    r('company_type', 'et', ['Hotellindus ja toitlustus', 'Majutus ja toitlustus'], ['company_type:hospitality', 'company_type:food_beverage']),
    r('company_type', 'et', ['Turism ja reisimine'], ['company_type:hospitality']),
    r('company_type', 'et', ['Värbamine'], ['company_type:agency']),
    r('company_type', 'et', ['IT ja telekommunikatsioon', 'IT / Telekom'], ['company_type:information_technology', 'company_type:telecom']),
    r('company_type', 'et', ['Tarkvara ja andmed', 'IT tarkvara'], ['company_type:information_technology']),
    r('company_type', 'et', ['Telekommunikatsioon'], ['company_type:telecom']),
    r('company_type', 'et', ['Õigus ja vastavus', 'Juriidilised teenused'], ['company_type:professional_services']),
    r('company_type', 'et', ['Transport ja logistika', 'Tarneahel ja hanked'], ['company_type:transportation', 'company_type:warehouse_logistics']),
    r('company_type', 'et', ['Tootmine ja laondus'], ['company_type:manufacturing', 'company_type:warehouse_logistics']),
    r('company_type', 'et', ['Tootmine'], ['company_type:manufacturing']),
    r('company_type', 'et', ['Tööstusteenused', 'Inseneriteenused'], ['company_type:industrial_services']),
    r('company_type', 'et', ['Reklaam, meedia ja kommunikatsioon', 'Turundus ja kommunikatsioon'], ['company_type:media_advertising']),
    r('company_type', 'et', ['Kaevandamine, energia ja metallid'], ['company_type:energy']),
    r('company_type', 'et', ['MTÜ, heategevus ja keskkonnakaitse'], ['company_type:nonprofit']),
    r('company_type', 'et', ['Keskkonnakaitse'], ['company_type:nonprofit']),
    r('company_type', 'et', ['Jaekaubandus, mood ja FMCG'], ['company_type:retailer', 'company_type:food_beverage']),
    r('company_type', 'et', ['Jaekaubandus', 'Müük ja kaubandus'], ['company_type:retailer']),
    r('company_type', 'et', ['Turvalisus ja valve'], ['company_type:security']),
    r('company_type', 'et', ['Kinnisvara ja kinnisvarahaldus'], ['company_type:real_estate_property']),
    r('company_type', 'et', ['Autotööstus ja lennundus'], ['company_type:automotive', 'company_type:aviation']),
    r('company_type', 'et', ['Autotööstus'], ['company_type:automotive']),
    r('company_type', 'et', ['Lennundus'], ['company_type:aviation']),
    r('company_type', 'et', ['Merendus'], ['company_type:transportation']),
    r('company_type', 'et', ['Meelelahutus, üritused ja sport'], ['company_type:media_advertising']),
    r('company_type', 'et', ['Klienditeenindus ja tugi', 'Kõnekeskus / BPO'], ['company_type:outsourcing_shared_services']),
    r('company_type', 'et', ['Raamatupidamine, audit ja finants'], ['company_type:professional_services', 'company_type:banking_financial_services']),
    r('company_type', 'et', ['Konsultatsioon ja strateegia'], ['company_type:professional_services']),
    r('company_type', 'et', ['Personalitöö ja HR'], ['company_type:agency']),
    r('company_type', 'et', ['Assisteerimine / Administreerimine'], ['company_type:outsourcing_shared_services']),
    r('company_type', 'et', ['Ehitus / Kinnisvara'], ['company_type:construction', 'company_type:real_estate_property']),
    r('company_type', 'et', ['Elektroonika / Telekommunikatsioon'], ['company_type:industrial_services', 'company_type:telecom']),
    r('company_type', 'et', ['Energeetika / Loodusvarad'], ['company_type:energy']),
    r('company_type', 'et', ['Finants', 'Pangandus'], ['company_type:banking_financial_services']),
    r('company_type', 'et', ['Haridus / Teadus'], ['company_type:education']),
    r('company_type', 'et', ['Infotehnoloogia'], ['company_type:information_technology']),
    r('company_type', 'et', ['Juhtimine'], ['company_type:professional_services']),
    r('company_type', 'et', ['Klienditeenindus'], ['company_type:outsourcing_shared_services']),
    r('company_type', 'et', ['Koolitus / Personalitöö'], ['company_type:education', 'company_type:agency']),
    r('company_type', 'et', ['Korrakaitse / Turva / Julgeolek'], ['company_type:security']),
    r('company_type', 'et', ['Kultuur / Meelelahutus'], ['company_type:media_advertising']),
    r('company_type', 'et', ['Meedia / Loomemajandus / Tõlkimine'], ['company_type:media_advertising']),
    r('company_type', 'et', ['Mehaanika / Tehnika'], ['company_type:industrial_services']),
    r('company_type', 'et', ['Müük'], ['company_type:retailer']),
    r('company_type', 'et', ['Põllumajandus / Metsandus'], ['company_type:agriculture_agri_business']),
    r('company_type', 'et', ['Riigi- ja avalik haldus'], ['company_type:government']),
    r('company_type', 'et', ['Tervishoid / Sotsiaaltöö'], ['company_type:hospital_healthcare']),
    r('company_type', 'et', ['Toitlustus'], ['company_type:hospitality', 'company_type:food_beverage']),
    r('company_type', 'et', ['Transport / Logistika'], ['company_type:transportation', 'company_type:warehouse_logistics']),
    r('company_type', 'et', ['Turism / Hotellindus / Iluteenused'], ['company_type:hospitality', 'company_type:hospital_healthcare']),
    r('company_type', 'et', ['Turundus / Reklaam / PR'], ['company_type:media_advertising']),
    r('company_type', 'et', ['Tööstus / Tootmine'], ['company_type:manufacturing']),
    r('company_type', 'et', ['Vabatahtlik töö'], ['company_type:nonprofit']),
    r('company_type', 'et', ['Õigusala'], ['company_type:professional_services']),
    // Hungarian company category facets.
    r('company_type', 'hu', ['Adminisztráció, Irodai munka'], ['company_type:outsourcing_shared_services']),
    r('company_type', 'hu', ['Bank, Biztosítás, Bróker'], ['company_type:banking_financial_services', 'company_type:insurance']),
    r('company_type', 'hu', ['Cégvezetés, Menedzsment'], ['company_type:professional_services']),
    r('company_type', 'hu', ['Egészségügy, Gyógyszeripar'], ['company_type:hospital_healthcare', 'company_type:pharma_biotech']),
    r('company_type', 'hu', ['Építőipar, Ingatlan'], ['company_type:construction', 'company_type:real_estate_property']),
    r('company_type', 'hu', ['Értékesítés, Kereskedelem'], ['company_type:retailer']),
    r('company_type', 'hu', ['Fizikai, Segéd, Betanított munka'], ['company_type:industrial_services']),
    r('company_type', 'hu', ['Gyártás, Termelés'], ['company_type:manufacturing']),
    r('company_type', 'hu', ['HR', 'HR, Munkaügy'], ['company_type:agency']),
    r('company_type', 'hu', ['IT programozás, Fejlesztés'], ['company_type:information_technology']),
    r('company_type', 'hu', ['IT üzemeltetés, Telekom', 'IT Telekom'], ['company_type:information_technology', 'company_type:telecom']),
    r('company_type', 'hu', ['Jog, Jogi tanácsadás'], ['company_type:professional_services']),
    r('company_type', 'hu', ['Közigazgatás'], ['company_type:government']),
    r('company_type', 'hu', ['Marketing, Média, PR'], ['company_type:media_advertising']),
    r('company_type', 'hu', ['Mérnök'], ['company_type:industrial_services']),
    r('company_type', 'hu', ['Mezőgazdaság, Környezet'], ['company_type:agriculture_agri_business', 'company_type:nonprofit']),
    r('company_type', 'hu', ['Oktatás, Tudomány, Sport'], ['company_type:education']),
    r('company_type', 'hu', ['Pénzügy, Könyvelés'], ['company_type:professional_services', 'company_type:banking_financial_services']),
    r('company_type', 'hu', ['Szakmunka'], ['company_type:industrial_services']),
    r('company_type', 'hu', ['Szállítás, Beszerzés, Logisztika'], ['company_type:transportation', 'company_type:warehouse_logistics']),
    r('company_type', 'hu', ['Ügyfélszolgálat, Vevőszolgálat'], ['company_type:outsourcing_shared_services']),
    r('company_type', 'hu', ['Üzleti támogató központok'], ['company_type:outsourcing_shared_services']),
    r('company_type', 'hu', ['Vendéglátás, Idegenforgalom'], ['company_type:hospitality']),
];
export function inferFacetTerms(bucket, clauses, languages) {
    const { add, terms } = collector();
    for (const c of clauses) {
        for (const entry of LOOKUP.get(bucket)?.get(normalizeFacetSurface(c.text)) ?? []) {
            if (!localeAllowed(entry.locale, languages))
                continue;
            if (entry.requiredAcronym && !isExactAcronymSurface(c.text, entry.requiredAcronym))
                continue;
            for (const key of entry.keys)
                add(key, SCORE, c.text);
        }
    }
    return terms();
}
export function isFacetBucket(bucket) {
    return (bucket === 'company_type' ||
        bucket === 'employment' ||
        bucket === 'level' ||
        bucket === 'schedule' ||
        bucket === 'workplace');
}
export function facetCollisionErrors() {
    return collectFacetCollisions(RECORDS);
}
function r(bucket, locale, surfaces, keys) {
    return { bucket, locale, surfaces, keys };
}
function buildLookup(records) {
    const byBucket = new Map();
    for (const record of records) {
        const bucketMap = byBucket.get(record.bucket) ?? new Map();
        byBucket.set(record.bucket, bucketMap);
        const keys = [...record.keys];
        for (const surface of record.surfaces) {
            for (const variant of facetSurfaceVariants(surface, record.locale)) {
                const prev = bucketMap.get(variant);
                const sameLocale = prev?.filter((x) => x.locale === record.locale);
                const entry = {
                    keys,
                    locale: record.locale,
                    requiredAcronym: acronymOnlySurface(variant),
                };
                if (sameLocale?.some((x) => x.keys.join('|') !== keys.join('|')))
                    continue;
                if (sameLocale?.some((x) => x.requiredAcronym === entry.requiredAcronym))
                    continue;
                bucketMap.set(variant, [...(prev ?? []), entry]);
            }
        }
    }
    return byBucket;
}
function collectFacetCollisions(records) {
    const seen = new Map();
    const collisions = [];
    for (const record of records) {
        const keys = [...record.keys].join('|');
        for (const surface of record.surfaces) {
            for (const variant of facetSurfaceVariants(surface, record.locale)) {
                const lookupKey = `${record.bucket}:${record.locale}:${variant}`;
                const prev = seen.get(lookupKey);
                if (prev && prev !== keys) {
                    collisions.push(`${lookupKey} maps to [${prev.replaceAll('|', ', ')}] and [${keys.replaceAll('|', ', ')}]`);
                }
                else {
                    seen.set(lookupKey, keys);
                }
            }
        }
    }
    return collisions;
}
function facetSurfaceVariants(surface, locale) {
    const found = new Set();
    const queue = [normalizeFacetSurface(surface)];
    for (let i = 0; i < queue.length; i++) {
        const current = queue[i];
        if (found.has(current))
            continue;
        found.add(current);
        for (const next of synonymVariants(current, locale))
            if (!found.has(next))
                queue.push(next);
    }
    return [...found].filter(Boolean);
}
export function normalizeFacetSurface(text) {
    return text
        .replace(/\(\s*\d+\s*\)/g, '')
        .normalize('NFKD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[–—−]/g, '-')
        .toLowerCase()
        .replace(/[&,+/|:;]+/g, ' ')
        .replace(/(?<=\p{L})-(?=\p{L})/gu, ' ')
        .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}
const SYNONYMS = {
    en: [
        ['pr', 'public relations'],
        ['telecoms', 'telecom'],
    ],
    et: [
        ['telekom', 'telekommunikatsioon'],
        ['hr', 'personalitoo'],
        ['pr', 'suhtekorraldus'],
    ],
    hu: [
        ['telekom', 'telekommunikacio'],
        ['home office', 'otthoni munka'],
        ['remote', 'tavmunka'],
        ['munkaugy', 'hr'],
    ],
    ro: [
        ['horeca', 'hoteluri restaurante catering'],
        ['pr', 'relatii publice'],
        ['telecom', 'telecomunicatii'],
    ],
};
const ACRONYM_TOKENS = new Set(['bpo', 'dtp', 'hr', 'it', 'mlm', 'ngo', 'ong', 'pfa', 'pr', 'pvc']);
const LOOKUP = buildLookup(RECORDS);
function synonymVariants(surface, locale) {
    const out = [];
    for (const [a, b] of SYNONYMS[locale]) {
        out.push(replaceTokenSequence(surface, a, b), replaceTokenSequence(surface, b, a));
    }
    return out.filter((x) => x !== surface);
}
function replaceTokenSequence(surface, from, to) {
    return surface.replace(new RegExp(`(?:^| )${escapeRegExp(from)}(?=$| )`, 'g'), (m) => `${m.startsWith(' ') ? ' ' : ''}${to}`);
}
function acronymOnlySurface(surface) {
    return ACRONYM_TOKENS.has(surface) ? surface.toUpperCase() : undefined;
}
function isExactAcronymSurface(text, acronym) {
    return text.replace(/\(\s*\d+\s*\)/g, '').trim() === acronym;
}
function localeAllowed(locale, languages) {
    return !languages || languages.includes(locale);
}
function escapeRegExp(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
