const DEFAULT_ESCO_SOURCE_NAME = 'esco_1_2_1';
const DEFAULT_SET_KEY = 'phase8-core-v1';
const OWNED_BY = 'seed-evaluation-set';
const EXPANDED_SET_KEY = 'phase15-expanded-v1';
const PHASE8_CORE_EVALUATION_SET = [
    {
        caseKey: 'exact-accountant-en',
        category: 'exact_english',
        localeCode: 'en',
        queryText: 'accountant',
        queryKind: 'title',
        description: 'Exact English leaf title.',
        expectations: [exactLeafByLabel('accountant', 1)]
    },
    {
        caseKey: 'exact-civil-engineer-en',
        category: 'exact_english',
        localeCode: 'en',
        queryText: 'civil engineer',
        queryKind: 'title',
        description: 'Exact English engineering title.',
        expectations: [exactLeafByLabel('civil engineer', 1)]
    },
    {
        caseKey: 'exact-cloud-software-developer-en',
        category: 'exact_english',
        localeCode: 'en',
        queryText: 'cloud software developer',
        queryKind: 'title',
        description: 'Exact English specialised ICT title.',
        expectations: [exactLeafByLabel('cloud software developer', 1)]
    },
    {
        caseKey: 'exact-data-analyst-en',
        category: 'exact_english',
        localeCode: 'en',
        queryText: 'data analyst',
        queryKind: 'title',
        description: 'Exact English analytics title.',
        expectations: [exactLeafByLabel('data analyst', 1)]
    },
    {
        caseKey: 'exact-nurse-general-care-en',
        category: 'exact_english',
        localeCode: 'en',
        queryText: 'nurse responsible for general care',
        queryKind: 'title',
        description: 'Exact English healthcare title.',
        expectations: [exactLeafByLabel('nurse responsible for general care', 1)]
    },
    {
        caseKey: 'exact-primary-school-teacher-en',
        category: 'exact_english',
        localeCode: 'en',
        queryText: 'primary school teacher',
        queryKind: 'title',
        description: 'Exact English education title.',
        expectations: [exactLeafByLabel('primary school teacher', 1)]
    },
    {
        caseKey: 'exact-chef-en',
        category: 'exact_english',
        localeCode: 'en',
        queryText: 'chef',
        queryKind: 'title',
        description: 'Exact English culinary title.',
        expectations: [exactLeafByLabel('chef', 1)]
    },
    {
        caseKey: 'exact-electrician-en',
        category: 'exact_english',
        localeCode: 'en',
        queryText: 'electrician',
        queryKind: 'title',
        description: 'Exact English trades title.',
        expectations: [exactLeafByLabel('electrician', 1)]
    },
    {
        caseKey: 'ro-contabil',
        category: 'romanian_variant',
        localeCode: 'ro',
        queryText: 'contabil',
        queryKind: 'title',
        description: 'Romanian alias for accountant.',
        expectations: [exactLeafByAlias('contabil', 'ro', 'accountant', 1)]
    },
    {
        caseKey: 'ro-analist-date',
        category: 'romanian_variant',
        localeCode: 'ro',
        queryText: 'analist de date',
        queryKind: 'title',
        description: 'Romanian alias for data analyst.',
        expectations: [exactLeafByAlias('analist de date', 'ro', 'data analyst', 1)]
    },
    {
        caseKey: 'ro-inginer-constructor',
        category: 'romanian_variant',
        localeCode: 'ro',
        queryText: 'inginer constructor',
        queryKind: 'title',
        description: 'Romanian local variant for civil engineer.',
        expectations: [exactLeafByAlias('inginer constructor', 'ro', 'civil engineer', 1)]
    },
    {
        caseKey: 'ro-dezvoltator-software-cloud',
        category: 'romanian_variant',
        localeCode: 'ro',
        queryText: 'dezvoltator de software cloud',
        queryKind: 'title',
        description: 'Romanian alias for cloud software developer.',
        expectations: [exactLeafByAlias('dezvoltator de software cloud', 'ro', 'cloud software developer', 1)]
    },
    {
        caseKey: 'ro-bucatar-sef',
        category: 'romanian_variant',
        localeCode: 'ro',
        queryText: 'bucătar șef',
        queryKind: 'title',
        description: 'Romanian masculine alias for chef.',
        expectations: [exactLeafByAlias('bucătar șef', 'ro', 'chef', 1)]
    },
    {
        caseKey: 'ro-avocat',
        category: 'romanian_variant',
        localeCode: 'ro',
        queryText: 'avocat',
        queryKind: 'title',
        description: 'Romanian alias for lawyer.',
        expectations: [exactLeafByAlias('avocat', 'ro', 'lawyer', 1)]
    },
    {
        caseKey: 'ro-farmacist',
        category: 'romanian_variant',
        localeCode: 'ro',
        queryText: 'farmacist',
        queryKind: 'title',
        description: 'Romanian alias for pharmacist.',
        expectations: [exactLeafByAlias('farmacist', 'ro', 'pharmacist', 1)]
    },
    {
        caseKey: 'noisy-senior-data-analyst',
        category: 'noisy_recruiter',
        localeCode: 'en',
        queryText: 'senior data analyst - SQL dashboards',
        queryKind: 'mixed',
        description: 'Recruiter phrasing with seniority and tooling noise.',
        expectations: [acceptableLeafByLabel('data analyst', 5)]
    },
    {
        caseKey: 'noisy-residential-electrician',
        category: 'noisy_recruiter',
        localeCode: 'en',
        queryText: 'licensed electrician for residential wiring',
        queryKind: 'mixed',
        description: 'Recruiter phrasing with license and domain modifiers.',
        expectations: [acceptableLeafByLabel('electrician', 5)]
    },
    {
        caseKey: 'noisy-cloud-software-engineer',
        category: 'noisy_recruiter',
        localeCode: 'en',
        queryText: 'cloud software engineer AWS platform',
        queryKind: 'mixed',
        description: 'Noisy software title that should still land near cloud software development.',
        expectations: [acceptableLeafByLabel('cloud software developer', 5)]
    },
    {
        caseKey: 'noisy-front-desk-receptionist',
        category: 'noisy_recruiter',
        localeCode: 'en',
        queryText: 'front desk receptionist hotel',
        queryKind: 'mixed',
        description: 'Noisy front-desk title with domain modifier.',
        expectations: [acceptableLeafByLabel('receptionist', 5)]
    },
    {
        caseKey: 'noisy-hr-manager',
        category: 'noisy_recruiter',
        localeCode: 'en',
        queryText: 'HR manager recruitment payroll',
        queryKind: 'mixed',
        description: 'Recruiter abbreviation and responsibility mix for human resources manager.',
        expectations: [acceptableLeafByLabel('human resources manager', 5)]
    },
    {
        caseKey: 'generic-developer-family',
        category: 'ambiguous_generic',
        localeCode: 'en',
        queryText: 'developer',
        queryKind: 'keyword',
        description: 'Generic developer query where a family-level software/application fallback is safer than over-picking a leaf.',
        expectations: [familyOfLeaf('software developer', 10)]
    },
    {
        caseKey: 'generic-driver-family',
        category: 'ambiguous_generic',
        localeCode: 'en',
        queryText: 'driver',
        queryKind: 'keyword',
        description: 'Generic driver query where broad driver/mobile plant family fallback is safer than over-picking a leaf.',
        expectations: [familyByLabel('Drivers and mobile plant operators', 10)]
    },
    {
        caseKey: 'generic-teacher-family',
        category: 'ambiguous_generic',
        localeCode: 'en',
        queryText: 'teacher',
        queryKind: 'keyword',
        description: 'Generic teacher query where broad teaching-professionals family fallback is safer than over-picking a leaf.',
        expectations: [familyByLabel('Teaching professionals', 10)]
    },
    {
        caseKey: 'fallback-software-group',
        category: 'fallback',
        localeCode: 'en',
        queryText: 'software roles',
        queryKind: 'keyword',
        description: 'Broad software query that can safely evaluate group-level fallback.',
        expectations: [groupOfLeaf('software developer', 10)]
    },
    {
        caseKey: 'fallback-sales-group',
        category: 'fallback',
        localeCode: 'en',
        queryText: 'sales shop role',
        queryKind: 'keyword',
        description: 'Broad sales query where shop sales assistant group fallback is acceptable.',
        expectations: [groupOfLeaf('sales assistant', 10)]
    }
];
const PHASE15_EXPANDED_EVALUATION_SET = [
    ...PHASE8_CORE_EVALUATION_SET,
    {
        caseKey: 'exact-architect-en',
        category: 'exact_english',
        localeCode: 'en',
        queryText: 'architect',
        queryKind: 'title',
        description: 'Exact English architecture title.',
        expectations: [exactLeafByLabel('architect', 1)]
    },
    {
        caseKey: 'exact-software-developer-en',
        category: 'exact_english',
        localeCode: 'en',
        queryText: 'software developer',
        queryKind: 'title',
        description: 'Exact English software title.',
        expectations: [exactLeafByLabel('software developer', 1)]
    },
    {
        caseKey: 'exact-web-developer-en',
        category: 'exact_english',
        localeCode: 'en',
        queryText: 'web developer',
        queryKind: 'title',
        description: 'Exact English web title.',
        expectations: [exactLeafByLabel('web developer', 1)]
    },
    {
        caseKey: 'exact-graphic-designer-en',
        category: 'exact_english',
        localeCode: 'en',
        queryText: 'graphic designer',
        queryKind: 'title',
        description: 'Exact English design title.',
        expectations: [exactLeafByLabel('graphic designer', 1)]
    },
    {
        caseKey: 'exact-accounting-assistant-en',
        category: 'exact_english',
        localeCode: 'en',
        queryText: 'accounting assistant',
        queryKind: 'title',
        description: 'Exact English accounting support title.',
        expectations: [exactLeafByLabel('accounting assistant', 1)]
    },
    {
        caseKey: 'exact-mechanical-engineer-en',
        category: 'exact_english',
        localeCode: 'en',
        queryText: 'mechanical engineer',
        queryKind: 'title',
        description: 'Exact English engineering title.',
        expectations: [exactLeafByLabel('mechanical engineer', 1)]
    },
    {
        caseKey: 'exact-lawyer-en',
        category: 'exact_english',
        localeCode: 'en',
        queryText: 'lawyer',
        queryKind: 'title',
        description: 'Exact English legal title.',
        expectations: [exactLeafByLabel('lawyer', 1)]
    },
    {
        caseKey: 'exact-pharmacist-en',
        category: 'exact_english',
        localeCode: 'en',
        queryText: 'pharmacist',
        queryKind: 'title',
        description: 'Exact English pharmacy title.',
        expectations: [exactLeafByLabel('pharmacist', 1)]
    },
    {
        caseKey: 'exact-receptionist-en',
        category: 'exact_english',
        localeCode: 'en',
        queryText: 'receptionist',
        queryKind: 'title',
        description: 'Exact English front-desk title.',
        expectations: [exactLeafByLabel('receptionist', 1)]
    },
    {
        caseKey: 'exact-sales-assistant-en',
        category: 'exact_english',
        localeCode: 'en',
        queryText: 'sales assistant',
        queryKind: 'title',
        description: 'Exact English retail title.',
        expectations: [exactLeafByLabel('sales assistant', 1)]
    },
    {
        caseKey: 'exact-social-worker-en',
        category: 'exact_english',
        localeCode: 'en',
        queryText: 'social worker',
        queryKind: 'title',
        description: 'Exact English social care title.',
        expectations: [exactLeafByLabel('social worker', 1)]
    },
    {
        caseKey: 'exact-bus-driver-en',
        category: 'exact_english',
        localeCode: 'en',
        queryText: 'bus driver',
        queryKind: 'title',
        description: 'Exact English transport title.',
        expectations: [exactLeafByLabel('bus driver', 1)]
    },
    {
        caseKey: 'en-certified-public-accountant',
        category: 'english_alias',
        localeCode: 'en',
        queryText: 'certified public accountant',
        queryKind: 'title',
        description: 'Common English alias for accountant.',
        expectations: [exactLeafByAlias('certified public accountant', 'en', 'accountant', 1)]
    },
    {
        caseKey: 'en-architectural-designer',
        category: 'english_alias',
        localeCode: 'en',
        queryText: 'architectural designer',
        queryKind: 'title',
        description: 'English synonym-style alias for architect.',
        expectations: [exactLeafByAlias('architectural designer', 'en', 'architect', 1)]
    },
    {
        caseKey: 'en-chef-de-cuisine',
        category: 'english_alias',
        localeCode: 'en',
        queryText: 'chef de cuisine',
        queryKind: 'title',
        description: 'English culinary alias for chef.',
        expectations: [exactLeafByAlias('chef de cuisine', 'en', 'chef', 1)]
    },
    {
        caseKey: 'en-cloud-consultant',
        category: 'english_alias',
        localeCode: 'en',
        queryText: 'cloud consultant',
        queryKind: 'title',
        description: 'English alias for cloud software developer.',
        expectations: [exactLeafByAlias('cloud consultant', 'en', 'cloud software developer', 1)]
    },
    {
        caseKey: 'en-business-data-analyst',
        category: 'english_alias',
        localeCode: 'en',
        queryText: 'business data analyst',
        queryKind: 'title',
        description: 'English modifier alias for data analyst.',
        expectations: [exactLeafByAlias('business data analyst', 'en', 'data analyst', 1)]
    },
    {
        caseKey: 'en-graphic-artist',
        category: 'english_alias',
        localeCode: 'en',
        queryText: 'graphic artist',
        queryKind: 'title',
        description: 'English alias for graphic designer.',
        expectations: [exactLeafByAlias('graphic artist', 'en', 'graphic designer', 1)]
    },
    {
        caseKey: 'en-hr-manager',
        category: 'english_alias',
        localeCode: 'en',
        queryText: 'HR manager',
        queryKind: 'title',
        description: 'Common English abbreviation for human resources manager.',
        expectations: [exactLeafByAlias('HR manager', 'en', 'human resources manager', 1)]
    },
    {
        caseKey: 'en-attorney',
        category: 'english_alias',
        localeCode: 'en',
        queryText: 'attorney',
        queryKind: 'title',
        description: 'English legal synonym for lawyer.',
        expectations: [exactLeafByAlias('attorney', 'en', 'lawyer', 1)]
    },
    {
        caseKey: 'en-adult-nurse',
        category: 'english_alias',
        localeCode: 'en',
        queryText: 'adult nurse',
        queryKind: 'title',
        description: 'English healthcare alias for nurse responsible for general care.',
        expectations: [exactLeafByAlias('adult nurse', 'en', 'nurse responsible for general care', 1)]
    },
    {
        caseKey: 'en-application-developer',
        category: 'english_alias',
        localeCode: 'en',
        queryText: 'application developer',
        queryKind: 'title',
        description: 'English alias for software developer.',
        expectations: [exactLeafByAlias('application developer', 'en', 'software developer', 1)]
    },
    {
        caseKey: 'ro-arhitect',
        category: 'romanian_variant',
        localeCode: 'ro',
        queryText: 'arhitect',
        queryKind: 'title',
        description: 'Romanian alias for architect.',
        expectations: [exactLeafByAlias('arhitect', 'ro', 'architect', 1)]
    },
    {
        caseKey: 'ro-asistent-contabil',
        category: 'romanian_variant',
        localeCode: 'ro',
        queryText: 'asistent contabil',
        queryKind: 'title',
        description: 'Romanian alias for accounting assistant.',
        expectations: [exactLeafByAlias('asistent contabil', 'ro', 'accounting assistant', 1)]
    },
    {
        caseKey: 'ro-designer-grafic',
        category: 'romanian_variant',
        localeCode: 'ro',
        queryText: 'designer grafic',
        queryKind: 'title',
        description: 'Romanian alias for graphic designer.',
        expectations: [exactLeafByAlias('designer grafic', 'ro', 'graphic designer', 1)]
    },
    {
        caseKey: 'ro-manager-resurse-umane',
        category: 'romanian_variant',
        localeCode: 'ro',
        queryText: 'manager resurse umane',
        queryKind: 'title',
        description: 'Romanian title for human resources manager.',
        expectations: [exactLeafByAlias('manager resurse umane', 'ro', 'human resources manager', 1)]
    },
    {
        caseKey: 'ro-inginer-mecanic',
        category: 'romanian_variant',
        localeCode: 'ro',
        queryText: 'inginer mecanic',
        queryKind: 'title',
        description: 'Romanian alias for mechanical engineer.',
        expectations: [exactLeafByAlias('inginer mecanic', 'ro', 'mechanical engineer', 1)]
    },
    {
        caseKey: 'ro-psiholog',
        category: 'romanian_variant',
        localeCode: 'ro',
        queryText: 'psiholog',
        queryKind: 'title',
        description: 'Romanian alias for psychologist.',
        expectations: [exactLeafByAlias('psiholog', 'ro', 'psychologist', 1)]
    },
    {
        caseKey: 'ro-receptioner',
        category: 'romanian_variant',
        localeCode: 'ro',
        queryText: 'recepționer',
        queryKind: 'title',
        description: 'Romanian alias for receptionist.',
        expectations: [exactLeafByAlias('recepționer', 'ro', 'receptionist', 1)]
    },
    {
        caseKey: 'ro-vanzator',
        category: 'romanian_variant',
        localeCode: 'ro',
        queryText: 'vânzător',
        queryKind: 'title',
        description: 'Romanian alias for sales assistant.',
        expectations: [exactLeafByAlias('vânzător', 'ro', 'sales assistant', 1)]
    },
    {
        caseKey: 'ro-asistent-social',
        category: 'romanian_variant',
        localeCode: 'ro',
        queryText: 'asistent social',
        queryKind: 'title',
        description: 'Romanian alias for social worker.',
        expectations: [exactLeafByAlias('asistent social', 'ro', 'social worker', 1)]
    },
    {
        caseKey: 'ro-dezvoltator-software',
        category: 'romanian_variant',
        localeCode: 'ro',
        queryText: 'dezvoltator software',
        queryKind: 'title',
        description: 'Romanian alias for software developer.',
        expectations: [exactLeafByAlias('dezvoltator software', 'ro', 'software developer', 1)]
    },
    {
        caseKey: 'ro-dezvoltator-web',
        category: 'romanian_variant',
        localeCode: 'ro',
        queryText: 'dezvoltator web',
        queryKind: 'title',
        description: 'Romanian alias for web developer.',
        expectations: [exactLeafByAlias('dezvoltator web', 'ro', 'web developer', 1)]
    },
    {
        caseKey: 'ro-instalator',
        category: 'romanian_variant',
        localeCode: 'ro',
        queryText: 'instalator',
        queryKind: 'title',
        description: 'Romanian alias for plumber.',
        expectations: [exactLeafByAlias('instalator', 'ro', 'plumber', 1)]
    },
    {
        caseKey: 'ro-sofer-de-autobuz',
        category: 'romanian_variant',
        localeCode: 'ro',
        queryText: 'șofer de autobuz',
        queryKind: 'title',
        description: 'Romanian alias for bus driver.',
        expectations: [exactLeafByAlias('șofer de autobuz', 'ro', 'bus driver', 1)]
    },
    {
        caseKey: 'ro-folded-contabila',
        category: 'diacritic_folded',
        localeCode: 'ro',
        queryText: 'contabila',
        queryKind: 'title',
        description: 'Romanian folded variant of contabilă.',
        expectations: [acceptableLeafByLabel('accountant', 5)]
    },
    {
        caseKey: 'ro-folded-bucatar-sef',
        category: 'diacritic_folded',
        localeCode: 'ro',
        queryText: 'bucatar sef',
        queryKind: 'title',
        description: 'Romanian folded variant of bucătar șef.',
        expectations: [acceptableLeafByLabel('chef', 5)]
    },
    {
        caseKey: 'ro-folded-electriciana',
        category: 'diacritic_folded',
        localeCode: 'ro',
        queryText: 'electriciana',
        queryKind: 'title',
        description: 'Romanian folded variant of electriciană.',
        expectations: [acceptableLeafByLabel('electrician', 5)]
    },
    {
        caseKey: 'ro-folded-receptioner',
        category: 'diacritic_folded',
        localeCode: 'ro',
        queryText: 'receptioner',
        queryKind: 'title',
        description: 'Romanian folded variant of recepționer.',
        expectations: [acceptableLeafByLabel('receptionist', 5)]
    },
    {
        caseKey: 'ro-folded-vanzator',
        category: 'diacritic_folded',
        localeCode: 'ro',
        queryText: 'vanzator',
        queryKind: 'title',
        description: 'Romanian folded variant of vânzător.',
        expectations: [acceptableLeafByLabel('sales assistant', 5)]
    },
    {
        caseKey: 'ro-folded-vanzatoare',
        category: 'diacritic_folded',
        localeCode: 'ro',
        queryText: 'vanzatoare',
        queryKind: 'title',
        description: 'Romanian folded variant of vânzătoare.',
        expectations: [acceptableLeafByLabel('sales assistant', 5)]
    },
    {
        caseKey: 'ro-folded-asistenta-sociala',
        category: 'diacritic_folded',
        localeCode: 'ro',
        queryText: 'asistenta sociala',
        queryKind: 'title',
        description: 'Romanian folded variant of asistentă socială.',
        expectations: [acceptableLeafByLabel('social worker', 5)]
    },
    {
        caseKey: 'ro-folded-profesoara-invatamant-primar',
        category: 'diacritic_folded',
        localeCode: 'ro',
        queryText: 'profesoara in invatamantul primar',
        queryKind: 'title',
        description: 'Romanian folded variant of profesoară în învăţământul primar.',
        expectations: [acceptableLeafByLabel('primary school teacher', 5)]
    },
    {
        caseKey: 'ro-folded-psiholog-scolar',
        category: 'diacritic_folded',
        localeCode: 'ro',
        queryText: 'psiholog scolar',
        queryKind: 'title',
        description: 'Romanian folded variant of psiholog școlar.',
        expectations: [acceptableLeafByLabel('psychologist', 5)]
    },
    {
        caseKey: 'ro-folded-arhitecta',
        category: 'diacritic_folded',
        localeCode: 'ro',
        queryText: 'arhitecta',
        queryKind: 'title',
        description: 'Romanian folded variant of arhitectă.',
        expectations: [acceptableLeafByLabel('architect', 5)]
    },
    {
        caseKey: 'noisy-staff-accountant',
        category: 'noisy_recruiter',
        localeCode: 'en',
        queryText: 'staff accountant AP AR month-end close',
        queryKind: 'mixed',
        description: 'Recruiter phrasing for an accounting role with finance workflow noise.',
        expectations: [acceptableLeafByLabel('accountant', 5)]
    },
    {
        caseKey: 'noisy-site-civil-engineer',
        category: 'noisy_recruiter',
        localeCode: 'en',
        queryText: 'site civil engineer roads drainage projects',
        queryKind: 'mixed',
        description: 'Recruiter phrasing for civil engineering with project modifiers.',
        expectations: [acceptableLeafByLabel('civil engineer', 5)]
    },
    {
        caseKey: 'noisy-react-web-developer',
        category: 'noisy_recruiter',
        localeCode: 'en',
        queryText: 'web developer React TypeScript remote',
        queryKind: 'mixed',
        description: 'Recruiter phrasing for web development with stack and work-mode noise.',
        expectations: [acceptableLeafByLabel('web developer', 5)]
    },
    {
        caseKey: 'noisy-retail-pharmacist',
        category: 'noisy_recruiter',
        localeCode: 'en',
        queryText: 'retail pharmacist dispensary patient counselling',
        queryKind: 'mixed',
        description: 'Recruiter phrasing for pharmacy with retail and patient-care modifiers.',
        expectations: [acceptableLeafByLabel('pharmacist', 5)]
    },
    {
        caseKey: 'noisy-cad-mechanical-engineer',
        category: 'noisy_recruiter',
        localeCode: 'en',
        queryText: 'mechanical engineer CAD manufacturing NPI',
        queryKind: 'mixed',
        description: 'Recruiter phrasing for mechanical engineering with tooling abbreviations.',
        expectations: [acceptableLeafByLabel('mechanical engineer', 5)]
    },
    {
        caseKey: 'noisy-front-office-receptionist',
        category: 'noisy_recruiter',
        localeCode: 'en',
        queryText: 'front office receptionist clinic bookings',
        queryKind: 'mixed',
        description: 'Recruiter phrasing for receptionist with domain-specific noise.',
        expectations: [acceptableLeafByLabel('receptionist', 5)]
    },
    {
        caseKey: 'noisy-shop-floor-sales-assistant',
        category: 'noisy_recruiter',
        localeCode: 'en',
        queryText: 'sales assistant shop floor tills merchandising',
        queryKind: 'mixed',
        description: 'Recruiter phrasing for retail with duty keywords.',
        expectations: [acceptableLeafByLabel('sales assistant', 5)]
    },
    {
        caseKey: 'noisy-community-social-worker',
        category: 'noisy_recruiter',
        localeCode: 'en',
        queryText: 'community social worker safeguarding caseload',
        queryKind: 'mixed',
        description: 'Recruiter phrasing for social care with service modifiers.',
        expectations: [acceptableLeafByLabel('social worker', 5)]
    },
    {
        caseKey: 'noisy-primary-teacher-ks2',
        category: 'noisy_recruiter',
        localeCode: 'en',
        queryText: 'primary teacher KS2 classroom cover',
        queryKind: 'mixed',
        description: 'Recruiter phrasing for primary teaching with regional school-stage noise.',
        expectations: [acceptableLeafByLabel('primary school teacher', 5)]
    },
    {
        caseKey: 'noisy-bus-driver-school-routes',
        category: 'noisy_recruiter',
        localeCode: 'en',
        queryText: 'bus driver school routes split shifts',
        queryKind: 'mixed',
        description: 'Recruiter phrasing for transport work with shift-pattern noise.',
        expectations: [acceptableLeafByLabel('bus driver', 5)]
    },
    {
        caseKey: 'skill-month-end-close',
        category: 'skill_enriched',
        localeCode: 'en',
        queryText: 'prepare monthly close reconciliations and statutory reporting',
        queryKind: 'description',
        description: 'Task-based accounting query without the job title.',
        expectations: [acceptableLeafByLabel('accountant', 5)]
    },
    {
        caseKey: 'skill-concrete-drainage-design',
        category: 'skill_enriched',
        localeCode: 'en',
        queryText: 'design reinforced concrete structures and drainage plans',
        queryKind: 'description',
        description: 'Task-based civil engineering query without the job title.',
        expectations: [acceptableLeafByLabel('civil engineer', 5)]
    },
    {
        caseKey: 'skill-etl-dashboards',
        category: 'skill_enriched',
        localeCode: 'en',
        queryText: 'build ETL pipelines dashboards and reporting models',
        queryKind: 'description',
        description: 'Task-based analytics query without the job title.',
        expectations: [acceptableLeafByLabel('data analyst', 5)]
    },
    {
        caseKey: 'skill-cloud-microservices-cicd',
        category: 'skill_enriched',
        localeCode: 'en',
        queryText: 'deploy cloud microservices and maintain CI CD pipelines',
        queryKind: 'description',
        description: 'Task-based cloud software query without the job title.',
        expectations: [acceptableLeafByLabel('cloud software developer', 5)]
    },
    {
        caseKey: 'skill-primary-literacy-numeracy',
        category: 'skill_enriched',
        localeCode: 'en',
        queryText: 'teach literacy numeracy and classroom routines to young pupils',
        queryKind: 'description',
        description: 'Task-based primary teaching query without the job title.',
        expectations: [acceptableLeafByLabel('primary school teacher', 5)]
    },
    {
        caseKey: 'skill-kitchen-brigade-menu-costing',
        category: 'skill_enriched',
        localeCode: 'en',
        queryText: 'lead kitchen brigade menu costing and food safety standards',
        queryKind: 'description',
        description: 'Task-based culinary leadership query without the job title.',
        expectations: [acceptableLeafByLabel('chef', 5)]
    },
    {
        caseKey: 'skill-building-wiring-panels',
        category: 'skill_enriched',
        localeCode: 'en',
        queryText: 'install and troubleshoot building wiring circuits and panels',
        queryKind: 'description',
        description: 'Task-based electrical trade query without the job title.',
        expectations: [acceptableLeafByLabel('electrician', 5)]
    },
    {
        caseKey: 'skill-legal-briefs-contracts',
        category: 'skill_enriched',
        localeCode: 'en',
        queryText: 'draft contracts litigation briefs and legal opinions',
        queryKind: 'description',
        description: 'Task-based legal practice query without the job title.',
        expectations: [acceptableLeafByLabel('lawyer', 5)]
    },
    {
        caseKey: 'skill-dispense-prescriptions',
        category: 'skill_enriched',
        localeCode: 'en',
        queryText: 'dispense prescriptions and advise patients on medicines',
        queryKind: 'description',
        description: 'Task-based pharmacy query without the job title.',
        expectations: [acceptableLeafByLabel('pharmacist', 5)]
    },
    {
        caseKey: 'skill-recruitment-onboarding-relations',
        category: 'skill_enriched',
        localeCode: 'en',
        queryText: 'coordinate recruitment onboarding and employee relations',
        queryKind: 'description',
        description: 'Task-based HR management query without the job title.',
        expectations: [acceptableLeafByLabel('human resources manager', 5)]
    },
    {
        caseKey: 'skill-brand-layout-campaign-visuals',
        category: 'skill_enriched',
        localeCode: 'en',
        queryText: 'design logos layouts and campaign visuals for brands',
        queryKind: 'description',
        description: 'Task-based graphic design query without the job title.',
        expectations: [acceptableLeafByLabel('graphic designer', 5)]
    },
    {
        caseKey: 'skill-responsive-sites-cms',
        category: 'skill_enriched',
        localeCode: 'en',
        queryText: 'develop responsive websites and CMS integrations',
        queryKind: 'description',
        description: 'Task-based web development query without the job title.',
        expectations: [acceptableLeafByLabel('web developer', 5)]
    },
    {
        caseKey: 'skill-family-community-support',
        category: 'skill_enriched',
        localeCode: 'en',
        queryText: 'support vulnerable families through community services',
        queryKind: 'description',
        description: 'Task-based social care query without the job title.',
        expectations: [acceptableLeafByLabel('social worker', 5)]
    },
    {
        caseKey: 'skill-visitor-calls-bookings',
        category: 'skill_enriched',
        localeCode: 'en',
        queryText: 'welcome visitors answer calls and manage bookings',
        queryKind: 'description',
        description: 'Task-based front-desk query without the job title.',
        expectations: [acceptableLeafByLabel('receptionist', 5)]
    },
    {
        caseKey: 'skill-shop-floor-merchandising',
        category: 'skill_enriched',
        localeCode: 'en',
        queryText: 'sell products on the shop floor and handle merchandising',
        queryKind: 'description',
        description: 'Task-based retail query without the job title.',
        expectations: [acceptableLeafByLabel('sales assistant', 5)]
    },
    {
        caseKey: 'broad-finance-professions',
        category: 'broad_family_group',
        localeCode: 'en',
        queryText: 'finance jobs',
        queryKind: 'keyword',
        description: 'Broad finance query where family fallback is safer than a specific leaf.',
        expectations: [familyOfLeaf('accountant', 10)]
    },
    {
        caseKey: 'broad-engineering-professions',
        category: 'broad_family_group',
        localeCode: 'en',
        queryText: 'engineering roles',
        queryKind: 'keyword',
        description: 'Broad engineering query where family fallback is safer than a specific leaf.',
        expectations: [familyOfLeaf('civil engineer', 10)]
    },
    {
        caseKey: 'broad-legal-practice',
        category: 'broad_family_group',
        localeCode: 'en',
        queryText: 'legal roles',
        queryKind: 'keyword',
        description: 'Broad legal query where group fallback is acceptable.',
        expectations: [groupOfLeaf('lawyer', 10)]
    },
    {
        caseKey: 'broad-shop-sales',
        category: 'broad_family_group',
        localeCode: 'en',
        queryText: 'shop sales jobs',
        queryKind: 'keyword',
        description: 'Broad retail sales query where group fallback is acceptable.',
        expectations: [groupOfLeaf('sales assistant', 10)]
    },
    {
        caseKey: 'broad-nursing-care',
        category: 'broad_family_group',
        localeCode: 'en',
        queryText: 'nursing roles',
        queryKind: 'keyword',
        description: 'Broad nursing query where group fallback is acceptable.',
        expectations: [groupOfLeaf('nurse responsible for general care', 10)]
    }
];
const EVALUATION_SET_FIXTURES = {
    [DEFAULT_SET_KEY]: PHASE8_CORE_EVALUATION_SET,
    [EXPANDED_SET_KEY]: PHASE15_EXPANDED_EVALUATION_SET
};
export class EvaluationSetSeeder {
    connection;
    constructor(connection) {
        this.connection = connection;
    }
    async run(options = {}) {
        const sourceName = normalizeSourceName(options.sourceName);
        const setKey = normalizeSetKey(options.setKey);
        const resolvedSeeds = await this.resolveSeeds(sourceName, evaluationSetSeeds(setKey));
        let resetDeletedQueryCount = 0;
        let resetDeletedExpectationCount = 0;
        let insertedQueryCount = 0;
        let reusedQueryCount = 0;
        let insertedExpectationCount = 0;
        let reusedExpectationCount = 0;
        await this.connection.beginTransaction();
        try {
            if (options.resetSet === true) {
                const resetResult = await this.resetSet(sourceName, setKey, resolvedSeeds);
                resetDeletedQueryCount = resetResult.deletedQueryCount;
                resetDeletedExpectationCount = resetResult.deletedExpectationCount;
            }
            for (const seed of resolvedSeeds) {
                const queryResult = await this.upsertEvaluationQuery(sourceName, setKey, seed);
                if (queryResult.inserted) {
                    insertedQueryCount += 1;
                }
                else {
                    reusedQueryCount += 1;
                }
                for (const expectation of seed.resolvedExpectations) {
                    const inserted = await this.insertExpectationIfMissing(queryResult.queryId, expectation);
                    if (inserted) {
                        insertedExpectationCount += 1;
                    }
                    else {
                        reusedExpectationCount += 1;
                    }
                }
            }
            await this.connection.commit();
        }
        catch (error) {
            await this.connection.rollback();
            throw error;
        }
        return {
            sourceName,
            setKey,
            resetSet: options.resetSet === true,
            queryCount: resolvedSeeds.length,
            expectationCount: resolvedSeeds.reduce((total, seed) => total + seed.resolvedExpectations.length, 0),
            insertedQueryCount,
            reusedQueryCount,
            insertedExpectationCount,
            reusedExpectationCount,
            resetDeletedQueryCount,
            resetDeletedExpectationCount
        };
    }
    async resolveSeeds(sourceName, seeds) {
        const resolvedSeeds = [];
        for (const seed of seeds) {
            const resolvedExpectations = [];
            for (const expectation of seed.expectations) {
                const expectedNode = await this.resolveTarget(sourceName, expectation.target, expectation.level);
                resolvedExpectations.push({
                    ...expectation,
                    expectedNodeId: expectedNode.id
                });
            }
            resolvedSeeds.push({
                ...seed,
                normalizedQuery: normalizeText(seed.queryText),
                resolvedExpectations
            });
        }
        return resolvedSeeds;
    }
    async resolveTarget(sourceName, target, expectationLevel) {
        if (target.kind === 'canonical_label') {
            const node = await this.resolveCanonicalLabel(sourceName, target.canonicalLabel, target.nodeLevel);
            assertExpectationLevelMatchesNode(expectationLevel, node, target.canonicalLabel);
            return node;
        }
        if (target.kind === 'alias') {
            const node = await this.resolveAlias(sourceName, target);
            assertExpectationLevelMatchesNode(expectationLevel, node, target.alias);
            return node;
        }
        if (target.kind === 'family_of') {
            const node = await this.resolveHierarchyTarget(sourceName, target.leafCanonicalLabel, 'family');
            assertExpectationLevelMatchesNode(expectationLevel, node, target.leafCanonicalLabel);
            return node;
        }
        const node = await this.resolveHierarchyTarget(sourceName, target.leafCanonicalLabel, 'group');
        assertExpectationLevelMatchesNode(expectationLevel, node, target.leafCanonicalLabel);
        return node;
    }
    async resolveCanonicalLabel(sourceName, canonicalLabel, nodeLevel) {
        const [rows] = await this.connection.query(`
        SELECT DISTINCT
          node.id,
          node.canonical_label,
          node.node_level
        FROM ose_graph_nodes node
        INNER JOIN ose_graph_node_sources node_source
          ON node_source.graph_node_id = node.id
        WHERE node_source.source_name = ?
          AND node.bucket = 'occupation'
          AND node.status = 'active'
          AND node.normalized_label = ?
          AND node.node_level = ?
        ORDER BY node.id
      `, [sourceName, normalizeText(canonicalLabel), nodeLevel]);
        return requireSingleNode(rows, `canonical_label="${canonicalLabel}", node_level="${nodeLevel}"`);
    }
    async resolveAlias(sourceName, target) {
        const canonicalFilter = target.canonicalLabel ? 'AND node.normalized_label = ?' : '';
        const params = target.canonicalLabel
            ? [sourceName, target.localeCode, normalizeText(target.alias), target.nodeLevel, normalizeText(target.canonicalLabel)]
            : [sourceName, target.localeCode, normalizeText(target.alias), target.nodeLevel];
        const [rows] = await this.connection.query(`
        SELECT
          node.id,
          node.canonical_label,
          node.node_level
        FROM ose_graph_nodes node
        INNER JOIN ose_graph_node_sources node_source
          ON node_source.graph_node_id = node.id
        INNER JOIN ose_graph_aliases alias
          ON alias.graph_node_id = node.id
        WHERE node_source.source_name = ?
          AND alias.locale_code = ?
          AND alias.normalized_alias = ?
          AND alias.is_active = 1
          AND node.bucket = 'occupation'
          AND node.status = 'active'
          AND node.node_level = ?
          ${canonicalFilter}
        GROUP BY node.id, node.canonical_label, node.node_level
        ORDER BY MAX(alias.is_primary) DESC, node.id
      `, params);
        return requireSingleNode(rows, `alias="${target.alias}", locale_code="${target.localeCode}"`);
    }
    async resolveHierarchyTarget(sourceName, leafCanonicalLabel, hierarchyLevel) {
        const idColumn = hierarchyLevel === 'family' ? 'family_node_id' : 'group_node_id';
        const [rows] = await this.connection.query(`
        SELECT DISTINCT
          expected_node.id,
          expected_node.canonical_label,
          expected_node.node_level
        FROM ose_graph_nodes leaf_node
        INNER JOIN ose_graph_node_sources node_source
          ON node_source.graph_node_id = leaf_node.id
        INNER JOIN ose_search_meta meta
          ON meta.graph_node_id = leaf_node.id
        INNER JOIN ose_graph_nodes expected_node
          ON expected_node.id = meta.${idColumn}
        WHERE node_source.source_name = ?
          AND leaf_node.bucket = 'occupation'
          AND leaf_node.status = 'active'
          AND leaf_node.node_level = 'occupation'
          AND leaf_node.normalized_label = ?
          AND expected_node.bucket = 'occupation'
          AND expected_node.status = 'active'
          AND expected_node.node_level = ?
        ORDER BY expected_node.id
      `, [sourceName, normalizeText(leafCanonicalLabel), hierarchyLevel]);
        return requireSingleNode(rows, `${hierarchyLevel}_of leaf="${leafCanonicalLabel}"`);
    }
    async resetSet(sourceName, setKey, seeds) {
        let deletedExpectationCount = await this.deleteOwnedExpectations(sourceName, setKey);
        for (const seed of seeds) {
            const queryIds = await this.findMatchingQueryIds(sourceName, setKey, seed);
            for (const expectation of seed.resolvedExpectations) {
                deletedExpectationCount += await this.deleteMatchingExpectation(queryIds, expectation);
            }
        }
        const deletedQueryCount = await this.deleteOwnedQueries(sourceName, setKey);
        return {
            deletedQueryCount,
            deletedExpectationCount
        };
    }
    async deleteOwnedExpectations(sourceName, setKey) {
        const [result] = await this.connection.execute(`
        DELETE expectation
        FROM ose_evaluation_expectations expectation
        INNER JOIN ose_evaluation_queries query
          ON query.id = expectation.evaluation_query_id
        WHERE ${ownedNotesWhereSql()}
      `, ownedNotesParams(sourceName, setKey));
        return result.affectedRows;
    }
    async deleteOwnedQueries(sourceName, setKey) {
        const [result] = await this.connection.execute(`
        DELETE query
        FROM ose_evaluation_queries query
        WHERE ${ownedNotesWhereSql()}
      `, ownedNotesParams(sourceName, setKey));
        return result.affectedRows;
    }
    async deleteMatchingExpectation(queryIds, expectation) {
        if (queryIds.length === 0) {
            return 0;
        }
        const placeholders = queryIds.map(() => '?').join(', ');
        const [result] = await this.connection.execute(`
        DELETE FROM ose_evaluation_expectations
        WHERE evaluation_query_id IN (${placeholders})
          AND expected_node_id = ?
          AND expectation_level = ?
      `, [...queryIds, expectation.expectedNodeId, expectation.level]);
        return result.affectedRows;
    }
    async upsertEvaluationQuery(sourceName, setKey, seed) {
        const existingQuery = await this.findExistingQuery(sourceName, setKey, seed);
        if (existingQuery) {
            return { queryId: existingQuery.id, inserted: false };
        }
        const [result] = await this.connection.execute(`
        INSERT INTO ose_evaluation_queries (
          locale_code,
          query_text,
          normalized_query,
          query_kind,
          notes
        )
        VALUES (?, ?, ?, ?, ?)
      `, [seed.localeCode, seed.queryText, seed.normalizedQuery, seed.queryKind, buildNotes(sourceName, setKey, seed)]);
        return { queryId: result.insertId, inserted: true };
    }
    async findExistingQuery(sourceName, setKey, seed) {
        const [rows] = await this.connection.query(`
        SELECT
          id,
          notes
        FROM ose_evaluation_queries query
        WHERE locale_code = ?
          AND BINARY query_text = BINARY ?
          AND BINARY normalized_query = BINARY ?
          AND query_kind = ?
          AND ${ownedNotesWhereSql()}
        ORDER BY id
        LIMIT 1
      `, [seed.localeCode, seed.queryText, seed.normalizedQuery, seed.queryKind, ...ownedNotesParams(sourceName, setKey)]);
        return rows[0] ?? null;
    }
    async findMatchingQueryIds(sourceName, setKey, seed) {
        const [rows] = await this.connection.query(`
        SELECT id, notes
        FROM ose_evaluation_queries query
        WHERE locale_code = ?
          AND BINARY query_text = BINARY ?
          AND BINARY normalized_query = BINARY ?
          AND query_kind = ?
          AND ${ownedNotesWhereSql()}
        ORDER BY id
      `, [seed.localeCode, seed.queryText, seed.normalizedQuery, seed.queryKind, ...ownedNotesParams(sourceName, setKey)]);
        return rows.map((row) => row.id);
    }
    async insertExpectationIfMissing(queryId, expectation) {
        const [existingRows] = await this.connection.query(`
        SELECT id
        FROM ose_evaluation_expectations
        WHERE evaluation_query_id = ?
          AND expected_node_id = ?
          AND expectation_level = ?
        LIMIT 1
      `, [queryId, expectation.expectedNodeId, expectation.level]);
        if (existingRows.length > 0) {
            return false;
        }
        await this.connection.execute(`
        INSERT INTO ose_evaluation_expectations (
          evaluation_query_id,
          expected_node_id,
          expectation_level,
          rank_ceiling
        )
        VALUES (?, ?, ?, ?)
      `, [queryId, expectation.expectedNodeId, expectation.level, expectation.rankCeiling]);
        return true;
    }
}
export function defaultEvaluationSetKey() {
    return DEFAULT_SET_KEY;
}
export function evaluationSetSize(setKey = DEFAULT_SET_KEY) {
    return evaluationSetSeeds(setKey).length;
}
function exactLeafByLabel(canonicalLabel, rankCeiling) {
    return {
        level: 'exact_leaf',
        target: {
            kind: 'canonical_label',
            canonicalLabel,
            nodeLevel: 'occupation'
        },
        rankCeiling
    };
}
function acceptableLeafByLabel(canonicalLabel, rankCeiling) {
    return {
        level: 'acceptable_leaf',
        target: {
            kind: 'canonical_label',
            canonicalLabel,
            nodeLevel: 'occupation'
        },
        rankCeiling
    };
}
function familyByLabel(canonicalLabel, rankCeiling) {
    return {
        level: 'family',
        target: {
            kind: 'canonical_label',
            canonicalLabel,
            nodeLevel: 'family'
        },
        rankCeiling
    };
}
function exactLeafByAlias(alias, localeCode, canonicalLabel, rankCeiling) {
    return {
        level: 'exact_leaf',
        target: {
            kind: 'alias',
            alias,
            localeCode,
            canonicalLabel,
            nodeLevel: 'occupation'
        },
        rankCeiling
    };
}
function evaluationSetSeeds(setKey) {
    const seeds = EVALUATION_SET_FIXTURES[setKey];
    if (!seeds) {
        const supportedSetKeys = Object.keys(EVALUATION_SET_FIXTURES).sort().join(', ');
        throw new Error(`Unsupported evaluation set key "${setKey}". Supported set keys: ${supportedSetKeys}.`);
    }
    return seeds;
}
function familyOfLeaf(leafCanonicalLabel, rankCeiling) {
    return {
        level: 'family',
        target: {
            kind: 'family_of',
            leafCanonicalLabel
        },
        rankCeiling
    };
}
function groupOfLeaf(leafCanonicalLabel, rankCeiling) {
    return {
        level: 'group',
        target: {
            kind: 'group_of',
            leafCanonicalLabel
        },
        rankCeiling
    };
}
function assertExpectationLevelMatchesNode(expectationLevel, node, targetLabel) {
    const expectedNodeLevelByExpectation = {
        exact_leaf: 'occupation',
        acceptable_leaf: 'occupation',
        family: 'family',
        group: 'group'
    };
    const expectedNodeLevel = expectedNodeLevelByExpectation[expectationLevel];
    if (node.node_level !== expectedNodeLevel) {
        throw new Error(`Resolved target "${targetLabel}" to node "${node.canonical_label}" at level "${node.node_level}", but expectation_level="${expectationLevel}" requires node_level="${expectedNodeLevel}".`);
    }
}
function requireSingleNode(rows, description) {
    if (rows.length === 0) {
        throw new Error(`Could not resolve evaluation expected node for ${description}. Build graph/search-meta first or adjust the seed fixture.`);
    }
    if (rows.length > 1) {
        const sample = rows
            .slice(0, 5)
            .map((row) => `${row.id}:${row.canonical_label}`)
            .join(', ');
        throw new Error(`Evaluation expected node resolver found ${rows.length} matches for ${description}: ${sample}`);
    }
    return rows[0];
}
function buildNotes(sourceName, setKey, seed) {
    return JSON.stringify({
        phase8_owned_by: OWNED_BY,
        phase8_set_key: setKey,
        source_name: sourceName,
        case_key: seed.caseKey,
        category: seed.category,
        description: seed.description,
        generated_by: 'src/evaluation/seed-evaluation-set.ts'
    });
}
function ownedNotesWhereSql() {
    return [
        "query.notes LIKE ? ESCAPE '\\\\'",
        "query.notes LIKE ? ESCAPE '\\\\'",
        "query.notes LIKE ? ESCAPE '\\\\'"
    ].join(' AND ');
}
function ownedNotesParams(sourceName, setKey) {
    return [
        `%${escapeLike(`"phase8_owned_by":"${OWNED_BY}"`)}%`,
        `%${escapeLike(`"phase8_set_key":"${setKey}"`)}%`,
        `%${escapeLike(`"source_name":"${sourceName}"`)}%`
    ];
}
async function countOwnedQueries(connection, sourceName, setKey) {
    const [rows] = await connection.query(`
      SELECT COUNT(*) AS count_value
      FROM ose_evaluation_queries query
      WHERE ${ownedNotesWhereSql()}
    `, ownedNotesParams(sourceName, setKey));
    return rows[0]?.count_value ?? 0;
}
export async function countSeededEvaluationQueries(connection, options = {}) {
    return countOwnedQueries(connection, normalizeSourceName(options.sourceName), normalizeSetKey(options.setKey));
}
function escapeLike(value) {
    return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
function normalizeSourceName(sourceName) {
    const normalized = sourceName?.trim();
    return normalized || DEFAULT_ESCO_SOURCE_NAME;
}
function normalizeSetKey(setKey) {
    const normalized = setKey?.trim();
    return normalized || DEFAULT_SET_KEY;
}
function normalizeText(value) {
    return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}
