import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const SPECIALIZATION_DIMENSIONS = [
    'venue',
    'channel',
    'product',
    'population',
    'task',
    'industry',
    'knowledge_domain',
    'work_object',
    'role_head'
];
const TOKEN_RE = /[\p{L}\p{N}]+/gu;
const DEFAULT_SCHEMA_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'specialization-schema');
const DIMENSION_PREFERENCE = {
    venue: 0,
    channel: 1,
    population: 2,
    knowledge_domain: 3,
    work_object: 4,
    product: 5,
    task: 6,
    industry: 7
};
const INDIRECT_ALIAS_DIMENSION_PREFERENCE = {
    venue: 0,
    channel: 1,
    population: 2,
    knowledge_domain: 3,
    task: 4,
    industry: 5,
    work_object: 6,
    product: 7
};
const CONTEXTUAL_COMMODITY_TOKENS = new Set([
    '3d',
    'aircraft',
    'agency',
    'appliance',
    'article',
    'article',
    'audio',
    'bakery',
    'beverage',
    'bicycle',
    'board',
    'book',
    'bookshop',
    'bridge',
    'bus',
    'cable',
    'cage',
    'car',
    'carpet',
    'china',
    'chocolate',
    'circuit',
    'cocktail',
    'cocoa',
    'commodity',
    'computer',
    'computer',
    'concrete',
    'container',
    'cosmetic',
    'cosmetic',
    'costume',
    'credit',
    'crustacean',
    'crustacean',
    'data',
    'database',
    'delicatessen',
    'desktop',
    'edible',
    'equipment',
    'eyewear',
    'feed',
    'fiberglass',
    'fish',
    'flower',
    'floor',
    'food',
    'footwear',
    'freight',
    'fruit',
    'furniture',
    'gas',
    'game',
    'glass',
    'glassware',
    'good',
    'ground',
    'hair',
    'hammer',
    'hardware',
    'hardwood',
    'hide',
    'household',
    'intelligence',
    'jewellery',
    'keyboard',
    'leather',
    'lottery',
    'machinery',
    'mattress',
    'meat',
    'meter',
    'milk',
    'mollusc',
    'multimedia',
    'oil',
    'oilseed',
    'paint',
    'paper',
    'part',
    'perfume',
    'pipeline',
    'police',
    'property',
    'product',
    'product',
    'rail',
    'record',
    'rubber',
    'scrap',
    'seafood',
    'semi',
    'skin',
    'skin',
    'software',
    'spice',
    'street',
    'sugar',
    'supply',
    'system',
    'tea',
    'textile',
    'tobacco',
    'tool',
    'truck',
    'vehicle',
    'vessel',
    'video',
    'watch',
    'watch',
    'wall',
    'water',
    'waste',
    'ship',
    'vegetable',
    'wood'
]);
const COMMERCIAL_CONTEXT_TOKENS = new Set([
    'broker',
    'cashier',
    'distribution',
    'export',
    'import',
    'merchant',
    'retail',
    'sale',
    'sales',
    'seller',
    'shop',
    'trader',
    'wholesale'
]);
const PRODUCT_DEFAULT_TOKENS = new Set(['article', 'good', 'product']);
const KNOWLEDGE_FALLBACK_ROLE_HEADS = new Set([
    'advisor',
    'adviser',
    'analyst',
    'checker',
    'compiler',
    'consultant',
    'counselor',
    'counsellor',
    'lecturer',
    'publisher',
    'researcher',
    'scientist',
    'specialist',
    'teacher',
    'trainer',
    'trustee'
]);
const WORK_OBJECT_GOOD_CONTEXT_TOKENS = new Set(['footwear', 'furniture', 'leather', 'textile', 'wood']);
const VENUE_DEFAULT_TOKENS = new Set(['agency', 'ground', 'street']);
const INDUSTRY_DEFAULT_TOKENS = new Set(['community', 'fire', 'maritime', 'police']);
const EXPLICIT_LITERAL_DIMENSIONS = {
    venue: new Set(['bookshop', 'cabin', 'city', 'door', 'gallery', 'museum']),
    channel: new Set(['contact']),
    population: new Set(['crew', 'dog', 'early', 'horse']),
    knowledge_domain: new Set([
        'chinese',
        'capacity',
        'change',
        'cost',
        'credit',
        'dance',
        'exchange',
        'fact',
        'frequency',
        'grant',
        'knowledge',
        'multimedia',
        'network',
        'new',
        'odd',
        'pharmacy',
        'polygraph',
        'religion',
        'soil',
        'survey',
        'tour',
        'weather',
        'web'
    ]),
    task: new Set(['budget', 'case', 'contract', 'drainage', 'finished', 'incident', 'order', 'resource', 'response', 'resilience']),
    industry: new Set([
        'artisan',
        'bankruptcy',
        'enterprise',
        'further',
        'higher',
        'kosher',
        'mixed',
        'outdoor',
        'power',
        'tourism',
        'trade'
    ]),
    work_object: new Set([
        '3d',
        'air',
        'alarm',
        'bingo',
        'cage',
        'cigar',
        'circuit',
        'clay',
        'computer',
        'concrete',
        'container',
        'cosmetics',
        'costume',
        'crustacean',
        'desktop',
        'disc',
        'embedded',
        'engineered',
        'equipment',
        'exterior',
        'eyewear',
        'fiber',
        'fiberglass',
        'fleet',
        'floor',
        'flight',
        'fortune',
        'fuel',
        'hammer',
        'hardwood',
        'honey',
        'hop',
        'idiophone',
        'infantry',
        'infrastructure',
        'jet',
        'keyboard',
        'leaf',
        'life',
        'lift',
        'luggage',
        'membranophone',
        'mattress',
        'meter',
        'milk',
        'mud',
        'nitroglycerin',
        'motorcycle',
        'oilseed',
        'paper',
        'pasta',
        'pit',
        'pulp',
        'puppet',
        'precious',
        'powder',
        'print',
        'printed',
        'quarry',
        'resilient',
        'rig',
        'rubber',
        'semiconductor',
        'sewerage',
        'skin',
        'shoe',
        'stationery',
        'stock',
        'stringed',
        'stunt',
        'system',
        'tank',
        'temperature',
        'thicknesser',
        'title',
        'toy',
        'tracer',
        'truck',
        'tree',
        'tube',
        'vermouth',
        'vessel',
        'wall',
        'watch',
        'wax',
        'well',
        'wind',
        'window',
        'yarn',
        'yeast'
    ]),
    product: new Set(['cider', 'cocktail', 'cosmetics', 'delicatessen', 'fund', 'liquor', 'raw', 'watche'])
};
const FORCED_LITERAL_DIMENSIONS = {
    venue: new Set(['surgery', 'venue']),
    channel: new Set(),
    population: new Set(),
    knowledge_domain: new Set(['cost', 'grant', 'new', 'odd', 'pharmacy', 'soil', 'therapy', 'weather', 'web']),
    task: new Set(['dry', 'respons', 'responsible', 'resource']),
    industry: new Set([
        'community',
        'fire',
        'further',
        'higher',
        'industry',
        'kosher',
        'maritime',
        'membership',
        'mixed',
        'outdoor',
        'power',
        'trade',
        'venture'
    ]),
    work_object: new Set(['chimney', 'cosmetics', 'kiln', 'landscape', 'preciou', 'surface']),
    product: new Set(['raw', 'watche'])
};
const DEFAULT_STOPWORDS = [
    'a',
    'al',
    'an',
    'and',
    'at',
    'au',
    'based',
    'common',
    'cu',
    'de',
    'din',
    'for',
    'in',
    'la',
    'man',
    'o',
    'of',
    'other',
    'on',
    'pe',
    'pentru',
    'sau',
    'si',
    'the',
    'to',
    'un',
    'unei',
    'unui',
    'up',
    'with',
    'without'
];
const DEFAULT_ROLE_HEADS = [
    'accountant',
    'acupuncturist',
    'actor',
    'actress',
    'administrator',
    'adviser',
    'advisor',
    'agent',
    'analyst',
    'animator',
    'architect',
    'artist',
    'assembler',
    'assistant',
    'attendant',
    'auditor',
    'biologist',
    'broker',
    'breeder',
    'builder',
    'buyer',
    'cashier',
    'chemist',
    'chief',
    'chiropractor',
    'clerk',
    'coach',
    'collector',
    'conductor',
    'consultant',
    'controller',
    'coordinator',
    'cook',
    'counsellor',
    'counselor',
    'coverer',
    'configurator',
    'developer',
    'director',
    'dispatcher',
    'distributor',
    'diver',
    'drafter',
    'driver',
    'dresser',
    'editor',
    'electrician',
    'engineer',
    'engraver',
    'ergonomist',
    'escort',
    'executive',
    'expert',
    'firefighter',
    'finisher',
    'fitter',
    'filler',
    'geologist',
    'governor',
    'grader',
    'guard',
    'guide',
    'handler',
    'head',
    'host',
    'hostess',
    'instructor',
    'inspector',
    'installer',
    'interpreter',
    'investigator',
    'journalist',
    'labourer',
    'laborer',
    'leader',
    'lecturer',
    'maker',
    'manager',
    'machinist',
    'master',
    'mechanic',
    'merchant',
    'metallurgist',
    'minder',
    'mixer',
    'modeler',
    'modeller',
    'monk',
    'moulder',
    'nutritionist',
    'nun',
    'officer',
    'operative',
    'operator',
    'painter',
    'patternmaker',
    'pharmacist',
    'philosopher',
    'physiotherapist',
    'pilot',
    'planner',
    'polisher',
    'practitioner',
    'printer',
    'producer',
    'programmer',
    'psychologist',
    'radiographer',
    'registrar',
    'repairer',
    'representative',
    'researcher',
    'restorer',
    'rigger',
    'roaster',
    'scientist',
    'secretary',
    'seller',
    'smith',
    'sommelier',
    'specialist',
    'steward',
    'stewardess',
    'supervisor',
    'surveyor',
    'teacher',
    'technician',
    'technologist',
    'tender',
    'tester',
    'therapist',
    'trader',
    'trainer',
    'translator',
    'underwriter',
    'upholsterer',
    'vendor',
    'veterinarian',
    'waiter',
    'welder',
    'worker',
    'writer'
];
const DEFAULT_ROLE_MODES = {
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
};
export const DEFAULT_ROLE_HEAD_GROUPS = {
    academic_administration: ['dean', 'headteacher', 'principal'],
    accounting_bookkeeping: ['accountant', 'auditor', 'bookkeeper', 'cashier', 'teller', 'treasurer'],
    acting_performance: ['actor', 'actress', 'comedian', 'extra', 'performer', 'puppeteer', 'stand-in'],
    animal_care_husbandry: ['breeder', 'farrier', 'groom', 'groomer', 'shepherd', 'zookeeper'],
    archives_curation: ['archivist', 'conservator', 'curator', 'librarian', 'restorer'],
    asset_valuation_risk: ['adjuster', 'appraiser', 'assessor', 'examiner', 'underwriter', 'valuer'],
    audio_speech_media: ['describer', 'prompter', 'subtitler', 'transcriptionist'],
    beverage_crafting: ['barista', 'bartender', 'brewmaster', 'distiller', 'sommelier'],
    biological_sciences: ['biochemist', 'biologist', 'botanist', 'ecologist', 'geneticist', 'microbiologist'],
    building_construction: ['builder', 'carpenter', 'contractor', 'worker'],
    buying_procurement: ['buyer', 'purchaser', 'shopper'],
    care_assistance: ['aide', 'caretaker', 'companion'],
    casting_moulding: ['caster', 'moulder', 'mouldmaker'],
    ceramic_glass_crafting: ['blower', 'ceramicist', 'potter'],
    childcare_minding: ['babysitter', 'minder', 'nanny', 'pair', 'sitter'],
    cleaning_sanitation: ['cleaner', 'handyperson', 'housekeeper', 'sweep', 'sweeper'],
    commercial_trading: ['broker', 'dealer', 'merchant', 'trader'],
    culinary_kitchen: ['baker', 'chef', 'cook', 'pizzaiolo'],
    dance_choreography: ['choreographer', 'choreologist', 'dancer', 'repetiteur'],
    diplomatic_corps: ['ambassador', 'consul', 'diplomat'],
    divination_esoteric: ['astrologer', 'medium', 'psychic'],
    earth_geological_sciences: [
        'climatologist',
        'geochemist',
        'geologist',
        'geophysicist',
        'hydrogeologist',
        'hydrologist',
        'meteorologist',
        'oceanographer',
        'seismologist'
    ],
    elected_governance: ['councillor', 'mayor', 'senator'],
    engineering_disciplines: ['architect', 'bioengineer', 'engineer', 'nanoengineer', 'technologist'],
    executive_leadership: ['boss', 'chief', 'executive', 'head', 'leader', 'manager'],
    eye_care_optics: ['optician', 'optometrist', 'orthoptist'],
    farming_forestry: ['agronomist', 'arboriculturist', 'farmer', 'forester', 'landscaper'],
    food_service_waiting: ['attendant', 'steward', 'stewardess', 'waiter', 'waitress'],
    freight_dispatch_handling: ['courier', 'dispatcher', 'handler', 'mover', 'packer', 'porter', 'postman', 'transporter'],
    front_desk_reception: ['concierge', 'doorman', 'host', 'hostess', 'receptionist', 'usher', 'valet'],
    hair_beauty_grooming: ['aesthetician', 'barber', 'hairdresser', 'manicurist', 'pedicurist', 'stylist'],
    judicial_prosecution: ['bailiff', 'judge', 'justice', 'prosecutor'],
    language_translation: ['interpreter', 'localiser', 'translator'],
    leather_footwear: ['shoemaker', 'tanner', 'upholsterer'],
    legal_counseling: ['adviser', 'counsellor', 'lawyer'],
    machining_shaping: ['grinder', 'machinist', 'planer', 'turner'],
    maintenance_repair: ['installer', 'maintainer', 'mechanic', 'repairer', 'servicer', 'technician'],
    masonry_plastering: ['bricklayer', 'plasterer', 'stonemason'],
    media_broadcasting: ['anchor', 'blogger', 'presenter', 'vlogger'],
    medical_physicians: ['doctor', 'practitioner', 'surgeon'],
    mental_health_counseling: ['counsellor', 'psychotherapist', 'therapist'],
    military_commissioned_officers: ['brigadier', 'captain', 'colonel', 'commander', 'general', 'lieutenant', 'major'],
    military_non_commissioned: ['corporal', 'sergeant', 'soldier'],
    music_composition_vocal: ['choirmaster', 'composer', 'lyricist', 'musician', 'singer'],
    office_administrative: ['administrator', 'assistant', 'clerk', 'registrar', 'secretary'],
    operational_supervision: ['controller', 'coordinator', 'director', 'officer', 'supervisor'],
    painting_decorating: ['coverer', 'paperhanger', 'plasterer'],
    pharmacology_toxicology: ['pharmacist', 'pharmacologist', 'toxicologist'],
    physical_mathematical_sciences: ['astronomer', 'chemist', 'cosmologist', 'mathematician', 'physicist', 'statistician'],
    physical_rehabilitation: ['chiropractor', 'osteopath', 'physiotherapist'],
    plumbing_fitting: ['fitter', 'plumber', 'repairer'],
    print_typesetting: ['printer', 'printmaker', 'typesetter'],
    quality_inspection: ['checker', 'inspector', 'tester'],
    sales_representation: ['agent', 'canvasser', 'demonstrator', 'representative', 'seller', 'vendor'],
    seafaring_maritime: ['boatman', 'boatmaster', 'boatswain', 'deckhand', 'decksman', 'sailor', 'seaman', 'skipper'],
    security_enforcement: ['bodyguard', 'detective', 'firefighter', 'guard', 'guardian', 'investigator', 'warden'],
    smithing_metalwork: ['blacksmith', 'coppersmith', 'goldsmith', 'gunsmith', 'locksmith', 'shipwright', 'silversmith', 'smith'],
    social_humanities_sciences: ['anthropologist', 'archaeologist', 'criminologist', 'demographer', 'economist', 'historian', 'sociologist'],
    software_development: ['coder', 'developer', 'programmer'],
    spiritual_clergy: ['chaplain', 'missionary', 'monk', 'nun', 'verger'],
    tailoring_garment: ['dressmaker', 'embroiderer', 'knitter', 'sewer', 'stitcher', 'tailor', 'weaver'],
    teaching_instruction: ['coach', 'educator', 'instructor', 'lecturer', 'teacher', 'trainer', 'tutor'],
    vehicle_driving: ['chauffeur', 'driver', 'helmsman', 'pilot'],
    visual_arts_design: ['animator', 'artist', 'cartoonist', 'designer', 'drafter', 'illustrator', 'painter', 'sculptor'],
    welding_fabrication: ['annealer', 'boilermaker', 'brazier', 'riveter', 'solderer', 'welder'],
    woodworking: ['carpenter', 'woodcarver', 'woodturner'],
    writing_editorial: ['columnist', 'copywriter', 'editor', 'journalist', 'reporter', 'writer']
};
const DEFAULT_PHRASE_DIMENSIONS = [
    { aliases: ['special educational needs'], dimension: 'population' },
    { aliases: ['special needs'], dimension: 'population' },
    { aliases: ['secondary school'], dimension: 'venue' },
    { aliases: ['primary school'], dimension: 'venue' },
    { aliases: ['call centre'], dimension: 'channel' },
    { aliases: ['help desk'], dimension: 'channel' },
    { aliases: ['sign language'], dimension: 'knowledge_domain' },
    { aliases: ['speech and language'], dimension: 'knowledge_domain' },
    { aliases: ['foreign language'], dimension: 'knowledge_domain' },
    { aliases: ['business studies'], dimension: 'knowledge_domain' },
    { aliases: ['human resources'], dimension: 'knowledge_domain' },
    { aliases: ['public relations'], dimension: 'knowledge_domain' },
    { aliases: ['quality assurance'], dimension: 'task' },
    { aliases: ['sewing machine'], dimension: 'work_object' },
    { aliases: ['central bank'], dimension: 'industry' }
];
const DEFAULT_ROLE_HEAD_PHRASES = [{ aliases: ['stand in'], roleHead: 'stand-in' }];
// Keep role-head phrases on the normal concept-alias priority scale.
const ROLE_HEAD_PHRASE_MATCH_PRIORITY = 100;
const DEFAULT_CONCEPTS = [
    ...buildFixedConcepts('venue', [
        'academy',
        'airport',
        'arena',
        'bar',
        'camp',
        'campus',
        'centre',
        'center',
        'cellar',
        'church',
        'clinic',
        'club',
        'court',
        'department',
        'farm',
        'factory',
        'facility',
        'garden',
        'hall',
        'harbour',
        'harbor',
        'hatchery',
        'home',
        'hospital',
        'hostel',
        'hotel',
        'house',
        'kitchen',
        'laboratory',
        'lab',
        'laundry',
        'market',
        'mill',
        'mine',
        'office',
        'park',
        'plant',
        'port',
        'prison',
        'railway',
        'reception',
        'restaurant',
        'resort',
        'room',
        'salon',
        'school',
        'shelter',
        'shop',
        'site',
        'stage',
        'studio',
        'terminal',
        'theatre',
        'theater',
        'university',
        'warehouse',
        'yard',
        'vineyard',
        'zoo'
    ]),
    ...buildFixedConcepts('channel', [
        'after-sales',
        'broadcast',
        'call',
        'distribution',
        'e-learning',
        'online',
        'phone',
        'presales',
        'retail',
        'telemarketing',
        'telephone',
        'wholesale'
    ]),
    ...buildFixedConcepts('population', [
        'adult',
        'adults',
        'adolescent',
        'adolescents',
        'animal',
        'animals',
        'child',
        'children',
        'customer',
        'customers',
        'elderly',
        'equine',
        'guest',
        'guests',
        'human',
        'humans',
        'infant',
        'infants',
        'livestock',
        'passenger',
        'passengers',
        'patient',
        'patients',
        'people',
        'person',
        'persons',
        'pet',
        'pets',
        'pupil',
        'pupils',
        'student',
        'students',
        'tourist',
        'tourists',
        'youth'
    ]),
    ...buildFixedConcepts('knowledge_domain', [
        'accounting',
        'aerodynamics',
        'aerospace',
        'art',
        'arts',
        'biology',
        'business',
        'cad',
        'chemistry',
        'classical',
        'communications',
        'compliance',
        'drama',
        'economics',
        'electronics',
        'engineering',
        'foreign',
        'geography',
        'geology',
        'history',
        'ict',
        'information',
        'iot',
        'it',
        'language',
        'languages',
        'law',
        'literacy',
        'marketing',
        'mathematics',
        'media',
        'medicine',
        'microelectronics',
        'music',
        'musical',
        'nursing',
        'philosophy',
        'physics',
        'programming',
        'psychology',
        'science',
        'securities',
        'sign',
        'speech',
        'statistics',
        'studies',
        'tax',
        'technology',
        'telecommunications',
        'theology',
        'tourism',
        'translation',
        'travel',
        'visual'
    ]),
    ...buildFixedConcepts('task', [
        'accessibility',
        'account',
        'administration',
        'administrative',
        'admissions',
        'advisory',
        'advertising',
        'affairs',
        'analysis',
        'archiving',
        'assembly',
        'auditing',
        'blasting',
        'breeding',
        'building',
        'care',
        'canning',
        'cleaning',
        'configuration',
        'control',
        'coordination',
        'correspondence',
        'counselling',
        'cutting',
        'de-icer',
        'delivery',
        'design',
        'development',
        'digestion',
        'documentation',
        'driving',
        'entry',
        'export',
        'finishing',
        'flow',
        'grading',
        'handling',
        'help',
        'husbandry',
        'import',
        'inspection',
        'installation',
        'integration',
        'journalism',
        'layout',
        'learning',
        'maintenance',
        'management',
        'manufacturing',
        'mooring',
        'moulding',
        'operations',
        'overhaul',
        'painting',
        'performance',
        'planning',
        'policy',
        'presales',
        'printing',
        'process',
        'processing',
        'production',
        'programme',
        'program',
        'project',
        'protection',
        'quality',
        'recovery',
        'rental',
        'repair',
        'research',
        'relationship',
        'rescue',
        'response',
        'risk',
        'safety',
        'sales',
        'sampling',
        'screening',
        'security',
        'service',
        'services',
        'set',
        'sewing',
        'support',
        'teaching',
        'technical',
        'test',
        'testing',
        'trading',
        'training',
        'transfer',
        'treatment',
        'troubleshooting',
        'usability',
        'welding',
        'work',
        'writing'
    ]),
    ...buildFixedConcepts('industry', [
        'academic',
        'acoustic',
        'acoustical',
        'actuarial',
        'agricultural',
        'agriculture',
        'anaesthetic',
        'anatomical',
        'aquaculture',
        'architectural',
        'artificial',
        'automotive',
        'aviation',
        'bank',
        'banking',
        'beauty',
        'biomedical',
        'chemical',
        'clinical',
        'civil',
        'commercial',
        'construction',
        'corporate',
        'correctional',
        'cultural',
        'dairy',
        'digital',
        'economic',
        'educational',
        'electrical',
        'electronic',
        'energy',
        'environmental',
        'ethical',
        'event',
        'fashion',
        'financial',
        'fisheries',
        'forestry',
        'government',
        'green',
        'health',
        'healthcare',
        'hospitality',
        'industrial',
        'insurance',
        'interior',
        'investment',
        'judicial',
        'legal',
        'logistics',
        'marine',
        'medical',
        'mechatronics',
        'mechanical',
        'mental',
        'military',
        'mining',
        'mobile',
        'nuclear',
        'occupational',
        'pharmaceutical',
        'photography',
        'physical',
        'political',
        'private',
        'public',
        'regulatory',
        'renewable',
        'road',
        'scientific',
        'social',
        'solar',
        'specialised',
        'sports',
        'synthetic',
        'technical',
        'tourism',
        'transport',
        'veterinary',
        'vocational',
        'welfare'
    ]),
    ...buildRoleSensitiveConcepts([
        'aircraft',
        'ammunition',
        'appliances',
        'application',
        'applications',
        'atm',
        'battery',
        'cable',
        'circuit',
        'circuits',
        'computer',
        'computers',
        'container',
        'database',
        'device',
        'devices',
        'drill',
        'engine',
        'engines',
        'equipment',
        'furnace',
        'instrument',
        'instruments',
        'machine',
        'machinery',
        'materials',
        'meter',
        'meters',
        'network',
        'networks',
        'panel',
        'panels',
        'pipeline',
        'press',
        'pump',
        'router',
        'screen',
        'screens',
        'ship',
        'ships',
        'system',
        'systems',
        'tank',
        'tool',
        'tools',
        'train',
        'vehicle',
        'vehicles',
        'vessel'
    ], [
        { dimension: 'work_object', roleModes: ['technical'] },
        { dimension: 'product', roleModes: ['commercial'] }
    ]),
    ...buildRoleSensitiveConcepts(['software'], [
        { dimension: 'work_object', roleModes: ['technical'] },
        { dimension: 'knowledge_domain', roleModes: ['knowledge'] },
        { dimension: 'product', roleModes: ['commercial'] }
    ]),
    ...buildRoleSensitiveConcepts(['audio', 'video', 'motion', 'picture', 'media'], [
        { dimension: 'knowledge_domain', roleModes: ['creative', 'knowledge'] },
        { dimension: 'product', roleModes: ['commercial'] }
    ]),
    ...buildRoleSensitiveConcepts([
        'beverages',
        'china',
        'clothing',
        'cocoa',
        'coffee',
        'confectionery',
        'cosmetics',
        'crustaceans',
        'drugs',
        'fish',
        'flowers',
        'food',
        'footwear',
        'fruit',
        'furniture',
        'games',
        'goods',
        'household',
        'jewellery',
        'jewelry',
        'leather',
        'lighting',
        'meat',
        'paper',
        'perfume',
        'pharmaceutical',
        'products',
        'soap',
        'sports',
        'sugar',
        'tea',
        'textile',
        'textiles',
        'tour'
    ], [{ dimension: 'product', roleModes: ['commercial'] }]),
    ...buildRoleSensitiveConcepts(['fund', 'funds'], [{ dimension: 'product', roleModes: ['commercial'] }])
];
export const BASE_SPECIALIZATION_SCHEMA = {
    acronymDimensions: {
        ATM: 'work_object',
        EU: 'industry',
        ICT: 'knowledge_domain',
        IT: 'knowledge_domain',
        IoT: 'knowledge_domain'
    },
    conceptEquivalences: [],
    concepts: DEFAULT_CONCEPTS,
    phraseDimensions: DEFAULT_PHRASE_DIMENSIONS,
    roleHeads: DEFAULT_ROLE_HEADS,
    roleHeadAliases: [],
    structuralCombinations: [],
    roleModes: DEFAULT_ROLE_MODES,
    stopwords: DEFAULT_STOPWORDS
};
const preparedSchemaCache = new WeakMap();
const loadedSchemaCache = new Map();
export const DEFAULT_SPECIALIZATION_SCHEMA = loadSpecializationSchemaFromCsv() ?? BASE_SPECIALIZATION_SCHEMA;
export function tokenizeTitle(text) {
    const normalized = text.replaceAll(/[-_/+]+/g, ' ');
    return Array.from(normalized.matchAll(TOKEN_RE), (match) => match[0]);
}
export function classifySpecializationQuery(title, options = {}) {
    const schema = resolveSchemaForOptions(options);
    const prepared = prepareSchema(schema);
    const tokens = tokenizeTitle(title);
    const folded = tokens.map((token) => foldTokenForMatch(token));
    const lowers = tokens.map((token) => normalizeTokenForMatch(token));
    const roleHeadPhraseMatches = collectRoleHeadPhraseMatches(lowers, prepared);
    const roleHeadPhraseCoveredIndexes = new Set();
    const roleIndexes = new Set();
    const roleSet = new Set();
    for (let index = 0; index < lowers.length; index += 1) {
        const canonicalRoleHead = resolveCanonicalRoleHead(lowers[index] ?? '', prepared);
        if (!canonicalRoleHead) {
            continue;
        }
        roleIndexes.add(index);
        roleSet.add(canonicalRoleHead);
    }
    const { concepts: conceptMatches, roleHeadPhrases: acceptedRoleHeadPhraseMatches } = resolveStructuralMatches(tokens, folded, lowers, prepared, roleSet, roleIndexes, roleHeadPhraseMatches);
    for (const match of acceptedRoleHeadPhraseMatches) {
        roleSet.add(normalizeTokenForMatch(match.roleHead));
        for (let index = match.start; index <= match.end; index += 1) {
            roleHeadPhraseCoveredIndexes.add(index);
        }
    }
    const activeRoleModes = collectActiveRoleModes(roleSet, prepared);
    const ambiguousIndexes = new Set();
    const committedConceptMatches = conceptMatches.filter((match) => {
        if (!isAmbiguousQueryConceptMatch(match, folded, prepared, roleSet, activeRoleModes)) {
            return true;
        }
        for (let index = match.start; index <= match.end; index += 1) {
            ambiguousIndexes.add(index);
        }
        return false;
    });
    const coveredIndexes = new Set();
    for (const match of committedConceptMatches) {
        for (let index = match.start; index <= match.end; index += 1) {
            coveredIndexes.add(index);
        }
    }
    const structuralCombinations = matchStructuralCombinations(committedConceptMatches, roleSet, prepared);
    const result = {
        venue: [],
        channel: [],
        product: [],
        population: [],
        task: [],
        industry: [],
        knowledge_domain: [],
        work_object: [],
        role_head: [],
        available: createEmptyBuckets(),
        concept: createEmptyBuckets(),
        literal: createEmptyBuckets(),
        structural_combination: structuralCombinations,
        tokens,
        unresolved: [],
        concepts: committedConceptMatches,
        roleModes: activeRoleModes
    };
    for (const match of acceptedRoleHeadPhraseMatches) {
        pushUnique(result.role_head, match.roleHead);
        pushUnique(result.literal.role_head, match.roleHead);
    }
    for (const match of committedConceptMatches) {
        for (const canonicalToken of match.canonicalTokens) {
            pushUnique(result[match.dimension], canonicalToken);
            pushUnique(result.concept[match.dimension], canonicalToken);
        }
    }
    for (let index = 0; index < lowers.length; index += 1) {
        const token = lowers[index] ?? '';
        const literalDimension = resolveLiteralTokenDimension(tokens, index, roleSet, prepared);
        if (literalDimension && !ambiguousIndexes.has(index) && !roleHeadPhraseCoveredIndexes.has(index)) {
            pushUnique(result.literal[literalDimension], tokens[index] ?? '');
        }
        if (!token || prepared.stopwords.has(token) || coveredIndexes.has(index)) {
            continue;
        }
        if (roleHeadPhraseCoveredIndexes.has(index)) {
            continue;
        }
        if (roleIndexes.has(index)) {
            const canonicalRoleHead = resolveCanonicalRoleHead(token, prepared);
            pushUnique(result.role_head, canonicalRoleHead ?? token);
            continue;
        }
        if (ambiguousIndexes.has(index)) {
            pushUnique(result.unresolved, token);
            continue;
        }
        if (literalDimension && literalDimension !== 'role_head') {
            const canonicalTokens = resolveLiteralConceptOutputTokens(tokens[index] ?? '', literalDimension, roleSet, prepared);
            if (canonicalTokens) {
                for (const canonicalToken of canonicalTokens) {
                    pushUnique(result[literalDimension], canonicalToken);
                    pushUnique(result.concept[literalDimension], canonicalToken);
                }
                continue;
            }
        }
        const acronymDimension = prepared.acronymDimensions[tokens[index] ?? ''] ??
            prepared.acronymDimensions[(tokens[index] ?? '').toUpperCase()] ??
            prepared.acronymDimensions[token.toUpperCase()];
        if (acronymDimension) {
            pushUnique(result[acronymDimension], token);
            continue;
        }
        pushUnique(result.unresolved, token);
    }
    for (const dimension of SPECIALIZATION_DIMENSIONS) {
        for (const token of result.literal[dimension]) {
            pushUnique(result.available[dimension], token);
        }
        for (const token of result.concept[dimension]) {
            pushUnique(result.available[dimension], token);
        }
    }
    return result;
}
function isAmbiguousQueryConceptMatch(match, folded, prepared, roleSet, activeRoleModes) {
    if (activeRoleModes.length > 0) {
        return false;
    }
    const exactSignature = folded.slice(match.start, match.end + 1).join('\u0001');
    const entries = prepared.conceptEntriesByExactSignature.get(exactSignature) ?? [];
    const matchedEntry = entries.find((entry) => entry.conceptId === match.conceptId && entry.alias === (match.aliases[0] ?? ''));
    if (!matchedEntry) {
        return false;
    }
    const matchedDimension = resolveConceptDimension(matchedEntry.conceptId, roleSet, prepared);
    if (matchedDimension === null) {
        return false;
    }
    const matchedIsDirect = isDirectCanonicalSurface(matchedEntry);
    const matchedIsRoleSpecific = isRoleSpecificMatch(matchedEntry.conceptId, roleSet, prepared);
    for (const entry of entries) {
        if (entry.conceptId === matchedEntry.conceptId && entry.alias === matchedEntry.alias) {
            continue;
        }
        const candidateDimension = resolveConceptDimension(entry.conceptId, roleSet, prepared);
        if (candidateDimension === null || candidateDimension === matchedDimension) {
            continue;
        }
        if ((entry.priority ?? 100) !== (matchedEntry.priority ?? 100)) {
            continue;
        }
        if (isDirectCanonicalSurface(entry) !== matchedIsDirect) {
            continue;
        }
        if (isRoleSpecificMatch(entry.conceptId, roleSet, prepared) !== matchedIsRoleSpecific) {
            continue;
        }
        return true;
    }
    return false;
}
export function classifySpecializationTitle(title, options = {}) {
    const detailed = classifySpecializationTitleDetailed(title, options);
    const { assignments, ...classification } = detailed;
    void assignments;
    return classification;
}
export function classifySpecializationTitleDetailed(title, options = {}) {
    const schema = resolveSchemaForOptions(options);
    const prepared = prepareSchema(schema);
    const tokens = tokenizeTitle(title);
    const folded = tokens.map((token) => foldTokenForMatch(token));
    const lowers = tokens.map((token) => normalizeTokenForMatch(token));
    const assigned = Array(tokens.length).fill(null);
    const roleHeadPhraseMatches = collectRoleHeadPhraseMatches(lowers, prepared);
    const roleSet = new Set(lowers.map((token) => resolveCanonicalRoleHead(token, prepared)).filter((token) => token !== null));
    const roleIndexes = new Set();
    for (let index = 0; index < lowers.length; index += 1) {
        if (resolveCanonicalRoleHead(lowers[index] ?? '', prepared)) {
            roleIndexes.add(index);
        }
    }
    const conceptCandidates = collectConceptCandidates(tokens, folded, lowers, prepared, roleSet, roleIndexes);
    const roleHeadPhraseCandidates = roleHeadPhraseMatches.map((match) => roleHeadPhraseMatchCandidate(match, lowers));
    const accepted = acceptNonOverlappingMatchCandidates([
        ...collectPhraseCandidates(lowers, prepared),
        ...conceptCandidates,
        ...roleHeadPhraseCandidates
    ]);
    for (const candidate of accepted.candidates) {
        for (let index = candidate.start; index <= candidate.end; index += 1) {
            assigned[index] = candidate.dimension;
        }
        if (candidate.roleHeadPhrase) {
            roleSet.add(normalizeTokenForMatch(candidate.roleHeadPhrase.roleHead));
        }
    }
    for (const roleIndex of roleIndexes) {
        if (assigned[roleIndex] === null) {
            assigned[roleIndex] = 'role_head';
        }
    }
    for (let index = 0; index < tokens.length; index += 1) {
        if (assigned[index] !== null) {
            continue;
        }
        const token = tokens[index] ?? '';
        const lower = normalizeTokenForMatch(token);
        if (prepared.stopwords.has(lower)) {
            continue;
        }
        const acronymDimension = prepared.acronymDimensions[token] ?? prepared.acronymDimensions[token.toUpperCase()];
        if (acronymDimension) {
            assigned[index] = acronymDimension;
            continue;
        }
        assigned[index] = resolveLiteralTokenDimension(tokens, index, roleSet, prepared);
    }
    const literalAssigned = tokens.map((_, index) => resolveLiteralTokenDimension(tokens, index, roleSet, prepared));
    return collectBuckets(tokens, assigned, literalAssigned, accepted.concepts, accepted.roleHeadPhrases, matchStructuralCombinations(accepted.concepts, roleSet, prepared), prepared);
}
function prepareSchema(schema) {
    const cached = preparedSchemaCache.get(schema);
    if (cached) {
        return cached;
    }
    const stopwords = new Set(schema.stopwords.map((value) => value.toLowerCase()));
    const concepts = new Map(schema.concepts.map((concept) => {
        const canonicalTokens = tokenizeCanonicalForOutput(concept.canonical ?? getAliasValue(concept.aliases[0] ?? concept.id));
        return [
            concept.id,
            {
                canonicalTokens,
                defaultDimension: concept.dimension ?? null,
                rules: concept.rules ?? []
            }
        ];
    }));
    const rawConceptEntries = schema.concepts
        .flatMap((concept) => {
        const preparedConcept = concepts.get(concept.id);
        if (!preparedConcept) {
            return [];
        }
        const canonicalParts = normalizeAlias(concept.canonical ?? getAliasValue(concept.aliases[0] ?? concept.id), stopwords);
        const staticDimension = getStaticPreferredConceptDimension(preparedConcept);
        return concept.aliases.map((aliasEntry) => {
            const alias = getAliasValue(aliasEntry);
            const parts = normalizeAlias(alias, stopwords);
            return {
                alias,
                canonicalParts,
                conceptId: concept.id,
                displayTokens: tokenizeSurfaceForOutput(alias, stopwords),
                exactParts: normalizeAliasExact(alias, stopwords),
                isDirect: samePartLists(parts, canonicalParts),
                parts,
                priority: getAliasPriority(aliasEntry),
                staticDimension
            };
        });
    })
        .filter((entry) => entry.parts.length > 0)
        .sort(compareAliasEntries);
    const rawConceptIdsByToken = new Map();
    for (const entry of rawConceptEntries) {
        if (entry.parts.length !== 1) {
            continue;
        }
        const key = entry.parts[0] ?? '';
        const conceptIds = rawConceptIdsByToken.get(key) ?? new Set();
        conceptIds.add(entry.conceptId);
        rawConceptIdsByToken.set(key, conceptIds);
    }
    const exactAliasPartsByNormalizedSignature = new Map();
    const conceptEntriesByExactSignature = new Map();
    const singleTokenEntriesByExactPart = new Map();
    const singleTokenEntriesByNormalizedPart = new Map();
    for (const rawEntry of rawConceptEntries) {
        if (isRedundantBridgeAlias(rawEntry, rawConceptIdsByToken)) {
            continue;
        }
        const entry = {
            alias: rawEntry.alias,
            conceptId: rawEntry.conceptId,
            displayTokens: rawEntry.displayTokens,
            exactParts: rawEntry.exactParts,
            isDirect: rawEntry.isDirect,
            parts: rawEntry.parts,
            priority: rawEntry.priority
        };
        const normalizedSignature = entry.parts.join('\u0001');
        const exactSignature = entry.exactParts.join('\u0001');
        const values = exactAliasPartsByNormalizedSignature.get(normalizedSignature) ?? new Set();
        values.add(exactSignature);
        exactAliasPartsByNormalizedSignature.set(normalizedSignature, values);
        pushMapArray(conceptEntriesByExactSignature, exactSignature, entry);
        if (entry.parts.length === 1) {
            pushMapArray(singleTokenEntriesByExactPart, entry.exactParts[0] ?? '', entry);
            pushMapArray(singleTokenEntriesByNormalizedPart, entry.parts[0] ?? '', entry);
        }
    }
    const prepared = {
        acronymDimensions: schema.acronymDimensions,
        concepts,
        conceptEntriesByExactSignature,
        exactAliasPartsByNormalizedSignature,
        phraseEntriesByFirstPart: buildPhraseEntriesByFirstPart(schema.phraseDimensions, stopwords),
        roleHeadCanonicalByAlias: buildRoleHeadCanonicalByAlias(schema),
        roleHeadPhraseEntriesByFirstPart: buildRoleHeadPhraseEntriesByFirstPart(schema, DEFAULT_ROLE_HEAD_PHRASES, stopwords),
        roleHeads: new Set(),
        roleModes: {
            commercial: new Set(schema.roleModes.commercial.map((value) => normalizeTokenForMatch(value))),
            creative: new Set(schema.roleModes.creative.map((value) => normalizeTokenForMatch(value))),
            education: new Set(schema.roleModes.education.map((value) => normalizeTokenForMatch(value))),
            knowledge: new Set(schema.roleModes.knowledge.map((value) => normalizeTokenForMatch(value))),
            technical: new Set(schema.roleModes.technical.map((value) => normalizeTokenForMatch(value)))
        },
        singleTokenEntriesByExactPart,
        singleTokenEntriesByNormalizedPart,
        stopwords,
        structuralCombinations: buildStructuralCombinationRules(schema)
    };
    prepared.roleHeads = new Set(prepared.roleHeadCanonicalByAlias.keys());
    preparedSchemaCache.set(schema, prepared);
    return prepared;
}
function normalizeAlias(alias, stopwords) {
    return tokenizeTitle(alias)
        .map((token) => normalizeTokenForMatch(token))
        .filter((token) => !stopwords.has(token));
}
function normalizeAliasExact(alias, stopwords) {
    return tokenizeTitle(alias)
        .map((token) => foldTokenForMatch(token))
        .filter((token) => !stopwords.has(token));
}
function tokenizeSurfaceForOutput(alias, stopwords) {
    return alias
        .trim()
        .split(/[\s/_]+/g)
        .map((token) => token.trim())
        .filter((token) => token.length > 0 && !stopwords.has(normalizeTokenForMatch(token)));
}
function buildPhraseEntriesByFirstPart(phraseDimensions, stopwords) {
    const entriesByFirstPart = new Map();
    for (const phraseDimension of phraseDimensions) {
        for (const alias of phraseDimension.aliases) {
            const parts = normalizeAlias(alias, stopwords);
            if (parts.length === 0) {
                continue;
            }
            pushMapArray(entriesByFirstPart, parts[0] ?? '', {
                alias,
                dimension: phraseDimension.dimension,
                parts
            });
        }
    }
    for (const entries of entriesByFirstPart.values()) {
        entries.sort(compareAliasEntries);
    }
    return entriesByFirstPart;
}
function buildRoleHeadPhraseEntriesByFirstPart(schema, roleHeadPhrases, stopwords) {
    const entriesByFirstPart = new Map();
    for (const roleHeadPhrase of roleHeadPhrases) {
        for (const alias of roleHeadPhrase.aliases) {
            const parts = normalizeAlias(alias, stopwords);
            if (parts.length === 0) {
                continue;
            }
            pushMapArray(entriesByFirstPart, parts[0] ?? '', {
                alias,
                parts,
                roleHead: roleHeadPhrase.roleHead
            });
        }
    }
    for (const roleHeadAlias of schema.roleHeadAliases ?? []) {
        const parts = normalizeAlias(roleHeadAlias.alias, stopwords);
        if (parts.length <= 1) {
            continue;
        }
        pushMapArray(entriesByFirstPart, parts[0] ?? '', {
            alias: roleHeadAlias.alias,
            parts,
            roleHead: roleHeadAlias.roleHead
        });
    }
    for (const entries of entriesByFirstPart.values()) {
        entries.sort(compareAliasEntries);
    }
    return entriesByFirstPart;
}
function pushMapArray(target, key, value) {
    const values = target.get(key) ?? [];
    values.push(value);
    target.set(key, values);
}
function samePartLists(left, right) {
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index += 1) {
        if (left[index] !== right[index]) {
            return false;
        }
    }
    return true;
}
function compareAliasEntries(left, right) {
    return (right.parts.length - left.parts.length ||
        (right.priority ?? 100) - (left.priority ?? 100) ||
        right.alias.length - left.alias.length ||
        left.alias.localeCompare(right.alias));
}
function resolveStructuralMatches(tokens, folded, lowers, prepared, roleSet, blockedIndexes, roleHeadPhraseMatches) {
    const conceptCandidates = collectConceptCandidates(tokens, folded, lowers, prepared, roleSet, blockedIndexes);
    const roleHeadPhraseCandidates = roleHeadPhraseMatches.map((match) => roleHeadPhraseMatchCandidate(match, lowers));
    const accepted = acceptNonOverlappingMatchCandidates([...conceptCandidates, ...roleHeadPhraseCandidates]);
    const matchesByConcept = new Map();
    for (const match of accepted.concepts) {
        const key = `${match.conceptId}|${match.dimension}`;
        const existing = matchesByConcept.get(key);
        if (!existing) {
            matchesByConcept.set(key, {
                aliases: match.alias ? [match.alias] : [],
                canonicalTokens: match.canonicalTokens,
                conceptId: match.conceptId,
                dimension: match.dimension,
                end: match.end,
                priority: match.priority ?? 100,
                start: match.start
            });
            continue;
        }
        if (match.alias) {
            pushUnique(existing.aliases, match.alias);
        }
        if (match.end - match.start > existing.end - existing.start ||
            (match.end - match.start === existing.end - existing.start && (match.priority ?? 100) > existing.priority)) {
            existing.start = match.start;
            existing.end = match.end;
            existing.priority = match.priority ?? existing.priority;
            existing.canonicalTokens = match.canonicalTokens;
        }
    }
    return {
        concepts: [...matchesByConcept.values()].sort((left, right) => left.start - right.start || right.end - left.end || right.priority - left.priority || left.conceptId.localeCompare(right.conceptId)),
        roleHeadPhrases: accepted.roleHeadPhrases.sort((left, right) => left.start - right.start || right.end - left.end)
    };
}
function acceptNonOverlappingMatchCandidates(candidates) {
    const accepted = [];
    const conceptAssignments = [];
    const roleHeadPhrases = [];
    const coveredIndexes = new Set();
    for (const candidate of candidates.sort(compareMatchCandidates)) {
        let hasConflict = false;
        for (let index = candidate.start; index <= candidate.end; index += 1) {
            if (coveredIndexes.has(index)) {
                hasConflict = true;
                break;
            }
        }
        if (hasConflict) {
            continue;
        }
        for (let index = candidate.start; index <= candidate.end; index += 1) {
            coveredIndexes.add(index);
        }
        if (candidate.roleHeadPhrase) {
            accepted.push(candidate);
            roleHeadPhrases.push(candidate.roleHeadPhrase);
            continue;
        }
        if (!candidate.conceptId || candidate.dimension === 'role_head') {
            accepted.push(candidate);
            continue;
        }
        accepted.push(candidate);
        conceptAssignments.push({
            alias: candidate.alias,
            canonicalTokens: candidate.canonicalTokens,
            conceptId: candidate.conceptId,
            dimension: candidate.dimension,
            end: candidate.end,
            priority: candidate.priority,
            start: candidate.start
        });
    }
    return {
        candidates: accepted,
        concepts: conceptAssignments,
        roleHeadPhrases
    };
}
function roleHeadPhraseMatchCandidate(match, lowers) {
    return {
        alias: match.alias,
        canonicalTokens: [],
        dimension: 'role_head',
        end: match.end,
        parts: lowers.slice(match.start, match.end + 1),
        priority: ROLE_HEAD_PHRASE_MATCH_PRIORITY,
        roleHeadPhrase: match,
        start: match.start
    };
}
function resolveConceptOutputTokens(conceptId, entry, prepared, surfaceTokens) {
    const canonicalTokens = prepared.concepts.get(conceptId)?.canonicalTokens ?? [];
    const canonicalSignature = canonicalTokens.map((token) => normalizeTokenForMatch(token)).join('\u0001');
    const aliasSignature = entry.displayTokens.map((token) => normalizeTokenForMatch(token)).join('\u0001');
    if (canonicalSignature && canonicalSignature === aliasSignature) {
        return orderConceptOutputTokens(entry.displayTokens, surfaceTokens);
    }
    const outputTokens = canonicalTokens.length > 0 ? canonicalTokens : entry.displayTokens;
    return orderConceptOutputTokens(outputTokens, surfaceTokens);
}
function resolveConceptDimension(conceptId, roleSet, prepared) {
    const concept = prepared.concepts.get(conceptId);
    if (!concept) {
        return null;
    }
    if (concept.rules.length > 0) {
        for (const rule of concept.rules) {
            for (const roleMode of rule.roleModes) {
                if (intersects(roleSet, prepared.roleModes[roleMode])) {
                    return rule.dimension;
                }
            }
        }
        if (concept.defaultDimension) {
            return concept.defaultDimension;
        }
        return null;
    }
    return concept.defaultDimension;
}
function collectPhraseCandidates(lowers, prepared) {
    const candidates = [];
    for (let start = 0; start < lowers.length; start += 1) {
        const entries = prepared.phraseEntriesByFirstPart.get(lowers[start] ?? '');
        if (!entries) {
            continue;
        }
        for (const entry of entries) {
            if (!matchesPartsAtStart(lowers, start, entry.parts)) {
                continue;
            }
            candidates.push({
                alias: entry.alias,
                canonicalTokens: [],
                dimension: entry.dimension,
                end: start + entry.parts.length - 1,
                parts: entry.parts,
                priority: 100,
                start
            });
        }
    }
    return candidates;
}
function collectRoleHeadPhraseMatches(lowers, prepared) {
    const matches = [];
    for (let start = 0; start < lowers.length; start += 1) {
        const entries = prepared.roleHeadPhraseEntriesByFirstPart.get(lowers[start] ?? '');
        if (!entries) {
            continue;
        }
        for (const entry of entries) {
            const end = matchRoleHeadPhrasePartsAtStart(lowers, start, entry.parts, prepared.stopwords);
            if (end === null) {
                continue;
            }
            matches.push({
                alias: entry.alias,
                end,
                roleHead: entry.roleHead,
                start
            });
        }
    }
    return matches;
}
function collectConceptCandidates(tokens, folded, lowers, prepared, roleSet, blockedIndexes) {
    const candidates = [];
    const preferredEntriesByFirstPart = getPreferredConceptEntriesByFirstPart(prepared, roleSet);
    for (let start = 0; start < lowers.length; start += 1) {
        if (blockedIndexes.has(start)) {
            continue;
        }
        const entries = preferredEntriesByFirstPart.get(lowers[start] ?? '');
        if (!entries) {
            continue;
        }
        for (const entry of entries) {
            if (!matchesPartsAtStart(lowers, start, entry.parts, blockedIndexes)) {
                continue;
            }
            const exactSignature = folded.slice(start, start + entry.parts.length).join('\u0001');
            const normalizedSignature = entry.parts.join('\u0001');
            const aliasExactSignature = entry.exactParts.join('\u0001');
            const hasExactAliasForSurface = prepared.exactAliasPartsByNormalizedSignature.get(normalizedSignature)?.has(exactSignature) ?? false;
            if (exactSignature !== aliasExactSignature && hasExactAliasForSurface) {
                continue;
            }
            const dimension = resolveConceptDimension(entry.conceptId, roleSet, prepared);
            if (dimension === null) {
                continue;
            }
            candidates.push({
                alias: entry.alias,
                canonicalTokens: resolveConceptOutputTokens(entry.conceptId, entry, prepared, tokens.slice(start, start + entry.parts.length)),
                conceptId: entry.conceptId,
                dimension,
                end: start + entry.parts.length - 1,
                parts: entry.parts,
                priority: entry.priority,
                start
            });
        }
    }
    return candidates;
}
function compareMatchCandidates(left, right) {
    return (right.parts.length - left.parts.length ||
        Number(Boolean(right.conceptId)) - Number(Boolean(left.conceptId)) ||
        right.priority - left.priority ||
        left.start - right.start ||
        right.alias.length - left.alias.length ||
        left.alias.localeCompare(right.alias));
}
function matchesPartsAtStart(lowers, start, parts, blockedIndexes) {
    if (start + parts.length > lowers.length) {
        return false;
    }
    for (let offset = 0; offset < parts.length; offset += 1) {
        if ((blockedIndexes?.has(start + offset) ?? false) || lowers[start + offset] !== parts[offset]) {
            return false;
        }
    }
    return true;
}
function matchRoleHeadPhrasePartsAtStart(lowers, start, parts, stopwords) {
    let partIndex = 0;
    for (let index = start; index < lowers.length; index += 1) {
        const lower = lowers[index] ?? '';
        if (lower === parts[partIndex]) {
            partIndex += 1;
            if (partIndex === parts.length) {
                return index;
            }
            continue;
        }
        if (stopwords.has(lower)) {
            continue;
        }
        return null;
    }
    return null;
}
function communityFallback(tokens, index, roleSet, prepared) {
    const nextLower = tokens[index + 1]?.toLowerCase() ?? '';
    if (roleSet.has('worker') ||
        roleSet.has('therapist') ||
        roleSet.has('nurse') ||
        nextLower === 'care' ||
        nextLower === 'health' ||
        nextLower === 'social') {
        return 'population';
    }
    if (intersects(roleSet, prepared.roleModes.commercial)) {
        return 'channel';
    }
    return null;
}
function intersects(left, right) {
    for (const value of left) {
        if (right.has(value)) {
            return true;
        }
    }
    return false;
}
function collectActiveRoleModes(roleSet, prepared) {
    const activeModes = [];
    if (intersects(roleSet, prepared.roleModes.commercial)) {
        activeModes.push('commercial');
    }
    if (intersects(roleSet, prepared.roleModes.creative)) {
        activeModes.push('creative');
    }
    if (intersects(roleSet, prepared.roleModes.education)) {
        activeModes.push('education');
    }
    if (intersects(roleSet, prepared.roleModes.knowledge)) {
        activeModes.push('knowledge');
    }
    if (intersects(roleSet, prepared.roleModes.technical)) {
        activeModes.push('technical');
    }
    return activeModes;
}
function collectBuckets(tokens, assigned, literalAssigned, conceptAssignments, roleHeadPhraseMatches, structuralCombinations, prepared) {
    const result = {
        venue: [],
        channel: [],
        product: [],
        population: [],
        task: [],
        industry: [],
        knowledge_domain: [],
        work_object: [],
        role_head: [],
        available: createEmptyBuckets(),
        concept: createEmptyBuckets(),
        literal: createEmptyBuckets(),
        structural_combination: structuralCombinations,
        tokens,
        unresolved: [],
        assignments: []
    };
    const conceptCovered = new Set();
    const conceptAssignmentsByStart = new Map();
    const roleHeadPhraseByStart = new Map();
    const roleHeadPhraseCovered = new Set();
    for (const assignment of [...conceptAssignments].sort((left, right) => left.start - right.start || left.end - right.end)) {
        for (let index = assignment.start; index <= assignment.end; index += 1) {
            conceptCovered.add(index);
        }
        const values = conceptAssignmentsByStart.get(assignment.start) ?? [];
        values.push(assignment);
        conceptAssignmentsByStart.set(assignment.start, values);
        for (const canonicalToken of assignment.canonicalTokens) {
            pushUnique(result.concept[assignment.dimension], canonicalToken);
        }
    }
    for (const match of roleHeadPhraseMatches) {
        const values = roleHeadPhraseByStart.get(match.start) ?? [];
        values.push(match);
        roleHeadPhraseByStart.set(match.start, values);
        for (let index = match.start; index <= match.end; index += 1) {
            roleHeadPhraseCovered.add(index);
        }
    }
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index] ?? '';
        const lower = normalizeTokenForMatch(token);
        const dimension = assigned[index];
        for (const conceptAssignment of conceptAssignmentsByStart.get(index) ?? []) {
            for (const canonicalToken of conceptAssignment.canonicalTokens) {
                pushUnique(result[conceptAssignment.dimension], canonicalToken);
            }
        }
        for (const roleHeadPhrase of roleHeadPhraseByStart.get(index) ?? []) {
            pushUnique(result.role_head, roleHeadPhrase.roleHead);
            pushUnique(result.literal.role_head, roleHeadPhrase.roleHead);
        }
        if (prepared.stopwords.has(lower)) {
            result.assignments.push({
                token,
                normalized: lower,
                dimension: null,
                status: 'stopword'
            });
            continue;
        }
        if (dimension === null) {
            pushUnique(result.unresolved, token);
            result.assignments.push({
                token,
                normalized: lower,
                dimension: null,
                status: 'unresolved'
            });
            continue;
        }
        if (!conceptCovered.has(index) && !(dimension === 'role_head' && roleHeadPhraseCovered.has(index))) {
            if (dimension === 'role_head') {
                const canonicalRoleHead = resolveCanonicalRoleHead(token, prepared);
                pushUnique(result.role_head, canonicalRoleHead ?? token);
            }
            else {
                const canonicalTokens = resolveLiteralConceptOutputTokens(token, dimension, new Set(), prepared);
                if (canonicalTokens) {
                    for (const canonicalToken of canonicalTokens) {
                        pushUnique(result[dimension], canonicalToken);
                        pushUnique(result.concept[dimension], canonicalToken);
                    }
                }
                else {
                    pushUnique(result[dimension], token);
                }
            }
        }
        const literalDimension = literalAssigned[index];
        if (literalDimension && !roleHeadPhraseCovered.has(index)) {
            pushUnique(result.literal[literalDimension], token);
        }
        result.assignments.push({
            token,
            normalized: lower,
            dimension,
            status: 'assigned'
        });
    }
    for (const dimension of SPECIALIZATION_DIMENSIONS) {
        for (const token of result.literal[dimension]) {
            pushUnique(result.available[dimension], token);
        }
        for (const token of result.concept[dimension]) {
            pushUnique(result.available[dimension], token);
        }
    }
    return result;
}
function createEmptyBuckets() {
    return {
        venue: [],
        channel: [],
        product: [],
        population: [],
        task: [],
        industry: [],
        knowledge_domain: [],
        work_object: [],
        role_head: []
    };
}
function resolveLiteralTokenDimension(tokens, index, roleSet, prepared) {
    const token = tokens[index] ?? '';
    const lower = normalizeTokenForMatch(token);
    if (!lower || prepared.stopwords.has(lower)) {
        return null;
    }
    if (resolveCanonicalRoleHead(lower, prepared)) {
        return 'role_head';
    }
    const acronymDimension = prepared.acronymDimensions[token] ?? prepared.acronymDimensions[token.toUpperCase()];
    if (acronymDimension) {
        return acronymDimension;
    }
    for (const [dimension, values] of Object.entries(FORCED_LITERAL_DIMENSIONS)) {
        if (values.has(lower)) {
            return dimension;
        }
    }
    const exactEntries = prepared.singleTokenEntriesByExactPart.get(foldTokenForMatch(token)) ?? [];
    const normalizedEntries = prepared.singleTokenEntriesByNormalizedPart.get(lower) ?? [];
    const candidateEntries = exactEntries.length > 0 ? exactEntries : normalizedEntries;
    const preferredEntry = pickPreferredConceptEntry(candidateEntries, roleSet, prepared);
    if (preferredEntry) {
        return (resolveConceptDimension(preferredEntry.conceptId, roleSet, prepared) ??
            inferContextualCommodityDimension(tokens, index, roleSet, prepared));
    }
    const contextualDimension = inferContextualCommodityDimension(tokens, index, roleSet, prepared);
    if (contextualDimension) {
        return contextualDimension;
    }
    if (lower === 'community') {
        return communityFallback(tokens, index, roleSet, prepared);
    }
    return inferGenericFallbackDimension(lower);
}
function inferContextualCommodityDimension(tokens, index, roleSet, prepared) {
    const lower = normalizeTokenForMatch(tokens[index] ?? '');
    for (const [dimension, values] of Object.entries(EXPLICIT_LITERAL_DIMENSIONS)) {
        if (values.has(lower)) {
            return dimension;
        }
    }
    if (!CONTEXTUAL_COMMODITY_TOKENS.has(lower)) {
        return null;
    }
    if (intersects(roleSet, prepared.roleModes.knowledge) || intersects(roleSet, prepared.roleModes.education)) {
        return 'knowledge_domain';
    }
    for (const roleHead of roleSet) {
        if (KNOWLEDGE_FALLBACK_ROLE_HEADS.has(roleHead)) {
            return 'knowledge_domain';
        }
    }
    const normalizedTokens = new Set(tokens.map((token) => normalizeTokenForMatch(token)));
    if (intersects(roleSet, prepared.roleModes.commercial)) {
        return 'product';
    }
    for (const token of normalizedTokens) {
        if (COMMERCIAL_CONTEXT_TOKENS.has(token)) {
            return 'product';
        }
    }
    if (VENUE_DEFAULT_TOKENS.has(lower)) {
        return 'venue';
    }
    if (INDUSTRY_DEFAULT_TOKENS.has(lower)) {
        return 'industry';
    }
    if (lower === 'good' && [...normalizedTokens].some((token) => WORK_OBJECT_GOOD_CONTEXT_TOKENS.has(token))) {
        return 'work_object';
    }
    if (PRODUCT_DEFAULT_TOKENS.has(lower)) {
        return 'product';
    }
    return 'work_object';
}
function resolveCanonicalRoleHead(token, prepared) {
    return prepared.roleHeadCanonicalByAlias.get(normalizeTokenForMatch(token)) ?? null;
}
function resolveLiteralConceptOutputTokens(token, dimension, roleSet, prepared) {
    const lower = normalizeTokenForMatch(token);
    const folded = foldTokenForMatch(token);
    const exactEntries = prepared.singleTokenEntriesByExactPart.get(folded) ?? [];
    const normalizedEntries = prepared.singleTokenEntriesByNormalizedPart.get(lower) ?? [];
    const matchingEntries = [...(exactEntries.length > 0 ? exactEntries : normalizedEntries)].filter((entry) => {
        const concept = prepared.concepts.get(entry.conceptId);
        if (!concept) {
            return false;
        }
        const conceptDimension = resolveConceptDimension(entry.conceptId, roleSet, prepared) ?? getStaticPreferredConceptDimension(concept);
        return conceptDimension === dimension;
    });
    if (matchingEntries.length === 0) {
        return null;
    }
    const preferredEntry = pickPreferredConceptEntryForDimension(matchingEntries, dimension, roleSet, prepared);
    if (!preferredEntry) {
        return null;
    }
    return resolveConceptOutputTokens(preferredEntry.conceptId, preferredEntry, prepared, [token]);
}
function pickPreferredConceptEntryForDimension(entries, dimension, roleSet, prepared) {
    let bestEntry = null;
    for (const candidateEntry of entries) {
        if (!bestEntry) {
            bestEntry = candidateEntry;
            continue;
        }
        const bestIsDirect = isDirectCanonicalSurface(bestEntry);
        const candidateIsDirect = isDirectCanonicalSurface(candidateEntry);
        if (candidateIsDirect !== bestIsDirect) {
            bestEntry = candidateIsDirect ? candidateEntry : bestEntry;
            continue;
        }
        const bestIsRoleSpecific = isRoleSpecificMatch(bestEntry.conceptId, roleSet, prepared);
        const candidateIsRoleSpecific = isRoleSpecificMatch(candidateEntry.conceptId, roleSet, prepared);
        if (candidateIsRoleSpecific !== bestIsRoleSpecific) {
            bestEntry = candidateIsRoleSpecific ? candidateEntry : bestEntry;
            continue;
        }
        if (candidateEntry.priority !== bestEntry.priority) {
            bestEntry = candidateEntry.priority > bestEntry.priority ? candidateEntry : bestEntry;
            continue;
        }
        const dimensionPreference = candidateIsDirect && bestIsDirect ? DIMENSION_PREFERENCE : INDIRECT_ALIAS_DIMENSION_PREFERENCE;
        if (dimensionPreference[dimension] !== dimensionPreference[dimension]) {
            continue;
        }
        if (candidateEntry.alias.length !== bestEntry.alias.length) {
            bestEntry = candidateEntry.alias.length > bestEntry.alias.length ? candidateEntry : bestEntry;
            continue;
        }
        if (candidateEntry.alias.localeCompare(bestEntry.alias) < 0) {
            bestEntry = candidateEntry;
        }
    }
    return bestEntry;
}
function pushUnique(target, token) {
    if (!target.includes(token)) {
        target.push(token);
    }
}
function buildFixedConcepts(dimension, aliases) {
    return aliases.map((alias) => ({
        aliases: [alias],
        canonical: alias,
        dimension,
        id: alias
    }));
}
function buildRoleSensitiveConcepts(aliases, rules) {
    return aliases.map((alias) => ({
        aliases: [alias],
        canonical: alias,
        id: alias,
        rules
    }));
}
function resolveSchemaForOptions(options) {
    if (options.schema) {
        return options.schema;
    }
    if (!options.locale) {
        return DEFAULT_SPECIALIZATION_SCHEMA;
    }
    return loadSpecializationSchemaFromCsv(DEFAULT_SCHEMA_DIR, options.locale) ?? DEFAULT_SPECIALIZATION_SCHEMA;
}
export function loadSpecializationSchemaFromCsv(schemaDir = DEFAULT_SCHEMA_DIR, locale) {
    const cacheKey = `${schemaDir}\u0001${locale?.trim().toLocaleLowerCase('en-US') ?? ''}`;
    if (loadedSchemaCache.has(cacheKey)) {
        return loadedSchemaCache.get(cacheKey) ?? null;
    }
    try {
        const conceptRows = parseCsv(readFileSync(resolve(schemaDir, 'specialization-concept-rules.csv'), 'utf8'));
        const aliasRows = loadConceptAliasRows(schemaDir, locale);
        const conceptEquivalenceRows = parseCsv(readFileSync(resolve(schemaDir, 'specialization-concept-equivalence.csv'), 'utf8'));
        const structuralCombinationRows = parseOptionalCsv(resolve(schemaDir, 'specialization-structural-combinations.csv'));
        const roleRows = parseCsv(readFileSync(resolve(schemaDir, 'specialization-role-heads.csv'), 'utf8'));
        const roleAliasRows = parseCsv(readFileSync(resolve(schemaDir, 'specialization-role-head-aliases.csv'), 'utf8'));
        if (conceptRows.length === 0) {
            return null;
        }
        const aliasesByConceptId = new Map();
        for (const row of aliasRows) {
            const conceptId = (row.concept_id ?? '').trim();
            const alias = (row.alias ?? '').trim();
            if (!conceptId || !alias) {
                continue;
            }
            const priority = Number(row.priority ?? '100');
            const aliases = aliasesByConceptId.get(conceptId) ?? [];
            aliases.push({
                priority: Number.isNaN(priority) ? 100 : priority,
                value: alias
            });
            aliasesByConceptId.set(conceptId, aliases);
        }
        const rulesByConceptId = new Map();
        for (const row of conceptRows) {
            const conceptId = (row.concept_id ?? '').trim();
            const canonical = (row.canonical ?? '').trim();
            const dimension = (row.dimension ?? '').trim();
            if (!conceptId || !canonical || !isDataDimension(dimension)) {
                continue;
            }
            const roleModes = parseRoleModes(row.role_modes ?? '');
            const rules = rulesByConceptId.get(conceptId) ?? [];
            rules.push({
                canonical,
                dimension,
                roleModes
            });
            rulesByConceptId.set(conceptId, rules);
        }
        const concepts = [];
        for (const [conceptId, rules] of rulesByConceptId.entries()) {
            const canonical = rules[0]?.canonical ?? conceptId;
            const aliases = aliasesByConceptId.get(conceptId) ?? [];
            if (!aliases.some((alias) => normalizeTokenForMatch(alias.value) === normalizeTokenForMatch(canonical))) {
                aliases.push({ value: canonical, priority: 100 });
            }
            const unconditionalRules = rules.filter((rule) => rule.roleModes.length === 0);
            const conditionalRules = rules.filter((rule) => rule.roleModes.length > 0);
            const defaultDimension = unconditionalRules
                .map((rule) => rule.dimension)
                .sort((left, right) => DIMENSION_PREFERENCE[left] - DIMENSION_PREFERENCE[right])[0];
            if (conditionalRules.length === 0 && defaultDimension) {
                concepts.push({
                    aliases: sortAliasesByPriority(aliases),
                    canonical,
                    dimension: defaultDimension,
                    id: conceptId
                });
                continue;
            }
            concepts.push({
                aliases: sortAliasesByPriority(aliases),
                canonical,
                dimension: defaultDimension,
                id: conceptId,
                rules: conditionalRules.map((rule) => ({
                    dimension: rule.dimension,
                    roleModes: rule.roleModes
                }))
            });
        }
        const conceptEquivalences = [];
        for (const row of conceptEquivalenceRows) {
            const dimension = (row.dimension ?? '').trim();
            if (!isDataDimension(dimension)) {
                continue;
            }
            const conceptIds = (row.concept_ids ?? '')
                .split(';')
                .map((value) => value.trim())
                .filter((value) => value.length > 0);
            if (conceptIds.length < 2) {
                continue;
            }
            const note = (row.note ?? '').trim();
            conceptEquivalences.push({
                conceptIds: [...new Set(conceptIds)],
                dimension,
                ...(note ? { note } : {})
            });
        }
        // `specialization-role-heads.csv` and `specialization-role-head-aliases.csv` may include
        // audit-only columns such as `note`. Runtime uses canonical heads, role modes, and aliases only.
        const roleHeads = roleRows.map((row) => (row.role_head ?? '').trim()).filter((value) => value.length > 0);
        const roleModes = {
            commercial: [],
            creative: [],
            education: [],
            knowledge: [],
            technical: []
        };
        for (const row of roleRows) {
            const roleHead = (row.role_head ?? '').trim();
            if (!roleHead) {
                continue;
            }
            for (const roleMode of parseRoleModes(row.role_modes ?? '')) {
                roleModes[roleMode].push(roleHead);
            }
        }
        const roleHeadAliases = roleAliasRows
            .map((row) => ({
            alias: (row.alias ?? '').trim(),
            roleHead: (row.role_head ?? '').trim()
        }))
            .filter((row) => row.alias.length > 0 && row.roleHead.length > 0);
        const mergedRoleHeadAliases = new Map();
        const stopwords = new Set(DEFAULT_STOPWORDS);
        for (const row of roleHeadAliases) {
            const normalizedAlias = normalizeTokenForMatch(row.alias);
            const normalizedRoleHead = normalizeTokenForMatch(row.roleHead);
            if (!normalizedAlias || !normalizedRoleHead) {
                continue;
            }
            const aliasParts = normalizeAlias(row.alias, stopwords).join('\u0001');
            const key = `${normalizedRoleHead}\u0001${aliasParts}`;
            if (!mergedRoleHeadAliases.has(key)) {
                mergedRoleHeadAliases.set(key, row);
            }
        }
        const structuralCombinations = structuralCombinationRows
            .map((row) => ({
            conceptIds: parseSemicolonList(row.concept_ids ?? ''),
            derivedRoleHeads: parseSemicolonList(row.derived_role_heads ?? ''),
            id: (row.combination_id ?? '').trim(),
            roleHeads: parseSemicolonList(row.role_heads ?? '')
        }))
            .filter((row) => row.id.length > 0 && row.conceptIds.length > 0 && (row.roleHeads.length > 0 || row.derivedRoleHeads.length > 0));
        const schema = {
            acronymDimensions: BASE_SPECIALIZATION_SCHEMA.acronymDimensions,
            conceptEquivalences,
            concepts,
            phraseDimensions: DEFAULT_PHRASE_DIMENSIONS,
            roleHeads,
            roleHeadAliases: [...mergedRoleHeadAliases.values()],
            roleModes,
            stopwords: DEFAULT_STOPWORDS,
            structuralCombinations
        };
        loadedSchemaCache.set(cacheKey, schema);
        return schema;
    }
    catch {
        loadedSchemaCache.set(cacheKey, null);
        return null;
    }
}
function parseOptionalCsv(filePath) {
    try {
        return parseCsv(readFileSync(filePath, 'utf8'));
    }
    catch {
        return [];
    }
}
function parseSemicolonList(value) {
    return value
        .split(';')
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
}
function loadConceptAliasRows(schemaDir, locale) {
    const aliasRows = parseCsv(readFileSync(resolve(schemaDir, 'specialization-concept-aliases.csv'), 'utf8'));
    const normalizedLocale = locale?.trim().toLocaleLowerCase('en-US');
    if (!normalizedLocale) {
        return aliasRows;
    }
    const localeAliasPath = resolve(schemaDir, `specialization-concept-aliases.${normalizedLocale}.csv`);
    try {
        return [...aliasRows, ...parseCsv(readFileSync(localeAliasPath, 'utf8'))];
    }
    catch {
        return aliasRows;
    }
}
function buildRoleHeadCanonicalByAlias(schema) {
    const roleHeadCanonicalByAlias = new Map();
    for (const roleHead of schema.roleHeads) {
        const normalizedRoleHead = normalizeTokenForMatch(roleHead);
        if (!normalizedRoleHead) {
            continue;
        }
        roleHeadCanonicalByAlias.set(normalizedRoleHead, normalizedRoleHead);
    }
    for (const entry of schema.roleHeadAliases ?? []) {
        const normalizedAlias = normalizeTokenForMatch(entry.alias);
        const normalizedRoleHead = normalizeTokenForMatch(entry.roleHead);
        if (!normalizedAlias || !normalizedRoleHead) {
            continue;
        }
        roleHeadCanonicalByAlias.set(normalizedAlias, normalizedRoleHead);
    }
    return roleHeadCanonicalByAlias;
}
function buildStructuralCombinationRules(schema) {
    const conceptIds = new Set(schema.concepts.map((concept) => concept.id));
    const roleHeads = new Set(schema.roleHeads.map((roleHead) => normalizeTokenForMatch(roleHead)).filter(Boolean));
    const rules = [];
    for (const entry of schema.structuralCombinations ?? []) {
        const id = entry.id.trim();
        const entryConceptIds = [...new Set(entry.conceptIds.map((conceptId) => conceptId.trim()).filter((conceptId) => conceptIds.has(conceptId)))].sort();
        const entryRoleHeads = [
            ...new Set(entry.roleHeads.map((roleHead) => normalizeTokenForMatch(roleHead)).filter((roleHead) => roleHeads.has(roleHead)))
        ].sort();
        const derivedRoleHeads = [
            ...new Set(entry.derivedRoleHeads.map((roleHead) => normalizeTokenForMatch(roleHead)).filter((roleHead) => roleHeads.has(roleHead)))
        ].sort();
        if (!id || entryConceptIds.length === 0 || (entryRoleHeads.length === 0 && derivedRoleHeads.length === 0)) {
            continue;
        }
        rules.push({
            conceptIds: entryConceptIds,
            derivedRoleHeads,
            id,
            roleHeads: entryRoleHeads
        });
    }
    return rules;
}
function matchStructuralCombinations(concepts, roleSet, prepared) {
    const matches = [];
    for (const rule of prepared.structuralCombinations) {
        const matchedConcepts = rule.conceptIds
            .map((conceptId) => concepts.find((concept) => concept.conceptId === conceptId))
            .filter((concept) => concept !== undefined);
        if (matchedConcepts.length !== rule.conceptIds.length) {
            continue;
        }
        if (!rule.roleHeads.every((roleHead) => roleSet.has(roleHead))) {
            continue;
        }
        matches.push({
            id: rule.id,
            concepts: matchedConcepts.map((concept) => ({
                canonicalTokens: concept.canonicalTokens,
                conceptId: concept.conceptId,
                dimension: concept.dimension,
                end: concept.end,
                start: concept.start
            })),
            derivedRoleHeads: rule.derivedRoleHeads,
            roleHeads: rule.roleHeads
        });
    }
    return keepMostSpecificStructuralCombinations(matches);
}
function keepMostSpecificStructuralCombinations(matches) {
    return matches.filter((match) => {
        return !matches.some((candidate) => {
            if (candidate === match || !sameStringSet(candidate.derivedRoleHeads, match.derivedRoleHeads)) {
                return false;
            }
            const candidateConceptIds = candidate.concepts.map((concept) => concept.conceptId);
            const matchConceptIds = match.concepts.map((concept) => concept.conceptId);
            const candidateIsMoreSpecific = candidateConceptIds.length > matchConceptIds.length || candidate.roleHeads.length > match.roleHeads.length;
            return candidateIsMoreSpecific && includesAll(candidateConceptIds, matchConceptIds) && includesAll(candidate.roleHeads, match.roleHeads);
        });
    });
}
function sameStringSet(left, right) {
    return left.length === right.length && includesAll(left, right);
}
function includesAll(values, required) {
    return required.every((value) => values.includes(value));
}
function sortAliasesByPriority(aliases) {
    return [...aliases].sort((left, right) => (right.priority ?? 100) - (left.priority ?? 100) || left.value.localeCompare(right.value));
}
function getAliasValue(alias) {
    return typeof alias === 'string' ? alias : alias.value;
}
function getAliasPriority(alias) {
    return typeof alias === 'string' ? 100 : (alias.priority ?? 100);
}
function tokenizeCanonicalForOutput(canonical) {
    return canonical
        .trim()
        .split(/[\s/_]+/g)
        .map((token) => token.trim())
        .filter((token) => token.length > 0);
}
function foldTokenForMatch(token) {
    return token
        .normalize('NFKD')
        .replaceAll(/\p{M}+/gu, '')
        .replaceAll(/['’`]+/g, '')
        .toLowerCase();
}
function normalizeTokenForMatch(token) {
    const lower = foldTokenForMatch(token);
    return singularizeMatchToken(lower);
}
function singularizeMatchToken(token) {
    if (token.endsWith('sis') || token.endsWith('ics')) {
        return token;
    }
    if (token.endsWith('ies') && token.length > 3) {
        return `${token.slice(0, -3)}y`;
    }
    if (token.endsWith('sses') && token.length > 4) {
        return token.slice(0, -2);
    }
    if (token.endsWith('ses') && token.length > 3) {
        return token.slice(0, -2);
    }
    if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
        return token.slice(0, -1);
    }
    return token;
}
function parseRoleModes(value) {
    return value
        .split('|')
        .map((roleMode) => roleMode.trim())
        .filter((roleMode) => isRoleMode(roleMode));
}
function getPreferredConceptEntriesByFirstPart(prepared, roleSet) {
    const entriesByFirstPart = new Map();
    for (const entries of prepared.conceptEntriesByExactSignature.values()) {
        const preferred = pickPreferredConceptEntry(entries, roleSet, prepared);
        if (!preferred) {
            continue;
        }
        pushMapArray(entriesByFirstPart, preferred.parts[0] ?? '', preferred);
    }
    for (const entries of entriesByFirstPart.values()) {
        entries.sort(compareAliasEntries);
    }
    return entriesByFirstPart;
}
function pickPreferredConceptEntry(entries, roleSet, prepared) {
    const resolvedEntries = entries.filter((entry) => resolveConceptDimension(entry.conceptId, roleSet, prepared) !== null);
    if (resolvedEntries.length === 0) {
        return null;
    }
    const hasDirectEntry = resolvedEntries.some((entry) => isDirectCanonicalSurface(entry));
    const roleSpecificEntries = resolvedEntries.filter((entry) => isRoleSpecificMatch(entry.conceptId, roleSet, prepared));
    if (!hasDirectEntry) {
        const distinctConceptIds = new Set(resolvedEntries.map((entry) => entry.conceptId));
        if (distinctConceptIds.size > 1 && roleSpecificEntries.length === 0) {
            return null;
        }
    }
    let bestEntry = null;
    for (const candidateEntry of resolvedEntries) {
        const candidateDimension = resolveConceptDimension(candidateEntry.conceptId, roleSet, prepared);
        if (candidateDimension === null) {
            continue;
        }
        if (!bestEntry) {
            bestEntry = candidateEntry;
            continue;
        }
        const bestDimension = resolveConceptDimension(bestEntry.conceptId, roleSet, prepared);
        if (bestDimension === null) {
            bestEntry = candidateEntry;
            continue;
        }
        const bestIsDirect = isDirectCanonicalSurface(bestEntry);
        const candidateIsDirect = isDirectCanonicalSurface(candidateEntry);
        if (candidateIsDirect !== bestIsDirect) {
            bestEntry = candidateIsDirect ? candidateEntry : bestEntry;
            continue;
        }
        const bestIsRoleSpecific = isRoleSpecificMatch(bestEntry.conceptId, roleSet, prepared);
        const candidateIsRoleSpecific = isRoleSpecificMatch(candidateEntry.conceptId, roleSet, prepared);
        if (candidateIsRoleSpecific !== bestIsRoleSpecific) {
            bestEntry = candidateIsRoleSpecific ? candidateEntry : bestEntry;
            continue;
        }
        if (candidateEntry.priority !== bestEntry.priority) {
            bestEntry = candidateEntry.priority > bestEntry.priority ? candidateEntry : bestEntry;
            continue;
        }
        const dimensionPreference = candidateIsDirect && bestIsDirect ? DIMENSION_PREFERENCE : INDIRECT_ALIAS_DIMENSION_PREFERENCE;
        if (dimensionPreference[candidateDimension] !== dimensionPreference[bestDimension]) {
            bestEntry = dimensionPreference[candidateDimension] < dimensionPreference[bestDimension] ? candidateEntry : bestEntry;
            continue;
        }
        if (candidateEntry.alias.length !== bestEntry.alias.length) {
            bestEntry = candidateEntry.alias.length > bestEntry.alias.length ? candidateEntry : bestEntry;
            continue;
        }
        if (candidateEntry.alias.localeCompare(bestEntry.alias) < 0) {
            bestEntry = candidateEntry;
        }
    }
    return bestEntry;
}
function isRoleSpecificMatch(conceptId, roleSet, prepared) {
    const concept = prepared.concepts.get(conceptId);
    if (!concept || concept.rules.length === 0) {
        return false;
    }
    for (const rule of concept.rules) {
        if (rule.roleModes.length === 0) {
            continue;
        }
        for (const roleMode of rule.roleModes) {
            if (prepared.roleModes[roleMode].size > 0 && intersects(roleSet, prepared.roleModes[roleMode])) {
                return true;
            }
        }
    }
    return false;
}
function isDirectCanonicalSurface(entry) {
    return entry.isDirect;
}
function isRedundantBridgeAlias(entry, conceptIdsByToken) {
    if (entry.parts.length === 1 && entry.staticDimension && !entry.isDirect) {
        const fallbackDimension = inferGenericFallbackDimension(entry.parts[0] ?? '');
        if (fallbackDimension) {
            return true;
        }
    }
    if (entry.parts.length < 2 || entry.canonicalParts.length === 0) {
        return false;
    }
    const canonicalSet = new Set(entry.canonicalParts);
    let aliasContainsCanonical = true;
    for (const part of canonicalSet) {
        if (!entry.parts.includes(part)) {
            aliasContainsCanonical = false;
            break;
        }
    }
    if (!aliasContainsCanonical) {
        return false;
    }
    for (const part of entry.parts) {
        if (canonicalSet.has(part)) {
            continue;
        }
        const competingConceptIds = conceptIdsByToken.get(part) ?? new Set();
        if ([...competingConceptIds].some((conceptId) => conceptId !== entry.conceptId)) {
            return true;
        }
    }
    return false;
}
function getStaticPreferredConceptDimension(concept) {
    if (concept.defaultDimension) {
        return concept.defaultDimension;
    }
    if (concept.rules.length === 0) {
        return null;
    }
    const uniqueDimensions = [...new Set(concept.rules.map((rule) => rule.dimension))];
    return uniqueDimensions.length === 1 ? (uniqueDimensions[0] ?? null) : null;
}
function inferGenericFallbackDimension(lower) {
    if (lower.endsWith('ology') || lower.endsWith('nomics')) {
        return 'knowledge_domain';
    }
    if (lower.endsWith('ing') || lower.endsWith('tion') || lower.endsWith('sion') || lower.endsWith('ment')) {
        return 'task';
    }
    if (lower.endsWith('al') ||
        lower.endsWith('ial') ||
        lower.endsWith('ic') ||
        lower.endsWith('ical') ||
        lower.endsWith('ary') ||
        lower.endsWith('ory') ||
        lower.endsWith('ive')) {
        return 'industry';
    }
    return null;
}
function orderConceptOutputTokens(outputTokens, surfaceTokens) {
    if (outputTokens.length !== surfaceTokens.length) {
        return outputTokens;
    }
    const remainingByNormalized = new Map();
    for (const token of outputTokens) {
        const normalized = normalizeTokenForMatch(token);
        const values = remainingByNormalized.get(normalized) ?? [];
        values.push(token);
        remainingByNormalized.set(normalized, values);
    }
    const ordered = [];
    for (const surfaceToken of surfaceTokens) {
        const normalized = normalizeTokenForMatch(surfaceToken);
        const values = remainingByNormalized.get(normalized);
        if (!values || values.length === 0) {
            return outputTokens;
        }
        values.shift();
        ordered.push(surfaceToken);
    }
    return ordered;
}
function isRoleMode(value) {
    return value === 'commercial' || value === 'creative' || value === 'education' || value === 'knowledge' || value === 'technical';
}
function isDataDimension(value) {
    return (value === 'venue' ||
        value === 'channel' ||
        value === 'product' ||
        value === 'population' ||
        value === 'task' ||
        value === 'industry' ||
        value === 'knowledge_domain' ||
        value === 'work_object');
}
function parseCsv(text) {
    const records = [];
    let field = '';
    let row = [];
    let inQuotes = false;
    for (let index = 0; index < text.length; index += 1) {
        const char = text[index] ?? '';
        const next = text[index + 1] ?? '';
        if (inQuotes) {
            if (char === '"' && next === '"') {
                field += '"';
                index += 1;
                continue;
            }
            if (char === '"') {
                inQuotes = false;
                continue;
            }
            field += char;
            continue;
        }
        if (char === '"') {
            inQuotes = true;
            continue;
        }
        if (char === ',') {
            row.push(field);
            field = '';
            continue;
        }
        if (char === '\r') {
            continue;
        }
        if (char === '\n') {
            row.push(field);
            records.push(row);
            row = [];
            field = '';
            continue;
        }
        field += char;
    }
    if (field.length > 0 || row.length > 0) {
        row.push(field);
        records.push(row);
    }
    const headerRow = records[0] ?? [];
    return records
        .slice(1)
        .filter((record) => record.some((value) => value.length > 0))
        .map((record) => {
        const result = {};
        for (let index = 0; index < headerRow.length; index += 1) {
            const key = headerRow[index] ?? '';
            result[key] = record[index] ?? '';
        }
        return result;
    });
}
