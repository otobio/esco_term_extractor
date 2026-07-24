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
  r('job_function', 'ro', ['Office / Back-office / Secretariat', 'office-secretariat'], ['job_function:administration']),
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
  r('job_function', 'ro', ['Transport / Distribuție'], ['job_function:transport_driving', 'job_function:operations_logistics']),
  r('job_function', 'ro', ['Turism / Hotel staff'], ['job_function:hospitality_food_service']),
  r('job_function', 'ro', ['Vânzări', 'Vanzari', 'vanzari', 'Sales'], ['job_function:sales_commerce']),

  // Hungarian sector facets.
  r('sector', 'hu', ['Építő munka, Földmunka', 'Építőipari segédmunkás'], ['sector:construction']),
  r('sector', 'hu', ['Mezőgazdasági munka'], ['sector:agriculture_agri_business']),
  r('sector', 'hu', ['Takarítás, Tisztítás'], ['sector:professional_services']),

  // Hungarian job-function facets.
  r(
    'job_function',
    'hu',
    ['Fizikai, Segéd, Betanított munka', 'Betanított munka', 'Egyéb fizikai munka'],
    ['job_function:physical_manual_work'],
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
  r('job_function', 'hu', ['Konyhai munka'], ['job_function:hospitality_food_service']),
  r('job_function', 'hu', ['Mezőgazdasági munka'], ['job_function:physical_manual_work']),
  r(
    'job_function',
    'hu',
    ['Szobalány/Szobafiú'],
    ['job_function:hospitality_food_service', 'job_function:animal_care_childcare_cleaning'],
  ),
  r('job_function', 'hu', ['Takarítás, Tisztítás'], ['job_function:animal_care_childcare_cleaning']),

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
