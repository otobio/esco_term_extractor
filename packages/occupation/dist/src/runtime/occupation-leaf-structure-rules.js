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
        shop: ['magazinul', 'magazine', 'uzlet', 'uzleti', 'kauplus', 'shop', 'store', 'magazin', 'mall', 'bolt', 'bolti'],
        studio: ['atelier', 'ateliere', 'muhely', 'stuudio', 'studio', 'salon', 'szalon'],
        theatre: ['teatru', 'teatrala', 'szinhazi', 'teater', 'theatre', 'theater', 'szinhaz'],
        warehouse: ['depozitare', 'depozit', 'raktari', 'ladu', 'warehouse', 'raktar']
    },
    channel: {
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
            'klienditeenindus'
        ],
        chat: ['chat', 'livechat', 'conversatie', 'cseveges', 'vestlus'],
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
    },
    population: {
        adult: ['adulti', 'felnott', 'taiskasvanu', 'adult', 'elderly', 'senior', 'aged', 'older', 'varstnic', 'idosek'],
        animal: ['animale', 'animalier', 'allat', 'loom', 'animal', 'pet', 'kedvenc', 'livestock'],
        child: ['copil', 'copii', 'gyermek', 'laps', 'child', 'children', 'kid', 'youth', 'tineret', 'juvenile', 'minor', 'minori'],
        client: ['clientela', 'clienti', 'ugyfelek', 'kliendid', 'client', 'customer', 'customer_service', 'ugyfel', 'ugyfelszolgalati'],
        community: ['comunitar', 'comunitate', 'kozossegi', 'kogukonna', 'community', 'public', 'kozosseg', 'kogukond'],
        disability: ['dizabil', 'fogyatekossag', 'puue', 'disability', 'disabled', 'dizabilitati', 'fogyatekos'],
        migrant: ['migranti', 'migrator', 'vandorlo', 'migrant', 'immigrant', 'refugee'],
        passenger: ['pasageri', 'pasager', 'utasok', 'reisija', 'passenger', 'utas'],
        patient: ['pacienti', 'pacient', 'betegek', 'patsient', 'patient', 'beteg'],
        student: ['studenti', 'studentesc', 'diakok', 'opilane', 'student', 'pupil', 'diak'],
        tourist: ['turistic', 'turisti', 'turistak', 'turistid', 'tourist', 'traveller', 'traveler', 'turist'],
        victim: ['victime', 'victima', 'aldozatok', 'ohver', 'victim', 'aldozat']
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
// export const ATOMIC_SPECIALIZATION_SYNONYMS: Record<LeafSpecializationKind, Record<string, string[]>> = {
//   venue: {
//     airport: ['aeroportul', 'lennujaama', 'airport', 'aeroport', 'repuloter', 'lennujaam', 'airside', 'terminal'],
//     bank: ['bancare', 'bankfiok', 'pangandus', 'bank', 'banca', 'banki'],
//     casino: ['cazinouri', 'kaszino', 'kasiino', 'casino', 'cazinou'],
//     clinic: ['cabinet', 'cabinete', 'rendelo', 'kliinik', 'clinic', 'clinica', 'klinik'],
//     court: ['judecatorie', 'tribunal', 'tribunale', 'birosag', 'kohus', 'court', 'instanta'],
//     factory: ['fabrica', 'uzina', 'uziny', 'gyar', 'tehas', 'plant', 'mill', 'moara', 'uzem', 'uzemi'],
//     farm: ['gospodarie', 'fermier', 'gazdasag', 'talu', 'farm', 'ferma'],
//     hospital: ['spitalul', 'korhazi', 'haigla', 'hospital', 'spital', 'korhaz'],
//     hotel: ['pensiune', 'pensiunea', 'szalloda', 'hotell', 'hotel'],
//     laboratory: ['laboratoriu', 'laboratoorium', 'laboratory', 'lab', 'laborator', 'labor'],
//     library: ['bibliotecara', 'bibliotecii', 'konyvtari', 'raamatukogu', 'library', 'biblioteca', 'konyvtar'],
//     market: ['comercial', 'piata', 'piac', 'turg', 'market'],
//     mine: ['minerit', 'cariera', 'banya', 'kaevandus', 'mine', 'quarry', 'mina'],
//     museum: ['muzeala', 'muzeumi', 'muuseum', 'museum', 'muzeu'],
//     office: ['birou', 'birouri', 'irodai', 'kontor', 'office', 'iroda'],
//     pharmacy: ['farmaceutica', 'farmaceutic', 'gyogyszertari', 'apteek', 'pharmacy', 'farmacie', 'gyogyszertar'],
//     prison: ['penitenciar', 'penitenciare', 'bortoni', 'vangla', 'prison', 'inchisoare', 'borton'],
//     railway: ['feroviar', 'feroviara', 'vasuti', 'raudtee', 'railway', 'station', 'gara', 'vasut', 'terminal'],
//     restaurant: [
//       'restaurantul',
//       'restaurante',
//       'ettermi',
//       'toitlustus',
//       'restaurant',
//       'etterem',
//       'gyorsetterem',
//       'bakery',
//       'panificatie',
//       'pekseg'
//     ],
//     school: [
//       'scolar',
//       'scolara',
//       'scolii',
//       'iskolai',
//       'kooli',
//       'school',
//       'campus',
//       'scoala',
//       'iskola',
//       'kool',
//       'freinet',
//       'montessori',
//       'steiner',
//       'nursery',
//       'primary',
//       'secondary'
//     ],
//     ship: ['naval', 'navale', 'hajozasi', 'laev', 'ship', 'vessel', 'nava', 'vas', 'hajo', 'port'],
//     shop: ['magazinul', 'magazine', 'uzlet', 'uzleti', 'kauplus', 'shop', 'store', 'magazin', 'mall', 'bolt', 'bolti'],
//     studio: ['atelier', 'ateliere', 'muhely', 'stuudio', 'studio', 'salon', 'szalon'],
//     theatre: ['teatru', 'teatrala', 'szinhazi', 'teater', 'theatre', 'theater', 'szinhaz'],
//     warehouse: ['depozitare', 'depozit', 'raktari', 'ladu', 'warehouse', 'raktar']
//   },
//   channel: {
//     call_centre: [
//       'callcenter',
//       'call-centre',
//       'call-center',
//       'centru telefonic',
//       'telefonos ugyfelszolgalat',
//       'klienditeenindus',
//       'call',
//       'centre',
//       'center',
//       'telefonic',
//       'telefonos',
//       'switchboard',
//       'centrala',
//       'helpline',
//       'helpdesk',
//       'apel',
//       'centru'
//     ],
//     chat: ['conversatie', 'conversatie online', 'cseveges', 'vestlus', 'chat', 'livechat'],
//     digital: [
//       'digital',
//       'digitalizare',
//       'digitalis',
//       'digitaalne',
//       'digitala',
//       'online',
//       'web',
//       'website',
//       'internet',
//       'cyber',
//       'e-commerce',
//       'ecommerce',
//       'ebusiness'
//     ],
//     mail: ['corespondenta', 'corespondentie', 'levelezes', 'postiteenus', 'mail', 'post', 'posta'],
//     social: [
//       'retele sociale',
//       'retele social',
//       'kozossegi',
//       'sotsiaalmeedia',
//       'social_work',
//       'social_services',
//       'social_security',
//       'csr',
//       'corporate_social_responsibility',
//       'media',
//       'social'
//     ],
//     telephone: ['telefonic', 'telefonica', 'telefonos', 'telefon', 'telephone', 'phone']
//   },
//   product: {
//     appliance: ['aparate electrocasnice', 'electrocasnic', 'haztartasi gep', 'kodumasin', 'appliance', 'futos'],
//     audio: ['audiovizual', 'audiovizuale', 'hangtechnika', 'heliseadmed', 'audio', 'music', 'musical', 'muzical', 'hang'],
//     battery: ['acumulator', 'acumulatoare', 'akkumulator', 'aku', 'battery', 'baterie', 'akku'],
//     beverage: [
//       'bautura',
//       'bauturi',
//       'ital',
//       'italok',
//       'jook',
//       'beverage',
//       'drink',
//       'coffee',
//       'cafea',
//       'tea',
//       'cocoa',
//       'cacao',
//       'chocolate',
//       'ciocolata',
//       'csokolade',
//       'sokolaad'
//     ],
//     circuit: ['circuite', 'aramkor', 'vooluring', 'circuit', 'microelectronics', 'chip'],
//     clothing: ['imbracaminte', 'vestimentatie', 'ruhazati', 'roivastus', 'clothing', 'apparel', 'garment', 'ruhazat'],
//     cosmetic: ['cosmetice', 'cosmetica', 'szepsegapolasi', 'kosmeetika', 'cosmetic', 'perfume', 'parfum', 'illatszer'],
//     device: ['aparatura', 'dispozitive', 'keszulek', 'seade', 'device', 'instrument'],
//     equipment: ['echipament', 'utilaj', 'berendezes', 'seadmed', 'equipment', 'machinery', 'utilaje', 'echipamente', 'gep'],
//     food: [
//       'alimentar',
//       'alimente',
//       'elelmiszeripari',
//       'toit',
//       'food',
//       'foodstuff',
//       'elelmiszer',
//       'meat',
//       'carne',
//       'fruit',
//       'fructe',
//       'vegetable',
//       'legume',
//       'dairy',
//       'lactate',
//       'sugar',
//       'zahar',
//       'confectionery',
//       'dulciuri'
//     ],
//     footwear: ['incaltaminte', 'incaltari', 'cipoi', 'jalats', 'footwear', 'shoe', 'shoes', 'cipos'],
//     furniture: ['mobilier', 'mobila', 'butoripari', 'moobel', 'furniture', 'butor'],
//     gambling_games: [
//       'jocuri de noroc',
//       'joc de noroc',
//       'szerencsejatek',
//       'hasartmangud',
//       'gambling',
//       'casino',
//       'games',
//       'game',
//       'jocuri',
//       'jatek'
//     ],
//     hardware: [
//       'componente hardware',
//       'hardware informatic',
//       'szamitastechnikai',
//       'arvutiriistvara',
//       'hardware',
//       'computer_hardware',
//       'szamitogep'
//     ],
//     integrated_circuit: ['circuit integrat', 'circuite integrate', 'integralt aramkor', 'integraallus', 'integrated_circuit', 'microchip'],
//     jewellery: ['bijuterie', 'bijuterii', 'ekszer', 'ehted', 'jewelry', 'watch', 'watches', 'ceas', 'ceasuri', 'ora', 'orak'],
//     leather: ['pielarie', 'pielii', 'boripari', 'nahk', 'leather', 'piele', 'bor'],
//     medical_device: [
//       'dispozitiv medical',
//       'dispozitive medicale',
//       'orvostechnikai',
//       'meditsiiniseade',
//       'medical_device',
//       'orthopaedic',
//       'audiology'
//     ],
//     metal: ['metale', 'metalurgic', 'femipari', 'metall', 'metal', 'steel', 'fem'],
//     paper: ['hartie', 'hartie tipografica', 'papiripari', 'paber', 'papir'],
//     plastic: ['material plastic', 'materiale plastice', 'muanyagipari', 'plast', 'plastic', 'rubber', 'cauciuc', 'muanyag'],
//     power: ['electricitate', 'energie electrica', 'energia', 'power', 'energy', 'energie', 'combustibil', 'fuel', 'gas', 'gaz'],
//     satellite: ['sateliti', 'muholdas', 'satelliit', 'satellite', 'satelit', 'muhold'],
//     sensor: ['senzori', 'erzekeloi', 'andur', 'sensor', 'senzor', 'erzekelo'],
//     textile: ['textil', 'textile', 'textilipari', 'tekstiil', 'textiles', 'fabric', 'imbracaminte'],
//     tobacco: ['tutun', 'tutunuri', 'dohanyipari', 'tubakas', 'dohany'],
//     tool: ['unelte', 'scule', 'szerszamok', 'tooriistad', 'tool', 'szerszam'],
//     toy: ['jucarie', 'jucarii', 'jatekipari', 'manguasi', 'toy', 'toys', 'jatek'],
//     vehicle: ['vehicul', 'vehicule', 'jarmuvek', 'soiduk', 'car', 'automobile', 'masina', 'auto', 'tehergepjarmu', 'tehergepkocsi']
//   },
//   population: {
//     adult: ['adulti', 'persoane adulte', 'felnott', 'taiskasvanu', 'adult', 'elderly', 'senior', 'aged', 'older', 'varstnic', 'idosek'],
//     animal: ['animale', 'animalier', 'allat', 'loom', 'animal', 'pet', 'kedvenc', 'livestock'],
//     child: ['copil', 'copii', 'gyermek', 'laps', 'children', 'kid', 'youth', 'tineret', 'juvenile', 'minor', 'minori'],
//     client: ['clientela', 'clienti', 'ugyfelek', 'kliendid', 'client', 'customer', 'customer_service', 'ugyfel', 'ugyfelszolgalati'],
//     community: ['comunitar', 'comunitate', 'kozossegi', 'kogukonna', 'community', 'public', 'kozosseg', 'kogukond'],
//     disability: ['dizabil', 'persoane cu dizabilitati', 'fogyatekossag', 'puue', 'disability', 'disabled', 'dizabilitati', 'fogyatekos'],
//     migrant: ['migranti', 'migrator', 'vandorlo', 'migrant', 'immigrant', 'refugee'],
//     passenger: ['pasageri', 'pasager', 'utasok', 'reisija', 'utas'],
//     patient: ['pacienti', 'pacient', 'betegek', 'patsient', 'beteg'],
//     student: ['studenti', 'studentesc', 'diakok', 'opilane', 'student', 'pupil', 'diak'],
//     tourist: ['turistic', 'turisti', 'turistak', 'turistid', 'tourist', 'traveller', 'traveler', 'turist'],
//     victim: ['victime', 'victima', 'aldozatok', 'ohver', 'victim', 'aldozat']
//   },
//   task_focus: {
//     academic_support: [
//       'sprijin academic',
//       'asistenta academica',
//       'tanulmanyi tamogatas',
//       'oppetugi',
//       'academic_support',
//       'tutoring',
//       'mentoring'
//     ],
//     design: ['proiectare', 'proiectant', 'tervezesi', 'kujundus', 'design', 'designer', 'tervezes', 'applied_arts'],
//     installation: ['instalare', 'montaj', 'telepitesi', 'paigaldus', 'installation', 'installer', 'instalator', 'telepito'],
//     learning_support: ['sprijin educational', 'educatie speciala', 'tanulasi tamogatas', 'learning_support', 'special_education', 'sen'],
//     maintenance_and_repair: [
//       'intretinere',
//       'mentenanta',
//       'reparatii',
//       'karbantartasi',
//       'javitas',
//       'hooldus',
//       'remont',
//       'maintenance',
//       'repair',
//       'repairer',
//       'intretinere',
//       'reparator'
//     ],
//     predictive_maintenance: [
//       'intretinere predictiva',
//       'mentenanta predictiva',
//       'prediktiv karbantartas',
//       'ennustav hooldus',
//       'predictive_maintenance',
//       'condition_monitoring'
//     ],
//     processing: ['procesare', 'prelucrare', 'feldolgozas', 'tootlemine', 'processing', 'moulding', 'finishing', 'cutting'],
//     quality_assurance: [
//       'asigurarea calitatii',
//       'controlul calitatii',
//       'control calitate',
//       'minosegbiztositas',
//       'kvaliteedikontroll',
//       'quality',
//       'quality_assurance',
//       'quality_control',
//       'calitate',
//       'minoseg',
//       'testing',
//       'testare',
//       'teszt'
//     ],
//     simulation: ['simulare', 'simulatie', 'szimulacio', 'simulatsioon', 'simulation'],
//     surveying: ['topografie', 'topograf', 'geodezie', 'foldmeres', 'maamootmine', 'survey', 'surveyor', 'sondaj', 'meres'],
//     water_quality_analysis: [
//       'analiza apei',
//       'analiza calitatii apei',
//       'vizminoseg',
//       'vee kvaliteet',
//       'veeanaluus',
//       'water_quality',
//       'water_analysis'
//     ]
//   },
//   industry_context: {
//     automotive: ['autovehicule', 'autovehicul', 'jarmuipari', 'autotoostus', 'automotive', 'auto', 'jarmu'],
//     aviation: ['aviatic', 'aviatie', 'repulesi', 'lennundus', 'aviation', 'aircraft', 'flight', 'repules', 'aeronava', 'zbor'],
//     business: ['afaceri', 'comercial', 'uzleti', 'ettevotlus', 'business', 'marketing', 'commercial', 'kereskedelmi'],
//     construction: ['constructii', 'constructii civile', 'epitoipari', 'ehitus', 'construction', 'building', 'constructii', 'epitoipar'],
//     electrical: [
//       'electric',
//       'electrica',
//       'villamosipari',
//       'elektri',
//       'electrical',
//       'electricity',
//       'energy',
//       'energie',
//       'villamossag',
//       'tensiune'
//     ],
//     electronics: [
//       'electronica',
//       'electromecanica',
//       'elektronikai',
//       'elektroonika',
//       'electronics',
//       'electronic',
//       'electromechanical',
//       'elektronika',
//       'electromecanic'
//     ],
//     ict: [
//       'informatica',
//       'tehnologia informatiei',
//       'informatikai',
//       'infotehnoloogia',
//       'ict',
//       'software',
//       'database',
//       'network',
//       'computer',
//       'calculator',
//       'szoftver',
//       'adat',
//       'cloud',
//       'sisteme',
//       'baza de date',
//       'retea'
//     ],
//     manufacturing: ['fabricatie', 'productie industriala', 'gyartasi', 'tootmine', 'manufacturing', 'industrial', 'fabricatie', 'gyartas'],
//     medical: [
//       'medicina',
//       'medicala',
//       'egeszsegugyi',
//       'meditsiiniline',
//       'medical',
//       'health',
//       'healthcare',
//       'clinical',
//       'pharmaceutical',
//       'sanatate',
//       'egeszsegugy',
//       'gyogyszereszeti',
//       'klinikai'
//     ],
//     mining: ['minerit', 'extractie miniera', 'banyaszati', 'kaevandus', 'mining', 'mine', 'banyaszat'],
//     renewable_energy: [
//       'energie regenerabila',
//       'surse regenerabile',
//       'megujulo energia',
//       'taastuvenergia',
//       'renewable',
//       'solar',
//       'wind',
//       'geothermal',
//       'regenerabil',
//       'megujulo'
//     ],
//     telecommunications: ['telecomunicatii', 'telecom', 'tavkozlesi', 'telekommunikatsioon', 'telecommunications', 'tavkozles']
//   }
// };
export const __ATOMIC_SPECIALIZATION_SYNONYMS = {
    venue: {
        airport: ['airport', 'aeroport', 'repuloter', 'lennujaam', 'airside', 'terminal', 'aeroportul', 'lennujaama'],
        bank: ['bank', 'banca', 'banki', 'bancare', 'bankfiok', 'pangandus'],
        casino: ['casino', 'cazinou', 'kaszino', 'cazinouri', 'kasiino'],
        clinic: ['clinic', 'clinica', 'klinik', 'cabinet', 'cabinete', 'rendelo', 'kliinik'],
        court: ['court', 'instanta', 'birosag'],
        factory: ['factory', 'plant', 'mill', 'fabrica', 'moara', 'uzem', 'uzemi', 'tehas'],
        farm: ['farm', 'ferma', 'gazdasag'],
        hospital: ['hospital', 'spital', 'korhaz'],
        hotel: ['hotel', 'szalloda'],
        laboratory: ['laboratory', 'lab', 'laborator', 'labor'],
        library: ['library', 'biblioteca', 'konyvtar', 'raamatukogu'],
        market: ['market', 'piata', 'piac'],
        mine: ['mine', 'quarry', 'mina', 'minerit', 'banya', 'kaevandus'],
        museum: ['museum', 'muzeu', 'muzeum'],
        office: ['office', 'birou', 'iroda'],
        pharmacy: ['pharmacy', 'farmacie', 'gyogyszertar'],
        prison: ['prison', 'inchisoare', 'borton'],
        railway: ['railway', 'station', 'gara', 'vasut', 'vasuti', 'raudtee', 'terminal'],
        restaurant: ['restaurant', 'etterem', 'gyorsetterem', 'bakery', 'panificatie', 'pekseg'],
        school: ['school', 'campus', 'scoala', 'iskola', 'kool', 'freinet', 'montessori', 'steiner', 'nursery', 'primary', 'secondary'],
        ship: ['ship', 'vessel', 'nava', 'vas', 'hajo', 'port'],
        shop: ['shop', 'store', 'magazin', 'mall', 'bolt', 'bolti', 'kauplus'],
        studio: ['studio', 'salon', 'szalon'],
        theatre: ['theatre', 'theater', 'teatru', 'szinhaz'],
        warehouse: ['warehouse', 'depozit', 'raktar', 'raktari']
    },
    channel: {
        call_centre: [
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
            'centru'
        ],
        chat: ['chat', 'livechat'],
        digital: ['digital', 'digitala', 'online', 'web', 'website', 'internet', 'cyber', 'e-commerce', 'ecommerce', 'ebusiness'],
        mail: ['mail', 'post', 'posta'],
        social: ['social', 'social_work', 'social_services', 'social_security', 'csr', 'corporate_social_responsibility', 'media'],
        telephone: ['telephone', 'phone', 'telefon']
    },
    product: {
        appliance: ['appliance', 'electrocasnice', 'futos'],
        audio: ['audio', 'music', 'musical', 'muzical', 'hang'],
        battery: ['battery', 'baterie', 'akku'],
        beverage: [
            'beverage',
            'drink',
            'bauturi',
            'ital',
            'coffee',
            'cafea',
            'tea',
            'cocoa',
            'cacao',
            'chocolate',
            'ciocolata',
            'csokolade',
            'sokolaad'
        ],
        circuit: ['circuit', 'microelectronics', 'chip'],
        clothing: ['clothing', 'apparel', 'imbracaminte', 'garment', 'ruhazat'],
        cosmetic: ['cosmetic', 'perfume', 'cosmetice', 'parfum', 'illatszer'],
        device: ['device', 'instrument', 'dispozitiv'],
        equipment: ['equipment', 'machinery', 'utilaje', 'echipamente', 'gep'],
        food: [
            'food',
            'foodstuff',
            'alimente',
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
        footwear: ['footwear', 'shoe', 'shoes', 'incaltaminte', 'cipos'],
        furniture: ['furniture', 'mobila', 'butor'],
        gambling_games: ['gambling', 'casino', 'games', 'game', 'jocuri', 'jatek'],
        hardware: ['hardware', 'computer_hardware', 'szamitogep'],
        integrated_circuit: ['integrated_circuit', 'microchip'],
        jewellery: ['jewellery', 'jewelry', 'watch', 'watches', 'bijuterii', 'ceas', 'ceasuri', 'ora', 'orak'],
        leather: ['leather', 'piele', 'bor'],
        medical_device: ['medical_device', 'orthopaedic', 'audiology'],
        metal: ['metal', 'steel', 'fém'],
        paper: ['paper', 'hartie', 'papir'],
        plastic: ['plastic', 'rubber', 'cauciuc', 'muanyag'],
        power: ['power', 'energy', 'energie', 'combustibil', 'fuel', 'gas', 'gaz'],
        satellite: ['satellite', 'satelit', 'muhold'],
        sensor: ['sensor', 'senzor', 'erzekelo'],
        textile: ['textile', 'textiles', 'fabric', 'imbracaminte'],
        tobacco: ['tobacco', 'tutun', 'dohany'],
        tool: ['tool', 'unelte', 'szerszam'],
        toy: ['toy', 'toys', 'jatek'],
        vehicle: ['vehicle', 'car', 'automobile', 'masina', 'auto', 'tehergepjarmu', 'tehergepkocsi']
    },
    population: {
        adult: ['adult', 'adulti', 'elderly', 'senior', 'aged', 'older', 'varstnic', 'idosek'],
        animal: ['animal', 'animale', 'pet', 'kedvenc', 'livestock'],
        child: ['child', 'children', 'kid', 'copil', 'copii', 'gyermek', 'youth', 'tineret', 'juvenile', 'minor', 'minori'],
        client: ['client', 'clienti', 'customer', 'customer_service', 'ugyfel', 'ugyfelszolgalati'],
        community: ['community', 'public', 'comunitate', 'kozosseg', 'kogukond'],
        disability: ['disability', 'disabled', 'dizabilitati', 'fogyatékos'],
        migrant: ['migrant', 'immigrant', 'refugee', 'migranti'],
        passenger: ['passenger', 'pasager', 'utas'],
        patient: ['patient', 'pacient', 'beteg'],
        student: ['student', 'pupil', 'studenti', 'diak'],
        tourist: ['tourist', 'traveller', 'traveler', 'turist', 'turisti'],
        victim: ['victim', 'victima', 'aldozat']
    },
    task_focus: {
        academic_support: ['academic_support', 'tutoring', 'mentoring'],
        design: ['design', 'designer', 'proiectare', 'proiectant', 'tervezes', 'applied_arts'],
        installation: ['installation', 'installer', 'instalare', 'instalator', 'telepito'],
        learning_support: ['learning_support', 'special_education', 'sen'],
        maintenance_and_repair: ['maintenance', 'repair', 'repairer', 'intreţinere', 'reparatii', 'karbantartas', 'reparator', 'mentenanta'],
        predictive_maintenance: ['predictive_maintenance', 'condition_monitoring'],
        processing: ['processing', 'moulding', 'finishing', 'cutting', 'procesare', 'feldolgozas'],
        quality_assurance: ['quality', 'quality_assurance', 'quality_control', 'calitate', 'minoseg', 'testing', 'testare', 'teszt'],
        simulation: ['simulation', 'simulare'],
        surveying: ['survey', 'surveyor', 'topograf', 'sondaj', 'meres'],
        water_quality_analysis: ['water_quality', 'water_analysis']
    },
    industry_context: {
        automotive: ['automotive', 'auto', 'jarmu'],
        aviation: ['aviation', 'aircraft', 'flight', 'aviatie', 'repules', 'aeronava', 'zbor'],
        business: ['business', 'marketing', 'commercial', 'kereskedelmi', 'afaceri'],
        construction: ['construction', 'building', 'construcţii', 'epitoipar'],
        electrical: ['electrical', 'electricity', 'energy', 'energie', 'villamossag', 'electrica', 'tensiune'],
        electronics: ['electronics', 'electronic', 'electromechanical', 'electronica', 'elektronika', 'electromecanic'],
        ict: [
            'ict',
            'software',
            'database',
            'network',
            'computer',
            'calculator',
            'szoftver',
            'adat',
            'cloud',
            'sisteme',
            'baza de date',
            'retea'
        ],
        manufacturing: ['manufacturing', 'industrial', 'fabricaţie', 'gyartas'],
        medical: ['medical', 'health', 'healthcare', 'clinical', 'pharmaceutical', 'sanatate', 'egeszsegugy', 'gyogyszereszeti', 'klinikai'],
        mining: ['mining', 'mine', 'minerit', 'banyaszat'],
        renewable_energy: ['renewable', 'solar', 'wind', 'geothermal', 'regenerabil', 'megujulo'],
        telecommunications: ['telecommunications', 'telecom', 'telecomunicatii', 'tavkozles']
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
// Equivalence rows: any two tokens listed in the same row count as the same specific
// specialization value (e.g. a leaf marked "shop" and a query saying "store" are the same venue).
//
// WHY THIS EXISTS: a leaf carries a specialization kind (venue/product/population/channel) when its
// canonical label or alias contains one of the LEAF_STRUCTURE_*_TOKENS above. If the query doesn't use
// that exact same word, the leaf's specific claim looks "unsupported" by the query and gets penalized
// (hasUnsupportedSpecialization in rank-family-leaves-core.ts) even when the query names the identical
// real-world thing in different vocabulary (store vs shop, phone vs telephone, elderly vs older adult).
// These rows are how that penalty gets waived correctly instead of by loosening the check generally.
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
// HOW A ROW EARNS ITS PLACE -- every row here was added by this process, not guessed:
//   1. Mine real recurrence: grep/count the candidate word's actual frequency across canonicalLabel
//      in data/runtime-review/occupation-search-meta.esco_1_2_1.jsonl. A word that never or almost never
//      recurs in real ESCO labels doesn't get a token or a row -- one-off invented vocabulary is exactly
//      the kind of guesswork this mechanism is designed to avoid.
//   2. Group only genuine synonyms for the SAME specific real-world referent, not merely related or
//      adjacent concepts. "fruit" and "vegetable" are both food products but are NOT grouped together --
//      ESCO models "fruit and vegetable specialised seller" as leaves distinguishable by exactly this
//      difference, so merging their rows would destroy real signal ESCO itself encodes. Compare: "adult"
//      and "elderly" ARE merged, because ESCO's own canonical vocabulary uses "older adult" to mean
//      elderly -- the merge reflects ESCO's modeling, not a convenience shortcut.
//   3. Verify with the CLI on a real query, not just by reading the code: run
//      `node dist/cli/rank-family-leaves-v2.js --family="..." --query="..." --locale=...` and confirm
//      the intended leaf actually outranks the generic/unrelated alternatives once the row is added.
//   4. Verify with both eval variants (`npm run rank:family-leaves:eval` and `-- --with-sibling-families=3`)
//      that overall/stable/developing pass counts hold or improve -- never regress -- before keeping a
//      change. A row that "fixes" one query but breaks another synonym grouping elsewhere is not a fix.
//   5. Prefer adding a golden test (search-pipeline/golden-suite.ts, PIPELINE_DEVELOPING_GOLDEN_CASES)
//      that isolates the new row's effect specifically -- a query where the win depends on the row
//      existing, not one that already wins on an exact alias match regardless.
//
// DO NOT: add a row, or fold two existing rows together, purely to make one specific query or one
// user-reported complaint pass, without doing steps 1-4 above. A row is a claim that two words denote
// the same real-world thing across ESCO's entire vocabulary, not a query-specific patch -- treat every
// addition or merge here with the same scrutiny as adding a new taxonomy fact, because a wrong merge
// silently blunders search quality for every OTHER query that happens to use either word.
const LEAF_STRUCTURE_SPECIALIZATION_EQUIVALENCE_ROWS = {
    venue: [
        ['shop', 'store', 'magazin', 'mall'],
        ['hotel', 'restaurant'],
        ['hospital', 'clinic', 'spital', 'clinica'],
        ['school', 'campus', 'scoala'],
        ['warehouse', 'depozit'],
        ['office', 'birou'],
        ['airport', 'aeroport'],
        ['railway', 'station', 'gara'],
        ['laboratory', 'lab', 'laborator'],
        ['mine', 'mina'],
        ['factory', 'plant', 'mill', 'fabrica', 'moara'],
        ['ship', 'vessel', 'nava', 'vas'],
        ['bank', 'banca'],
        ['market', 'piata'],
        ['pharmacy', 'farmacie'],
        ['farm', 'ferma'],
        ['casino', 'cazinou'],
        ['theatre', 'teatru'],
        ['library', 'biblioteca'],
        ['bakery', 'panificatie'],
        ['prison', 'inchisoare'],
        ['museum', 'muzeu']
    ],
    product: [
        ['vehicle', 'car', 'automobile', 'masina'],
        ['machinery', 'equipment', 'utilaje', 'echipamente'],
        ['clothing', 'textile', 'apparel', 'imbracaminte'],
        // 'watches' added as the plural form newly mined from the leaf data; 'ceasuri'/'órák' are its
        // ro/hu plurals (not yet CLI-verified).
        ['jewellery', 'jewelry', 'watch', 'watches', 'bijuterii', 'ceas', 'ceasuri', 'óra', 'órák'],
        ['wood', 'timber', 'lemn'],
        ['glass', 'sticla'],
        ['stone', 'piatra'],
        ['plastic', 'rubber', 'cauciuc'],
        ['gas', 'fuel', 'combustibil', 'gaz'],
        ['power', 'energy', 'energie'],
        ['food', 'foodstuff', 'alimente'],
        ['meat', 'carne'],
        ['fruit', 'fructe'],
        ['vegetable', 'legume'],
        ['dairy', 'lactate'],
        ['sugar', 'zahar'],
        ['coffee', 'cafea'],
        // 'ciocolata'/'csokoládé'/'šokolaad' are ro/hu/et forms of 'chocolate', already an English member.
        ['cocoa', 'chocolate', 'confectionery', 'cacao', 'dulciuri', 'ciocolata', 'csokoládé', 'šokolaad'],
        ['beverage', 'drink', 'bauturi'],
        ['tobacco', 'tutun'],
        ['cosmetic', 'perfume', 'cosmetice', 'parfum'],
        ['leather', 'piele'],
        ['paper', 'hartie'],
        ['furniture', 'mobila'],
        ['footwear', 'shoe', 'incaltaminte'],
        ['battery', 'baterie'],
        ['instrument', 'musical'],
        ['appliance', 'electrocasnice'],
        ['hardware', 'device', 'circuit', 'sensor', 'microelectronics'],
        ['games', 'game'],
        ['satellite', 'satelit'],
        ['tool', 'unelte'],
        ['pump', 'pompa'],
        ['crane', 'macara']
    ],
    population: [
        ['customer', 'client', 'clienti'],
        // 'comunitate'/'közösség'/'kogukond' are ro/hu/et forms of 'community' (not yet CLI-verified).
        ['public', 'community', 'comunitate', 'közösség', 'kogukond'],
        ['student', 'pupil', 'studenti'],
        ['patient', 'pacient'],
        ['passenger', 'pasager'],
        ['visitor', 'vizitator'],
        ['user', 'utilizator'],
        ['animal', 'animale'],
        ['tourist', 'traveller', 'traveler', 'turist'],
        ['child', 'children', 'kid', 'copil', 'copii'],
        ['youth', 'teen', 'teenager', 'adolescent', 'tineret'],
        ['adult', 'elderly', 'senior', 'aged', 'older', 'adulti', 'varstnic'],
        ['disability', 'disabled', 'dizabilitati'],
        ['migrant', 'immigrant', 'refugee', 'migranti'],
        ['victim', 'victima'],
        ['juvenile', 'minor', 'minori']
    ],
    channel: [
        ['telephone', 'phone', 'call', 'telefon', 'telefonic', 'apel'],
        ['switchboard', 'centrala'],
        ['helpdesk', 'helpline', 'desk', 'ghiseu'],
        ['online', 'internet', 'digital', 'digitala'],
        ['chat', 'livechat'],
        ['social', 'media'],
        ['video'],
        ['broadcast', 'radio', 'television', 'tv', 'difuzare'],
        ['mail', 'post', 'posta'],
        ['web', 'website'],
        ['door', 'usa'],
        ['counter', 'ghiseu']
    ]
};
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
// True when a leaf's specific specialization marker (e.g. "shop") and a query token (e.g. "store")
// are grouped in the same equivalence row -- i.e. the query names the same specific venue/etc. using
// different vocabulary, so the leaf should not be penalized for "not matching" a value it actually does match.
export function specializationKindAlignedWithQuery(kind, canonicalTokens, preparedQuery) {
    const rows = LEAF_STRUCTURE_SPECIALIZATION_EQUIVALENCE_ROWS[kind];
    if (!rows) {
        return false;
    }
    const markerTokens = leafMarkerTokensForKind(kind, canonicalTokens);
    if (markerTokens.length === 0) {
        return false;
    }
    const structuralTokens = kind === 'venue'
        ? new Set([...preparedQuery.intent.venueTokens, ...preparedQuery.intent.domainTokens].map((token) => foldSearchText(token)))
        : preparedQueryStructuralTokenSet(preparedQuery);
    const rowIncludesToken = (row, token) => row.some((rowToken) => matchesTokenOrPlural(token, new Set([rowToken])));
    return rows.some((row) => markerTokens.some((marker) => rowIncludesToken(row, marker)) &&
        Array.from(structuralTokens).some((token) => rowIncludesToken(row, token)));
}
// A query naming a specific venue often implies a specific industry without saying the industry word
// itself -- "clinic receptionist" names the medical industry via "clinic", not via "medical". This maps
// a handful of common, unambiguous venue words (across en/ro/hu) to the industry_context token(s) they
// imply, so a leaf like "front line medical receptionist" isn't penalized just because the query said
// the venue instead of the industry. Deliberately small and conservative -- industry_context's own
// detection/family-inherence check (industryContextInherentToFamily in rank-family-leaves-core.ts)
// stays untouched; this only adds one more way for a leaf's industry_context claim to be considered
// query-supported.
const LEAF_STRUCTURE_VENUE_IMPLIES_INDUSTRY_CONTEXT = {
    clinic: ['medical', 'health'],
    hospital: ['medical', 'health'],
    spital: ['medical', 'health'],
    clinica: ['medical', 'health'],
    pharmacy: ['medical', 'health'],
    farmacie: ['medical', 'health'],
    school: ['education', 'vocational'],
    scoala: ['education', 'vocational'],
    campus: ['education', 'vocational'],
    airport: ['aviation'],
    aeroport: ['aviation'],
    bank: ['financial'],
    banca: ['financial'],
    mine: ['mining'],
    mina: ['mining'],
    factory: ['industrial'],
    plant: ['industrial'],
    mill: ['industrial'],
    fabrica: ['industrial'],
    moara: ['industrial'],
    farm: ['agricultural'],
    ferma: ['agricultural'],
    theatre: ['arts'],
    teatru: ['arts'],
    museum: ['arts'],
    muzeu: ['arts'],
    library: ['education'],
    biblioteca: ['education'],
    court: ['legal'],
    ship: ['marine'],
    vessel: ['marine'],
    nava: ['marine'],
    vas: ['marine']
};
// Venue -> Industry Implication Map
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
// export function specializationKindImpliedByQueryVenue(
//   kind: LeafSpecializationKind,
//   canonicalTokens: Set<string>,
//   preparedQuery: PreparedQuery
// ): boolean {
//   if (kind !== 'industry_context') {
//     return false;
//   }
//   const markerTokens = leafMarkerTokensForKind(kind, canonicalTokens);
//   if (markerTokens.length === 0) {
//     return false;
//   }
//   const structuralTokens = preparedQueryStructuralTokenSet(preparedQuery);
//   return Array.from(structuralTokens).some((token) => {
//     const impliedIndustries = Object.hasOwn(LEAF_STRUCTURE_VENUE_IMPLIES_INDUSTRY_CONTEXT, token)
//       ? LEAF_STRUCTURE_VENUE_IMPLIES_INDUSTRY_CONTEXT[token]
//       : undefined;
//     return impliedIndustries !== undefined && markerTokens.some((marker) => impliedIndustries.includes(marker));
//   });
// }
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
// task_focus vocabulary is too large and open-ended to hand-group into equivalence rows the way
// venue was (see LEAF_STRUCTURE_SPECIALIZATION_EQUIVALENCE_ROWS above) -- curated rows there would be
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
function tokensContainLevelKind(tokens, kind) {
    return LEVEL_SPECIALIZATION_SYNONYMS[kind].some((alias) => tokens.has(foldSearchText(alias)));
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
