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

import type { Clause } from '../tokenizer.js';
import type { BucketName, SupportedLanguage } from '../types.js';
import { collector, type InferredTerm } from './shared.js';

export type FacetBucket = Extract<
  BucketName,
  'sector' | 'job_function' | 'employment' | 'level' | 'schedule' | 'workplace'
>;
type Locale = 'en' | 'et' | 'hu' | 'ro';

interface FacetAliasRecord {
  bucket: FacetBucket;
  locale: Locale;
  surfaces: readonly string[];
  keys: readonly string[];
}

interface FacetLookupEntry {
  keys: readonly string[];
  locale: Locale;
  requiredAcronym?: string;
}

const SCORE = 0.93;

const RECORDS: readonly FacetAliasRecord[] = [
  r('employment', 'en', ['Internship & Graduate', 'Internship Graduate'], ['employment:internship']),
  r('employment', 'ro', ['Program Full Time'], ['employment:full_time']),
  r('employment', 'ro', ['Program Part Time'], ['employment:part_time']),
  r('employment', 'ro', ['Practica / voluntariat', 'practica voluntariat'], ['employment:internship']),
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
  r('level', 'ro', ['Nivel Junior: Asociat / Ofițer', 'nivel junior asociat ofiter'], ['level:junior']),
  r('level', 'en', ['Team lead supervisor unit head'], ['level:lead']),
  r('level', 'et', ['Algtase', 'Algaja', 'Ilma kogemuseta'], ['level:entry_level']),
  r('level', 'et', ['Juunior', 'Juunior tase'], ['level:junior']),
  r('level', 'et', ['Kesktase', 'Vahetase', 'Mõõduka kogemusega'], ['level:mid_level']),
  r('level', 'et', ['Seenior', 'Vanemspetsialist', 'Kogenud spetsialist'], ['level:senior']),
  r('level', 'et', ['Tiimijuht', 'Meeskonnajuht', 'Vahetusevanem'], ['level:lead']),
  r('level', 'et', ['Juhataja', 'Osakonnajuht', 'Juht'], ['level:manager']),
  r('level', 'et', ['Direktor', 'Tegevjuht', 'C-tase'], ['level:executive']),

  r('schedule', 'hu', ['Kötött', 'Kötött munkarend'], ['schedule:fixed_shift']),
  r('schedule', 'hu', ['Kötetlen munkarend'], ['schedule:flexible_hours']),
  r('schedule', 'hu', ['2 műszak', '2 műszakos munkarend'], ['schedule:rotational_shift']),
  r('schedule', 'hu', ['3 műszak', '3 műszakos munkarend'], ['schedule:rotational_shift']),
  r('schedule', 'hu', ['Több műszak', 'Több műszakos munkarend'], ['schedule:rotational_shift']),

  r('workplace', 'en', ['Fixed location'], ['workplace:onsite']),
  r('workplace', 'en', ['Flexible'], ['workplace:flexible']),
  r('workplace', 'en', ['Hybrid'], ['workplace:hybrid']),
  r('workplace', 'en', ['Remote'], ['workplace:remote']),
  r('workplace', 'hu', ['Hibrid/Home office'], ['workplace:hybrid']),
  r('workplace', 'hu', ['Helyhez kötött'], ['workplace:onsite']),
  r('workplace', 'hu', ['Terület/régió'], ['workplace:flexible']),
  r('workplace', 'hu', ['Távmunka/Remote'], ['workplace:remote']),

  // English sector facets.
  r(
    'sector',
    'en',
    ['Agriculture, Fishing & Forestry', 'Agriculture', 'Fishing', 'Forestry'],
    ['sector:agriculture_agri_business'],
  ),
  r('sector', 'en', ['Art & Design', 'Art', 'Design'], ['sector:media_advertising']),
  r('sector', 'en', ['Construction'], ['sector:construction']),
  r('sector', 'en', ['Banking, Finance & Insurance'], ['sector:banking_financial_services', 'sector:insurance']),
  r('sector', 'en', ['Banking', 'Finance'], ['sector:banking_financial_services']),
  r('sector', 'en', ['Insurance'], ['sector:insurance']),
  r('sector', 'en', ['Education'], ['sector:education']),
  r('sector', 'en', ['Energy & Utilities'], ['sector:energy', 'sector:utility_provider']),
  r('sector', 'en', ['Energy'], ['sector:energy']),
  r('sector', 'en', ['Utilities'], ['sector:utility_provider']),
  r('sector', 'en', ['Government'], ['sector:government']),
  r('sector', 'en', ['Healthcare'], ['sector:hospital_healthcare']),
  r(
    'sector',
    'en',
    ['Hospitality & Hotel', 'Hospitality', 'Hotel', 'Tourism & Travel', 'Tourism', 'Travel'],
    ['sector:hospitality'],
  ),
  r('sector', 'en', ['Recruitment'], ['sector:professional_services']),
  r('sector', 'en', ['IT & Telecoms'], ['sector:information_technology', 'sector:telecom']),
  r('sector', 'en', ['IT', 'Information Technology', 'Technology'], ['sector:information_technology']),
  r('sector', 'en', ['Telecoms', 'Telecom'], ['sector:telecom']),
  r('sector', 'en', ['Law & Compliance'], ['sector:professional_services']),
  r('sector', 'en', ['Law', 'Compliance'], ['sector:professional_services']),
  r('sector', 'en', ['Shipping & Logistics'], ['sector:transportation', 'sector:warehouse_logistics']),
  r('sector', 'en', ['Shipping'], ['sector:transportation']),
  r('sector', 'en', ['Logistics'], ['sector:warehouse_logistics']),
  r('sector', 'en', ['Manufacturing & Warehousing'], ['sector:manufacturing', 'sector:warehouse_logistics']),
  r('sector', 'en', ['Manufacturing', 'Manufacturing/Production'], ['sector:manufacturing']),
  r('sector', 'en', ['Warehousing'], ['sector:warehouse_logistics']),
  r(
    'sector',
    'en',
    ['Advertising, Media & Communications', 'Advertising', 'Media', 'Communications'],
    ['sector:media_advertising'],
  ),
  r('sector', 'en', ['Digital, Media & Communications'], ['sector:media_advertising', 'sector:information_technology']),
  r('sector', 'en', ['Digital'], ['sector:information_technology']),
  r('sector', 'en', ['Mining, Energy & Metals'], ['sector:energy']),
  r('sector', 'en', ['Mining', 'Metals'], ['sector:energy']),
  r('sector', 'en', ['NGO, NPO & Charity'], ['sector:nonprofit']),
  r('sector', 'en', ['NGO', 'NPO', 'Charity'], ['sector:nonprofit']),
  r('sector', 'en', ['Retail, Fashion & FMCG'], ['sector:retailer', 'sector:food_beverage']),
  r('sector', 'en', ['Retail', 'Fashion'], ['sector:retailer']),
  r('sector', 'en', ['FMCG'], ['sector:food_beverage']),
  r('sector', 'en', ['Enforcement & Security'], ['sector:security']),
  r('sector', 'en', ['Enforcement', 'Security'], ['sector:security']),
  r('sector', 'en', ['Real Estate'], ['sector:real_estate_property']),
  r('sector', 'en', ['Automotive & Aviation'], ['sector:automotive', 'sector:aviation']),
  r('sector', 'en', ['Automotive'], ['sector:automotive']),
  r('sector', 'en', ['Aviation'], ['sector:aviation']),
  r(
    'sector',
    'en',
    ['Entertainment, Events & Sport', 'Entertainment', 'Events', 'Sport'],
    ['sector:media_advertising'],
  ),
  r('sector', 'en', ['Farming & Agriculture', 'Farming'], ['sector:agriculture_agri_business']),
  r('sector', 'en', ['Medical & Pharmaceutical'], ['sector:hospital_healthcare', 'sector:pharma_biotech']),
  r('sector', 'en', ['Medical'], ['sector:hospital_healthcare']),
  r('sector', 'en', ['Pharmaceutical'], ['sector:pharma_biotech']),
  r('sector', 'en', ['Estate Agents & Property Management'], ['sector:real_estate_property']),
  r('sector', 'en', ['Estate Agents', 'Property Management'], ['sector:real_estate_property']),
  r('sector', 'en', ['Building & Architecture'], ['sector:construction']),
  r('sector', 'en', ['Building', 'Architecture'], ['sector:construction']),
  r('sector', 'en', ['Food Services & Catering'], ['sector:food_beverage']),
  r('sector', 'en', ['Food Services', 'Catering'], ['sector:food_beverage']),

  // English job-function facets.
  r('job_function', 'en', ['Admin & Office', 'Admin', 'Office'], ['job_function:administration']),
  r('job_function', 'en', ['Farming & Agriculture', 'Farming', 'Agriculture'], ['job_function:skilled_trades']),
  r('job_function', 'en', ['Accounting, Auditing & Finance'], ['job_function:finance_accounting']),
  r('job_function', 'en', ['Accounting', 'Auditing', 'Finance'], ['job_function:finance_accounting']),
  r('job_function', 'en', ['Banking & Micro-finance', 'Banking', 'Micro-finance'], ['job_function:banking']),
  r('job_function', 'en', ['Management'], ['job_function:management']),
  r('job_function', 'en', ['Engineering & Technology', 'Engineering', 'Technology'], ['job_function:engineering']),
  r('job_function', 'en', ['Product & Project Management'], ['job_function:project_management']),
  r('job_function', 'en', ['Product Management', 'Project Management'], ['job_function:project_management']),
  r(
    'job_function',
    'en',
    ['Creative & Design'],
    ['job_function:architecture_design', 'job_function:arts_entertainment'],
  ),
  r('job_function', 'en', ['Creative'], ['job_function:arts_entertainment']),
  r('job_function', 'en', ['Design'], ['job_function:architecture_design']),
  r(
    'job_function',
    'en',
    ['Customer Service & Support', 'Customer Service', 'Support'],
    ['job_function:customer_support'],
  ),
  r(
    'job_function',
    'en',
    ['Research, Teaching & Training'],
    ['job_function:research_development', 'job_function:education_training'],
  ),
  r('job_function', 'en', ['Research'], ['job_function:research_development']),
  r('job_function', 'en', ['Teaching', 'Training'], ['job_function:education_training']),
  r('job_function', 'en', ['Government'], ['job_function:administration']),
  r('job_function', 'en', ['Human Resources'], ['job_function:human_resources']),
  r('job_function', 'en', ['Software & Data'], ['job_function:it_software_data']),
  r('job_function', 'en', ['Software', 'Data'], ['job_function:it_software_data']),
  r('job_function', 'en', ['Legal Services'], ['job_function:legal_compliance']),
  r(
    'job_function',
    'en',
    ['Supply Chain & Procurement'],
    ['job_function:operations_logistics', 'job_function:procurement'],
  ),
  r('job_function', 'en', ['Supply Chain'], ['job_function:operations_logistics']),
  r('job_function', 'en', ['Procurement'], ['job_function:procurement']),
  r('job_function', 'en', ['Manufacturing/Production'], ['job_function:skilled_trades']),
  r(
    'job_function',
    'en',
    ['Marketing & Communications', 'Marketing', 'Communications'],
    ['job_function:marketing_communications'],
  ),
  r('job_function', 'en', ['Security'], ['job_function:security']),
  r('job_function', 'en', ['Medical & Pharmaceutical'], ['job_function:healthcare']),
  r('job_function', 'en', ['Medical', 'Pharmaceutical'], ['job_function:healthcare']),
  r('job_function', 'en', ['Consulting & Strategy'], ['job_function:consulting_strategy']),
  r('job_function', 'en', ['Consulting', 'Strategy'], ['job_function:consulting_strategy']),
  r(
    'job_function',
    'en',
    ['Community & Social Services', 'Community', 'Social Services'],
    ['job_function:community_social_services'],
  ),
  r(
    'job_function',
    'en',
    ['Quality Control & Assurance', 'Quality Control', 'Quality Assurance', 'Assurance'],
    ['job_function:quality_assurance'],
  ),
  r('job_function', 'en', ['Retail'], ['job_function:sales_commerce']),
  r(
    'job_function',
    'en',
    ['Management & Business Development'],
    ['job_function:management', 'job_function:business_development'],
  ),
  r('job_function', 'en', ['Business Development'], ['job_function:business_development']),
  r('job_function', 'en', ['Tourism & Travel', 'Hospitality & Leisure'], ['job_function:hospitality_food_service']),
  r('job_function', 'en', ['Tourism', 'Travel', 'Hospitality', 'Leisure'], ['job_function:hospitality_food_service']),
  r('job_function', 'en', ['Trades & Services'], ['job_function:skilled_trades']),
  r('job_function', 'en', ['Trades', 'Services'], ['job_function:skilled_trades']),
  r('job_function', 'en', ['Mining & Natural Resources'], ['job_function:mining_natural_resources']),
  r('job_function', 'en', ['Mining', 'Natural Resources'], ['job_function:mining_natural_resources']),
  r('job_function', 'en', ['Insurance'], ['job_function:insurance']),
  r('job_function', 'en', ['Internships & Volunteering'], ['job_function:volunteering_internships']),
  r('job_function', 'en', ['Internships', 'Volunteering'], ['job_function:volunteering_internships']),
  r('job_function', 'en', ['Estate Agents & Property Management'], ['job_function:sales_commerce']),
  r('job_function', 'en', ['Estate Agents', 'Property Management'], ['job_function:sales_commerce']),
  r(
    'job_function',
    'en',
    ['Building & Architecture'],
    ['job_function:architecture_design', 'job_function:skilled_trades'],
  ),
  r('job_function', 'en', ['Building'], ['job_function:skilled_trades']),
  r('job_function', 'en', ['Architecture'], ['job_function:architecture_design']),
  r('job_function', 'en', ['Food Services & Catering'], ['job_function:hospitality_food_service']),
  r('job_function', 'en', ['Food Services', 'Catering'], ['job_function:hospitality_food_service']),
  r('job_function', 'en', ['Natural Sciences'], ['job_function:research_development']),
  r('job_function', 'en', ['Driver & Transport Services'], ['job_function:transport_driving']),
  r('job_function', 'en', ['Driver', 'Transport Services'], ['job_function:transport_driving']),
  r('job_function', 'en', ['Sales'], ['job_function:sales_commerce']),
  r('job_function', 'en', ['Health & Safety', 'Health', 'Safety'], ['job_function:health_safety']),

  // Romanian sector facets.
  r('sector', 'ro', ['Administrație / Sector Public'], ['sector:government']),
  r('sector', 'ro', ['Agrară'], ['sector:agriculture_agri_business']),
  r('sector', 'ro', ['Alimentară'], ['sector:food_beverage']),
  r('sector', 'ro', ['Artă / Entertainment'], ['sector:media_advertising']),
  r('sector', 'ro', ['Asigurări'], ['sector:insurance']),
  r('sector', 'ro', ['Bănci / Servicii financiare'], ['sector:banking_financial_services']),
  r('sector', 'ro', ['Call-center / BPO'], ['sector:professional_services']),
  r('sector', 'ro', ['Chimică'], ['sector:industrial_services']),
  r('sector', 'ro', ['Comerț / Retail'], ['sector:retailer']),
  r('sector', 'ro', ['Construcții'], ['sector:construction']),
  r('sector', 'ro', ['Drept'], ['sector:professional_services']),
  r('sector', 'ro', ['Educație / Training'], ['sector:education']),
  r('sector', 'ro', ['Energetică'], ['sector:energy']),
  r('sector', 'ro', ['Farma'], ['sector:pharma_biotech']),
  r('sector', 'ro', ['Imobiliară'], ['sector:real_estate_property']),
  r('sector', 'ro', ['IT / Telecom'], ['sector:information_technology', 'sector:telecom']),
  r('sector', 'ro', ['Lemn / PVC'], ['sector:manufacturing']),
  r('sector', 'ro', ['Mașini / Auto'], ['sector:automotive']),
  r('sector', 'ro', ['Media / Internet'], ['sector:media_advertising', 'sector:information_technology']),
  r('sector', 'ro', ['Medicină / Sănătate'], ['sector:hospital_healthcare']),
  r('sector', 'ro', ['Navală / Aeronautică'], ['sector:transportation', 'sector:aviation']),
  r('sector', 'ro', ['Pază și protecție'], ['sector:security']),
  r('sector', 'ro', ['Petrol / Gaze'], ['sector:energy']),
  r('sector', 'ro', ['Prestări servicii'], ['sector:professional_services']),
  r('sector', 'ro', ['Producție'], ['sector:manufacturing']),
  r('sector', 'ro', ['Protecția mediului'], ['sector:nonprofit']),
  r('sector', 'ro', ['Publicitate / Marketing / PR'], ['sector:media_advertising']),
  r('sector', 'ro', ['Sport / Frumusețe'], ['sector:media_advertising']),
  r('sector', 'ro', ['Textilă'], ['sector:manufacturing']),
  r(
    'sector',
    'ro',
    ['Transport / Logistică / Import - Export'],
    ['sector:transportation', 'sector:warehouse_logistics'],
  ),
  r('sector', 'ro', ['Turism / HoReCa'], ['sector:hospitality']),
  r('sector', 'ro', ['Agricultură'], ['sector:agriculture_agri_business']),
  r('sector', 'ro', ['Alimentație / HoReCa'], ['sector:hospitality', 'sector:food_beverage']),
  r('sector', 'ro', ['Arhitectură / Design interior'], ['sector:construction']),
  r('sector', 'ro', ['Au pair / Babysitter / Curățenie'], ['sector:professional_services']),
  r('sector', 'ro', ['Auto / Echipamente'], ['sector:automotive']),
  r('sector', 'ro', ['Bănci'], ['sector:banking_financial_services']),
  r('sector', 'ro', ['Chimie / Biochimie'], ['sector:industrial_services', 'sector:pharma_biotech']),
  r('sector', 'ro', ['Confecții / Design vestimentar'], ['sector:manufacturing']),
  r('sector', 'ro', ['Construcții / Instalații'], ['sector:construction']),
  r('sector', 'ro', ['Crewing / Casino / Entertainment'], ['sector:hospitality', 'sector:media_advertising']),
  r('sector', 'ro', ['Educație / Training / Arte'], ['sector:education']),
  r('sector', 'ro', ['Farmacie'], ['sector:pharma_biotech']),
  r('sector', 'ro', ['Publicitate, media si comunicare'], ['sector:media_advertising']),
  r('sector', 'ro', ['Agricultura, pescuit si silvicultura'], ['sector:agriculture_agri_business']),
  r('sector', 'ro', ['Industria Auto'], ['sector:automotive']),
  r('sector', 'ro', ['Bancar, finante si asigurari'], ['sector:banking_financial_services']),
  r('sector', 'ro', ['Constructii si infrastructura'], ['sector:construction']),
  r('sector', 'ro', ['Educatie'], ['sector:education']),
  r('sector', 'ro', ['Energie si utilitati'], ['sector:energy']),
  r('sector', 'ro', ['Paza si securitate'], ['sector:security']),
  r('sector', 'ro', ['Divertisment si arta'], ['sector:media_advertising']),
  r('sector', 'ro', ['Sector public'], ['sector:government']),
  r('sector', 'ro', ['Medicina si farmaceutica'], ['sector:hospital_healthcare']),
  r('sector', 'ro', ['Hoteluri, restaurante si catering'], ['sector:hospitality']),
  r('sector', 'ro', ['IT si telecomunicatii'], ['sector:information_technology']),
  r('sector', 'ro', ['Lege si conformitate'], ['sector:professional_services']),
  r('sector', 'ro', ['Productie si depozitare'], ['sector:manufacturing', 'sector:warehouse_logistics']),
  r('sector', 'ro', ['Minerit'], ['sector:energy']),
  r('sector', 'ro', ['ONG, caritate si protectia mediului'], ['sector:nonprofit']),
  r('sector', 'ro', ['Imobiliare si managementul proprietatilor'], ['sector:real_estate_property']),
  r('sector', 'ro', ['Recrutare'], ['sector:professional_services']),
  r('sector', 'ro', ['Retail, moda si bunuri de larg consum'], ['sector:retailer']),
  r('sector', 'ro', ['Transport si logistica'], ['sector:transportation', 'sector:warehouse_logistics']),
  r('sector', 'ro', ['Turism si recreere'], ['sector:hospitality']),
  r('sector', 'ro', ['Industria Aeronautica'], ['sector:aviation']),
  r('sector', 'ro', ['Industria Navala'], ['sector:transportation']),
  r('sector', 'ro', ['Sport si welness'], ['sector:media_advertising']),

  // Romanian job-function facets.
  r('job_function', 'ro', ['Achiziții'], ['job_function:procurement']),
  r(
    'job_function',
    'ro',
    ['Administrativ / Logistică'],
    ['job_function:administration', 'job_function:operations_logistics'],
  ),
  r('job_function', 'ro', ['Agricultură'], ['job_function:skilled_trades']),
  r('job_function', 'ro', ['Alimentație / HoReCa'], ['job_function:hospitality_food_service']),
  r('job_function', 'ro', ['Arhitectură / Design interior'], ['job_function:architecture_design']),
  r('job_function', 'ro', ['Asigurări'], ['job_function:insurance']),
  r('job_function', 'ro', ['Au pair / Babysitter / Curățenie'], ['job_function:animal_care_childcare_cleaning']),
  r(
    'job_function',
    'ro',
    ['Audit / Consultanță'],
    ['job_function:finance_accounting', 'job_function:consulting_strategy'],
  ),
  r('job_function', 'ro', ['Auto / Echipamente'], ['job_function:mechanical_technical']),
  r('job_function', 'ro', ['Automatizări'], ['job_function:engineering', 'job_function:mechanical_technical']),
  r('job_function', 'ro', ['Bănci'], ['job_function:banking']),
  r('job_function', 'ro', ['Cercetare - dezvoltare'], ['job_function:research_development']),
  r('job_function', 'ro', ['Chimie / Biochimie'], ['job_function:research_development']),
  r('job_function', 'ro', ['Confecții / Design vestimentar'], ['job_function:skilled_trades']),
  r('job_function', 'ro', ['Construcții / Instalații'], ['job_function:skilled_trades']),
  r('job_function', 'ro', ['Controlul calității'], ['job_function:quality_assurance']),
  r('job_function', 'ro', ['Crewing / Casino / Entertainment'], ['job_function:arts_entertainment']),
  r(
    'job_function',
    'ro',
    ['Educație / Training / Arte'],
    ['job_function:education_training', 'job_function:arts_entertainment'],
  ),
  r('job_function', 'ro', ['Farmacie'], ['job_function:healthcare']),
  r('job_function', 'ro', ['Financiar / Contabilitate'], ['job_function:finance_accounting']),
  r('job_function', 'ro', ['Imobiliare'], ['job_function:sales_commerce']),
  r('job_function', 'ro', ['Inginerie'], ['job_function:engineering']),
  r('job_function', 'ro', ['Instalații electrice'], ['job_function:skilled_trades']),
  r('job_function', 'ro', ['Instalații sanitare'], ['job_function:skilled_trades']),
  r('job_function', 'ro', ['Instalații termice'], ['job_function:skilled_trades']),
  r(
    'job_function',
    'ro',
    ['IT Hardware', 'IT Software', 'Internet / e-Commerce', 'Telecomunicații'],
    ['job_function:it_software_data'],
  ),
  r('job_function', 'ro', ['Management'], ['job_function:management']),
  r('job_function', 'ro', ['Marketing'], ['job_function:marketing_communications']),
  r('job_function', 'ro', ['Medicină umană'], ['job_function:healthcare']),
  r('job_function', 'ro', ['Merchandising / Promoteri'], ['job_function:sales_commerce']),
  r('job_function', 'ro', ['MLM / Vânzări directe'], ['job_function:sales_commerce']),
  r('job_function', 'ro', ['Naval / Aeronautic'], ['job_function:mechanical_technical']),
  r(
    'job_function',
    'ro',
    ['Office / Back-office / Secretariat', 'office-secretariat'],
    ['job_function:administration'],
  ),
  r('job_function', 'ro', ['Personal calificat'], ['job_function:skilled_trades']),
  r('job_function', 'ro', ['Producție'], ['job_function:skilled_trades']),
  r(
    'job_function',
    'ro',
    ['Proiectare civilă / industrială'],
    ['job_function:architecture_design', 'job_function:engineering'],
  ),
  r('job_function', 'ro', ['Project Management'], ['job_function:project_management']),
  r('job_function', 'ro', ['Relații clienți / Call center'], ['job_function:customer_support']),
  r('job_function', 'ro', ['Resurse umane / Psihologie'], ['job_function:human_resources']),
  r('job_function', 'ro', ['Service / Reparații'], ['job_function:mechanical_technical']),
  r('job_function', 'ro', ['Specialiști / Tehnicieni'], ['job_function:mechanical_technical']),
  r(
    'job_function',
    'ro',
    ['Transport / Distribuție'],
    ['job_function:transport_driving', 'job_function:operations_logistics'],
  ),
  r('job_function', 'ro', ['Turism / Hotel staff'], ['job_function:hospitality_food_service']),
  r('job_function', 'ro', ['Vânzări', 'Vanzari', 'vanzari', 'Sales'], ['job_function:sales_commerce']),

  // Hungarian sector facets.
  r('sector', 'hu', ['Építő munka, Földmunka', 'Építőipari segédmunkás'], ['sector:construction']),
  r('sector', 'hu', ['Mezőgazdasági munka'], ['sector:agriculture_agri_business']),
  r('sector', 'hu', ['Takarítás, Tisztítás'], ['sector:professional_services']),
  r('sector', 'hu', ['Adminisztráció, Asszisztens, Irodai munka'], ['sector:professional_services']),
  r('sector', 'hu', ['Bank, Biztosítás, Bróker'], ['sector:banking_financial_services', 'sector:insurance']),
  r('sector', 'hu', ['Cégvezetés, Menedzsment'], ['sector:professional_services']),
  r('sector', 'hu', ['Egészségügy, Gyógyszeripar'], ['sector:hospital_healthcare', 'sector:pharma_biotech']),
  r('sector', 'hu', ['Építőipar, Ingatlan'], ['sector:construction', 'sector:real_estate_property']),
  r('sector', 'hu', ['Értékesítés, Kereskedelem'], ['sector:retailer']),
  r('sector', 'hu', ['Fizikai, Segéd, Betanított munka'], ['sector:industrial_services']),
  r('sector', 'hu', ['Gyártás, Termelés'], ['sector:manufacturing']),
  r('sector', 'hu', ['HR, Munkaügy'], ['sector:professional_services']),
  r('sector', 'hu', ['IT programozás, Fejlesztés'], ['sector:information_technology']),
  r('sector', 'hu', ['IT üzemeltetés, Telekommunikáció'], ['sector:information_technology', 'sector:telecom']),
  r('sector', 'hu', ['Jog, Jogi tanácsadás'], ['sector:professional_services']),
  r('sector', 'hu', ['Közigazgatás'], ['sector:government']),
  r('sector', 'hu', ['Marketing, Média, PR'], ['sector:media_advertising']),
  r('sector', 'hu', ['Mérnök'], ['sector:industrial_services']),
  r('sector', 'hu', ['Mezőgazdaság, Környezet'], ['sector:agriculture_agri_business']),
  r('sector', 'hu', ['Oktatás, Tudomány, Sport'], ['sector:education']),
  r('sector', 'hu', ['Pénzügy, Könyvelés'], ['sector:banking_financial_services']),
  r('sector', 'hu', ['Szakmunka'], ['sector:industrial_services']),
  r('sector', 'hu', ['Szállítás, Beszerzés, Logisztika'], ['sector:transportation', 'sector:warehouse_logistics']),
  r('sector', 'hu', ['Ügyfélszolgálat, Vevőszolgálat'], ['sector:professional_services']),
  r('sector', 'hu', ['Üzleti támogató központok'], ['sector:professional_services']),
  r('sector', 'hu', ['Vendéglátás, Hotel, Idegenforgalom'], ['sector:hospitality']),

  // Hungarian job-function facets.
  r('job_function', 'hu', ['Adminisztráció, Asszisztens, Irodai munka'], ['job_function:administration']),
  r('job_function', 'hu', ['Bank, Biztosítás, Bróker'], ['job_function:banking', 'job_function:insurance']),
  r('job_function', 'hu', ['Cégvezetés, Menedzsment'], ['job_function:management']),
  r('job_function', 'hu', ['Egészségügy, Gyógyszeripar'], ['job_function:healthcare']),
  r('job_function', 'hu', ['Építőipar, Ingatlan'], ['job_function:skilled_trades', 'job_function:sales_commerce']),
  r('job_function', 'hu', ['Értékesítés, Kereskedelem'], ['job_function:sales_commerce']),
  r(
    'job_function',
    'hu',
    ['Fizikai, Segéd, Betanított munka', 'Betanított munka', 'Egyéb fizikai munka'],
    ['job_function:physical_manual_work'],
  ),
  r('job_function', 'hu', ['Gyártás, Termelés'], ['job_function:skilled_trades']),
  r('job_function', 'hu', ['HR, Munkaügy'], ['job_function:human_resources']),
  r('job_function', 'hu', ['IT programozás, Fejlesztés'], ['job_function:it_software_data']),
  r('job_function', 'hu', ['IT üzemeltetés, Telekommunikáció'], ['job_function:it_software_data']),
  r('job_function', 'hu', ['Jog, Jogi tanácsadás'], ['job_function:legal_compliance']),
  r('job_function', 'hu', ['Közigazgatás'], ['job_function:administration']),
  r(
    'job_function',
    'hu',
    ['Marketing, Média, PR'],
    ['job_function:marketing_communications', 'job_function:arts_entertainment'],
  ),
  r(
    'job_function',
    'hu',
    ['Anyagmozgatás, Rakodás'],
    ['job_function:operations_logistics', 'job_function:physical_manual_work'],
  ),
  r('job_function', 'hu', ['Csomagolás, Feltöltés'], ['job_function:operations_logistics']),
  r('job_function', 'hu', ['Építő munka, Földmunka', 'Építőipari segédmunkás'], ['job_function:skilled_trades']),
  r('job_function', 'hu', ['Gépkezelő'], ['job_function:mechanical_technical']),
  r('job_function', 'hu', ['Házvezető, Gondnok, Bejáró'], ['job_function:animal_care_childcare_cleaning']),
  r('job_function', 'hu', ['Mérnök'], ['job_function:engineering']),
  r('job_function', 'hu', ['Konyhai munka'], ['job_function:hospitality_food_service']),
  r('job_function', 'hu', ['Mezőgazdasági munka'], ['job_function:physical_manual_work']),
  r('job_function', 'hu', ['Mezőgazdaság, Környezet'], ['job_function:skilled_trades']),
  r(
    'job_function',
    'hu',
    ['Oktatás, Tudomány, Sport'],
    ['job_function:education_training', 'job_function:research_development'],
  ),
  r('job_function', 'hu', ['Pénzügy, Könyvelés'], ['job_function:finance_accounting']),
  r('job_function', 'hu', ['Szakmunka'], ['job_function:skilled_trades']),
  r(
    'job_function',
    'hu',
    ['Szállítás, Beszerzés, Logisztika'],
    ['job_function:transport_driving', 'job_function:operations_logistics', 'job_function:procurement'],
  ),
  r('job_function', 'hu', ['Ügyfélszolgálat, Vevőszolgálat'], ['job_function:customer_support']),
  r('job_function', 'hu', ['Üzleti támogató központok'], ['job_function:administration']),
  r('job_function', 'hu', ['Vendéglátás, Hotel, Idegenforgalom'], ['job_function:hospitality_food_service']),
  r(
    'job_function',
    'hu',
    ['Szobalány/Szobafiú'],
    ['job_function:hospitality_food_service', 'job_function:animal_care_childcare_cleaning'],
  ),
  r('job_function', 'hu', ['Takarítás, Tisztítás'], ['job_function:animal_care_childcare_cleaning']),

  // Granular HU job_function surfaces (330-term category list), mapped directly to
  // job_function bucket codes — additive alongside the coarser sector-category records above.
  r(
    'job_function',
    'hu',
    [
      'Ács, Asztalos',
      'Árnyékolástechnika',
      'Burkoló',
      'Egyéb szakmunka',
      'Építő munka, Földmunka',
      'Épületkarbantartó',
      'Esztergályos, Marós',
      'Festő, Mázoló',
      'Fodrász',
      'Fodrász, Kozmetikus',
      'Hegesztő, Lángvágó',
      'Hentes, Mészáros',
      'Karosszéria lakatos, Fényező',
      'Kárpitos',
      'Kertész',
      'Klímaszerelő',
      'Kőműves',
      'Kozmetikus',
      'Lakatos, Géplakatos',
      'Manikűr, Pedikűr',
      'Nyomdász',
      'Szabó, Varró',
      'Villanyszerelő',
      'Virágkötő/virágos',
      'Víz- gáz- fűtésszerelő',
    ],
    ['job_function:skilled_trades'],
  ),
  r(
    'job_function',
    'hu',
    [
      'Adásszerkesztő',
      'Animátor',
      'Casting',
      'Ezotéria',
      'Felvételvezető, Kameraman',
      'Filmgyártás',
      'Fotózás',
      'Grafikus, Képszerkesztő',
      'Képzőművész',
      'Modell',
      'Moderátor',
      'Múzeumi dolgozó',
      'Rendezvények',
      'Rendezvényszervező',
      'Sportszervező, sportmenedzser',
      'Statiszta',
      'Tördelő, DTP operátor',
      'Úszómester',
    ],
    ['job_function:arts_entertainment'],
  ),
  r(
    'job_function',
    'hu',
    [
      'Adatbázisszakértő',
      'AI és Automatizáció',
      'Hálózati és Rendszermérnök',
      'Informatikai támogatás',
      'IT support, Helpdesk',
      'IT tanácsadó, Elemző, Auditor',
      'Programozó, Fejlesztő',
      'Rendszergazda',
      'Rendszerintegrátor',
      'Rendszertervező',
      'Rendszerüzemeltető',
      'Telekommunikáció',
      'UI-, UX designer',
      'Vállalatirányítási rendszer, SAP',
      'Webdesigner',
    ],
    ['job_function:it_software_data'],
  ),
  r(
    'job_function',
    'hu',
    [
      'Adatrögzítő',
      'Irodavezető',
      'Kormánytisztviselő',
      'Közalkalmazott',
      'Köztisztviselő',
      'Szakmai asszisztens',
      'Személyi asszisztens',
      'Titkárnő, Titkár',
    ],
    ['job_function:administration'],
  ),
  r(
    'job_function',
    'hu',
    [
      'Adatvédelmi tisztviselő, szakértő',
      'Bankjog, Pénzügyi szektor',
      'Jogi asszisztens, Adminisztratív munkatárs',
      'Jogi gyakornok',
      'Jogtanácsos, Jogász, Jogi előadó',
      'Ügyvéd',
      'Ügyvédjelölt',
    ],
    ['job_function:legal_compliance'],
  ),
  r(
    'job_function',
    'hu',
    [
      'Agrármérnök',
      'Automatizálás',
      'CAD tervező, Műszaki rajzoló',
      'Elektromérnök',
      'Élelmiszermérnök',
      'Építőmérnök',
      'Épületgépész',
      'Faipari mérnök',
      'Földmérés, Geodézia',
      'Folyamatmérnök',
      'Gépészmérnök',
      'Hang- és világítástechnikai mérnök',
      'Kertészmérnök',
      'Kohó- és anyagmérnök',
      'Könnyűipari mérnök',
      'Környezetmérnök',
      'Közlekedési mérnök',
      'Logisztikai mérnök',
      'Mechatronikai mérnök',
      'Műszaki előkészítő',
      'Műszaki rajzoló',
      'PLC programozó',
      'Speciális mérnöki területek',
      'Üzemmérnök',
      'Vegyészmérnök',
      'Villamosmérnök',
    ],
    ['job_function:engineering'],
  ),
  r(
    'job_function',
    'hu',
    [
      'Állatorvos',
      'Ápoló, Egészségügyi szakmunka',
      'Egészségügyi asszisztens',
      'Egészségügyi szakember',
      'Fogorvos',
      'Fogtechnikus',
      'Gyógyszerész',
      'Gyógytornász',
      'Idősgondozó',
      'Logopédus',
      'Masszőr',
      'Nővér, Szakápoló',
      'Optikus',
      'Optometrista',
      'Orvos, Szakorvos',
      'Pszichológus, Mentálhigiénés szakember',
      'Terapeuta, Pszichiáter',
      'Természetgyógyász',
    ],
    ['job_function:healthcare'],
  ),
  r('job_function', 'hu', ['Anyaggazdálkodás, Beszerzés'], ['job_function:procurement']),
  r(
    'job_function',
    'hu',
    [
      'Csomagolás, Feltöltés',
      'Diszpécser',
      'Ellátási lánc',
      'Flottakezelő',
      'Hulladékgazdálkodás',
      'Ingatlankezelő',
      'Külkereskedelmi bonyolító',
      'Logisztika támogatás',
      'Logisztikai ügyintéző, adminisztrátor',
      'Logisztikus, Fuvarszervező',
      'Raktáros, egyéb raktári szakmunka',
      'Raktározás, Készletezés',
      'Szállítmányozó',
      'Termeléstervező/Gyártástervező',
      'Vámügyintéző',
    ],
    ['job_function:operations_logistics'],
  ),
  r(
    'job_function',
    'hu',
    [
      'Autószerelő, Szervizes',
      'Autóvillamossági szerelő',
      'CNC programozó',
      'Gépkezelő',
      'Gépszerelő',
      'Gumiszerelő',
      'Gyártás technikus',
      'Karbantartó',
      'Karbantartó, Szervizes',
      'Műszaki munkatárs',
      'Műszerész',
      'Operátor',
      'Üzemeltető',
    ],
    ['job_function:mechanical_technical'],
  ),
  r(
    'job_function',
    'hu',
    [
      'Bank biztonság',
      'Biztonsági őr, Vagyonőr, Portás',
      'Információbiztonság',
      'Katasztrófavédelem',
      'Személy- és vagyonvédelem',
    ],
    ['job_function:security'],
  ),
  r(
    'job_function',
    'hu',
    [
      'Bank, Biztosítás, Tőzsde vezető',
      'Csoportvezető',
      'Egészségügy, Szépség vezető',
      'Építőipar, Ingatlan vezető',
      'Értékesítési, Kereskedelmi vezető',
      'Gyártás, Termelés  vezető',
      'HR igazgató',
      'HR manager, HR vezető',
      'Informatikai igazgató',
      'Ingatlanfejlesztő',
      'Interim menedzser',
      'IT, fejlesztési vezető',
      'IT, Telecom vezető',
      'Jogi vezető',
      'Kereskedelmi, Marketing igazgató',
      'Kivitelező, General kivitelező',
      'Környezet, Mezőgazdaság vezető',
      'Marketing, Média, PR vezető',
      'Mérnök vezető',
      'Műszakvezető',
      'Oktatás-, Tudomány vezető',
      'Pénzügyi, Gazdasági igazgató',
      'Pénzügyi, Számviteli vezető',
      'Szállítás, Logisztika vezető',
      'Szállodaipar',
      'Termelési igazgató',
      'Termelésirányítás',
      'Ügyfélszolgálat, Ügyfélkapcsolat vezető',
      'Ügyvezető',
      'Üzlet-, Boltvezető',
      'Vendéglátás, Idegenforgalom vezető',
    ],
    ['job_function:management'],
  ),
  r(
    'job_function',
    'hu',
    [
      'Banki értékesítés',
      'Bolti eladó, Pénztáros',
      'Értékesítés támogatás',
      'Értékesítési munkatárs',
      'Informatikai értékesítő',
      'Ingatlan-, építőipari értékesítés',
      'Ingatlanértékesítő',
      'Kereskedelmi munkatárs',
      'Kereskedő, Eladó',
      'Key Account Manager',
      'Kirakatrendező',
      'Mérnök, Műszaki értékesítő',
      'Online értékesítés',
      'Orvoslátogató, Patikalátogató',
      'Pénzügyi szolgáltatások értékesítése',
      'Telefonos értékesítő',
      'Területi képviselő',
    ],
    ['job_function:sales_commerce'],
  ),
  r('job_function', 'hu', ['Banki, Biztosítási szakügyintéző'], ['job_function:banking']),
  r(
    'job_function',
    'hu',
    ['Bébiszitter', 'Csecsemő- és Kisgyermeknevelő', 'Házvezető, Gondnok, Bejáró(nő)', 'Kisgyermekgondozó'],
    ['job_function:animal_care_childcare_cleaning'],
  ),
  r(
    'job_function',
    'hu',
    [
      'Befektetési tanácsadó',
      'Bérszámfejtés, TB ügyintézés',
      'Bróker',
      'Cash management',
      'Corporate treasurer',
      'Finanszírozás',
      'Kintlévőség kezelő',
      'Kockázatkezelő',
      'Kontrolling',
      'Könyvelés',
      'Könyvvizsgáló, Belsőellenőr',
      'Követelés kezelés, Behajtás',
      'Közgazdász',
      'Pénzügyi asszisztens, Munkatárs',
      'Pénzügyi támogatás',
      'Számlázó, Pénztáros',
      'Számviteli munkatárs',
      'Treasury',
    ],
    ['job_function:finance_accounting'],
  ),
  r(
    'job_function',
    'hu',
    ['Belsőépítész', 'Divat-, Stílustervező', 'Építészmérnök', 'Lakberendező', 'Textiltervező, Ruhatervező'],
    ['job_function:architecture_design'],
  ),
  r(
    'job_function',
    'hu',
    ['Betanított munka', 'Egyéb fizikai munka', 'Ipari alpinista', 'Mezőgazdasági munka'],
    ['job_function:physical_manual_work'],
  ),
  r(
    'job_function',
    'hu',
    [
      'Biológus',
      'Biotechnika',
      'Fizikus',
      'Klinikai kutató',
      'Kutató',
      'Laboráns',
      'Laboros',
      'Matematikus',
      'Meteorológus',
      'Mikrobiológus / Biomérnök',
      'Termékfejlesztés',
      'Termékfejlesztés, tervezés',
      'Vegyész/Vegyésztechnikus',
    ],
    ['job_function:research_development'],
  ),
  r('job_function', 'hu', ['Biztosítás értékesítés', 'Kárszakértő'], ['job_function:insurance']),
  r(
    'job_function',
    'hu',
    [
      'Brand menedzser',
      'Kommunikáció és PR',
      'Márka- és Termékmenedzser',
      'Marketing',
      'Médiatervező, Tanácsadó',
      'Online marketing',
      'Piacelemző, Piackutató',
      'Szerkesztő, Szövegíró',
      'Tolmács, Fordító',
      'Újságíró, Riporter',
    ],
    ['job_function:marketing_communications'],
  ),
  r(
    'job_function',
    'hu',
    [
      'Cukrász, Pék',
      'Éttermi vendéglátás',
      'Felszolgáló, Pincér, Pultos',
      'Host, Hostess',
      'Hostess/Host, Animátor',
      'Idegenvezető',
      'Konyhai munka',
      'Közétkeztetés, Üzemeltetés',
      'Légi utaskísérő',
      'Szakács',
      'Szállodai recepciós',
      'Turizmus, Utazásszervezés',
    ],
    ['job_function:hospitality_food_service'],
  ),
  r(
    'job_function',
    'hu',
    [
      'Elemzés',
      'Elemző, Tanácsadó',
      'Értékbecslő',
      'Pályázati szakértő',
      'Pályázatírás',
      'Stratégiai tanácsadó',
      'Üzleti elemző',
    ],
    ['job_function:consulting_strategy'],
  ),
  r(
    'job_function',
    'hu',
    [
      'Gépjárművezető, Sofőr, Futár',
      'Hajós munka',
      'Kötött sínpályás vezető',
      'Légi közlekedés',
      'Személyszállító, Gépkocsivezető',
      'Teherszállító, Sofőr, Futár',
    ],
    ['job_function:transport_driving'],
  ),
  r(
    'job_function',
    'hu',
    [
      'HACCP szakértő',
      'Minőségbiztosítás',
      'Minőségbiztosítási mérnök',
      'Minőségellenőrzés',
      'Műszaki ellenőr',
      'Terméktesztelő',
      'Tesztelő, Tesztmérnök',
    ],
    ['job_function:quality_assurance'],
  ),
  r(
    'job_function',
    'hu',
    [
      'HR adminisztráció',
      'HR Business Partner',
      'HR generalista, Specialista',
      'HR kontroller',
      'HR támogatás',
      'Munkaerő közvetítés, Kölcsönzés, Fejvadászat',
      'Szervezetfejlesztés',
      'Toborzás, Kiválasztás',
    ],
    ['job_function:human_resources'],
  ),
  r(
    'job_function',
    'hu',
    [
      'Képzés, Fejlesztés',
      'Könyvtáros',
      'Nyelvtanár',
      'Oktatásszervező',
      'Oktató',
      'Óvoda-, bölcsőde pedagógus, dajka',
      'Tanító, Tanár, Pedagógus',
      'Tréner, Coach',
      'Vezetőképző programok',
    ],
    ['job_function:education_training'],
  ),
  r(
    'job_function',
    'hu',
    ['Környezetvédelem, Vízgazdálkodás', 'Mezőgazdaság, Élelmiszeripar', 'Növényorvos', 'Törzskönyvezés'],
    ['job_function:mining_natural_resources'],
  ),
  r('job_function', 'hu', ['Munka-, Egészségvédelem, Biztonságtechnika'], ['job_function:health_safety']),
  r(
    'job_function',
    'hu',
    ['Művelődésszervező', 'Nonprofit szervezetek', 'Szociális munkás'],
    ['job_function:community_social_services'],
  ),
  r(
    'job_function',
    'hu',
    [
      'Online ügyfélszolgálat',
      'Recepciós',
      'Személyes ügyfélszolgálat',
      'Szerviz munkafelvevő',
      'Telefonos ügyfélszolgálat',
      'Ügyféltámogatás, Adminisztráció',
      'Vevőszolgálat',
    ],
    ['job_function:customer_support'],
  ),
  r(
    'job_function',
    'hu',
    ['Product owner, -manager', 'Projektmanager', 'Projektmenedzser', 'Projektmenedzsment', 'Scrum master'],
    ['job_function:project_management'],
  ),
  r('job_function', 'hu', ['Üzletfejlesztő'], ['job_function:business_development']),

  // Estonian sector facets.
  r('sector', 'et', ['Põllumajandus, kalandus ja metsandus'], ['sector:agriculture_agri_business']),
  r('sector', 'et', ['Pangandus, finants ja kindlustus'], ['sector:banking_financial_services', 'sector:insurance']),
  r('sector', 'et', ['IT / Telekom'], ['sector:information_technology', 'sector:telecom']),
  r('sector', 'et', ['Transport ja logistika'], ['sector:transportation', 'sector:warehouse_logistics']),
  r('sector', 'et', ['Meditsiin ja farmaatsia'], ['sector:hospital_healthcare', 'sector:pharma_biotech']),
  r('sector', 'et', ['Kinnisvara ja kinnisvarahaldus'], ['sector:real_estate_property']),
  r('sector', 'et', ['Autotööstus ja lennundus'], ['sector:automotive', 'sector:aviation']),
  r('sector', 'et', ['Ehitus / Kinnisvara'], ['sector:construction', 'sector:real_estate_property']),
  r('sector', 'et', ['Elektroonika / Telekommunikatsioon'], ['sector:industrial_services', 'sector:telecom']),
  r('sector', 'et', ['Energeetika / Loodusvarad'], ['sector:energy']),
  r('sector', 'et', ['Korrakaitse / Turva / Julgeolek'], ['sector:security']),
  r('sector', 'et', ['Merendus'], ['sector:transportation']),
  r('sector', 'et', ['Põllumajandus / Metsandus'], ['sector:agriculture_agri_business']),
  r('sector', 'et', ['Riigi- ja avalik haldus'], ['sector:government']),
  r('sector', 'et', ['Tööstus / Tootmine'], ['sector:manufacturing']),

  // Estonian job-function facets.
  r('job_function', 'et', ['Assisteerimine / Administreerimine'], ['job_function:administration']),
  r('job_function', 'et', ['Ehitus / Kinnisvara'], ['job_function:skilled_trades']),
  r('job_function', 'et', ['Elektroonika / Telekommunikatsioon'], ['job_function:mechanical_technical']),
  r('job_function', 'et', ['Energeetika / Loodusvarad'], ['job_function:mining_natural_resources']),
  r('job_function', 'et', ['Finants'], ['job_function:finance_accounting']),
  r(
    'job_function',
    'et',
    ['Haridus / Teadus'],
    ['job_function:education_training', 'job_function:research_development'],
  ),
  r('job_function', 'et', ['Infotehnoloogia'], ['job_function:it_software_data']),
  r('job_function', 'et', ['Juhtimine'], ['job_function:management']),
  r('job_function', 'et', ['Klienditeenindus'], ['job_function:customer_support']),
  r(
    'job_function',
    'et',
    ['Koolitus / Personalitöö'],
    ['job_function:education_training', 'job_function:human_resources'],
  ),
  r('job_function', 'et', ['Korrakaitse / Turva / Julgeolek'], ['job_function:security']),
  r('job_function', 'et', ['Kultuur / Meelelahutus'], ['job_function:arts_entertainment']),
  r(
    'job_function',
    'et',
    ['Meedia / Loomemajandus / Tõlkimine'],
    ['job_function:marketing_communications', 'job_function:arts_entertainment'],
  ),
  r('job_function', 'et', ['Mehaanika / Tehnika'], ['job_function:mechanical_technical']),
  r('job_function', 'et', ['Merendus'], ['job_function:transport_driving']),
  r('job_function', 'et', ['Müük'], ['job_function:sales_commerce']),
  r('job_function', 'et', ['Pangandus'], ['job_function:banking']),
  r('job_function', 'et', ['Põllumajandus / Metsandus'], ['job_function:skilled_trades']),
  r('job_function', 'et', ['Riigi- ja avalik haldus'], ['job_function:administration']),
  r(
    'job_function',
    'et',
    ['Tervishoid / Sotsiaaltöö'],
    ['job_function:healthcare', 'job_function:community_social_services'],
  ),
  r('job_function', 'et', ['Toitlustus'], ['job_function:hospitality_food_service']),
  r(
    'job_function',
    'et',
    ['Transport / Logistika'],
    ['job_function:transport_driving', 'job_function:operations_logistics'],
  ),
  r(
    'job_function',
    'et',
    ['Turism / Hotellindus / Iluteenused'],
    ['job_function:hospitality_food_service', 'job_function:healthcare'],
  ),
  r('job_function', 'et', ['Turundus / Reklaam / PR'], ['job_function:marketing_communications']),
  r('job_function', 'et', ['Tööstus / Tootmine'], ['job_function:skilled_trades']),
  r('job_function', 'et', ['Vabatahtlik töö'], ['job_function:volunteering_internships']),
  r('job_function', 'et', ['Õigusala'], ['job_function:legal_compliance']),
];

export function inferFacetTerms(
  bucket: FacetBucket,
  clauses: Clause[],
  languages?: SupportedLanguage[],
): InferredTerm[] {
  const { add, terms } = collector();
  for (const c of clauses) {
    for (const entry of LOOKUP.get(bucket)?.get(normalizeFacetSurface(c.text)) ?? []) {
      if (!localeAllowed(entry.locale, languages)) continue;
      if (entry.requiredAcronym && !isExactAcronymSurface(c.text, entry.requiredAcronym)) continue;
      for (const key of entry.keys) add(key, SCORE, c.text);
    }
  }
  return terms();
}

/**
 * Structured `job_function` surface → ESCO occupation-family slug(s), lexical-exact
 * only (same normalization/variant machinery as the finite facets above). This is a
 * standalone table, not part of `RECORDS`/`FacetBucket`, since `occupation_family`
 * is not a `BucketName` bucket — it feeds an additive `alt_family` signal alongside
 * occupation, never the job_function bucket itself.
 */
interface OccupationFamilyAliasRecord {
  locale: Locale;
  surfaces: readonly string[];
  slugs: readonly string[];
}

const OCCUPATION_FAMILY_RECORDS: readonly OccupationFamilyAliasRecord[] = [
  {
    locale: 'hu',
    surfaces: ['Ács, Asztalos', 'Építő munka, Földmunka', 'Kőműves'],
    slugs: ['building_frame_and_related_trades_workers'],
  },
  {
    locale: 'hu',
    surfaces: ['Adásszerkesztő', 'Moderátor', 'Szerkesztő, Szövegíró', 'Tolmács, Fordító', 'Újságíró, Riporter'],
    slugs: ['authors_journalists_and_linguists'],
  },
  {
    locale: 'hu',
    surfaces: [
      'Adatbázisszakértő',
      'Hálózati és Rendszermérnök',
      'Információbiztonság',
      'Rendszergazda',
      'Rendszerintegrátor',
    ],
    slugs: ['database_and_network_professionals'],
  },
  { locale: 'hu', surfaces: ['Adatrögzítő'], slugs: ['keyboard_operators'] },
  {
    locale: 'hu',
    surfaces: [
      'Adatvédelmi tisztviselő, szakértő',
      'Bankjog, Pénzügyi szektor',
      'Jogi gyakornok',
      'Jogtanácsos, Jogász, Jogi előadó',
      'Ügyvéd',
      'Ügyvédjelölt',
    ],
    slugs: ['legal_professionals'],
  },
  {
    locale: 'hu',
    surfaces: [
      'Agrármérnök',
      'Élelmiszermérnök',
      'Építőmérnök',
      'Épületgépész',
      'Faipari mérnök',
      'Folyamatmérnök',
      'Gépészmérnök',
      'Kohó- és anyagmérnök',
      'Könnyűipari mérnök',
      'Környezetmérnök',
      'Közlekedési mérnök',
      'Logisztikai mérnök',
      'Minőségbiztosítási mérnök',
      'Speciális mérnöki területek',
      'Termékfejlesztés',
      'Termékfejlesztés, tervezés',
      'Üzemmérnök',
      'Vegyészmérnök',
    ],
    slugs: ['engineering_professionals_excluding_electrotechnology'],
  },
  {
    locale: 'hu',
    surfaces: [
      'AI és Automatizáció',
      'IT tanácsadó, Elemző, Auditor',
      'Programozó, Fejlesztő',
      'Rendszertervező',
      'UI-, UX designer',
      'Vállalatirányítási rendszer, SAP',
      'Webdesigner',
    ],
    slugs: ['software_and_applications_developers_and_analysts'],
  },
  { locale: 'hu', surfaces: ['Állatorvos'], slugs: ['veterinarians'] },
  {
    locale: 'hu',
    surfaces: ['Animátor', 'Ezotéria', 'Host, Hostess', 'Hostess/Host, Animátor', 'Rendezvények', 'Rendezvényszervező'],
    slugs: ['other_personal_services_workers'],
  },
  {
    locale: 'hu',
    surfaces: [
      'Anyaggazdálkodás, Beszerzés',
      'Banki értékesítés',
      'Biztosítás értékesítés',
      'Értékesítés támogatás',
      'Értékesítési munkatárs',
      'Informatikai értékesítő',
      'Kereskedelmi munkatárs',
      'Mérnök, Műszaki értékesítő',
      'Online értékesítés',
      'Orvoslátogató, Patikalátogató',
      'Pénzügyi szolgáltatások értékesítése',
      'Területi képviselő',
    ],
    slugs: ['sales_and_purchasing_agents_and_brokers'],
  },
  { locale: 'hu', surfaces: ['Anyagmozgatás, Rakodás'], slugs: ['transport_and_storage_labourers'] },
  {
    locale: 'hu',
    surfaces: ['Ápoló, Egészségügyi szakmunka'],
    slugs: ['nursing_and_midwifery_associate_professionals'],
  },
  {
    locale: 'hu',
    surfaces: ['Árnyékolástechnika', 'Burkoló', 'Klímaszerelő', 'Víz- gáz- fűtésszerelő'],
    slugs: ['building_finishers_and_related_trades_workers'],
  },
  {
    locale: 'hu',
    surfaces: ['Automatizálás', 'Elektromérnök', 'Mechatronikai mérnök', 'Villamosmérnök'],
    slugs: ['electrotechnology_engineers'],
  },
  {
    locale: 'hu',
    surfaces: ['Autószerelő, Szervizes', 'Gépszerelő', 'Gumiszerelő', 'Karbantartó', 'Karbantartó, Szervizes'],
    slugs: ['machinery_mechanics_and_repairers'],
  },
  {
    locale: 'hu',
    surfaces: ['Autóvillamossági szerelő', 'Villanyszerelő'],
    slugs: ['electrical_equipment_installers_and_repairers'],
  },
  {
    locale: 'hu',
    surfaces: ['Bank biztonság', 'Biztonsági őr, Vagyonőr, Portás', 'Katasztrófavédelem', 'Személy- és vagyonvédelem'],
    slugs: ['protective_services_workers'],
  },
  {
    locale: 'hu',
    surfaces: [
      'Bank, Biztosítás, Tőzsde vezető',
      'Egészségügy, Szépség vezető',
      'Jogi vezető',
      'Oktatás-, Tudomány vezető',
    ],
    slugs: ['professional_services_managers'],
  },
  {
    locale: 'hu',
    surfaces: ['Banki, Biztosítási szakügyintéző'],
    slugs: ['tellers_money_collectors_and_related_clerks'],
  },
  {
    locale: 'hu',
    surfaces: ['Bébiszitter', 'Csecsemő- és Kisgyermeknevelő', 'Kisgyermekgondozó'],
    slugs: ['child_care_workers_and_teachers_aides'],
  },
  {
    locale: 'hu',
    surfaces: [
      'Befektetési tanácsadó',
      'Cash management',
      'Corporate treasurer',
      'Finanszírozás',
      'Kockázatkezelő',
      'Kontrolling',
      'Könyvvizsgáló, Belsőellenőr',
      'Treasury',
    ],
    slugs: ['finance_professionals'],
  },
  {
    locale: 'hu',
    surfaces: [
      'Belsőépítész',
      'Divat-, Stílustervező',
      'Építészmérnök',
      'Földmérés, Geodézia',
      'Grafikus, Képszerkesztő',
      'Lakberendező',
      'Textiltervező, Ruhatervező',
    ],
    slugs: ['architects_planners_surveyors_and_designers'],
  },
  {
    locale: 'hu',
    surfaces: ['Bérszámfejtés, TB ügyintézés', 'Könyvelés', 'Számviteli munkatárs'],
    slugs: ['numerical_clerks'],
  },
  { locale: 'hu', surfaces: ['Betanított munka', 'Csomagolás, Feltöltés'], slugs: ['manufacturing_labourers'] },
  {
    locale: 'hu',
    surfaces: ['Biológus', 'Kertészmérnök', 'Klinikai kutató', 'Kutató', 'Mikrobiológus / Biomérnök', 'Növényorvos'],
    slugs: ['life_science_professionals'],
  },
  {
    locale: 'hu',
    surfaces: ['Biotechnika', 'HACCP szakértő', 'Környezetvédelem, Vízgazdálkodás', 'Laboráns', 'Laboros'],
    slugs: ['life_science_technicians_and_related_associate_professionals'],
  },
  { locale: 'hu', surfaces: ['Bolti eladó, Pénztáros', 'Kereskedő, Eladó'], slugs: ['shop_salespersons'] },
  {
    locale: 'hu',
    surfaces: [
      'Brand menedzser',
      'Key Account Manager',
      'Kommunikáció és PR',
      'Márka- és Termékmenedzser',
      'Marketing',
      'Médiatervező, Tanácsadó',
      'Online marketing',
      'Piacelemző, Piackutató',
      'Product owner, -manager',
      'Üzletfejlesztő',
    ],
    slugs: ['sales_marketing_and_public_relations_professionals'],
  },
  {
    locale: 'hu',
    surfaces: ['Bróker', 'Pénzügyi asszisztens, Munkatárs', 'Pénzügyi támogatás'],
    slugs: ['financial_and_mathematical_associate_professionals'],
  },
  {
    locale: 'hu',
    surfaces: [
      'CAD tervező, Műszaki rajzoló',
      'CNC programozó',
      'Gyártás technikus',
      'Minőségbiztosítás',
      'Minőségellenőrzés',
      'Műszaki ellenőr',
      'Műszaki előkészítő',
      'Műszaki munkatárs',
      'Műszaki rajzoló',
      'Műszerész',
      'PLC programozó',
      'Terméktesztelő',
      'Tesztelő, Tesztmérnök',
    ],
    slugs: ['physical_and_engineering_science_technicians'],
  },
  {
    locale: 'hu',
    surfaces: ['Casting', 'Filmgyártás', 'Képzőművész', 'Statiszta'],
    slugs: ['creative_and_performing_artists'],
  },
  {
    locale: 'hu',
    surfaces: ['Csoportvezető', 'Műszakvezető', 'Termelésirányítás'],
    slugs: ['mining_manufacturing_and_construction_supervisors'],
  },
  {
    locale: 'hu',
    surfaces: ['Cukrász, Pék', 'Hentes, Mészáros'],
    slugs: ['food_processing_and_related_trades_workers'],
  },
  {
    locale: 'hu',
    surfaces: [
      'Diszpécser',
      'Logisztika támogatás',
      'Logisztikai ügyintéző, adminisztrátor',
      'Raktáros, egyéb raktári szakmunka',
      'Raktározás, Készletezés',
      'Termeléstervező/Gyártástervező',
    ],
    slugs: ['material_recording_and_transport_clerks'],
  },
  {
    locale: 'hu',
    surfaces: ['Egészségügyi asszisztens', 'Idősgondozó'],
    slugs: ['personal_care_workers_in_health_services'],
  },
  {
    locale: 'hu',
    surfaces: [
      'Egészségügyi szakember',
      'Fogorvos',
      'Gyógyszerész',
      'Gyógytornász',
      'Logopédus',
      'Munka-, Egészségvédelem, Biztonságtechnika',
      'Optometrista',
      'Pszichológus, Mentálhigiénés szakember',
    ],
    slugs: ['other_health_professionals'],
  },
  { locale: 'hu', surfaces: ['Egyéb fizikai munka'], slugs: ['other_elementary_workers'] },
  { locale: 'hu', surfaces: ['Egyéb szakmunka'], slugs: ['other_craft_and_related_workers'] },
  {
    locale: 'hu',
    surfaces: [
      'Elemzés',
      'Elemző, Tanácsadó',
      'HR Business Partner',
      'HR generalista, Specialista',
      'HR kontroller',
      'Munkaerő közvetítés, Kölcsönzés, Fejvadászat',
      'Pályázati szakértő',
      'Pályázatírás',
      'Projektmanager',
      'Projektmenedzser',
      'Projektmenedzsment',
      'Scrum master',
      'Stratégiai tanácsadó',
      'Szervezetfejlesztés',
      'Toborzás, Kiválasztás',
      'Üzleti elemző',
    ],
    slugs: ['administration_professionals'],
  },
  {
    locale: 'hu',
    surfaces: [
      'Ellátási lánc',
      'Értékbecslő',
      'Flottakezelő',
      'Ingatlan-, építőipari értékesítés',
      'Ingatlanértékesítő',
      'Ingatlankezelő',
      'Kárszakértő',
      'Külkereskedelmi bonyolító',
      'Logisztikus, Fuvarszervező',
      'Szállítmányozó',
    ],
    slugs: ['business_services_agents'],
  },
  {
    locale: 'hu',
    surfaces: [
      'Építőipar, Ingatlan vezető',
      'Gyártás, Termelés  vezető',
      'Ingatlanfejlesztő',
      'Kivitelező, General kivitelező',
      'Mérnök vezető',
      'Szállítás, Logisztika vezető',
      'Termelési igazgató',
    ],
    slugs: ['manufacturing_mining_construction_and_distribution_managers'],
  },
  {
    locale: 'hu',
    surfaces: ['Építőipari segédmunkás', 'Ipari alpinista'],
    slugs: ['mining_and_construction_labourers'],
  },
  { locale: 'hu', surfaces: ['Épületkarbantartó'], slugs: ['building_and_housekeeping_supervisors'] },
  {
    locale: 'hu',
    surfaces: ['Értékesítési, Kereskedelmi vezető', 'Kereskedelmi, Marketing igazgató', 'Marketing, Média, PR vezető'],
    slugs: ['sales_marketing_and_development_managers'],
  },
  {
    locale: 'hu',
    surfaces: ['Esztergályos, Marós', 'Lakatos, Géplakatos'],
    slugs: ['blacksmiths_toolmakers_and_related_trades_workers'],
  },
  { locale: 'hu', surfaces: ['Éttermi vendéglátás', 'Felszolgáló, Pincér, Pultos'], slugs: ['waiters_and_bartenders'] },
  {
    locale: 'hu',
    surfaces: ['Felvételvezető, Kameraman', 'Fotózás'],
    slugs: ['artistic_cultural_and_culinary_associate_professionals'],
  },
  {
    locale: 'hu',
    surfaces: ['Festő, Mázoló'],
    slugs: ['painters_building_structure_cleaners_and_related_trades_workers'],
  },
  {
    locale: 'hu',
    surfaces: ['Fizikus', 'Meteorológus', 'Vegyész/Vegyésztechnikus'],
    slugs: ['physical_and_earth_science_professionals'],
  },
  {
    locale: 'hu',
    surfaces: ['Fodrász', 'Fodrász, Kozmetikus', 'Kozmetikus', 'Manikűr, Pedikűr'],
    slugs: ['hairdressers_beauticians_and_related_workers'],
  },
  { locale: 'hu', surfaces: ['Fogtechnikus', 'Optikus'], slugs: ['medical_and_pharmaceutical_technicians'] },
  {
    locale: 'hu',
    surfaces: ['Gépjárművezető, Sofőr, Futár', 'Személyszállító, Gépkocsivezető'],
    slugs: ['car_van_and_motorcycle_drivers'],
  },
  {
    locale: 'hu',
    surfaces: ['Gépkezelő', 'Operátor', 'Üzemeltető'],
    slugs: ['other_stationary_plant_and_machine_operators'],
  },
  { locale: 'hu', surfaces: ['Hajós munka'], slugs: ['ships_deck_crews_and_related_workers'] },
  {
    locale: 'hu',
    surfaces: ['Hang- és világítástechnikai mérnök', 'Telekommunikáció'],
    slugs: ['telecommunications_and_broadcasting_technicians'],
  },
  {
    locale: 'hu',
    surfaces: ['Házvezető, Gondnok, Bejáró(nő)', 'Szobalány/Szobafiú', 'Takarítás, Tisztítás'],
    slugs: ['domestic_hotel_and_office_cleaners_and_helpers'],
  },
  {
    locale: 'hu',
    surfaces: ['Hegesztő, Lángvágó', 'Karosszéria lakatos, Fényező'],
    slugs: ['sheet_and_structural_metal_workers_moulders_and_welders_and_related_workers'],
  },
  {
    locale: 'hu',
    surfaces: [
      'HR adminisztráció',
      'HR támogatás',
      'Jogi asszisztens, Adminisztratív munkatárs',
      'Szakmai asszisztens',
      'Személyi asszisztens',
    ],
    slugs: ['administrative_and_specialised_secretaries'],
  },
  {
    locale: 'hu',
    surfaces: [
      'HR igazgató',
      'HR manager, HR vezető',
      'Irodavezető',
      'Pénzügyi, Gazdasági igazgató',
      'Pénzügyi, Számviteli vezető',
    ],
    slugs: ['business_services_and_administration_managers'],
  },
  { locale: 'hu', surfaces: ['Hulladékgazdálkodás'], slugs: ['refuse_workers'] },
  {
    locale: 'hu',
    surfaces: ['Idegenvezető', 'Légi utaskísérő', 'Turizmus, Utazásszervezés'],
    slugs: ['travel_attendants_conductors_and_guides'],
  },
  {
    locale: 'hu',
    surfaces: ['Informatikai igazgató', 'IT, fejlesztési vezető', 'IT, Telecom vezető'],
    slugs: ['information_and_communications_technology_service_managers'],
  },
  {
    locale: 'hu',
    surfaces: ['Informatikai támogatás', 'IT support, Helpdesk', 'Rendszerüzemeltető'],
    slugs: ['information_and_communications_technology_operations_and_user_support_technicians'],
  },
  {
    locale: 'hu',
    surfaces: ['Interim menedzser', 'Ügyfélszolgálat, Ügyfélkapcsolat vezető'],
    slugs: ['other_services_managers'],
  },
  { locale: 'hu', surfaces: ['Kárpitos', 'Szabó, Varró'], slugs: ['garment_and_related_trades_workers'] },
  {
    locale: 'hu',
    surfaces: ['Képzés, Fejlesztés', 'Oktatásszervező', 'Oktató', 'Tréner, Coach', 'Vezetőképző programok'],
    slugs: ['other_teaching_professionals'],
  },
  { locale: 'hu', surfaces: ['Kertész'], slugs: ['market_gardeners_and_crop_growers'] },
  {
    locale: 'hu',
    surfaces: [
      'Kintlévőség kezelő',
      'Követelés kezelés, Behajtás',
      'Online ügyfélszolgálat',
      'Recepciós',
      'Szállodai recepciós',
      'Személyes ügyfélszolgálat',
      'Szerviz munkafelvevő',
      'Telefonos ügyfélszolgálat',
      'Ügyféltámogatás, Adminisztráció',
      'Vevőszolgálat',
    ],
    slugs: ['client_information_workers'],
  },
  { locale: 'hu', surfaces: ['Kirakatrendező', 'Modell', 'Telefonos értékesítő'], slugs: ['other_sales_workers'] },
  { locale: 'hu', surfaces: ['Konyhai munka'], slugs: ['food_preparation_assistants'] },
  { locale: 'hu', surfaces: ['Könyvtáros', 'Múzeumi dolgozó'], slugs: ['librarians_archivists_and_curators'] },
  { locale: 'hu', surfaces: ['Kormánytisztviselő'], slugs: ['legislators_and_senior_officials'] },
  {
    locale: 'hu',
    surfaces: ['Környezet, Mezőgazdaság vezető'],
    slugs: ['production_managers_in_agriculture_forestry_and_fisheries'],
  },
  { locale: 'hu', surfaces: ['Kötött sínpályás vezető'], slugs: ['locomotive_engine_drivers_and_related_workers'] },
  {
    locale: 'hu',
    surfaces: ['Közalkalmazott', 'Köztisztviselő', 'Vámügyintéző'],
    slugs: ['regulatory_government_associate_professionals'],
  },
  { locale: 'hu', surfaces: ['Közétkeztetés, Üzemeltetés', 'Szakács'], slugs: ['cooks'] },
  {
    locale: 'hu',
    surfaces: ['Közgazdász', 'Művelődésszervező', 'Nonprofit szervezetek', 'Szociális munkás'],
    slugs: ['social_and_religious_professionals'],
  },
  { locale: 'hu', surfaces: ['Légi közlekedés'], slugs: ['ship_and_aircraft_controllers_and_technicians'] },
  { locale: 'hu', surfaces: ['Masszőr'], slugs: ['traditional_and_complementary_medicine_associate_professionals'] },
  { locale: 'hu', surfaces: ['Matematikus'], slugs: ['mathematicians_actuaries_and_statisticians'] },
  { locale: 'hu', surfaces: ['Mezőgazdaság, Élelmiszeripar'], slugs: ['mixed_crop_and_animal_producers'] },
  { locale: 'hu', surfaces: ['Mezőgazdasági munka'], slugs: ['agricultural_forestry_and_fishery_labourers'] },
  { locale: 'hu', surfaces: ['Nővér, Szakápoló'], slugs: ['nursing_and_midwifery_professionals'] },
  { locale: 'hu', surfaces: ['Nyelvtanár'], slugs: ['secondary_education_teachers'] },
  { locale: 'hu', surfaces: ['Nyomdász', 'Tördelő, DTP operátor'], slugs: ['printing_trades_workers'] },
  { locale: 'hu', surfaces: ['Orvos, Szakorvos', 'Terapeuta, Pszichiáter'], slugs: ['medical_doctors'] },
  {
    locale: 'hu',
    surfaces: ['Óvoda-, bölcsőde pedagógus, dajka', 'Tanító, Tanár, Pedagógus'],
    slugs: ['primary_school_and_early_childhood_teachers'],
  },
  { locale: 'hu', surfaces: ['Sportszervező, sportmenedzser', 'Úszómester'], slugs: ['sports_and_fitness_workers'] },
  {
    locale: 'hu',
    surfaces: ['Szállodaipar', 'Vendéglátás, Idegenforgalom vezető'],
    slugs: ['hotel_and_restaurant_managers'],
  },
  { locale: 'hu', surfaces: ['Számlázó, Pénztáros'], slugs: ['cashiers_and_ticket_clerks'] },
  { locale: 'hu', surfaces: ['Teherszállító, Sofőr, Futár'], slugs: ['heavy_truck_and_bus_drivers'] },
  { locale: 'hu', surfaces: ['Természetgyógyász'], slugs: ['traditional_and_complementary_medicine_professionals'] },
  { locale: 'hu', surfaces: ['Titkárnő, Titkár'], slugs: ['secretaries_general'] },
  { locale: 'hu', surfaces: ['Törzskönyvezés'], slugs: ['animal_producers'] },
  { locale: 'hu', surfaces: ['Ügyvezető'], slugs: ['managing_directors_and_chief_executives'] },
  { locale: 'hu', surfaces: ['Üzlet-, Boltvezető'], slugs: ['retail_and_wholesale_trade_managers'] },
  { locale: 'hu', surfaces: ['Virágkötő/virágos'], slugs: ['handicraft_workers'] },
];

function buildOccupationFamilyLookup(records: readonly OccupationFamilyAliasRecord[]) {
  const byLocale = new Map<Locale, Map<string, string[]>>();
  for (const record of records) {
    const localeMap = byLocale.get(record.locale) ?? new Map<string, string[]>();
    byLocale.set(record.locale, localeMap);
    for (const surface of record.surfaces) {
      for (const variant of facetSurfaceVariants(surface, record.locale)) {
        localeMap.set(variant, [...record.slugs]);
      }
    }
  }
  return byLocale;
}

/** Exact lexical lookup: a structured job_function surface (given its locale) → ESCO occupation-family slugs. */
export function lookupOccupationFamilySlugs(surface: string, locale: SupportedLanguage): string[] {
  const localeMap = OCCUPATION_FAMILY_LOOKUP.get(locale as Locale);
  if (!localeMap) return [];
  return localeMap.get(normalizeFacetSurface(surface)) ?? [];
}

export function isFacetBucket(bucket: BucketName): bucket is FacetBucket {
  return (
    bucket === 'sector' ||
    bucket === 'job_function' ||
    bucket === 'employment' ||
    bucket === 'level' ||
    bucket === 'schedule' ||
    bucket === 'workplace'
  );
}

export function facetCollisionErrors(): string[] {
  return collectFacetCollisions(RECORDS);
}

function r(
  bucket: FacetBucket,
  locale: Locale,
  surfaces: readonly string[],
  keys: readonly string[],
): FacetAliasRecord {
  return { bucket, locale, surfaces, keys };
}

function buildLookup(records: readonly FacetAliasRecord[]) {
  const byBucket = new Map<FacetBucket, Map<string, FacetLookupEntry[]>>();

  for (const record of records) {
    const bucketMap = byBucket.get(record.bucket) ?? new Map<string, FacetLookupEntry[]>();
    byBucket.set(record.bucket, bucketMap);
    const keys = [...record.keys];

    for (const surface of record.surfaces) {
      for (const variant of facetSurfaceVariants(surface, record.locale)) {
        const prev = bucketMap.get(variant);
        const sameLocale = prev?.filter((x) => x.locale === record.locale);
        const entry: FacetLookupEntry = {
          keys,
          locale: record.locale,
          requiredAcronym: acronymOnlySurface(variant),
        };
        if (sameLocale?.some((x) => x.keys.join('|') !== keys.join('|'))) continue;
        if (sameLocale?.some((x) => x.requiredAcronym === entry.requiredAcronym)) continue;
        bucketMap.set(variant, [...(prev ?? []), entry]);
      }
    }
  }

  return byBucket;
}

function collectFacetCollisions(records: readonly FacetAliasRecord[]): string[] {
  const seen = new Map<string, string>();
  const collisions: string[] = [];
  for (const record of records) {
    const keys = [...record.keys].join('|');
    for (const surface of record.surfaces) {
      for (const variant of facetSurfaceVariants(surface, record.locale)) {
        const lookupKey = `${record.bucket}:${record.locale}:${variant}`;
        const prev = seen.get(lookupKey);
        if (prev && prev !== keys) {
          collisions.push(`${lookupKey} maps to [${prev.replaceAll('|', ', ')}] and [${keys.replaceAll('|', ', ')}]`);
        } else {
          seen.set(lookupKey, keys);
        }
      }
    }
  }
  return collisions;
}

function facetSurfaceVariants(surface: string, locale: Locale): string[] {
  const found = new Set<string>();
  const queue = [normalizeFacetSurface(surface)];
  for (let i = 0; i < queue.length; i++) {
    const current = queue[i];
    if (found.has(current)) continue;
    found.add(current);
    for (const next of synonymVariants(current, locale)) if (!found.has(next)) queue.push(next);
  }
  return [...found].filter(Boolean);
}

export function normalizeFacetSurface(text: string): string {
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

const SYNONYMS: Record<Locale, readonly [string, string][]> = {
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
const OCCUPATION_FAMILY_LOOKUP = buildOccupationFamilyLookup(OCCUPATION_FAMILY_RECORDS);
export const FINITE_FACET_RECORDS = RECORDS;

function synonymVariants(surface: string, locale: Locale): string[] {
  const out: string[] = [];
  for (const [a, b] of SYNONYMS[locale]) {
    out.push(replaceTokenSequence(surface, a, b), replaceTokenSequence(surface, b, a));
  }
  return out.filter((x) => x !== surface);
}

function replaceTokenSequence(surface: string, from: string, to: string): string {
  return surface.replace(
    new RegExp(`(?:^| )${escapeRegExp(from)}(?=$| )`, 'g'),
    (m) => `${m.startsWith(' ') ? ' ' : ''}${to}`,
  );
}

function acronymOnlySurface(surface: string): string | undefined {
  return ACRONYM_TOKENS.has(surface) ? surface.toUpperCase() : undefined;
}

function isExactAcronymSurface(text: string, acronym: string): boolean {
  return text.replace(/\(\s*\d+\s*\)/g, '').trim() === acronym;
}

function localeAllowed(locale: Locale, languages: SupportedLanguage[] | undefined): boolean {
  return !languages || languages.includes(locale);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
