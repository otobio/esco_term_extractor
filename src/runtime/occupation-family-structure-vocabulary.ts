import type { SupportedQueryLocale } from '../query/query-preparation.js';
import { expandLocaleTokenVariants } from '../query/token-variants.js';
import { foldSearchText } from '../utils/texts.js';
import type { FamilyStructureDimension } from './occupation-family-structure-rules.js';
import { ATOMIC_SPECIALIZATION_SYNONYMS, LEVEL_SPECIALIZATION_SYNONYMS } from './occupation-leaf-structure-rules-v2.js';
import reviewedFamilyStructureVocabularyJson from './seeds/occupation-family-structure-vocabulary.json' with { type: 'json' };

export type FamilyStructureVocabularyDimension = FamilyStructureDimension | 'occupation_level';

export type FamilyStructureVocabularyEntry = {
  dimension: FamilyStructureVocabularyDimension;
  value: string;
  aliases: readonly string[];
  locales?: readonly SupportedQueryLocale[];
};

export type FamilyStructureVocabularyMatch = {
  dimension: FamilyStructureVocabularyDimension;
  value: string;
  matchedAlias: string;
};

export type FamilyStructureVocabularyLookupOptions = {
  readonly expandLocaleVariants?: boolean;
};

type ReviewedFamilyStructureVocabularySeedRow = {
  readonly locale?: SupportedQueryLocale;
  readonly locales?: readonly SupportedQueryLocale[];
  readonly dimension: FamilyStructureVocabularyDimension;
  readonly value: string;
  readonly aliases: readonly string[];
  readonly source?: string;
  readonly note?: string;
};

type IndexedFamilyStructureVocabularyMatch = FamilyStructureVocabularyMatch & {
  readonly locales?: readonly SupportedQueryLocale[];
};

const FAMILY_STRUCTURE_VOCABULARY_DIMENSIONS = new Set<FamilyStructureVocabularyDimension>([
  'occupation_level',
  'role_heads',
  'knowledge_domains',
  'work_objects',
  'settings',
  'population_or_channel',
  'transport_mode',
  'authority_band',
  'activities'
]);

const FAMILY_STRUCTURE_VOCABULARY_LOCALES = new Set<SupportedQueryLocale>(['en', 'ro', 'hu', 'et']);

// Query-side checklist for the family-structure dimensions. This is deliberately separate from the
// family table: the table says what a family asserts; this vocabulary says which query words are
// strong enough to assert the same dimension. Keep entries concrete and visible. Do not add broad
// words such as "service", "specialist", "professional", "worker", "support", or "operator" as
// domain/object evidence without a more specific companion concept.
const BASE_FAMILY_STRUCTURE_QUERY_VOCABULARY: readonly FamilyStructureVocabularyEntry[] = [
  entry('occupation_level', 'military_officer', ['commissioned', 'officer', 'colonel', 'captain', 'major']),
  entry('occupation_level', 'military_non_commissioned', ['sergeant', 'corporal', 'noncommissioned', 'nco']),
  entry('occupation_level', 'military_other_rank', ['soldier', 'infantry', 'warfare']),
  entry('occupation_level', 'executive_manager', ['manager', 'director', 'chief', 'ceo', 'coo', 'cto', 'cio', 'cfo', 'head', 'leadership']),
  entry('occupation_level', 'professional', [
    'professional',
    'engineer',
    'developer',
    'analyst',
    'scientist',
    'doctor',
    'physician',
    'nurse',
    'teacher',
    'lecturer',
    'lawyer',
    'accountant',
    'auditor',
    'architect',
    'designer',
    'journalist',
    'translator',
    'veterinarian',
    'veterinar',
    'jurist'
  ]),
  entry('occupation_level', 'associate_technical', [
    'technician',
    'tehnician',
    'technologist',
    'associate',
    'assistant',
    'asistent',
    'asistenta',
    'asistentă',
    'inspector',
    'controller',
    'drafter',
    'broker',
    'agent',
    'instructor'
  ]),
  entry('occupation_level', 'clerical', [
    'clerk',
    'secretary',
    'receptionist',
    'typist',
    'dispatcher',
    'bookkeeper',
    'teller',
    'backoffice',
    'facturare',
    'facturi',
    'secretara',
    'secretară'
  ]),
  entry('occupation_level', 'service_sales', [
    'seller',
    'salesperson',
    'cashier',
    'casier',
    'waiter',
    'bartender',
    'cook',
    'chef',
    'guard',
    'attendant',
    'guide',
    'aide',
    'nanny'
  ]),
  entry('occupation_level', 'skilled_trades', [
    'mechanic',
    'repairer',
    'installer',
    'electrician',
    'welder',
    'carpenter',
    'bricklayer',
    'baker',
    'butcher',
    'assembler',
    'craft',
    'artisan'
  ]),
  entry('occupation_level', 'plant_machine_operator', ['plant', 'machine', 'machinist', 'controlroom']),
  entry('occupation_level', 'driver_transport', ['driver', 'chauffeur', 'courier', 'pilot', 'sailor', 'seaman', 'deckhand', 'shunter']),
  entry('occupation_level', 'elementary', [
    'labourer',
    'laborer',
    'helper',
    'cleaner',
    'porter',
    'handler',
    'packer',
    'picker',
    'ambalator',
    'manipulant'
  ]),

  entry('role_heads', 'manager', ['manager', 'director', 'chief', 'ceo', 'coo', 'cto', 'cio', 'head']),
  entry('role_heads', 'supervisor', [
    'supervisor',
    'foreman',
    'teamleader',
    'teamlead',
    'coordinator',
    'lead',
    'sef',
    'șef',
    'responsabil'
  ]),
  entry('role_heads', 'officer', ['officer', 'official', 'minister', 'diplomat', 'councillor', 'governor']),
  entry('role_heads', 'engineer', ['engineer', 'engineering']),
  entry('role_heads', 'technician', ['technician', 'technologist', 'technical', 'tehnician', 'frigotehnist']),
  entry('role_heads', 'inspector', ['inspector', 'qa', 'qc']),
  entry('role_heads', 'developer', ['developer', 'programmer', 'coder']),
  entry('role_heads', 'analyst', ['analyst', 'analysis', 'analyser']),
  entry('role_heads', 'scientist', ['scientist', 'chemist', 'physicist', 'biologist', 'geologist', 'meteorologist']),
  entry('role_heads', 'doctor', ['doctor', 'physician', 'gp', 'practitioner', 'medic']),
  entry('role_heads', 'nurse', ['nurse', 'midwife', 'midwifery']),
  entry('role_heads', 'therapist', ['therapist', 'physiotherapist', 'chiropractor', 'audiologist', 'fizioterapeut', 'kinetoterapeut']),
  entry('role_heads', 'pharmacist', ['pharmacist', 'farmacist', 'farmacie', 'farmaceutic']),
  entry('role_heads', 'veterinarian', ['veterinarian', 'veterinary', 'vet', 'veterinar']),
  entry('role_heads', 'teacher', ['teacher', 'lecturer', 'professor', 'instructor', 'trainer', 'educator']),
  entry('role_heads', 'legal_professional', ['lawyer', 'judge', 'coroner', 'jurist', 'legal']),
  entry('role_heads', 'finance_professional', ['auditor', 'controller', 'adviser', 'advisor']),
  entry('role_heads', 'accountant', ['accountant', 'contabil', 'contabilitate']),
  entry('role_heads', 'writer_media_language', ['writer', 'author', 'journalist', 'editor', 'translator', 'linguist', 'blogger']),
  entry('role_heads', 'artist_performer', ['artist', 'actor', 'performer', 'musician', 'painter', 'dancer']),
  entry('role_heads', 'clerk', [
    'clerk',
    'secretary',
    'typist',
    'teller',
    'dispatcher',
    'receptionist',
    'backoffice',
    'billing',
    'facturare',
    'secretara',
    'secretară'
  ]),
  entry('role_heads', 'agent_broker', [
    'agent',
    'broker',
    'buyer',
    'trader',
    'representative',
    'reprezentant',
    'procurement',
    'purchasing',
    'achizitii',
    'achiziții'
  ]),
  entry('role_heads', 'purchasing', ['procurement', 'purchasing', 'achizitii', 'achiziții']),
  entry('role_heads', 'seller', [
    'seller',
    'salesperson',
    'vendor',
    'cashier',
    'casier',
    'shopkeeper',
    'vanzator',
    'vânzător',
    'vanzari',
    'vânzări',
    'consilier',
    'comercial'
  ]),
  entry('role_heads', 'cashier', ['cashier', 'casier']),
  entry('role_heads', 'service_worker', ['waiter', 'bartender', 'barista', 'attendant', 'guide', 'host']),
  entry('role_heads', 'guard', ['guard', 'paznic']),
  entry('role_heads', 'care_worker', ['carer', 'caregiver', 'aide', 'nanny', 'babysitter']),
  entry('role_heads', 'assistant', ['assistant', 'asistent', 'asistenta', 'asistentă']),
  entry('role_heads', 'cook', ['cook', 'chef', 'baker']),
  entry('role_heads', 'driver', ['driver', 'chauffeur', 'courier']),
  entry('role_heads', 'operator', ['operator', 'controller', 'machinist']),
  entry('role_heads', 'mechanic_repairer', ['mechanic', 'repairer', 'maintenance', 'fitter']),
  entry('role_heads', 'installer', ['installer', 'installation', 'electrician']),
  entry('role_heads', 'assembler', ['assembler', 'assembly', 'asamblare', 'asamblor', 'montaj']),
  entry('role_heads', 'cleaner', ['cleaner', 'laundry', 'sweeper']),
  entry('role_heads', 'packer', ['packer', 'ambalator']),
  entry('role_heads', 'labourer', ['labourer', 'laborer', 'worker', 'helper', 'handler', 'packer', 'picker', 'ambalator', 'manipulant']),

  entry('knowledge_domains', 'military', ['military', 'army', 'navy', 'airforce', 'armed', 'defence', 'defense']),
  entry('knowledge_domains', 'government', ['government', 'public', 'regulatory', 'customs', 'embassy', 'diplomacy']),
  entry('knowledge_domains', 'business_administration', [
    'business',
    'administration',
    'administrative',
    'hr',
    'office',
    'policy',
    'proiect',
    'project'
  ]),
  entry('knowledge_domains', 'sales_marketing', [
    'sales',
    'marketing',
    'advertising',
    'brand',
    'retail',
    'wholesale',
    'commercial',
    'comercial',
    'vanzari',
    'vânzări',
    'vanzare',
    'vânzare',
    'procurement',
    'purchasing',
    'achizitii',
    'achiziții'
  ]),
  entry('knowledge_domains', 'hospitality', ['hotel', 'restaurant', 'hospitality', 'accommodation', 'guest']),
  entry('knowledge_domains', 'physical_earth_science', [
    'physics',
    'physical',
    'earth',
    'geology',
    'meteorology',
    'astronomy',
    'chemistry'
  ]),
  entry('knowledge_domains', 'life_science', ['biology', 'biotech', 'biotechnology', 'agronomy', 'aquaculture', 'environmental']),
  entry('knowledge_domains', 'engineering', ['engineering', 'mechanical', 'civil', 'aerospace', 'industrial']),
  entry('knowledge_domains', 'electrical_electronics', [
    'electrical',
    'electric',
    'electronics',
    'electronic',
    'electrotechnology',
    'power'
  ]),
  entry('knowledge_domains', 'architecture_design_survey', ['architecture', 'architectural', 'planning', 'surveying', 'design']),
  entry('knowledge_domains', 'health', [
    'health',
    'medical',
    'clinical',
    'medicine',
    'pharmaceutical',
    'hospital',
    'patient',
    'farmacist',
    'farmacie',
    'farmaceutic'
  ]),
  entry('knowledge_domains', 'veterinary', ['veterinary', 'animalhealth', 'vet', 'veterinar']),
  entry('knowledge_domains', 'education', [
    'education',
    'school',
    'university',
    'teaching',
    'training',
    'vocational',
    'primary',
    'secondary'
  ]),
  entry('knowledge_domains', 'finance', [
    'finance',
    'financial',
    'financiar',
    'financiara',
    'financiară',
    'accounting',
    'audit',
    'banking',
    'investment',
    'insurance',
    'tax',
    'payroll',
    'contabil',
    'contabilitate'
  ]),
  entry('knowledge_domains', 'ict', ['ict', 'it', 'software', 'application', 'database', 'network', 'cyber', 'security', 'cloud', 'data']),
  entry('knowledge_domains', 'legal', ['legal', 'law', 'judicial', 'court', 'compliance', 'rights']),
  entry('knowledge_domains', 'library_archive_museum', ['library', 'archive', 'archivist', 'curator', 'museum', 'collection']),
  entry('knowledge_domains', 'social_religious', ['social', 'religious', 'community', 'counselling', 'counseling', 'chaplain']),
  entry('knowledge_domains', 'arts_media_language', ['art', 'arts', 'media', 'journalism', 'publishing', 'language', 'theatre', 'music']),
  entry('knowledge_domains', 'construction', ['construction', 'building', 'civil', 'site']),
  entry('knowledge_domains', 'manufacturing', [
    'manufacturing',
    'factory',
    'production',
    'productie',
    'producție',
    'industrial',
    'assembly'
  ]),
  entry('knowledge_domains', 'mining', ['mining', 'mine', 'quarry', 'mineral']),
  entry('knowledge_domains', 'agriculture_forestry_fishery', [
    'agriculture',
    'farm',
    'crop',
    'forestry',
    'forest',
    'fishery',
    'aquaculture'
  ]),
  entry('knowledge_domains', 'transport_logistics', [
    'transport',
    'logistics',
    'logistica',
    'logistică',
    'warehouse',
    'cargo',
    'freight',
    'dispatch',
    'depozit'
  ]),
  entry('knowledge_domains', 'protective_services', ['protective', 'guard', 'coastguard', 'enforcement']),
  entry('knowledge_domains', 'cleaning_sanitation', ['cleaning', 'cleaner', 'laundry', 'sanitation', 'refuse', 'recycling', 'waste']),

  entry('work_objects', 'money_accounts', [
    'money',
    'cash',
    'account',
    'accounts',
    'invoice',
    'billing',
    'payroll',
    'budget',
    'loan',
    'factura',
    'facturare'
  ]),
  entry('work_objects', 'documents_records', [
    'document',
    'documents',
    'record',
    'records',
    'file',
    'files',
    'mail',
    'correspondence',
    'comenzi'
  ]),
  entry('work_objects', 'software_data', ['software', 'application', 'app', 'code', 'data', 'database', 'cloud', 'website']),
  entry('work_objects', 'network_security_systems', ['network', 'cybersecurity', 'security', 'firewall']),
  entry('work_objects', 'patients_treatment', ['patient', 'patients', 'diagnosis', 'treatment', 'therapy', 'clinical']),
  entry('work_objects', 'animals', ['animal', 'animals', 'livestock', 'poultry', 'horse', 'cattle', 'fish']),
  entry('work_objects', 'children_learning', ['child', 'children', 'pupil', 'student', 'curriculum', 'lesson']),
  entry('work_objects', 'buildings_structures', [
    'building',
    'buildings',
    'structure',
    'structures',
    'frame',
    'scaffold',
    'floor',
    'ceiling',
    'roof'
  ]),
  entry('work_objects', 'machinery_equipment', [
    'machine',
    'machinery',
    'equipment',
    'engine',
    'crane',
    'forklift',
    'excavator',
    'bulldozer'
  ]),
  entry('work_objects', 'electrical_equipment', ['electrical', 'electric', 'cable', 'meter', 'battery', 'lighting', 'power']),
  entry('work_objects', 'electronics_telecom', [
    'electronics',
    'electronic',
    'telecom',
    'telecommunications',
    'radio',
    'fibre',
    'fiber',
    'mobile'
  ]),
  entry('work_objects', 'vehicles', ['vehicle', 'vehicles', 'car', 'van', 'motorcycle', 'truck', 'bus', 'automotive']),
  entry('work_objects', 'aircraft', ['aircraft', 'airplane', 'aeroplane', 'aviation', 'airline', 'airport']),
  entry('work_objects', 'ships', ['ship', 'ships', 'vessel', 'marine', 'maritime', 'boat']),
  entry('work_objects', 'rail', ['rail', 'railway', 'train', 'locomotive', 'tram']),
  entry('work_objects', 'food_beverage', [
    'food',
    'beverage',
    'drink',
    'meat',
    'dairy',
    'bakery',
    'patiserie',
    'bread',
    'chocolate',
    'coffee'
  ]),
  entry('work_objects', 'wood_paper', ['wood', 'timber', 'furniture', 'cabinet', 'paper', 'pulp']),
  entry('work_objects', 'metal', ['metal', 'steel', 'welding', 'sheet', 'structural', 'casting']),
  entry('work_objects', 'chemical_photographic', ['chemical', 'chemicals', 'photographic', 'fertiliser', 'fertilizer', 'cosmetics']),
  entry('work_objects', 'rubber_plastic_paper', ['rubber', 'plastic', 'paper', 'corrugated']),
  entry('work_objects', 'textile_fur_leather_garment', ['textile', 'fur', 'leather', 'garment', 'clothing', 'footwear', 'shoe']),
  entry('work_objects', 'waste_refuse', ['waste', 'refuse', 'recycling', 'recyclable', 'garbage']),
  entry('work_objects', 'goods_products', [
    'goods',
    'product',
    'products',
    'commodity',
    'stock',
    'inventory',
    'marfa',
    'marfuri',
    'produse'
  ]),

  entry('settings', 'office', ['office', 'backoffice', 'corporate', 'branch']),
  entry('settings', 'government_public_office', ['government', 'public', 'embassy', 'court', 'customs']),
  entry('settings', 'hotel_restaurant', ['hotel', 'restaurant', 'bar', 'cafe', 'kitchen', 'hospitality', 'horeca']),
  entry('settings', 'shop_market_street', ['shop', 'store', 'market', 'street', 'retail', 'mall', 'boutique', 'magazin']),
  entry('settings', 'school_university_training', ['school', 'university', 'college', 'campus', 'nursery', 'vocational', 'training']),
  entry('settings', 'hospital_clinic_pharmacy', ['hospital', 'clinic', 'pharmacy', 'laboratory', 'lab']),
  entry('settings', 'domestic_home', ['domestic', 'home', 'household', 'residential']),
  entry('settings', 'farm_forest_fishery', ['farm', 'forest', 'fishery', 'aquaculture', 'greenhouse', 'garden']),
  entry('settings', 'mine_construction_plant', ['mine', 'quarry', 'construction', 'site', 'plant', 'factory', 'mill']),
  entry('settings', 'warehouse_logistics', ['warehouse', 'storage', 'depot', 'depozit', 'distribution', 'logistica', 'logistică']),
  entry('settings', 'transport_air', ['airport', 'airline', 'aircraft', 'airspace', 'airside']),
  entry('settings', 'transport_ship', ['ship', 'vessel', 'port', 'marine', 'maritime']),
  entry('settings', 'transport_rail', ['railway', 'rail', 'train', 'station']),
  entry('settings', 'studio_stage_media', ['studio', 'stage', 'theatre', 'theater', 'broadcast', 'newsroom']),
  entry('settings', 'library_archive_museum_gallery', ['library', 'archive', 'museum', 'gallery']),

  entry('population_or_channel', 'customer_client', ['customer', 'client', 'clienti', 'clienți', 'guest', 'consumer']),
  entry('population_or_channel', 'patient', ['patient', 'patients']),
  entry('population_or_channel', 'child_student', ['child', 'children', 'student', 'pupil', 'learner', 'trainee']),
  entry('population_or_channel', 'passenger_tourist', ['passenger', 'tourist', 'traveller', 'traveler', 'visitor']),
  entry('population_or_channel', 'animal', ['animal', 'animals', 'livestock', 'pet']),
  entry('population_or_channel', 'public_community', ['public', 'community', 'citizen', 'resident']),
  entry('population_or_channel', 'telephone_call_centre', ['telephone', 'phone', 'call', 'callcenter', 'callcentre', 'switchboard']),
  entry('population_or_channel', 'chat_digital', ['chat', 'online', 'digital', 'web']),
  entry('population_or_channel', 'ticket_reception_counter', ['ticket', 'reception', 'receptionist', 'counter', 'frontdesk']),

  entry('transport_mode', 'air', ['air', 'aircraft', 'airline', 'airport', 'aviation', 'pilot', 'flight', 'airspace', 'airside']),
  entry('transport_mode', 'ship', ['ship', 'ships', 'vessel', 'marine', 'maritime', 'boat', 'sailor', 'deckhand', 'seaman', 'port']),
  entry('transport_mode', 'rail', ['rail', 'railway', 'train', 'locomotive', 'tram', 'shunter', 'switchperson', 'station']),
  entry('transport_mode', 'road_light', ['car', 'van', 'motorcycle', 'taxi', 'chauffeur', 'courier', 'delivery']),
  entry('transport_mode', 'road_heavy', ['truck', 'bus', 'lorry', 'cargo', 'tanker', 'concretepump']),
  entry('transport_mode', 'mobile_plant', [
    'forklift',
    'stivuitorist',
    'crane',
    'excavator',
    'bulldozer',
    'dredge',
    'grader',
    'roller',
    'scraper'
  ]),
  entry('transport_mode', 'warehouse_transport', [
    'warehouse',
    'baggage',
    'material',
    'handler',
    'mover',
    'shelf',
    'storage',
    'depozit',
    'marfa',
    'marfuri'
  ]),
  entry('transport_mode', 'passenger_travel', ['passenger', 'travel', 'tour', 'guide', 'attendant', 'conductor']),

  entry('authority_band', 'chief', ['chief', 'ceo', 'coo', 'cto', 'cio', 'cfo']),
  entry('authority_band', 'director', ['director', 'head']),
  entry('authority_band', 'manager', ['manager', 'management', 'administrator']),
  entry('authority_band', 'supervisor', [
    'supervisor',
    'foreman',
    'teamleader',
    'teamlead',
    'lead',
    'coordinator',
    'sef',
    'șef',
    'responsabil',
    'tura',
    'tură'
  ]),
  entry('authority_band', 'professional', ['professional', 'specialist', 'consultant', 'adviser', 'advisor']),
  entry('authority_band', 'associate', ['associate', 'technician', 'agent', 'broker', 'clerk', 'reprezentant']),
  entry('authority_band', 'assistant_helper', ['assistant', 'aide', 'helper', 'support', 'junior', 'trainee', 'intern']),
  entry('authority_band', 'worker', ['worker', 'operator', 'driver', 'seller', 'cleaner', 'labourer', 'laborer']),
  entry('authority_band', 'military_rank', ['officer', 'sergeant', 'corporal', 'soldier', 'captain', 'major', 'colonel']),

  entry('activities', 'manage', [
    'manage',
    'manager',
    'management',
    'direct',
    'director',
    'coordinate',
    'supervise',
    'lead',
    'sef',
    'șef',
    'responsabil'
  ]),
  entry('activities', 'analyse', ['analyse', 'analyze', 'analyst', 'audit', 'inspect', 'test', 'research', 'calculate']),
  entry('activities', 'design_engineer', ['design', 'designer', 'engineer', 'architect', 'plan', 'model']),
  entry('activities', 'develop_ict', ['develop', 'developer', 'program', 'programmer', 'code', 'configure']),
  entry('activities', 'teach_train', ['teach', 'teacher', 'train', 'trainer', 'instruct', 'lecture']),
  entry('activities', 'care_treat', ['care', 'treat', 'therapy', 'diagnose', 'nurse', 'assist']),
  entry('activities', 'sell_trade', [
    'sell',
    'seller',
    'sales',
    'buy',
    'buyer',
    'broker',
    'trade',
    'cashier',
    'vend',
    'vanzari',
    'vânzări',
    'vanzare',
    'vânzare',
    'procurement',
    'purchasing',
    'achizitii',
    'achiziții'
  ]),
  entry('activities', 'serve_customer', ['serve', 'service', 'reception', 'host', 'attend', 'guide', 'answer']),
  entry('activities', 'protect_enforce', ['protect', 'guard', 'secure', 'enforce', 'patrol', 'paza', 'pază']),
  entry('activities', 'repair_maintain_install', ['repair', 'maintain', 'maintenance', 'install', 'installer', 'fit', 'overhaul']),
  entry('activities', 'operate_control', ['operate', 'operator', 'control', 'controller', 'monitor', 'drive']),
  entry('activities', 'assemble_make_process', [
    'assemble',
    'assembly',
    'asamblare',
    'asamblor',
    'montaj',
    'make',
    'process',
    'produce',
    'manufacture',
    'mould',
    'mold'
  ]),
  entry('activities', 'clean_prepare_handle', [
    'clean',
    'launder',
    'sweep',
    'prepare',
    'cook',
    'handle',
    'pack',
    'load',
    'sort',
    'picker',
    'ambalator'
  ])
];

export const FAMILY_STRUCTURE_QUERY_VOCABULARY: readonly FamilyStructureVocabularyEntry[] = [
  ...BASE_FAMILY_STRUCTURE_QUERY_VOCABULARY,
  ...reviewedFamilyStructureVocabularyEntries(),
  ...derivedLeafStructureVocabularyEntries()
];

const FAMILY_STRUCTURE_VOCABULARY_BY_TOKEN = buildVocabularyTokenIndex();

export function familyStructureVocabularyMatchesForToken(
  token: string,
  locale: SupportedQueryLocale = 'en',
  options: FamilyStructureVocabularyLookupOptions = {}
): readonly FamilyStructureVocabularyMatch[] {
  const matches: FamilyStructureVocabularyMatch[] = [];
  const seen = new Set<string>();
  const keys =
    options.expandLocaleVariants === false
      ? [vocabularyTokenKey(token)].filter((key) => key.length > 0)
      : vocabularyLookupKeys(token, locale);

  for (const key of keys) {
    for (const match of FAMILY_STRUCTURE_VOCABULARY_BY_TOKEN.get(key) ?? []) {
      if (match.locales && !match.locales.includes(locale)) {
        continue;
      }
      const matchKey = `${match.dimension}\t${match.value}\t${match.matchedAlias}`;
      if (seen.has(matchKey)) {
        continue;
      }
      matches.push(match);
      seen.add(matchKey);
    }
  }

  return matches;
}

export function familyStructureVocabularyMatchesForTokens(
  tokens: readonly string[],
  locale: SupportedQueryLocale = 'en',
  options: FamilyStructureVocabularyLookupOptions = {}
): readonly FamilyStructureVocabularyMatch[] {
  const matches: FamilyStructureVocabularyMatch[] = [];
  const seen = new Set<string>();

  for (const token of tokens) {
    for (const match of familyStructureVocabularyMatchesForToken(token, locale, options)) {
      const key = `${match.dimension}\t${match.value}\t${match.matchedAlias}`;
      if (seen.has(key)) {
        continue;
      }
      matches.push(match);
      seen.add(key);
    }
  }

  return matches;
}

export function familyStructureVocabularyValuesByDimension(
  tokens: readonly string[],
  locale: SupportedQueryLocale = 'en',
  options: FamilyStructureVocabularyLookupOptions = {}
): ReadonlyMap<FamilyStructureVocabularyDimension, readonly string[]> {
  const values = new Map<FamilyStructureVocabularyDimension, Set<string>>();

  for (const match of familyStructureVocabularyMatchesForTokens(tokens, locale, options)) {
    let dimensionValues = values.get(match.dimension);
    if (!dimensionValues) {
      dimensionValues = new Set<string>();
      values.set(match.dimension, dimensionValues);
    }
    dimensionValues.add(match.value);
  }

  return new Map(Array.from(values, ([dimension, dimensionValues]) => [dimension, Array.from(dimensionValues).sort()]));
}

function entry(
  dimension: FamilyStructureVocabularyDimension,
  value: string,
  aliases: readonly string[],
  locales?: readonly SupportedQueryLocale[]
): FamilyStructureVocabularyEntry {
  return locales ? { dimension, value, aliases, locales } : { dimension, value, aliases };
}

function reviewedFamilyStructureVocabularyEntries(): FamilyStructureVocabularyEntry[] {
  const rows = reviewedFamilyStructureVocabularyJson;
  if (!Array.isArray(rows)) {
    throw new Error('Reviewed family structure vocabulary seed must be a JSON array.');
  }

  return rows.map((row, index) => {
    const seedRow = parseReviewedFamilyStructureVocabularySeedRow(row, index);
    const locales = seedRow.locales ?? (seedRow.locale ? [seedRow.locale] : undefined);
    return entry(seedRow.dimension, seedRow.value, seedRow.aliases, locales);
  });
}

function parseReviewedFamilyStructureVocabularySeedRow(row: unknown, index: number): ReviewedFamilyStructureVocabularySeedRow {
  if (!row || typeof row !== 'object') {
    throw new Error(`Invalid reviewed family structure vocabulary row ${index}: expected object.`);
  }

  const record = row as Record<string, unknown>;
  const dimension = record.dimension;
  const value = record.value;
  const aliases = record.aliases;
  const locale = record.locale;
  const locales = record.locales;

  if (typeof dimension !== 'string' || !FAMILY_STRUCTURE_VOCABULARY_DIMENSIONS.has(dimension as FamilyStructureVocabularyDimension)) {
    throw new Error(`Invalid reviewed family structure vocabulary row ${index}: invalid dimension.`);
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Invalid reviewed family structure vocabulary row ${index}: invalid value.`);
  }
  if (!Array.isArray(aliases) || aliases.length === 0 || !aliases.every((alias) => typeof alias === 'string' && alias.trim().length > 0)) {
    throw new Error(`Invalid reviewed family structure vocabulary row ${index}: aliases must be non-empty strings.`);
  }
  if (locale !== undefined && (typeof locale !== 'string' || !FAMILY_STRUCTURE_VOCABULARY_LOCALES.has(locale as SupportedQueryLocale))) {
    throw new Error(`Invalid reviewed family structure vocabulary row ${index}: invalid locale.`);
  }
  if (
    locales !== undefined &&
    (!Array.isArray(locales) ||
      locales.length === 0 ||
      !locales.every((item) => typeof item === 'string' && FAMILY_STRUCTURE_VOCABULARY_LOCALES.has(item as SupportedQueryLocale)))
  ) {
    throw new Error(`Invalid reviewed family structure vocabulary row ${index}: invalid locales.`);
  }
  if (locale !== undefined && locales !== undefined) {
    throw new Error(`Invalid reviewed family structure vocabulary row ${index}: use locale or locales, not both.`);
  }

  return {
    locale: locale as SupportedQueryLocale | undefined,
    locales: locales as readonly SupportedQueryLocale[] | undefined,
    dimension: dimension as FamilyStructureVocabularyDimension,
    value: value.trim(),
    aliases: aliases.map((alias) => alias.trim())
  };
}

function derivedLeafStructureVocabularyEntries(): FamilyStructureVocabularyEntry[] {
  const entries: FamilyStructureVocabularyEntry[] = [];

  for (const [value, aliases] of Object.entries(ATOMIC_SPECIALIZATION_SYNONYMS.venue)) {
    entries.push(entry('settings', value, aliases));
  }

  for (const [value, aliases] of Object.entries(ATOMIC_SPECIALIZATION_SYNONYMS.channel)) {
    entries.push(entry('population_or_channel', value, aliases));
  }

  for (const [value, aliases] of Object.entries(ATOMIC_SPECIALIZATION_SYNONYMS.product)) {
    entries.push(entry('work_objects', value, aliases));
  }

  for (const [value, aliases] of Object.entries(ATOMIC_SPECIALIZATION_SYNONYMS.population)) {
    entries.push(entry('population_or_channel', value, aliases));
  }

  for (const [value, aliases] of Object.entries(ATOMIC_SPECIALIZATION_SYNONYMS.task_focus)) {
    entries.push(entry('activities', value, aliases));
  }

  for (const [value, aliases] of Object.entries(ATOMIC_SPECIALIZATION_SYNONYMS.industry_context)) {
    entries.push(entry('knowledge_domains', value, aliases));
  }

  for (const [value, aliases] of Object.entries(LEVEL_SPECIALIZATION_SYNONYMS)) {
    if (value === 'none') {
      continue;
    }
    entries.push(entry('authority_band', value, aliases));
  }

  return entries;
}

function buildVocabularyTokenIndex(): ReadonlyMap<string, readonly IndexedFamilyStructureVocabularyMatch[]> {
  const byToken = new Map<string, IndexedFamilyStructureVocabularyMatch[]>();

  for (const vocabularyEntry of FAMILY_STRUCTURE_QUERY_VOCABULARY) {
    for (const alias of vocabularyEntry.aliases) {
      const foldedAlias = vocabularyTokenKey(alias);
      if (!foldedAlias) {
        continue;
      }

      const existing = byToken.get(foldedAlias) ?? [];
      existing.push({
        dimension: vocabularyEntry.dimension,
        value: vocabularyEntry.value,
        matchedAlias: alias,
        locales: vocabularyEntry.locales
      });
      byToken.set(foldedAlias, existing);
    }
  }

  return byToken;
}

function vocabularyTokenKey(token: string): string {
  return foldSearchText(token).toLocaleLowerCase('en-US');
}

function vocabularyLookupKeys(token: string, locale: SupportedQueryLocale): string[] {
  const key = vocabularyTokenKey(token);
  if (!key) {
    return [];
  }

  const keys = new Set<string>([key]);
  for (const variant of expandLocaleTokenVariants(key, locale)) {
    const variantKey = vocabularyTokenKey(variant);
    if (variantKey) {
      keys.add(variantKey);
    }
  }

  // The vocabulary is multilingual, but many aliases are still English backbone terms.
  // Keep English reductions available for imported titles and mixed-language listings.
  if (locale !== 'en') {
    for (const variant of expandLocaleTokenVariants(key, 'en')) {
      const variantKey = vocabularyTokenKey(variant);
      if (variantKey) {
        keys.add(variantKey);
      }
    }
  }

  return Array.from(keys);
}
