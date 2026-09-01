import { foldSearchText, tokenizeNormalizedText } from '../utils/texts.js';
export const LEAF_LEVEL_KINDS = ['none', 'assistant', 'junior', 'senior', 'lead', 'supervisor', 'manager', 'director', 'chief'];
export const LEAF_STRUCTURE_AUTHORITY_ORDER = [
    { token: 'chief', kind: 'chief' },
    { token: 'director', kind: 'director' },
    { token: 'manager', kind: 'manager' },
    { token: 'supervisor', kind: 'supervisor' },
    { token: 'lead', kind: 'lead' },
    { token: 'auditor', kind: 'auditor' }
];
export const LEVEL_SPECIALIZATION_SYNONYMS = {
    none: [],
    assistant: ['ajutor', 'segito', 'abistaja', 'assistant', 'asistent', 'asistenta', 'asszisztens', 'assistent', 'deputy'],
    junior: [
        'incepator',
        'debutant',
        'stagiar',
        'ucenic',
        'gyakornok',
        'palyakezdo',
        'tanulo',
        'algaja',
        'praktikant',
        'junior',
        'entry',
        'entrylevel',
        'intern',
        'trainee',
        'apprentice',
        'graduate',
        'noorem'
    ],
    senior: ['experimentat', 'avansat', 'tapasztalt', 'halado', 'kogenud', 'senior', 'principal', 'advanced', 'vanem'],
    lead: [
        'coordonator',
        'conducator',
        'vezeto',
        'csoportvezeto',
        'meeskonnajuht',
        'tiimijuht',
        'lead',
        'leader',
        'teamlead',
        'teamleader',
        'lider'
    ],
    supervisor: ['supraveghetor', 'felugyelo', 'jarelevaataja', 'supervisor', 'supervizor'],
    manager: ['administrator', 'conducator', 'vezeto', 'menedzsment', 'juhataja', 'juht', 'manager', 'menedzser'],
    director: ['directorial', 'igazgato', 'peadirektor', 'director', 'direktor', 'head'],
    chief: ['conducator', 'fovezeto', 'pealik', 'chief', 'ceo', 'coo', 'cfo', 'cio', 'cto', 'cdo']
};
export const ATOMIC_SPECIALIZATION_SYNONYMS = {
    venue: {
        airport: ['aeroportul', 'lennujaama', 'airport', 'aeroport', 'repuloter', 'lennujaam', 'airside', 'terminal', 'airspace'],
        bank: ['bancare', 'bankfiok', 'pangandus', 'bank', 'banca', 'banki'],
        casino: ['cazinouri', 'kaszino', 'kasiino', 'casino', 'cazinou'],
        clinic: ['cabinet', 'cabinete', 'rendelo', 'kliinik', 'clinic', 'clinica', 'klinik'],
        court: ['judecatorie', 'tribunal', 'tribunale', 'birosag', 'kohus', 'court', 'instanta'],
        factory: ['fabrica', 'uzina', 'uziny', 'gyar', 'tehas', 'plant', 'mill', 'moara', 'uzem', 'uzemi'],
        farm: ['gospodarie', 'fermier', 'gazdasag', 'talu', 'farm', 'ferma'],
        hospital: ['spitalul', 'korhazi', 'haigla', 'hospital', 'spital', 'korhaz'],
        hotel: ['pensiune', 'pensiunea', 'szalloda', 'hotell', 'hotel'],
        laboratory: ['laboratoriu', 'laboratoorium', 'laboratory', 'lab', 'laborator', 'labor'],
        library: ['bibliotecara', 'bibliotecii', 'konyvtari', 'raamatukogu', 'library', 'biblioteca', 'konyvtar'],
        market: ['comercial', 'piata', 'piac', 'turg', 'market'],
        mine: ['minerit', 'cariera', 'banya', 'kaevandus', 'mine', 'quarry', 'mina'],
        museum: ['muzeala', 'muzeumi', 'muuseum', 'museum', 'muzeu'],
        office: ['birou', 'birouri', 'irodai', 'kontor', 'office', 'iroda'],
        pharmacy: ['farmaceutica', 'farmaceutic', 'gyogyszertari', 'apteek', 'pharmacy', 'farmacie', 'gyogyszertar', 'drugstore'],
        prison: ['penitenciar', 'penitenciare', 'bortoni', 'vangla', 'prison', 'inchisoare', 'borton'],
        railway: ['feroviar', 'feroviara', 'vasuti', 'raudtee', 'railway', 'station', 'gara', 'vasut', 'terminal'],
        restaurant: [
            'restaurantul',
            'restaurante',
            'ettermi',
            'toitlustus',
            'restaurant',
            'etterem',
            'gyorsetterem',
            'bakery',
            'panificatie',
            'pekseg',
            'brutarie',
            'pagari'
        ],
        school: [
            'scolar',
            'scolara',
            'scolii',
            'iskolai',
            'kooli',
            'school',
            'campus',
            'scoala',
            'iskola',
            'kool',
            'freinet',
            'montessori',
            'steiner',
            'nursery',
            'primary',
            'secondary'
        ],
        ship: ['naval', 'navale', 'hajozasi', 'laev', 'ship', 'vessel', 'nava', 'vas', 'hajo', 'port'],
        shop: ['magazinul', 'magazine', 'uzlet', 'uzleti', 'kauplus', 'shop', 'store', 'magazin', 'mall', 'bolt', 'bolti', 'kaupluse'],
        studio: ['atelier', 'ateliere', 'muhely', 'stuudio', 'studio', 'salon', 'szalon'],
        theatre: ['teatru', 'teatrala', 'szinhazi', 'teater', 'theatre', 'theater', 'szinhaz'],
        warehouse: ['depozitare', 'depozit', 'raktari', 'ladu', 'warehouse', 'raktar']
    },
    channel: {
        // 'broadcast' added while folding the old equivalence rows in -- no ATOMIC key covered it before.
        broadcast: ['broadcast', 'radio', 'television', 'tv', 'difuzare'],
        // 'desk'/'ghiseu' added here (helpdesk/helpline were already present): the old equivalence rows
        // also had a separate ['counter', 'ghiseu'] row, but 'ghiseu' is genuinely ambiguous in Romanian
        // job titles between "service counter/window" and "help desk" -- resolved to call_centre since
        // that reading is the closer real-world fit for this vocabulary. 'counter' below stays unlinked
        // rather than merged with call_centre, to avoid broadening channel alignment to cover unrelated
        // in-person-counter roles just because of that one shared, ambiguous word.
        call_centre: [
            'callcenter',
            'call',
            'centre',
            'center',
            'telefonic',
            'telefonos',
            'switchboard',
            'centrala',
            'helpline',
            'helpdesk',
            'apel',
            'centru',
            'klienditeenindus',
            'desk',
            'ghiseu'
        ],
        chat: ['chat', 'livechat', 'conversatie', 'cseveges', 'vestlus'],
        // 'counter' added while folding the old equivalence rows in -- see the call_centre comment above
        // for why it is deliberately NOT merged with call_centre despite sharing 'ghiseu' in the old data.
        counter: ['counter'],
        digital: [
            'digital',
            'digitalizare',
            'digitalis',
            'digitaalne',
            'digitala',
            'online',
            'web',
            'website',
            'internet',
            'cyber',
            'ecommerce',
            'ebusiness'
        ],
        // 'door' added while folding the old equivalence rows in -- no ATOMIC key covered it before.
        door: ['door', 'usa'],
        mail: ['corespondenta', 'corespondentie', 'levelezes', 'postiteenus', 'mail', 'post', 'posta'],
        social: ['kozossegi', 'sotsiaalmeedia', 'social', 'social_work', 'social_services', 'social_security', 'csr', 'media'],
        telephone: ['telefonic', 'telefonica', 'telefonos', 'telefon', 'telephone', 'phone']
    },
    product: {
        appliance: ['electrocasnic', 'haztartasi', 'kodumasin', 'appliance', 'electrocasnice', 'futos'],
        audio: ['audiovizual', 'audiovizuale', 'hangtechnika', 'heliseadmed', 'audio', 'music', 'musical', 'muzical', 'hang'],
        battery: ['acumulator', 'acumulatoare', 'akkumulator', 'aku', 'battery', 'baterie', 'akku'],
        beverage: [
            'bautura',
            'bauturi',
            'ital',
            'italok',
            'jook',
            'beverage',
            'drink',
            'coffee',
            'cafea',
            'tea',
            'cocoa',
            'cacao',
            'chocolate',
            'ciocolata',
            'csokolade',
            'sokolaad',
            'joogid'
        ],
        circuit: ['circuite', 'aramkor', 'vooluring', 'circuit', 'microelectronics', 'chip'],
        clothing: ['imbracaminte', 'vestimentatie', 'ruhazati', 'roivastus', 'clothing', 'apparel', 'garment', 'ruhazat'],
        cosmetic: ['cosmetice', 'cosmetica', 'szepsegapolasi', 'kosmeetika', 'cosmetic', 'perfume', 'parfum', 'illatszer'],
        device: ['aparatura', 'dispozitive', 'keszulek', 'seade', 'device', 'instrument'],
        equipment: ['echipament', 'utilaj', 'berendezes', 'seadmed', 'equipment', 'machinery', 'utilaje', 'echipamente', 'gep'],
        food: [
            'alimentar',
            'alimente',
            'elelmiszeripari',
            'toit',
            'food',
            'foodstuff',
            'elelmiszer',
            'meat',
            'carne',
            'fruit',
            'fructe',
            'vegetable',
            'legume',
            'dairy',
            'lactate',
            'sugar',
            'zahar',
            'confectionery',
            'dulciuri'
        ],
        footwear: ['incaltaminte', 'incaltari', 'cipoi', 'jalats', 'footwear', 'shoe', 'shoes', 'cipos'],
        furniture: ['mobilier', 'mobila', 'butoripari', 'moobel', 'furniture', 'butor'],
        gambling_games: ['szerencsejatek', 'hasartmangud', 'gambling', 'casino', 'games', 'game', 'jocuri', 'jatek'],
        hardware: ['hardware', 'szamitastechnikai', 'arvutiriistvara', 'computer_hardware', 'szamitogep'],
        integrated_circuit: ['integralt', 'integraallus', 'integrated_circuit', 'microchip'],
        jewellery: ['bijuterie', 'bijuterii', 'ekszer', 'ehted', 'jewellery', 'jewelry', 'watch', 'watches', 'ceas', 'ceasuri', 'ora', 'orak'],
        leather: ['pielarie', 'pielii', 'boripari', 'nahk', 'leather', 'piele', 'bor'],
        medical_device: ['orvostechnikai', 'meditsiiniseade', 'medical_device', 'orthopaedic', 'audiology'],
        metal: ['metale', 'metalurgic', 'femipari', 'metall', 'metal', 'steel', 'fem'],
        paper: ['hartie', 'papiripari', 'paber', 'papir'],
        plastic: ['plastice', 'muanyagipari', 'plast', 'plastic', 'rubber', 'cauciuc', 'muanyag'],
        power: ['electricitate', 'energia', 'power', 'energy', 'energie', 'combustibil', 'fuel', 'gas', 'gaz'],
        satellite: ['sateliti', 'muholdas', 'satelliit', 'satellite', 'satelit', 'muhold'],
        sensor: ['senzori', 'erzekeloi', 'andur', 'sensor', 'senzor', 'erzekelo'],
        textile: ['textil', 'textile', 'textilipari', 'tekstiil', 'textiles', 'fabric', 'imbracaminte'],
        tobacco: ['tutun', 'tutunuri', 'dohanyipari', 'tubakas', 'tobacco', 'dohany'],
        tool: ['unelte', 'scule', 'szerszamok', 'tooriistad', 'tool', 'szerszam'],
        toy: ['jucarie', 'jucarii', 'jatekipari', 'manguasi', 'toy', 'toys', 'jatek'],
        vehicle: [
            'vehicul',
            'vehicule',
            'jarmuvek',
            'soiduk',
            'vehicle',
            'car',
            'automobile',
            'masina',
            'auto',
            'tehergepjarmu',
            'tehergepkocsi'
        ],
        art: ['gallery', 'galerie', 'galeria', 'muveszeti', 'kunstigalerii', 'art', 'artistic', 'antique'],
        // Added while folding LEAF_STRUCTURE_SPECIALIZATION_EQUIVALENCE_ROWS into this object (see
        // SPECIALIZATION_MARKER_EQUIVALENCE_GROUPS below) -- these five concepts recurred in equivalence
        // rows but had no ATOMIC key of their own yet. Locale forms are carried over exactly as they were
        // in the old rows (no new translations invented).
        crane: ['crane', 'macara'],
        glass: ['glass', 'sticla'],
        pump: ['pump', 'pompa'],
        stone: ['stone', 'piatra'],
        wood: ['wood', 'timber', 'lemn']
    },
    population: {
        adult: ['adulti', 'felnott', 'taiskasvanu', 'adult', 'elderly', 'senior', 'aged', 'older', 'varstnic', 'idosek'],
        animal: ['animale', 'animalier', 'allat', 'loom', 'animal', 'pet', 'kedvenc', 'livestock'],
        // 'teen'/'teenager'/'adolescent' added while folding the old equivalence rows in: 'youth'/'tineret'
        // were already here, these three weren't.
        child: [
            'copil',
            'copii',
            'gyermek',
            'laps',
            'child',
            'children',
            'kid',
            'youth',
            'tineret',
            'juvenile',
            'minor',
            'minori',
            'teen',
            'teenager',
            'adolescent'
        ],
        client: ['clientela', 'clienti', 'ugyfelek', 'kliendid', 'client', 'customer', 'customer_service', 'ugyfel', 'ugyfelszolgalati'],
        community: ['comunitar', 'comunitate', 'kozossegi', 'kogukonna', 'community', 'public', 'kozosseg', 'kogukond'],
        disability: ['dizabil', 'fogyatekossag', 'puue', 'disability', 'disabled', 'dizabilitati', 'fogyatekos'],
        migrant: ['migranti', 'migrator', 'vandorlo', 'migrant', 'immigrant', 'refugee'],
        passenger: ['pasageri', 'pasager', 'utasok', 'reisija', 'passenger', 'utas'],
        patient: ['pacienti', 'pacient', 'betegek', 'patsient', 'patient', 'beteg'],
        student: ['studenti', 'studentesc', 'diakok', 'opilane', 'student', 'pupil', 'diak'],
        tourist: ['turistic', 'turisti', 'turistak', 'turistid', 'tourist', 'traveller', 'traveler', 'turist'],
        // 'user'/'visitor' added while folding the old equivalence rows in -- no ATOMIC key covered them before.
        user: ['user', 'utilizator'],
        victim: ['victime', 'victima', 'aldozatok', 'ohver', 'victim', 'aldozat'],
        visitor: ['visitor', 'vizitator']
    },
    task_focus: {
        academic_support: ['academic_support', 'tutoring', 'mentoring', 'academic', 'tutore', 'mentor', 'tanar', 'opetaja'],
        design: ['proiectare', 'proiectant', 'tervezesi', 'kujundus', 'design', 'designer', 'tervezes', 'applied_arts'],
        installation: ['instalare', 'montaj', 'telepitesi', 'paigaldus', 'installation', 'installer', 'instalator', 'telepito'],
        learning_support: ['learning_support', 'special_education', 'sen', 'educational', 'educatie', 'tanulasi', 'oppetugi'],
        maintenance_and_repair: [
            'intretinere',
            'mentenanta',
            'reparatii',
            'karbantartasi',
            'javitas',
            'hooldus',
            'remont',
            'maintenance',
            'repair',
            'repairer',
            'reparator'
        ],
        predictive_maintenance: ['predictive_maintenance', 'condition_monitoring', 'predictiva', 'prediktiv', 'ennustav'],
        processing: ['procesare', 'prelucrare', 'feldolgozas', 'tootlemine', 'processing', 'moulding', 'finishing', 'cutting'],
        quality_assurance: [
            'quality',
            'quality_assurance',
            'quality_control',
            'calitate',
            'minoseg',
            'testing',
            'testare',
            'teszt',
            'asigurarea',
            'calitatii',
            'control',
            'minosegbiztositas',
            'kvaliteedikontroll'
        ],
        simulation: ['simulare', 'simulatie', 'szimulacio', 'simulatsioon', 'simulation'],
        surveying: ['topografie', 'topograf', 'geodezie', 'foldmeres', 'maamootmine', 'survey', 'surveyor', 'sondaj', 'meres'],
        water_quality_analysis: ['water_quality', 'water_analysis', 'analiza', 'apei', 'vizminoseg', 'vee', 'veeanaluus']
    },
    industry_context: {
        legal: ['legal', 'juridic', 'juridica', 'jogi', 'oiguslik'],
        sport: ['sport', 'sportiv', 'sportiva', 'sportagi', 'spordi'],
        automotive: ['autovehicule', 'autovehicul', 'jarmuipari', 'autotoostus', 'automotive', 'auto', 'jarmu'],
        aviation: ['aviatic', 'aviatie', 'repulesi', 'lennundus', 'aviation', 'aircraft', 'flight', 'repules', 'aeronava', 'zbor'],
        business: ['afaceri', 'comercial', 'uzleti', 'ettevotlus', 'business', 'marketing', 'commercial', 'kereskedelmi'],
        construction: ['constructii', 'epitoipari', 'ehitus', 'construction', 'building', 'epitoipar'],
        electrical: [
            'electric',
            'electrica',
            'villamosipari',
            'elektri',
            'electrical',
            'electricity',
            'energy',
            'energie',
            'villamossag',
            'tensiune'
        ],
        electronics: [
            'electronica',
            'electromecanica',
            'elektronikai',
            'elektroonika',
            'electronics',
            'electronic',
            'electromechanical',
            'elektronika',
            'electromecanic'
        ],
        ict: [
            'ict',
            'informatica',
            'informatikai',
            'infotehnoloogia',
            'software',
            'database',
            'network',
            'computer',
            'calculator',
            'szoftver',
            'adat',
            'cloud',
            'sisteme',
            'retea'
        ],
        manufacturing: ['fabricatie', 'gyartasi', 'tootmine', 'manufacturing', 'industrial', 'fabricaţie', 'gyartas'],
        medical: [
            'medicina',
            'medicala',
            'egeszsegugyi',
            'meditsiiniline',
            'medical',
            'health',
            'healthcare',
            'clinical',
            'pharmaceutical',
            'sanatate',
            'egeszsegugy',
            'gyogyszereszeti',
            'klinikai'
        ],
        insurance: ['insurance', 'asigurari', 'biztositas', 'kindlustus'],
        mining: ['minerit', 'extractie', 'banyaszati', 'kaevandus', 'mining', 'mine', 'banyaszat'],
        renewable_energy: ['renewable', 'solar', 'wind', 'geothermal', 'regenerabil', 'megujulo', 'taastuvenergia'],
        telecommunications: ['telecomunicatii', 'telecom', 'tavkozlesi', 'telekommunikatsioon', 'telecommunications', 'tavkozles']
    }
};
// Flattened lookup map per specialization kind for rapid set-checking
function buildFlatKindSets() {
    const result = {};
    for (const [kind, clusters] of Object.entries(ATOMIC_SPECIALIZATION_SYNONYMS)) {
        const tokens = new Set();
        for (const aliases of Object.values(clusters)) {
            for (const alias of aliases) {
                tokens.add(foldSearchText(alias));
            }
        }
        result[kind] = tokens;
    }
    return result;
}
export const LEAF_STRUCTURE_TOKENS_BY_KIND = buildFlatKindSets();
export const LEAF_STRUCTURE_VENUE_TOKENS = new Set([
    'hotel',
    'hospital',
    'clinic',
    'school',
    'airport',
    'railway',
    'station',
    'restaurant',
    'shop',
    'store',
    'office',
    'mine',
    'laboratory',
    'lab',
    'warehouse',
    'court',
    'building',
    // mined from canonical-label word frequency (see venue equivalence rows below for grouping)
    'plant',
    'factory',
    'mill',
    'vessel',
    'ship',
    'bank',
    'market',
    'farm',
    'pharmacy',
    'casino',
    'theatre',
    'library',
    'bakery',
    'prison',
    'salon',
    'studio',
    'museum'
]);
export const LEAF_STRUCTURE_CHANNEL_TOKENS = new Set([
    'chat',
    'online',
    'digital',
    'social',
    'media',
    'telephone',
    'call',
    'centre',
    'center',
    'broadcast',
    'helpdesk',
    'video',
    'switchboard',
    'helpline',
    'desk',
    'mail',
    'web',
    'door',
    'counter'
]);
export const LEAF_STRUCTURE_PRODUCT_TOKENS = new Set([
    'battery',
    'circuit',
    'hardware',
    'textile',
    'footwear',
    'furniture',
    'sensor',
    'satellite',
    'microelectronics',
    'games',
    'power',
    'device',
    'goods',
    'equipment',
    'vehicle',
    'machinery',
    'clothing',
    'metal',
    'food',
    'instrument',
    'materials',
    'jewellery',
    'glass',
    'stone',
    'meat',
    'fruit',
    'coffee',
    'wood',
    'engine',
    'gas',
    'musical',
    // mined from canonical-label word frequency (see product equivalence rows below for grouping)
    'leather',
    'energy',
    'fuel',
    'appliance',
    'perfume',
    'cosmetic',
    'tobacco',
    'car',
    'watch',
    'confectionery',
    'cocoa',
    'vegetable',
    'beverage',
    'dairy',
    'tool',
    'plastic',
    'sugar',
    'paper',
    'pump',
    'crane',
    'rubber',
    // mined from a full scan of remaining unclassified leaf tokens (see occupation-leaf-structure.esco_1_2_1.json)
    // 'machine' was dropped: too generic (machine operator) to be a specialization, not the specific
    // product being specialized in.
    'chocolate',
    'kiln',
    'audio',
    'watches',
    'accessories'
]);
export const LEAF_STRUCTURE_POPULATION_TOKENS = new Set([
    'customer',
    'client',
    'public',
    'student',
    'patient',
    'passenger',
    'visitor',
    'user',
    'animal',
    'tourist',
    'child',
    'youth',
    'adult',
    'elderly',
    'disability',
    'disabled',
    'migrant',
    'victim',
    'juvenile',
    // mined from a full scan of remaining unclassified leaf tokens
    'community',
    'pet'
]);
export const LEAF_STRUCTURE_TASK_FOCUS_TOKENS = new Set([
    'testing',
    'test',
    'maintenance',
    'repair',
    'repairer',
    'installation',
    'installer',
    'survey',
    'surveyor',
    'design',
    'designer',
    'simulation',
    'quality',
    'support',
    // 'operations'/'operator' dropped: too generic (machine operator, system operator) to be a
    // specialization.
    'analyst',
    'planner',
    'production',
    'assembly',
    'distribution',
    'import',
    'export',
    'rental',
    'research',
    'breeding',
    'care',
    'stock',
    'development',
    'safety',
    'sales',
    'service',
    'policy',
    'performance',
    // mined from a full scan of remaining unclassified leaf tokens
    'treatment',
    'processing',
    'moulding',
    'driving',
    'finishing',
    'cutting'
]);
export const LEAF_STRUCTURE_INDUSTRY_CONTEXT_TOKENS = new Set([
    'electrical',
    'electronics',
    'electronic',
    'electromechanical',
    'telecommunications',
    'telecom',
    'aviation',
    'aircraft',
    'flight',
    'automotive',
    'mining',
    'construction',
    'manufacturing',
    'medical',
    'energy',
    'software',
    'database',
    'network',
    'marketing',
    'advertising',
    'aquaculture',
    'leather',
    'agricultural',
    'agriculture',
    'chemical',
    'industrial',
    'marine',
    'motor',
    'water',
    'insurance',
    'transport',
    'health',
    'fisheries',
    'fish',
    'civil',
    'financial',
    'legal',
    'sports',
    'music',
    'wholesale',
    'retail',
    'vocational',
    'education',
    'environmental',
    'business',
    'security',
    'corporate',
    'investment',
    'art',
    'arts',
    'systems',
    'property',
    'waste',
    // mined from a full scan of remaining unclassified leaf tokens
    'ict',
    'computer',
    'educational',
    'heating',
    'lighting',
    'rail',
    'optical',
    'data',
    'pipeline',
    'clinical',
    'pharmaceutical',
    'forestry',
    'renewable',
    'dental',
    // 'occupational' dropped: it's part of the profession name itself ("occupational therapist"),
    // not a signal of an external industry.
    'police',
    'compliance',
    'plumbing',
    'technology',
    'healthcare',
    'hospitality',
    'cultural',
    'conservation',
    'ventilation',
    'veterinary',
    'emergency',
    'traffic',
    'tax',
    'political',
    'cloud'
]);
// Locale token sets are written once, in natural diacritic Romanian spelling; foldedLocaleSet() folds
// each entry through the same foldSearchText() used on query tokens (preparedQueryStructuralTokenSet
// below), so there is exactly one spelling per concept instead of hand-maintained diacritic/no-diacritic
// pairs that silently drift out of sync (e.g. a folded query token can never match an un-folded 'școală'
// entry, so keeping both forms only hid dead entries rather than adding coverage).
function foldedLocaleSet(words) {
    return new Set(words.map((word) => foldSearchText(word)));
}
// ro additions below 'depozit' and hu entries were mined from real listing samples
// (data/taxonomy-review/job-title-common-tokens.ejobs.csv for ro, ...profession.csv for hu) --
// each is a token that actually recurs across a meaningful share of real job titles in that
// locale, not a guessed translation.
const LEAF_STRUCTURE_VENUE_TOKENS_BY_LOCALE = {
    ro: foldedLocaleSet([
        'hotel',
        'spital',
        'clinică',
        'școală',
        'aeroport',
        'gară',
        'restaurant',
        'magazin',
        'birou',
        'mină',
        'laborator',
        'depozit',
        'șantier',
        'bancă',
        'campus',
        'mall',
        'fabrică',
        'ghișeu',
        'clădire',
        'instanță',
        'moară',
        'vas',
        'navă',
        'piață',
        'fermă',
        'farmacie',
        'cazinou',
        'teatru',
        'bibliotecă',
        'panificație',
        'închisoare',
        'muzeu'
    ]),
    hu: foldedLocaleSet(['bolti', 'éttermi', 'gyorséttermi', 'üzem', 'üzemi', 'pékség', 'raktár', 'raktári'])
};
const LEAF_STRUCTURE_CHANNEL_TOKENS_BY_LOCALE = {
    ro: foldedLocaleSet([
        'chat',
        'online',
        'digitală',
        'social',
        'media',
        'telefon',
        'telefonic',
        'apel',
        'centru',
        'difuzare',
        'centrala',
        'ghiseu',
        'posta',
        'web',
        'usa'
    ]),
    hu: foldedLocaleSet(['telefonos', 'ügyfélszolgálati', 'digitális', 'online'])
};
const LEAF_STRUCTURE_PRODUCT_TOKENS_BY_LOCALE = {
    ro: foldedLocaleSet([
        'baterie',
        'circuit',
        'hardware',
        'textile',
        'încălțăminte',
        'mobilă',
        'senzor',
        'satelit',
        'microelectronică',
        'jocuri',
        'energie',
        'dispozitiv',
        'utilaje',
        'mașini',
        'echipamente',
        'bunuri',
        'vehicul',
        'îmbrăcăminte',
        'metal',
        'alimente',
        'instrument',
        'materiale',
        'bijuterii',
        'sticlă',
        'piatră',
        'carne',
        'fructe',
        'cafea',
        'lemn',
        'motor',
        'gaz',
        'muzical',
        'piele',
        'combustibil',
        'electrocasnice',
        'parfum',
        'cosmetice',
        'tutun',
        'masina',
        'ceas',
        'dulciuri',
        'cacao',
        'legume',
        'bauturi',
        'lactate',
        'unelte',
        'plastic',
        'zahar',
        'hartie',
        'pompa',
        'macara',
        'cauciuc',
        // ro forms for the newly mined product tokens above -- not yet CLI-verified per the process
        // documented below (steps 1-4); flag for review if a query-specific regression surfaces.
        'ciocolata',
        'ceasuri',
        'cuptor',
        'accesorii'
    ]),
    hu: foldedLocaleSet([
        'alkatrész',
        'karosszéria',
        'tehergépjármű',
        'tehergépkocsi',
        'víz',
        // hu forms for the newly mined product tokens above -- not yet CLI-verified.
        'csokoládé',
        'óra',
        'kemence',
        'kiegészítők'
    ]),
    // et had no product locale set before. Lower confidence than the ro/hu additions above (less
    // fluency, no ejobs/profession sample to mine from) -- kept to the smallest set of unambiguous,
    // common words; not yet CLI-verified. Skipped: 'watches' (Estonian 'kell' is also the ordinary
    // word for "time/clock", the same double-meaning-risk shape as the earlier 'security' bug).
    et: foldedLocaleSet(['toode', 'šokolaad', 'ahi', 'tarvikud'])
};
const LEAF_STRUCTURE_POPULATION_TOKENS_BY_LOCALE = {
    ro: foldedLocaleSet([
        'client',
        'clienți',
        'public',
        'student',
        'studenți',
        'pacient',
        'pasager',
        'vizitator',
        'utilizator',
        'persoane',
        'animal',
        'animale',
        'turist',
        'turisti',
        'copil',
        'copii',
        'tineret',
        'adult',
        'adulti',
        'varstnic',
        'varstnici',
        'dizabilitati',
        'migrant',
        'migranti',
        'victima',
        'minor',
        'minori',
        // ro forms for the newly mined population tokens above -- not yet CLI-verified.
        'comunitate'
    ]),
    hu: foldedLocaleSet([
        'lakossági',
        'vállalati',
        'ügyfél',
        'ügyfélszolgálati',
        // hu forms for the newly mined population tokens above -- not yet CLI-verified.
        'közösség',
        'kedvenc'
    ]),
    // et had no population locale set before; not yet CLI-verified.
    et: foldedLocaleSet(['kogukond', 'lemmikloom'])
};
const LEAF_STRUCTURE_TASK_FOCUS_TOKENS_BY_LOCALE = {
    ro: foldedLocaleSet([
        'testare',
        'întreținere',
        'reparații',
        'reparator',
        'instalare',
        'instalator',
        'sondaj',
        'topograf',
        'design',
        'proiectare',
        'proiectant',
        'simulare',
        'calitate',
        'suport',
        // 'operațiuni' (operations) dropped along with the English 'operations'/'operator' tokens above.
        'analist',
        'planificare',
        'planificator',
        'depozitare',
        'vânzare',
        'vânzări',
        'livrare',
        'asamblare',
        'mentenanță',
        'distribuție',
        'import',
        'export',
        'închiriere',
        'cercetare',
        'creștere',
        'îngrijire',
        'stoc',
        'dezvoltare',
        'siguranță',
        'servicii',
        'politică',
        'performanță',
        // ro forms for the newly mined task_focus tokens above -- not yet CLI-verified.
        'tratament',
        'procesare',
        'formare',
        'conducere',
        'finisare',
        'taiere'
    ]),
    // hu had no task_focus locale set before -- these are hu forms for the newly mined tokens only,
    // not a full hu translation of the older task_focus tokens above; not yet CLI-verified.
    hu: foldedLocaleSet(['kezelés', 'feldolgozás', 'öntés', 'vezetés', 'vágás']),
    // et had no task_focus locale set before -- lower confidence, smallest safe subset only.
    // Skipped 'driving' ('juht-' forms in Estonian conflate driving with leading/management,
    // the same double-meaning-risk shape as the earlier 'security' bug).
    et: foldedLocaleSet(['ravi', 'töötlemine', 'vormimine', 'viimistlus', 'lõikamine'])
};
const LEAF_STRUCTURE_INDUSTRY_CONTEXT_TOKENS_BY_LOCALE = {
    hu: foldedLocaleSet([
        'termelési',
        'logisztikai',
        'pénzügyi',
        'kereskedelmi',
        'műszaki',
        // hu forms for the newly mined industry_context tokens above -- not yet CLI-verified.
        'számítógép',
        'oktatási',
        'fűtés',
        'világítás',
        'vasúti',
        'optikai',
        'adat',
        'klinikai',
        'gyógyszerészeti',
        'erdészeti',
        'megújuló',
        'fogászati',
        'rendőrségi',
        'technológia',
        'kulturális',
        'szellőzés',
        'állatorvosi',
        'sürgősségi',
        'forgalmi',
        'adó',
        'cloud'
    ]),
    ro: foldedLocaleSet([
        'electric',
        'electrică',
        'electronică',
        'electromecanic',
        'telecomunicații',
        'telecom',
        'aviație',
        'aeronavă',
        'zbor',
        'auto',
        'minerit',
        'construcții',
        'fabricație',
        'producție',
        'medical',
        'energie',
        'software',
        'bază de date',
        'rețea',
        'marketing',
        'publicitate',
        'logistică',
        'comercial',
        'sisteme',
        'automatizate',
        'termice',
        'tensiune',
        'acvacultură',
        'piele',
        'agricol',
        'agricultură',
        'chimic',
        'industrial',
        'maritim',
        'apă',
        'asigurări',
        'transport',
        'sănătate',
        'pescuit',
        'pește',
        'civil',
        'financiar',
        'juridic',
        'sportiv',
        'muzică',
        'angro',
        'retail',
        'educație',
        'mediu',
        'ecologic',
        'afaceri',
        'securitate',
        'pază',
        'corporativ',
        'investiții',
        'artă',
        'arte',
        'proprietate',
        'imobiliare',
        'deșeuri',
        // ro forms for the newly mined industry_context tokens above -- not yet CLI-verified. Skipped:
        // 'ict' (no recurring ro abbreviation), 'compliance'/'hospitality'/'conservation'/'political' (no
        // single confident ro word), 'plumbing' (only a multi-word ro phrase, 'instalatii sanitare').
        'calculator',
        'educational',
        'incalzire',
        'iluminat',
        'feroviar',
        'optic',
        'date',
        'conducta',
        'clinic',
        'farmaceutic',
        'forestier',
        'regenerabil',
        'dentar',
        'politie',
        'tehnologie',
        'sanatate',
        'cultural',
        'ventilatie',
        'veterinar',
        'urgenta',
        'trafic',
        'fiscal',
        'cloud'
    ]),
    // et had no industry_context locale set before -- lower confidence, smallest safe subset only.
    // Skipped: 'tax' ('maks' collides with the ordinary Estonian word for "liver" -- same
    // double-meaning-risk shape as the earlier 'security' bug), 'cloud' ('pilv' collides with the
    // weather sense), 'ict'/'compliance'/'hospitality'/'conservation'/'political'/'plumbing' (no
    // single confident et word).
    et: foldedLocaleSet([
        'arvuti',
        'hariduslik',
        'küte',
        'valgustus',
        'raudtee',
        'optiline',
        'andmed',
        'kliiniline',
        'farmaatsia',
        'metsandus',
        'taastuv',
        'hambaravi',
        'politsei',
        'tehnoloogia',
        'tervishoid',
        'kultuuriline',
        'ventilatsioon',
        'veterinaar',
        'hädaabi',
        'liiklus'
    ])
};
// Marker-equivalence groups: ATOMIC_SPECIALIZATION_SYNONYMS keys listed together here are treated as
// the SAME specific specialization value for alignment purposes (e.g. a leaf marked with the 'hotel'
// key and a query using a 'restaurant' word are the same venue). This used to be a separate flat table
// (LEAF_STRUCTURE_SPECIALIZATION_EQUIVALENCE_ROWS) of raw token rows, maintained independently of
// ATOMIC_SPECIALIZATION_SYNONYMS -- most of those rows turned out to be pure duplicates of one ATOMIC
// key's own alias list (e.g. ['shop','store','magazin','mall'] was already exactly
// ATOMIC_SPECIALIZATION_SYNONYMS.venue.shop). Folded into this smaller table so there is only ONE place
// that maintains locale/synonym vocabulary (ATOMIC_SPECIALIZATION_SYNONYMS); this table only records
// which otherwise-DISTINCT ATOMIC keys are additionally equivalent to each other -- see
// specializationKindAlignedWithQuery below, which now expands a key's full alias list (including any
// group it belongs to here) directly from ATOMIC_SPECIALIZATION_SYNONYMS instead of consulting a
// separately-curated row. A side effect: alignment now automatically benefits from every locale form
// ATOMIC already has for a key, even ones an old row never got around to copying in.
//
// WHY THIS MECHANISM EXISTS: a leaf carries a specialization kind (venue/product/population/channel)
// when its canonical label or alias contains one of the LEAF_STRUCTURE_TOKENS_BY_KIND words. If the
// query doesn't use that exact same word, the leaf's specific claim looks "unsupported" by the query and
// gets penalized (hasUnsupportedSpecialization in rank-family-leaves-core.ts) even when the query names
// the identical real-world thing in different vocabulary (store vs shop, phone vs telephone). This table
// is how that penalty gets waived correctly for genuinely distinct ATOMIC keys, instead of by loosening
// the check generally. Within ONE ATOMIC key, this waiving already happens for free -- no entry needed.
//
// WHEN THIS MECHANISM APPLIES: 'venue', 'product', 'population', and 'channel' are curated this way --
// each is a small, closed vocabulary (a few dozen words, mined from real canonical-label frequency in
// data/runtime-review/occupation-search-meta.esco_1_2_1.jsonl) that can be hand-grouped with confidence.
// 'task_focus' has a much larger, open-ended vocabulary where hand-grouped rows would be guesswork;
// that kind instead draws on real per-leaf capability data (specializationKindSupportedByCapabilities
// below), not curated synonym rows. 'industry_context' already has a more accurate signal (family-label
// token inherence, see industryContextInherentToFamily in rank-family-leaves-core.ts, plus the narrow
// venue-implies-industry mapping below) and doesn't need this either.
//
// HOW A GROUP (or a new ATOMIC key/alias) EARNS ITS PLACE -- same process as before the fold:
//   1. Mine real recurrence: grep/count the candidate word's actual frequency across canonicalLabel
//      in data/runtime-review/occupation-search-meta.esco_1_2_1.jsonl. A word that never or almost never
//      recurs in real ESCO labels doesn't get a token or a group -- one-off invented vocabulary is
//      exactly the kind of guesswork this mechanism is designed to avoid.
//   2. Group only genuine synonyms for the SAME specific real-world referent, not merely related or
//      adjacent concepts. "fruit" and "vegetable" are both food products but are NOT grouped together --
//      ESCO models "fruit and vegetable specialised seller" as leaves distinguishable by exactly this
//      difference, so merging them would destroy real signal ESCO itself encodes. Compare: "hotel" and
//      "restaurant" ARE merged, because ESCO's own canonical vocabulary blurs them (see the bakery/
//      restaurant blend already inside ATOMIC_SPECIALIZATION_SYNONYMS.venue.restaurant) -- the merge
//      reflects ESCO's modeling, not a convenience shortcut.
//   3. Verify with the CLI on a real query, not just by reading the code: run
//      `node dist/cli/rank-family-leaves-v2.js --family="..." --query="..." --locale=...` and confirm
//      the intended leaf actually outranks the generic/unrelated alternatives once the change is made.
//   4. Verify with both eval variants (`npm run rank:family-leaves:eval` and `-- --with-sibling-families=3`)
//      that overall/stable/developing pass counts hold or improve -- never regress -- before keeping a
//      change. A group that "fixes" one query but breaks another synonym grouping elsewhere is not a fix.
//   5. Prefer adding a golden test (search-pipeline/golden-suite.ts, PIPELINE_DEVELOPING_GOLDEN_CASES)
//      that isolates the new group's effect specifically -- a query where the win depends on the group
//      existing, not one that already wins on an exact alias match regardless.
//
// DO NOT: add a group, or fold two existing groups together, purely to make one specific query or one
// user-reported complaint pass, without doing steps 1-4 above. A group is a claim that two ATOMIC keys
// denote the same real-world thing across ESCO's entire vocabulary, not a query-specific patch -- treat
// every addition or merge here with the same scrutiny as adding a new taxonomy fact, because a wrong
// merge silently blunders search quality for every OTHER query that happens to use either key's words.
//
// Deliberately NOT merged despite a coincidental old row pairing them: 'device'+'audio' (the old row
// was really about the narrow phrase "musical instrument", not a claim that all device words and all
// audio words are interchangeable -- promoting it to a full key merge would let e.g. 'sensor' align with
// 'radio'), and 'beverage'+'food' (an old row bridged cocoa/chocolate with confectionery, but merging the
// whole beverage and food keys would let 'coffee' align with 'meat'). Both concepts already have a
// correct home in ATOMIC_SPECIALIZATION_SYNONYMS on their own; they just don't need to be equivalent.
const SPECIALIZATION_MARKER_EQUIVALENCE_GROUPS = {
    venue: [
        ['hotel', 'restaurant'],
        ['hospital', 'clinic']
    ],
    product: [
        ['clothing', 'textile'],
        ['hardware', 'device', 'circuit', 'sensor']
    ],
    channel: [['telephone', 'call_centre']]
};
// For every ATOMIC_SPECIALIZATION_SYNONYMS key, the full set of folded tokens that count as aligned
// with a leaf marked by that key -- the key's own alias list, plus (if it belongs to a group above) the
// alias lists of every other key in that group. Computed once at module load, not per comparison.
function buildKeyAlignedTokenSets() {
    const result = {};
    for (const [kind, clusters] of Object.entries(ATOMIC_SPECIALIZATION_SYNONYMS)) {
        const groups = SPECIALIZATION_MARKER_EQUIVALENCE_GROUPS[kind] ?? [];
        const map = new Map();
        for (const key of Object.keys(clusters)) {
            const equivalenceGroup = groups.find((group) => group.includes(key)) ?? [key];
            const tokens = new Set();
            for (const groupKey of equivalenceGroup) {
                const aliases = clusters[groupKey];
                if (!aliases) {
                    throw new Error(`SPECIALIZATION_MARKER_EQUIVALENCE_GROUPS.${kind} references "${groupKey}", which is not a key in ATOMIC_SPECIALIZATION_SYNONYMS.${kind}`);
                }
                for (const alias of aliases) {
                    tokens.add(foldSearchText(alias));
                }
            }
            map.set(key, tokens);
        }
        result[kind] = map;
    }
    return result;
}
// Reverse lookup: folded token -> the ATOMIC_SPECIALIZATION_SYNONYMS key(s), per kind, whose alias list
// contains it. A token can belong to more than one key (a handful of ATOMIC entries already share a
// word, e.g. 'imbracaminte' sits in both product.clothing and product.textile) -- that pre-existing
// overlap is preserved, not deduplicated, here.
function buildMarkerKeyIndex() {
    const result = {};
    for (const [kind, clusters] of Object.entries(ATOMIC_SPECIALIZATION_SYNONYMS)) {
        const index = new Map();
        for (const [key, aliases] of Object.entries(clusters)) {
            for (const alias of aliases) {
                const folded = foldSearchText(alias);
                const keys = index.get(folded) ?? [];
                keys.push(key);
                index.set(folded, keys);
            }
        }
        result[kind] = index;
    }
    return result;
}
const SPECIALIZATION_KEY_ALIGNED_TOKENS = buildKeyAlignedTokenSets();
const SPECIALIZATION_MARKER_KEY_INDEX = buildMarkerKeyIndex();
// Canonical-label contradiction rules.
//
// These groups are intentionally narrower than ATOMIC_SPECIALIZATION_SYNONYMS and
// SPECIALIZATION_MARKER_EQUIVALENCE_GROUPS. Those say "these tokens/keys can support the same value";
// contradiction groups say "if the query names one value and the visible canonical leaf label names
// another value in this group, those values should not both describe the same leaf". ATOMIC's own
// synonym clusters are usually too broad to reuse directly as a contradiction value (e.g.
// product.hardware bundles hardware/device/circuit/sensor/microelectronics, which this file treats as
// ALIGNED, not mutually exclusive) -- the exception is pharmacy_practice_context below, where the
// venue/population concepts genuinely are ATOMIC keys already decomposed to a safe single concept.
//
// A value is `string[][]`: an AND of "anchor groups", each anchor group an OR of interchangeable
// tokens (locale spellings included -- see below). Most values need only one anchor group (a plain
// OR-list of synonyms for one concept, e.g. ['backend', 'back-end']); a second anchor group is only
// added when one word alone is ambiguous within the same slot (e.g. distinguishing "office furniture"
// from "furniture, carpets and lighting equipment" needs both ['office'] and ['furniture']).
//
// A leaf or query can legitimately match MORE THAN ONE value in the same slot (e.g. "marine
// electronics technician" matches both the marine and the electronics values below) -- that is not a
// contradiction with itself. Matching is therefore disjoint-based: two sides contradict only when
// their matched-value sets share NO value at all, not merely when some pair of matched values differs
// (see canonicalLeafSpecializationContradictionCount below). Never go back to an any-pair-differs
// check -- it flags a false contradiction the instant either side matches two values in one slot.
//
// Locale variants are written directly alongside the English tokens in the same OR-list (matching the
// existing 'aeronava'/'spital' style below), not through the LEAF_STRUCTURE_*_TOKENS_BY_LOCALE
// indirection used for boost-side matching -- the leaf side of a contradiction check is always English
// (ESCO canonical labels), only the query side needs the locale word, so one flat mixed-language list
// per value is simpler and sufficient. A locale word is added only when it unambiguously means the
// same specific value in that language; where a confident single-word translation was not available,
// the value is intentionally English-only rather than guessed -- read as coverage still to fill in.
//
// Expansion rules:
// - Use canonical leaf labels only. Do not use aliases or capabilities here; contradiction penalties
//   must be explainable from the result text callers can see.
// - Add only mutually exclusive values inside one title slot. If two values can plausibly co-exist
//   in one occupation title, do not put them in the same contradiction group.
// - Keep each synonym cluster small and concrete. Prefer adding a new group over broadening an
//   existing one when a term has multiple senses.
// - Add locale variants only after checking they preserve the same mutually-exclusive meaning.
// - Add a structural test for every new conflict group. These penalties are deliberately stronger
//   than unsupportedSpecialization, so an unsafe group can suppress correct leaves.
//
// HOW TO ADD COVERAGE FOR ANOTHER FAMILY (there are ~125 seeded families total; this file currently
// covers a handful -- software_surface, vehicle_powertrain_or_type, pharmacy_practice_context,
// trade_goods_domain, technician_industry_domain, software_development_domain,
// customer_service_channel_domain). Repeat this recipe per family (or per small cluster of related
// families) rather than trying to do all 125 in one pass:
//
// 1. Pull the REAL sibling leaves for the family(ies) you're targeting out of
//    data/runtime-review/occupation-leaf-structure.esco_1_2_1.json (the `records` array, filtered by
//    `familyNodeId`; `seededFamilies` at the top of that file only lists a subset -- the authoritative
//    set of family ids in use is whatever `familyNodeId` values actually appear across `records`).
//    Never invent plausible-sounding values from general knowledge of the occupation -- ESCO's own
//    wording and its specific enumerated splits are the only ground truth, and a value that isn't
//    grounded in an actual sibling leaf risks penalizing a correct match instead of a wrong one.
// 2. Read the leaf labels looking for a repeated "same head, different modifier" pattern -- e.g.
//    "wholesale merchant in X" / "import export specialist in X" (a shared role head enumerated once
//    per goods domain), or "X developer" / "X technician" (a shared role head enumerated once per
//    platform/industry). That repeated modifier slot is your new specialization dimension. A family
//    with no such repeated pattern (each leaf is a genuinely distinct role, not a domain/channel split
//    of one role) is not a good candidate for this mechanism -- skip it.
// 3. Decide the SLOT name (a short snake_case label for the dimension, e.g. 'trade_goods_domain') and
//    write one `contradictionValue(...)` per distinct value found in step 2, decomposed to the finest
//    safe single concept per the Expansion rules above. Put the new array as its own top-level
//    `const ..._VALUES: string[][][] = [...]` near the other domain arrays (not inline in the groups
//    array below), and add a doc comment above it citing the family id(s) and the specific ESCO leaf
//    labels that justify each new value, mirroring the trade-goods/technician/software-development
//    comments already here -- that citation is what lets a future pass tell "grounded in data" apart
//    from "guessed."
// 4. Register it by adding `{ slot: '<your_slot>', values: YOUR_VALUES }` to
//    LEAF_CANONICAL_SPECIALIZATION_CONTRADICTION_GROUPS below. Nothing else needs to change --
//    buildSpecializationDimensionProfile iterates that array generically, so a new slot is picked up
//    automatically by both the leaf and query profile builders.
// 5. Watch for these two concrete mistakes made (and caught) while building the slots already in this
//    file:
//    - `contradictionValue` ANDs every anchor group you pass it (hasAny per group, all groups must
//      match). Only pass multiple groups for a genuine COMPOUND concept where all words must co-occur
//      (e.g. `contradictionValue(['office'], ['machinery'])` for "office machinery", distinct from
//      plain "office"). Do NOT use multiple groups to try to OR together two unrelated phrasings of
//      the same concept (e.g. "database" vs "baza de date") -- that silently requires BOTH phrasings'
//      words at once and breaks the plain single-word case. For "same concept, multiple surface
//      forms", use one flat OR-list group instead: `contradictionValue(['helpdesk', 'desk'])`.
//    - Do not add a value for a word that recurs across nearly every leaf in the family (see the
//      TECHNICIAN_INDUSTRY_DOMAIN_VALUES comment's exclusion list: process, production, quality,
//      industrial, systems, engineering, equipment, maintenance, manufacturing). A value that fires on
//      almost every leaf stops discriminating and just adds contradiction noise.
// 6. Add a structural test per new value/slot in tests/structural/leaf-specialization-support-v2.test.ts
//    following the existing pattern: one contradiction case (two leaves asserting different values from
//    the new slot) and, where the family has a real pair that shares a value, one alignment case
//    (asserting `alignedSpecializationValue === 5`). Use a fresh graphNodeId not already used elsewhere
//    in that test file.
// 7. Re-run `npx tsc --noEmit -p .`, `npm run build`, `npm run build:tests`, and
//    `node --test dist/tests/structural/leaf-specialization-support-v2.test.js` (plus the v1
//    leaf-specialization-support.test.js / rank-family-leaves-core.test.js suites, to confirm the v1
//    file you did not touch is still unaffected) before considering the new family covered.
//
// Separately, level-band contradictions (LEAF_LEVEL_CONTRADICTION_GROUPS, below) are a different,
// family-independent mechanism -- extending them means adding another `[levelA, levelB]` pair to that
// array, not a new slot here, and only for level pairs not already implicitly handled by
// levelMatchScore's UNREQUESTED_AUTHORITY_LEVEL_PENALTY (rank-family-leaves-core.ts) -- check that
// function first so a new pair does not duplicate an existing penalty path.
function contradictionValue(...anchorGroups) {
    return anchorGroups;
}
// The ESCO wholesale merchant / distribution manager / import export manager / import export
// specialist / technical sales representative / specialised seller / rental service representative
// families each enumerate the SAME closed vocabulary of traded goods/service domains as one sibling
// leaf per domain -- see data/runtime-review/occupation-leaf-structure.esco_1_2_1.json family ids
// 14690, 14903, 14796, 14908, 15021 and 15027. A query naming one domain ("chemical products") should
// not let a sibling naming a different domain ("textile machinery") win on generic role-word overlap
// alone. Values are deliberately single-concept and decomposed to the finest safe granularity (e.g.
// 'clothing' and 'footwear' stay separate values even though one ESCO leaf ("clothing and footwear
// distribution manager") legitimately carries both -- the disjoint-based check above handles that leaf
// matching two values safely, and staying decomposed lets the two ALSO be told apart where ESCO models
// them as separate sibling leaves, as in the specialised-seller family).
const TRADE_GOODS_DOMAIN_VALUES = [
    contradictionValue(['agricultural'], ['machinery']),
    contradictionValue(['agricultural'], ['seeds', 'feeds']),
    contradictionValue(['beverage', 'bautura', 'ital']),
    contradictionValue(['chemical', 'chimic', 'vegyi', 'keemiline']),
    contradictionValue(['china', 'glassware', 'sticlarie']),
    contradictionValue(['clothing', 'imbracaminte', 'ruha', 'roivas']),
    contradictionValue(['footwear', 'shoe', 'shoes', 'incaltaminte', 'cipo', 'jalats']),
    contradictionValue(['coffee', 'tea', 'cocoa', 'spice', 'spices', 'cafea', 'cacao']),
    contradictionValue(['computer', 'calculator', 'szamitogep', 'arvuti']),
    contradictionValue(['software', 'szoftver', 'tarkvara']),
    contradictionValue(['dairy', 'lactate', 'tejtermek', 'piimatoode']),
    contradictionValue(['oil']),
    contradictionValue(['appliance', 'electrocasnice']),
    contradictionValue(['electronic'], ['telecommunications', 'telecom']),
    contradictionValue(['fish', 'crustacean', 'mollusc', 'seafood', 'peste']),
    contradictionValue(['flower', 'flowers', 'plant', 'plants', 'floare', 'virag', 'lill']),
    contradictionValue(['fruit', 'vegetable', 'fructe', 'legume', 'zoldseg', 'puuvili']),
    contradictionValue(['furniture'], ['carpet', 'lighting']),
    contradictionValue(['office'], ['furniture']),
    contradictionValue(['hardware'], ['plumbing'], ['heating']),
    contradictionValue(['hide', 'hides', 'skin', 'skins', 'leather', 'piele', 'bor', 'nahk']),
    contradictionValue(['household']),
    contradictionValue(['animal', 'animale', 'allat', 'loom']),
    contradictionValue(['machine'], ['tool', 'tools']),
    contradictionValue(['industrial'], ['machinery']),
    contradictionValue(['ship', 'aircraft'], ['machinery']),
    contradictionValue(['meat', 'carne', 'hus', 'liha']),
    contradictionValue(['metal', 'metals', 'ore', 'ores', 'metale', 'fem', 'metall']),
    contradictionValue(['mining'], ['construction', 'civil']),
    contradictionValue(['perfume', 'cosmetic', 'cosmetics', 'parfum', 'cosmetice']),
    contradictionValue(['pharmaceutical', 'farmaceutic', 'gyogyszereszeti', 'farmaatsia']),
    contradictionValue(['sugar', 'chocolate', 'confectionery', 'zahar', 'ciocolata', 'dulciuri']),
    contradictionValue(['textile', 'textiles', 'textila', 'textil', 'tekstiil']),
    contradictionValue(['textile'], ['machinery']),
    contradictionValue(['tobacco', 'tutun', 'dohany', 'tubakas']),
    contradictionValue(['waste', 'scrap', 'deseuri', 'hulladek', 'jaatmed']),
    contradictionValue(['watch', 'watches', 'jewellery', 'ceas', 'bijuterii']),
    contradictionValue(['wood', 'lemn', 'fa', 'puit']),
    contradictionValue(['ammunition']),
    contradictionValue(['antique', 'antiques']),
    contradictionValue(['bakery', 'brutarie', 'pekseg', 'pagari']),
    contradictionValue(['bookshop', 'book', 'books']),
    contradictionValue(['building'], ['material', 'materials']),
    contradictionValue(['delicatessen']),
    contradictionValue(['eyewear', 'optical']),
    contradictionValue(['floor', 'wall'], ['covering']),
    contradictionValue(['medical']),
    contradictionValue(['motor'], ['vehicle', 'vehicles']),
    contradictionValue(['car', 'cars', 'auto']),
    contradictionValue(['orthopaedic']),
    contradictionValue(['paint']),
    contradictionValue(['pet']),
    contradictionValue(['press', 'stationery']),
    contradictionValue(['sporting', 'sports', 'recreational']),
    contradictionValue(['truck', 'trucks']),
    contradictionValue(['disk', 'disks', 'video', 'audio']),
    contradictionValue(['air'], ['transport']),
    contradictionValue(['water'], ['transport']),
    contradictionValue(['ict']),
    contradictionValue(['renewable', 'solar', 'regenerabil', 'megujulo', 'taastuv']),
    contradictionValue(['fuel']),
    // Added from a full pass over the real ESCO leaves in families 14903 (Sales and purchasing agents
    // and brokers), 14908 (Business services agents), 15021 (Shop salespersons) and 15027 (Other sales
    // workers) -- see Current Work notes: these are goods domains that appear on real sibling leaves
    // ("wholesale merchant in office machinery and equipment", "toys and games specialised seller",
    // "computer games, multimedia and software specialised seller", "second-hand goods specialised
    // seller", "audiology equipment specialised seller", "electricity sales representative") but had no
    // matching value above -- office/furniture (existing, 'office furniture') is distinct from
    // office/machinery ('office machinery and equipment'), so this is a new value, not a broadened one.
    contradictionValue(['office'], ['machinery']),
    contradictionValue(['toy', 'toys', 'jucarie', 'jucarii']),
    contradictionValue(['multimedia']),
    contradictionValue(['second'], ['hand']),
    contradictionValue(['audiology']),
    contradictionValue(['electricity', 'electricitate', 'villamos'])
];
// The ESCO engineering technician / machinery technician / electronics-and-communications technician
// families (see family ids 14842, 15114, 15139) each place one sibling leaf per industry the
// technician specializes in. Values below are decomposed into the smallest safe single concept, and
// deliberately DO NOT include the generic connector words already excluded from
// LEAF_STRUCTURE_INDUSTRY_CONTEXT_TOKENS/TASK_FOCUS for being too broad to be a specialization
// (process, production, quality, industrial, systems, engineering, equipment, maintenance,
// manufacturing) -- those recur across nearly every technician leaf and would make this slot fire on
// almost every comparison instead of only on genuine industry differences.
const TECHNICIAN_INDUSTRY_DOMAIN_VALUES = [
    contradictionValue(['aerospace', 'aircraft', 'aviation', 'avionics', 'flight', 'aeronava', 'aviatie', 'repuloter', 'lennundus']),
    contradictionValue(['automotive', 'motor', 'car', 'cars', 'diesel', 'auto', 'masina', 'gepjarmu', 'autonduse']),
    contradictionValue(['bicycle', 'cycle']),
    contradictionValue(['marine', 'vessel', 'ship', 'naval', 'maritim', 'hajo', 'laev']),
    contradictionValue(['rail', 'railway', 'tramway', 'tramways', 'rolling', 'feroviar', 'vasuti', 'raudtee']),
    contradictionValue(['construction', 'civil', 'constructii', 'epito', 'ehitus']),
    contradictionValue(['mining', 'mine', 'quarry', 'minerit', 'banyaszat', 'kaevandus']),
    contradictionValue(['agricultural', 'agriculture', 'agricol', 'mezogazdasagi', 'pollumajandus']),
    contradictionValue(['forestry', 'forest', 'forestier', 'erdeszeti', 'metsandus']),
    contradictionValue(['fisheries', 'fishery', 'aquaculture', 'fish', 'pescuit', 'acvacultura', 'akvakultuur']),
    contradictionValue(['chemical', 'chemistry', 'chimic', 'vegyi', 'keemiline']),
    contradictionValue(['textile', 'textiles', 'weaving', 'knitting', 'braiding', 'nonwoven', 'textila', 'tekstiil']),
    contradictionValue(['leather', 'tanning', 'piele', 'bor', 'nahk']),
    contradictionValue(['footwear', 'shoe', 'shoes', 'incaltaminte', 'cipo', 'jalats']),
    contradictionValue(['food', 'dairy', 'meat', 'beverage', 'alimentar', 'elelmiszer', 'toiduaine']),
    contradictionValue(['electrical', 'electric', 'electrica', 'villamos', 'elektri']),
    contradictionValue(['electronics', 'electronic', 'electronica', 'elektronika', 'elektroonika']),
    contradictionValue(['telecommunications', 'telecom', 'radio', 'fibre', 'telecomunicatii', 'tavkozles']),
    contradictionValue(['microelectronics', 'microsystem']),
    contradictionValue(['optical', 'optoelectronic', 'photonics', 'optomechanical', 'optic', 'optikai', 'optiline']),
    contradictionValue(['electromechanical', 'electromecanic', 'elektromechanikai']),
    contradictionValue(['mechatronics', 'mecatronica', 'mechatronika', 'mehhatroonika']),
    contradictionValue(['instrumentation', 'instrument']),
    contradictionValue(['sensor']),
    contradictionValue(['robotics', 'robot', 'robotica', 'robotika', 'robootika']),
    contradictionValue(['automation', 'automated', 'automatizare', 'automatizalt', 'automatiseeritud']),
    contradictionValue(['metallurgical', 'metal', 'metals', 'metalurgic', 'kohaszati']),
    contradictionValue(['geology', 'geological', 'geotechnician', 'soil', 'geologie', 'geologiai', 'geoloogia']),
    contradictionValue(['surveying', 'survey', 'hydrographic', 'topografic']),
    contradictionValue(['meteorology', 'meteorological']),
    contradictionValue(['metrology', 'calibration', 'metrologie']),
    contradictionValue(['nuclear', 'nuclear', 'nuklearis', 'tuuma']),
    contradictionValue(['radiation']),
    contradictionValue(['water', 'sewerage', 'desalination', 'hydropower', 'apa', 'viz', 'vesi']),
    contradictionValue(['energy', 'renewable', 'solar', 'wind', 'geothermal', 'biogas', 'offshore', 'energie', 'energia']),
    contradictionValue(['medical', 'dental', 'veterinary', 'medical', 'orvosi', 'meditsiiniline']),
    contradictionValue(['heating', 'ventilation', 'refrigeration', 'hvac', 'incalzire', 'futes', 'kute']),
    contradictionValue(['pneumatic']),
    contradictionValue(['fluid']),
    contradictionValue(['welding', 'welder', 'sudura', 'hegesztes', 'keevitus']),
    contradictionValue(['fire']),
    contradictionValue(['corrosion']),
    contradictionValue(['hazardous', 'waste']),
    contradictionValue(['crane']),
    contradictionValue(['forge']),
    contradictionValue(['moulding', 'molding']),
    contradictionValue(['rotating']),
    contradictionValue(['printing', '3d']),
    contradictionValue(['atm']),
    contradictionValue(['mobile', 'phone']),
    contradictionValue(['security', 'alarm']),
    contradictionValue(['smart']),
    // Added from a full pass over the real ESCO leaves in family 15135 (Electrical equipment installers
    // and repairers) -- "building electrician", "domestic electrician", "household appliances repair
    // technician", "lift technician" / "ski lift operator" had no matching value above. 'building' is
    // kept as its own value rather than folded into the construction/civil value above: a building
    // electrician (wires buildings) and a construction equipment technician (repairs excavators/
    // bulldozers) are different specializations that happen to share an industry-adjacent English word.
    // Deliberately NOT adding a bare 'industrial' value -- see the comment above this array; it recurs
    // across too many technician leaves to be a safe single-concept discriminator.
    contradictionValue(['building', 'cladire', 'epulet']),
    contradictionValue(['domestic', 'residential', 'hazi']),
    contradictionValue(['lift', 'elevator', 'escalator']),
    contradictionValue(['household', 'appliance', 'appliances'])
];
// Added from a full pass over the real ESCO leaves in families 14802 (ICT operations technicians /
// systems administrators), 14808 (Software developers and analysts) and 14942 (Web and multimedia
// developers, database/network professionals) -- these are the platform/domain splits that recur as
// real sibling leaves ("web developer", "mobile application developer", "cloud", "embedded systems
// designer", "games developer", "devops", "database designer", "network engineer", "ICT security
// specialist", "test", "UX designer", "ICT help desk agent"). Values are kept EN-first because these
// are modern loanword-heavy terms used as-is in RO/HU/ET job titles; a locale variant is only added
// where an established, unambiguous single-word translation exists -- e.g. bare RO 'date' or HU 'adat'
// ("data") were deliberately rejected as too generically risky (they collide with unrelated "data
// entry"/office-clerk leaves outside this family).
const SOFTWARE_DEVELOPMENT_DOMAIN_VALUES = [
    contradictionValue(['web']),
    contradictionValue(['mobile', 'android', 'ios']),
    contradictionValue(['desktop']),
    contradictionValue(['cloud']),
    contradictionValue(['embedded', 'firmware']),
    contradictionValue(['blockchain']),
    contradictionValue(['game', 'games']),
    contradictionValue(['iot']),
    // Bare 'ai' is deliberately excluded as its own anchor: a 2-letter token is too collision-prone
    // (folded conjugations, OCR noise) to trust without a companion word, so this only fires on the
    // full "artificial intelligence" phrase.
    contradictionValue(['artificial'], ['intelligence']),
    contradictionValue(['machine'], ['learning']),
    contradictionValue(['vision']),
    contradictionValue(['multimedia', 'animation']),
    // 'database' is single-group (not compounded with a RO/HU companion): RO/HU render this as the
    // two-word phrase "bază de date" / "adatbazis" is one word in HU actually -- adatbazis is added
    // directly as a confident single-word translation, while bare RO 'baza' is skipped since it is
    // ambiguous alone (means "base") and the compound "bază de date" cannot be expressed as a safe
    // single anchor group without an AND that would also block the plain English word from matching.
    contradictionValue(['database', 'adatbazis']),
    contradictionValue(['network', 'retea', 'halozat', 'vork']),
    contradictionValue(['security', 'securitate', 'biztonsag', 'turvalisus']),
    contradictionValue(['testing', 'test', 'qa']),
    contradictionValue(['ux', 'usability']),
    // 'helpdesk' (one word) and 'help desk' (two words) both need to match without requiring the other
    // half, so this is a flat OR list rather than an AND-compound.
    contradictionValue(['helpdesk', 'desk']),
    contradictionValue(['support']),
    contradictionValue(['seo']),
    contradictionValue(['devops'])
];
// Added from a full pass over the real ESCO leaves in family 14965 (Client information workers /
// customer contact and reception roles) and 15027 (Other sales workers, "call centre agent"): these
// leaves are siblings that differ mainly by CONTACT CHANNEL rather than goods domain or industry --
// "live chat operator", "telephone switchboard operator", "customer contact centre information
// clerk", "hotel concierge"/"receptionist", "travel agent"/"tourist information officer", "ticket
// sales agent"/"railway sales agent". Kept as its own slot (not folded into trade_goods_domain or
// technician_industry_domain) because the underlying concept is "how the customer is reached", not a
// product or an engineering industry.
const CUSTOMER_SERVICE_CHANNEL_DOMAIN_VALUES = [
    contradictionValue(['chat']),
    contradictionValue(['telephone', 'switchboard', 'telefon']),
    contradictionValue(['reception', 'receptionist', 'concierge', 'receptie', 'recepcio']),
    contradictionValue(['travel', 'tourist', 'tourism', 'calatorie', 'turism', 'utazas']),
    contradictionValue(['ticket', 'tickets', 'bilet', 'bilete', 'jegy'])
];
const LEAF_CANONICAL_SPECIALIZATION_CONTRADICTION_GROUPS = [
    {
        slot: 'software_surface',
        values: [contradictionValue(['backend', 'back-end']), contradictionValue(['frontend', 'front-end'])]
    },
    {
        slot: 'vehicle_powertrain_or_type',
        values: [contradictionValue(['electric', 'ev', 'electric_vehicle']), contradictionValue(['motorcycle', 'moto'])]
    },
    {
        slot: 'pharmacy_practice_context',
        // Reused directly from ATOMIC_SPECIALIZATION_SYNONYMS rather than hand-copied: both concepts here
        // are already decomposed to one safe single concept in ATOMIC (unlike e.g. product.hardware, which
        // bundles several), so hand-maintaining a second, slightly-out-of-sync copy of the same alias list
        // added no value -- it only had 4-5 locale forms where ATOMIC already carries the fuller list.
        values: [
            contradictionValue(ATOMIC_SPECIALIZATION_SYNONYMS.venue.hospital),
            contradictionValue(ATOMIC_SPECIALIZATION_SYNONYMS.population.community)
        ]
    },
    {
        slot: 'trade_goods_domain',
        values: TRADE_GOODS_DOMAIN_VALUES
    },
    {
        slot: 'technician_industry_domain',
        values: TECHNICIAN_INDUSTRY_DOMAIN_VALUES
    },
    {
        slot: 'software_development_domain',
        values: SOFTWARE_DEVELOPMENT_DOMAIN_VALUES
    },
    {
        slot: 'customer_service_channel_domain',
        values: CUSTOMER_SERVICE_CHANNEL_DOMAIN_VALUES
    }
];
const FOLDED_CANONICAL_SPECIALIZATION_CONTRADICTION_GROUPS = LEAF_CANONICAL_SPECIALIZATION_CONTRADICTION_GROUPS.map((group) => ({
    slot: group.slot,
    values: group.values.map((value) => value.map((anchorGroup) => new Set(anchorGroup.map((token) => foldSearchText(token)))))
}));
// const LEAF_STRUCTURE_TOKENS_BY_KIND: Record<LeafSpecializationKind, Set<string>> = {
//   venue: LEAF_STRUCTURE_VENUE_TOKENS,
//   channel: LEAF_STRUCTURE_CHANNEL_TOKENS,
//   product: LEAF_STRUCTURE_PRODUCT_TOKENS,
//   population: LEAF_STRUCTURE_POPULATION_TOKENS,
//   task_focus: LEAF_STRUCTURE_TASK_FOCUS_TOKENS,
//   industry_context: LEAF_STRUCTURE_INDUSTRY_CONTEXT_TOKENS
// };
function leafMarkerTokensForKind(kind, tokens) {
    const tokenSet = LEAF_STRUCTURE_TOKENS_BY_KIND[kind];
    return Array.from(tokens).filter((token) => matchesTokenOrPlural(token, tokenSet));
}
// Level contradictions are separate from specialization contradictions because level words describe
// seniority/authority rather than ESCO venue/product/channel context. Keep this list conservative:
// "assistant manager" and "lead developer" style titles make broad level incompatibility risky.
//
// The 'manager' groups below are a distinct, non-duplicate mechanism from levelMatchScore's
// UNREQUESTED_AUTHORITY_LEVEL_PENALTY (rank-family-leaves-core.ts): that penalty only fires when the
// QUERY specifies no level at all (queryLevelKind === 'none') and the leaf is manager/director/chief --
// it never looks at an explicit query level. An explicit mismatch, e.g. query says "junior" and the
// leaf is "manager", previously fell through levelMatchScore's switch to a silent 0 (scored identically
// to "no opinion"), and leafLevelKindsContradict only covered junior/senior. Added 'assistant'/'manager'
// and 'junior'/'manager' as the highest-impact explicit-level contradiction gap: an assistant- or
// junior-level query should not surface a management-level leaf as an equally good match.
const LEAF_LEVEL_CONTRADICTION_GROUPS = [
    ['assistant', 'manager'],
    ['junior', 'manager']
];
// if both leaf and query exists in the pair above then they contradict makes sesne
export function leafLevelKindsContradict(queryLevelKind, leafLevelKind) {
    if (queryLevelKind === 'none' || leafLevelKind === 'none' || queryLevelKind === leafLevelKind) {
        return false;
    }
    return LEAF_LEVEL_CONTRADICTION_GROUPS.some((group) => group.includes(queryLevelKind) && group.includes(leafLevelKind));
}
export function buildSpecializationDimensionProfile(tokens) {
    const profile = new Map();
    for (const group of FOLDED_CANONICAL_SPECIALIZATION_CONTRADICTION_GROUPS) {
        const matchedValueIndexes = matchingContradictionValueIndexes(tokens, group.values);
        if (matchedValueIndexes.length > 0) {
            profile.set(group.slot, matchedValueIndexes);
        }
    }
    return profile;
}
export function leafSpecializationDimensionProfile(canonicalTokens) {
    return buildSpecializationDimensionProfile(canonicalTokens);
}
export function querySpecializationDimensionProfile(preparedQuery) {
    return buildSpecializationDimensionProfile(preparedQueryStructuralTokenSet(preparedQuery));
}
// Diffs a leaf profile against a query profile dimension by dimension and classifies every dimension
// where at least one side has an opinion into one of four cases:
// - leaf silent, query silent      -> not counted (neutral; nothing to compare)
// - leaf silent, query has a value -> not counted (the query is more specific than the leaf; that is
//   unsupportedSpecialization's job elsewhere, not this dimension machinery's)
// - leaf has a value, query silent -> counted as unsupportedSpecificity (the leaf is more specific than
//   the query asked for -- distinct from a genuine contradiction, tracked so callers can decide whether
//   to weight it, currently scored 0 to preserve existing ranking behavior)
// - both have a value              -> alignment if they share at least one index (query says frontend,
//   leaf says frontend: reward it explicitly instead of scoring the same as "leaf has no opinion"),
//   otherwise contradiction (disjoint-set check, not an any-pair-differs check, so a leaf legitimately
//   matching two values in one dimension -- e.g. "marine electronics technician" -- isn't falsely
//   flagged the instant its second value doesn't happen to be the one word the query used)
export function compareSpecializationDimensionProfiles(leafProfile, queryProfile) {
    let contradictionCount = 0;
    let alignmentCount = 0;
    let unsupportedSpecificityCount = 0;
    for (const [slot, leafValueIndexes] of leafProfile) {
        const queryValueIndexes = queryProfile.get(slot);
        if (!queryValueIndexes) {
            unsupportedSpecificityCount += 1;
            continue;
        }
        if (leafValueIndexes.some((leafIndex) => queryValueIndexes.includes(leafIndex))) {
            alignmentCount += 1;
        }
        else {
            contradictionCount += 1;
        }
    }
    return { contradictionCount, alignmentCount, unsupportedSpecificityCount };
}
export function canonicalLeafSpecializationSlotComparison(canonicalTokens, preparedQuery) {
    const leafProfile = leafSpecializationDimensionProfile(canonicalTokens);
    const queryProfile = querySpecializationDimensionProfile(preparedQuery);
    const { contradictionCount, alignmentCount } = compareSpecializationDimensionProfiles(leafProfile, queryProfile);
    return { contradictionCount, alignmentCount };
}
export function canonicalLeafSpecializationContradictionCount(canonicalTokens, preparedQuery) {
    return canonicalLeafSpecializationSlotComparison(canonicalTokens, preparedQuery).contradictionCount;
}
function matchingContradictionValueIndexes(tokens, values) {
    const indexes = [];
    values.forEach((anchorGroups, index) => {
        if (anchorGroups.every((anchorTokens) => hasAny(tokens, anchorTokens))) {
            indexes.push(index);
        }
    });
    return indexes;
}
// True when a leaf's specific specialization marker (e.g. "shop") and a query token (e.g. "store")
// resolve to the same ATOMIC_SPECIALIZATION_SYNONYMS key (or two keys in the same
// SPECIALIZATION_MARKER_EQUIVALENCE_GROUPS group) -- i.e. the query names the same specific venue/etc.
// using different vocabulary, so the leaf should not be penalized for "not matching" a value it
// actually does match.
export function specializationKindAlignedWithQuery(kind, canonicalTokens, preparedQuery) {
    const keyIndex = SPECIALIZATION_MARKER_KEY_INDEX[kind];
    const alignedTokensByKey = SPECIALIZATION_KEY_ALIGNED_TOKENS[kind];
    const markerTokens = leafMarkerTokensForKind(kind, canonicalTokens);
    if (markerTokens.length === 0) {
        return false;
    }
    const structuralTokens = kind === 'venue'
        ? new Set([...preparedQuery.intent.venueTokens, ...preparedQuery.intent.domainTokens].map((token) => foldSearchText(token)))
        : preparedQueryStructuralTokenSet(preparedQuery);
    return markerTokens.some((marker) => {
        const keys = keyIndex.get(foldSearchText(marker)) ?? [];
        return keys.some((key) => {
            const alignedTokens = alignedTokensByKey.get(key);
            return alignedTokens !== undefined && Array.from(structuralTokens).some((token) => matchesTokenOrPlural(token, alignedTokens));
        });
    });
}
// A query naming a specific venue often implies a specific industry without saying the industry word
// itself -- "clinic receptionist" names the medical industry via "clinic", not via "medical". This maps
// a handful of common, unambiguous venue words (across en/ro/hu) to the industry_context token(s) they
// imply, so a leaf like "front line medical receptionist" isn't penalized just because the query said
// the venue instead of the industry. Deliberately small and conservative -- industry_context's own
// detection/family-inherence check (industryContextInherentToFamily in rank-family-leaves-core.ts)
// stays untouched; this only adds one more way for a leaf's industry_context claim to be considered
// query-supported.
const VENUE_IMPLIES_INDUSTRY_CONTEXT = {
    clinic: ['medical'],
    hospital: ['medical'],
    spital: ['medical'],
    pharmacy: ['medical'],
    farmacie: ['medical'],
    school: ['ict', 'business'],
    scoala: ['ict', 'business'],
    airport: ['aviation'],
    aeroport: ['aviation'],
    bank: ['business'],
    banca: ['business'],
    mine: ['mining'],
    mina: ['mining'],
    factory: ['manufacturing'],
    plant: ['manufacturing'],
    fabrica: ['manufacturing'],
    ship: ['aviation'] // Maritime / Transport context
};
export function specializationKindImpliedByQueryVenue(kind, canonicalTokens, preparedQuery) {
    if (kind !== 'industry_context') {
        return false;
    }
    const markerTokens = leafMarkerTokensForKind(kind, canonicalTokens);
    if (markerTokens.length === 0) {
        return false;
    }
    const structuralTokens = preparedQueryStructuralTokenSet(preparedQuery);
    return Array.from(structuralTokens).some((token) => {
        const impliedIndustries = Object.hasOwn(VENUE_IMPLIES_INDUSTRY_CONTEXT, token) ? VENUE_IMPLIES_INDUSTRY_CONTEXT[token] : undefined;
        if (!impliedIndustries) {
            return false;
        }
        return markerTokens.some((marker) => impliedIndustries.some((industry) => ATOMIC_SPECIALIZATION_SYNONYMS.industry_context[industry]?.includes(marker)));
    });
}
// task_focus vocabulary is too large and open-ended to hand-group into equivalence groups the way
// venue was (see SPECIALIZATION_MARKER_EQUIVALENCE_GROUPS above) -- curated groups there would be
// guesswork. Real per-leaf ESCO skill/knowledge data (searchMetaArtifact.getCapabilityLabels) already
// carries this locale-by-locale for free, so instead of guessing synonyms, this checks whether the
// query's own words actually appear in what the leaf's real capability text says it does -- a leaf
// whose skills genuinely mention the query's task is legitimately supported, not exempted by hunch.
export function specializationKindSupportedByCapabilities(kind, preparedQuery, capabilityLabels) {
    if ((kind !== 'task_focus' && kind !== 'industry_context') || capabilityLabels.length === 0) {
        return false;
    }
    const locale = preparedQuery.locale;
    const relevantLabels = capabilityLabels.filter((capability) => capability.localeCode === locale || capability.localeCode === 'en');
    const capabilityTokens = new Set(relevantLabels.flatMap((capability) => tokenizeNormalizedText(foldSearchText(capability.normalizedLabel || capability.label))));
    if (capabilityTokens.size === 0) {
        return false;
    }
    const queryTokens = preparedQueryStructuralTokenSet(preparedQuery);
    if (kind === 'industry_context') {
        const impliedIndustryTokens = queryImpliedIndustryContextTokens(queryTokens);
        return (Array.from(queryTokens).some((token) => capabilityTokens.has(token) && LEAF_STRUCTURE_TOKENS_BY_KIND.industry_context.has(token)) ||
            Array.from(impliedIndustryTokens).some((token) => capabilityTokens.has(token)));
    }
    return Array.from(queryTokens).some((token) => capabilityTokens.has(token));
}
function queryImpliedIndustryContextTokens(queryTokens) {
    const tokens = new Set();
    for (const token of queryTokens) {
        const impliedIndustries = Object.hasOwn(VENUE_IMPLIES_INDUSTRY_CONTEXT, token) ? VENUE_IMPLIES_INDUSTRY_CONTEXT[token] : undefined;
        if (!impliedIndustries) {
            continue;
        }
        for (const industry of impliedIndustries) {
            for (const alias of ATOMIC_SPECIALIZATION_SYNONYMS.industry_context[industry] ?? []) {
                tokens.add(foldSearchText(alias));
            }
        }
    }
    return tokens;
}
function structuralTokensForLocale(base, byLocale, locale) {
    const localeTokens = byLocale[locale];
    if (!localeTokens || localeTokens.size === 0) {
        return base;
    }
    return new Set([...base, ...localeTokens]);
}
export function detectLeafAuthorityKind(tokens) {
    for (const entry of LEAF_STRUCTURE_AUTHORITY_ORDER) {
        if (tokens.includes(entry.token)) {
            return entry.kind;
        }
    }
    return 'none';
}
export function detectLeafSpecializationKinds(tokens) {
    const kinds = new Set();
    for (const [kind, tokenSet] of Object.entries(LEAF_STRUCTURE_TOKENS_BY_KIND)) {
        if (hasAny(tokens, tokenSet)) {
            kinds.add(kind);
        }
    }
    return Array.from(kinds).sort();
}
export function detectLeafLevelKind(tokens) {
    for (let index = LEAF_LEVEL_KINDS.length - 1; index > 0; index -= 1) {
        const kind = LEAF_LEVEL_KINDS[index];
        if (kind && tokensContainLevelKind(tokens, kind)) {
            return kind;
        }
    }
    return 'none';
}
// A leaf's authored specializationKinds can legitimately be empty (verified: none apply) or
// unclassified (never authored). Both look identical as `[]`. The cache disambiguates by remembering,
// per graphNodeId, whether we've already derived a value for an unclassified leaf this run: `Map.has()`
// false means "not yet computed," a cached `[]` means "computed, genuinely none derivable."
export function resolveLeafSpecializationKindsFromTokens(cache, graphNodeId, structure, tokens) {
    if (structure && structure.specializationKinds.length > 0) {
        return structure.specializationKinds;
    }
    const cached = cache.get(graphNodeId);
    if (cached !== undefined) {
        return cached;
    }
    const derived = detectLeafSpecializationKinds(tokens);
    cache.set(graphNodeId, derived);
    return derived;
}
export function resolveLeafSpecializationKinds(cache, graphNodeId, structure, canonicalLabel) {
    return resolveLeafSpecializationKindsFromTokens(cache, graphNodeId, structure, canonicalTokenSet(canonicalLabel));
}
// Folded once at module load -- LEVEL_SPECIALIZATION_SYNONYMS entries are static strings, so
// re-folding each one on every detectLeafLevelKind call (once per leaf, per query) was pure waste.
const FOLDED_LEVEL_SPECIALIZATION_SYNONYMS = Object.fromEntries(Object.entries(LEVEL_SPECIALIZATION_SYNONYMS).map(([kind, aliases]) => [kind, new Set(aliases.map((alias) => foldSearchText(alias)))]));
function tokensContainLevelKind(tokens, kind) {
    const foldedAliases = FOLDED_LEVEL_SPECIALIZATION_SYNONYMS[kind];
    for (const token of tokens) {
        if (foldedAliases.has(token)) {
            return true;
        }
    }
    return false;
}
export function preparedQueryStructuralTokenSet(preparedQuery) {
    return new Set([
        ...preparedQuery.usefulFoldedRecallTokens,
        ...preparedQuery.intent.roleTokens,
        ...preparedQuery.intent.roleHeadTokens,
        ...preparedQuery.intent.domainTokens,
        ...preparedQuery.intent.venueTokens
    ].map((token) => foldSearchText(token)));
}
export function preparedQueryRequestsAuthority(preparedQuery, authorityKind) {
    if (authorityKind === 'none') {
        return true;
    }
    const tokens = preparedQueryStructuralTokenSet(preparedQuery);
    return Array.from(tokens).includes(authorityKind);
}
// export function preparedQuerySupportsSpecializationKind(preparedQuery: PreparedQuery, kind: LeafSpecializationKind): boolean {
//   const structuralTokens = preparedQueryStructuralTokenSet(preparedQuery);
//   const locale = preparedQuery.locale;
//   if (kind === 'venue') {
//     return (
//       preparedQuery.intent.venueTokens.length > 0 ||
//       preparedQuery.intent.domainTokens.length > 0 ||
//       hasAny(structuralTokens, structuralTokensForLocale(LEAF_STRUCTURE_VENUE_TOKENS, LEAF_STRUCTURE_VENUE_TOKENS_BY_LOCALE, locale))
//     );
//   }
//   if (kind === 'channel') {
//     return hasAny(
//       structuralTokens,
//       structuralTokensForLocale(LEAF_STRUCTURE_CHANNEL_TOKENS, LEAF_STRUCTURE_CHANNEL_TOKENS_BY_LOCALE, locale)
//     );
//   }
//   if (kind === 'product') {
//     return hasAny(
//       structuralTokens,
//       structuralTokensForLocale(LEAF_STRUCTURE_PRODUCT_TOKENS, LEAF_STRUCTURE_PRODUCT_TOKENS_BY_LOCALE, locale)
//     );
//   }
//   if (kind === 'population') {
//     return hasAny(
//       structuralTokens,
//       structuralTokensForLocale(LEAF_STRUCTURE_POPULATION_TOKENS, LEAF_STRUCTURE_POPULATION_TOKENS_BY_LOCALE, locale)
//     );
//   }
//   if (kind === 'task_focus') {
//     return hasAny(
//       structuralTokens,
//       structuralTokensForLocale(LEAF_STRUCTURE_TASK_FOCUS_TOKENS, LEAF_STRUCTURE_TASK_FOCUS_TOKENS_BY_LOCALE, locale)
//     );
//   }
//   if (kind === 'industry_context') {
//     return (
//       preparedQuery.intent.domainTokens.length > 0 &&
//       hasAny(
//         structuralTokens,
//         structuralTokensForLocale(LEAF_STRUCTURE_INDUSTRY_CONTEXT_TOKENS, LEAF_STRUCTURE_INDUSTRY_CONTEXT_TOKENS_BY_LOCALE, locale)
//       )
//     );
//   }
//   return false;
// }
// Discount family-level baseline noise tokens when evaluating query specializations
export function preparedQuerySpecializationTokensForFamily(preparedQuery, familySharedTokens) {
    const queryTokens = preparedQueryStructuralTokenSet(preparedQuery);
    const specializationTokens = new Set();
    for (const token of queryTokens) {
        if (!familySharedTokens.has(token)) {
            specializationTokens.add(token);
        }
    }
    return specializationTokens;
}
export function preparedQuerySupportsSpecializationKind(preparedQuery, kind, familySharedTokens) {
    const structuralTokens = familySharedTokens
        ? preparedQuerySpecializationTokensForFamily(preparedQuery, familySharedTokens)
        : preparedQueryStructuralTokenSet(preparedQuery);
    const kindTokens = LEAF_STRUCTURE_TOKENS_BY_KIND[kind];
    if (kind === 'venue') {
        return (preparedQuery.intent.venueTokens.length > 0 ||
            preparedQuery.intent.domainTokens.some((token) => kindTokens.has(foldSearchText(token))));
    }
    if (kind === 'industry_context') {
        return hasAny(structuralTokens, kindTokens);
    }
    return hasAny(structuralTokens, kindTokens);
}
export function canonicalTokenSet(label) {
    return new Set(tokenizeNormalizedText(foldSearchText(label)));
}
// Specialization token sets are curated by hand, so they only ever list one grammatical form of a
// word (e.g. 'vehicle', but not the 'vehicles' that actually shows up in a canonical label like "motor
// vehicles parts advisor"). Rather than hand-duplicating a plural entry for every noun, tolerate a
// plain English trailing-s mismatch in either direction wherever these sets are matched against.
function matchesTokenOrPlural(token, candidates) {
    if (candidates.has(token)) {
        return true;
    }
    if (token.endsWith('s') && token.length > 3 && candidates.has(token.slice(0, -1))) {
        return true;
    }
    return !token.endsWith('s') && candidates.has(`${token}s`);
}
function hasAny(tokens, candidates) {
    for (const token of tokens) {
        if (matchesTokenOrPlural(token, candidates)) {
            return true;
        }
    }
    return false;
}
