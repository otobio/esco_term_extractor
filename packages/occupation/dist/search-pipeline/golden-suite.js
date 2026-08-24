import { DEFAULT_ESCO_SOURCE_NAME, DEFAULT_MODEL_KEY, DEFAULT_RETRIEVAL_PROFILE, DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import { DEFAULT_SIBLING_LIMIT } from '../retrieval/occupation-candidate-branches.js';
import { OccupationSearchPipeline } from './occupation-search-pipeline.js';
const LOCALE_ORDER = ['en', 'ro', 'hu', 'et'];
export const PIPELINE_GOLDEN_CASES = [
    {
        caseKey: 'exact-software-developer',
        format: 'exact_title',
        coverageKind: 'technology',
        query: 'software developer',
        locale: 'en',
        description: 'Exact canonical software occupation title.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'software developer',
            topFamilyLabel: 'Software and applications developers and analysts',
            minimumConfidence: 0.9
        }
    },
    {
        caseKey: 'generic-tail-fullstack-developer',
        format: 'generic_tail',
        coverageKind: 'technology',
        query: 'Fullstack developer',
        locale: 'en',
        description: 'Common market title with generic developer tail and no exact ESCO leaf.',
        expectation: {
            decisionType: 'family',
            selectedLabel: 'Software and applications developers and analysts',
            topFamilyLabel: 'Software and applications developers and analysts',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'modifier-senior-data-analyst',
        format: 'modifier_removed',
        coverageKind: 'white_collar',
        query: 'senior data analyst',
        locale: 'en',
        description: 'Seniority modifier should not block closest base occupation.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'data analyst',
            topFamilyLabel: 'Software and applications developers and analysts',
            minimumConfidence: 0.75
        }
    },
    {
        caseKey: 'specialization-guard-registered-nurse',
        format: 'specialization_guard',
        coverageKind: 'care_collar',
        query: 'registered nurse',
        locale: 'en',
        description: 'Avoid over-selecting specialist nurse when specialist is not requested.',
        expectation: {
            decisionType: 'family',
            selectedLabel: 'Nursing and midwifery professionals',
            topFamilyLabel: 'Nursing and midwifery professionals',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'multi-word-primary-school-teacher',
        format: 'multi_word_exact',
        coverageKind: 'education',
        query: 'primary school teacher',
        locale: 'en',
        description: 'Multi-word exact education occupation.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'primary school teacher',
            topFamilyLabel: 'Primary school and early childhood teachers',
            minimumConfidence: 0.9
        }
    },
    {
        caseKey: 'short-form-chef',
        format: 'short_form',
        coverageKind: 'service',
        query: 'chef',
        locale: 'en',
        description: 'Short single-token occupation should prefer the general title over specializations.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'chef',
            topFamilyLabel: 'Cooks',
            minimumConfidence: 0.85
        }
    },
    {
        caseKey: 'exact-accountant',
        format: 'exact_title',
        coverageKind: 'white_collar',
        query: 'accountant',
        locale: 'en',
        description: 'Exact finance occupation.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'accountant',
            topFamilyLabel: 'Finance professionals',
            minimumConfidence: 0.8
        }
    },
    {
        caseKey: 'synonym-receptionist',
        format: 'synonym_alias',
        coverageKind: 'pink_collar',
        query: 'front desk receptionist',
        locale: 'en',
        description: 'Synonym-style phrasing should land in the receptionist/client information branch.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'receptionist',
            topFamilyLabel: 'Client information workers',
            minimumConfidence: 0.75
        }
    },
    {
        caseKey: 'descriptive-people-who-install-wiring',
        format: 'descriptive',
        coverageKind: 'blue_collar',
        query: 'electrical wiring installer',
        locale: 'en',
        description: 'Descriptive query should land on the electrical installer broader branch.',
        expectation: {
            decisionType: 'family',
            selectedLabel: 'Electrical equipment installers and repairers',
            topFamilyLabel: 'Electrical equipment installers and repairers',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'manager-marketing-manager',
        format: 'manager_title',
        coverageKind: 'management',
        query: 'marketing manager',
        locale: 'en',
        description: 'Exact manager title should prefer the management branch over broad marketing professionals.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'marketing manager',
            topFamilyLabel: 'Sales, marketing and development managers',
            minimumConfidence: 0.75
        }
    },
    {
        caseKey: 'noisy-looking-sales-assistant',
        format: 'noisy_recruiter',
        coverageKind: 'service',
        query: 'sales assistant',
        locale: 'en',
        description: 'Generic assistant tail should still preserve exact sales assistant intent.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'sales assistant',
            topFamilyLabel: 'Shop salespersons',
            minimumConfidence: 0.85
        }
    },
    {
        caseKey: 'plural-software-developers',
        format: 'plural_variant',
        coverageKind: 'technology',
        query: 'software developers',
        locale: 'en',
        description: 'English plural role form should resolve to the singular canonical occupation.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'software developer',
            topFamilyLabel: 'Software and applications developers and analysts',
            minimumConfidence: 0.75
        }
    },
    {
        caseKey: 'ambiguous-wrapper-security-personnel',
        format: 'ambiguous_title',
        coverageKind: 'service',
        query: 'Security Personnel',
        locale: 'en',
        description: 'Generic occupational wrapper ("personnel") modifying a specific head word must not zero out alias evidence for the head word alone.',
        expectation: {
            decisionType: 'family',
            selectedLabel: 'Protective services workers',
            topFamilyLabel: 'Protective services workers',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'et-poe-juht',
        format: 'exact_title',
        coverageKind: 'management',
        query: 'poe juht',
        locale: 'et',
        description: 'Estonian store manager title should canonicalize into the retail management branch and promote the leaf.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'shop manager',
            topFamilyLabel: 'Retail and wholesale trade managers',
            minimumConfidence: 0.75
        }
    },
    {
        caseKey: 'hu-projekt-menedzser',
        format: 'exact_title',
        coverageKind: 'management',
        query: 'projekt menedzser',
        locale: 'hu',
        description: 'Hungarian project manager title should canonicalize into the management branch and promote the leaf.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'project manager',
            topFamilyLabel: 'Business services and administration managers',
            minimumConfidence: 0.75
        }
    },
    {
        caseKey: 'ro-contabil',
        format: 'exact_title',
        coverageKind: 'white_collar',
        query: 'contabil',
        locale: 'ro',
        description: 'Romanian finance title should promote to the accountant leaf via local alias closeness.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'accountant',
            topFamilyLabel: 'Finance professionals',
            minimumConfidence: 0.75
        }
    },
    {
        caseKey: 'ro-analist-date',
        format: 'exact_title',
        coverageKind: 'technology',
        query: 'analist de date',
        locale: 'ro',
        description: 'Romanian data analyst title should promote to the data analyst leaf via local alias closeness.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'data analyst',
            topFamilyLabel: 'Software and applications developers and analysts',
            minimumConfidence: 0.75
        }
    },
    {
        caseKey: 'ro-dezvoltator-software',
        format: 'exact_title',
        coverageKind: 'technology',
        query: 'dezvoltator software',
        locale: 'ro',
        description: 'Romanian software developer title with strong exact alias evidence.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'software developer',
            topFamilyLabel: 'Software and applications developers and analysts',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'ro-receptioner',
        format: 'exact_title',
        coverageKind: 'pink_collar',
        query: 'recepționer',
        locale: 'ro',
        description: 'Romanian receptionist title should promote through slash-delimited local alias alternatives.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'receptionist',
            topFamilyLabel: 'Client information workers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'ro-farmacist',
        format: 'exact_title',
        coverageKind: 'health',
        query: 'farmacist',
        locale: 'ro',
        description: 'Romanian pharmacist title should promote to the pharmacist leaf.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'pharmacist',
            topFamilyLabel: 'Other health professionals',
            minimumConfidence: 0.85
        }
    },
    {
        caseKey: 'ro-bucatar-sef',
        format: 'exact_title',
        coverageKind: 'service',
        query: 'bucătar șef',
        locale: 'ro',
        description: 'Romanian chef title should promote to the chef leaf.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'chef',
            topFamilyLabel: 'Cooks',
            minimumConfidence: 0.75
        }
    },
    {
        caseKey: 'ro-sofer-autobuz',
        format: 'exact_title',
        coverageKind: 'transport',
        query: 'șofer de autobuz',
        locale: 'ro',
        description: 'Romanian bus driver title should promote to the bus driver leaf.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'bus driver',
            topFamilyLabel: 'Heavy truck and bus drivers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'ro-profesoara-invatamant-primar',
        format: 'multi_word_exact',
        coverageKind: 'education',
        query: 'profesoara in invatamantul primar',
        locale: 'ro',
        description: 'Romanian folded primary teacher title should promote to the primary school teacher leaf.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'primary school teacher',
            topFamilyLabel: 'Primary school and early childhood teachers',
            minimumConfidence: 0.75
        }
    },
    {
        caseKey: 'ro-asistent-social',
        format: 'exact_title',
        coverageKind: 'care_collar',
        query: 'asistent social',
        locale: 'ro',
        description: 'Romanian social worker title should land in social and religious professionals.',
        expectation: {
            decisionType: 'family',
            selectedLabel: 'Social and religious professionals',
            topFamilyLabel: 'Social and religious professionals',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'ro-inginer-constructor',
        format: 'exact_title',
        coverageKind: 'white_collar',
        query: 'inginer constructor',
        locale: 'ro',
        description: 'Romanian civil engineer title should promote to the civil engineer leaf.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'civil engineer',
            topFamilyLabel: 'Engineering professionals (excluding electrotechnology)',
            minimumConfidence: 0.75
        }
    },
    {
        caseKey: 'ro-feminine-contabila',
        format: 'plural_variant',
        coverageKind: 'white_collar',
        query: 'contabila',
        locale: 'ro',
        description: 'Romanian feminine/folded accounting title should land in finance via token variants.',
        expectation: {
            decisionType: 'family',
            selectedLabel: 'Finance professionals',
            topFamilyLabel: 'Finance professionals',
            minimumConfidence: 0.55
        }
    },
    {
        caseKey: 'ro-plural-dezvoltatori-software',
        format: 'plural_variant',
        coverageKind: 'technology',
        query: 'dezvoltatori software',
        locale: 'ro',
        description: 'Romanian plural developer title should promote to the software developer leaf via token variants.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'software developer',
            topFamilyLabel: 'Software and applications developers and analysts',
            minimumConfidence: 0.85
        }
    }
];
export const PIPELINE_DEVELOPING_GOLDEN_CASES = [
    {
        caseKey: 'dev-en-sales-personnel-generic-wrapper-pollution',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'white_collar',
        query: 'Sales Personnel',
        locale: 'en',
        description: 'Generic occupational wrapper ("personnel") should not out-score the specific head word ("sales") in ngram_alias evidence. ' +
            'Currently "personnel" concentrates enough ngram_alias score in "Administration professionals" to crowd out the sales-domain ' +
            'families and the pipeline declines to resolve instead of picking a sales family. See core.md for the open hypotheses.',
        expectation: {
            decisionType: 'family',
            selectedLabel: 'Sales and purchasing agents and brokers',
            topFamilyLabel: 'Sales and purchasing agents and brokers',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-en-farrier',
        suite: 'developing',
        format: 'obscure_title',
        coverageKind: 'blue_collar',
        query: 'farrier',
        locale: 'en',
        description: 'Obscure animal-care craft title should resolve directly.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'farrier',
            topFamilyLabel: 'Blacksmiths, toolmakers and related trades workers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-drone-operator',
        suite: 'developing',
        format: 'obscure_title',
        coverageKind: 'transport',
        query: 'drone operator',
        locale: 'en',
        description: 'Modern market title should map to ESCO drone pilot.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'drone pilot',
            topFamilyLabel: 'Ship and aircraft controllers and technicians',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-beer-sommelier',
        suite: 'developing',
        format: 'obscure_title',
        coverageKind: 'service',
        query: 'beer sommelier',
        locale: 'en',
        description: 'Specialized hospitality title should not collapse to generic sommelier if a leaf exists.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'beer sommelier',
            topFamilyLabel: 'Waiters and bartenders',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-locksmith',
        suite: 'developing',
        format: 'obscure_title',
        coverageKind: 'blue_collar',
        query: 'locksmith',
        locale: 'en',
        description: 'Skilled trade title should resolve directly.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'locksmith',
            topFamilyLabel: 'Blacksmiths, toolmakers and related trades workers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-actuary',
        suite: 'developing',
        format: 'obscure_title',
        coverageKind: 'white_collar',
        query: 'actuary',
        locale: 'en',
        description: 'Common occupation synonym should map to actuarial consultant.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'actuarial consultant',
            topFamilyLabel: 'Mathematicians, actuaries and statisticians',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-social-media-content-creator',
        suite: 'developing',
        format: 'obscure_title',
        coverageKind: 'service',
        query: 'Social Media Content Creator',
        locale: 'en',
        description: 'Modern market title should avoid social-worker noise and land in the marketing/media branch.',
        expectation: {
            decisionType: 'family',
            selectedLabel: 'Sales, marketing and public relations professionals',
            topFamilyLabel: 'Sales, marketing and public relations professionals',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'dev-en-risk-manager',
        suite: 'developing',
        format: 'specialization_guard',
        coverageKind: 'management',
        query: 'risk manager',
        locale: 'en',
        description: 'Broad risk-manager title should avoid over-promoting narrower corporate risk manager unless evidence is exact.',
        expectation: {
            decisionType: 'family',
            selectedLabel: 'Finance managers',
            topFamilyLabel: 'Finance managers',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-en-content-creator',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'creative',
        query: 'content creator',
        locale: 'en',
        description: 'Modern broad creator title should land in a media/content branch without forcing an unsafe leaf.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Authors, journalists and linguists',
            minimumConfidence: 0.45
        }
    },
    {
        caseKey: 'dev-en-community-manager',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'service',
        query: 'community manager',
        locale: 'en',
        description: 'Ambiguous community manager should prefer online/community-management branch over generic management when evidence supports it.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'online community manager',
            topFamilyLabel: 'Sales, marketing and public relations professionals',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-medical-assistant',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'health',
        query: 'medical assistant',
        locale: 'en',
        description: 'Ambiguous assistant title should land in the health support branch, not generic administration.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Medical and pharmaceutical technicians',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-en-ux-designer',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'technology',
        query: 'UX designer',
        locale: 'en',
        description: 'Modern UX title should map to the closest interface/design occupation, not generic design work.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'user interface designer',
            topFamilyLabel: 'Software and applications developers and analysts',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-devops-engineer',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'technology',
        query: 'DevOps engineer',
        locale: 'en',
        description: 'Modern DevOps title should resolve to the closest ESCO cloud DevOps leaf when available.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'cloud DevOps engineer',
            topFamilyLabel: 'Software and applications developers and analysts',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-cybersecurity-analyst',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'technology',
        query: 'cybersecurity analyst',
        locale: 'en',
        description: 'Cybersecurity analyst should land in the ICT security/software analysis area without drifting to generic analyst roles.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Software and applications developers and analysts',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-en-seo-specialist',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'service',
        query: 'SEO specialist',
        locale: 'en',
        description: 'SEO specialist should resolve to ESCO search engine optimisation expert when available.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'search engine optimisation expert',
            topFamilyLabel: 'Software and applications developers and analysts',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-podcast-producer',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'creative',
        query: 'podcast producer',
        locale: 'en',
        description: 'Podcast producer should resolve directly when the modern ESCO leaf is available.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'podcast producer',
            topFamilyLabel: 'Creative and performing artists',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-solar-panel-installer',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'blue_collar',
        query: 'solar panel installer',
        locale: 'en',
        description: 'Solar panel installer should map to the closest renewable/electrical installation occupation or family.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'solar energy technician',
            topFamilyLabel: 'Electrical equipment installers and repairers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-hvac-technician',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'blue_collar',
        query: 'HVAC technician',
        locale: 'en',
        description: 'HVAC technician should resolve to refrigeration/air-conditioning mechanic or the correct installation/repair family.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'refrigeration and air conditioning mechanic',
            topFamilyLabel: 'Electrical equipment installers and repairers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-field-technician',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'blue_collar',
        query: 'Field Technician',
        locale: 'en',
        description: 'Broad field technician title should not let one supporting sales alias dominate recovered family authority.',
        expectation: {
            decisionType: 'family',
            selectedLabel: 'Physical and engineering science technicians',
            topFamilyLabel: 'Physical and engineering science technicians',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-en-cnc-operator',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'blue_collar',
        query: 'CNC machine operator',
        locale: 'en',
        description: 'CNC machine operator should map to the computer numerical control machine occupation area.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'computer numerical control machine operator',
            topFamilyLabel: 'Blacksmiths, toolmakers and related trades workers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-forklift-operator',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'transport',
        query: 'forklift operator',
        locale: 'en',
        description: 'Forklift operator should resolve to lift truck/forklift material-moving work.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'forklift operator',
            topFamilyLabel: 'Mobile plant operators',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-welder-fabricator',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'blue_collar',
        query: 'welder fabricator',
        locale: 'en',
        description: 'Welder fabricator should prefer welding/sheet-metal trades rather than generic manufacturing.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Sheet and structural metal workers, moulders and welders, and related workers',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-en-warehouse-picker',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'blue_collar',
        query: 'warehouse picker',
        locale: 'en',
        description: 'Warehouse picker should land in stock/warehouse handling rather than unrelated picker roles.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'warehouse worker',
            topFamilyLabel: 'Transport and storage labourers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-care-assistant',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'care_collar',
        query: 'care assistant',
        locale: 'en',
        description: 'Common European care-sector title should land in personal care rather than generic assistant roles.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Personal care workers in health services',
            minimumConfidence: 0.45
        }
    },
    {
        caseKey: 'dev-en-elderly-care-worker',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'care_collar',
        query: 'elderly care worker',
        locale: 'en',
        description: 'Elder-care title should map to aged-care/personal-care work common in EU labour markets.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Personal care workers in health services',
            minimumConfidence: 0.45
        }
    },
    {
        caseKey: 'dev-en-kitchen-assistant',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'service',
        query: 'kitchen assistant',
        locale: 'en',
        description: 'Common hospitality support title should land in kitchen/food preparation support.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'kitchen assistant',
            topFamilyLabel: 'Food preparation assistants',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-hotel-housekeeper',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'service',
        query: 'hotel housekeeper',
        locale: 'en',
        description: 'Hotel housekeeping title should land in cleaning/housekeeping rather than generic hotel service.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Domestic, hotel and office cleaners and helpers',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-en-construction-labourer',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'blue_collar',
        query: 'construction labourer',
        locale: 'en',
        description: 'Common EU construction labour title should land in building/construction labour work.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'building construction worker',
            topFamilyLabel: 'Mining and construction labourers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-bricklayer',
        suite: 'developing',
        format: 'obscure_title',
        coverageKind: 'blue_collar',
        query: 'bricklayer',
        locale: 'en',
        description: 'Core construction trade should resolve directly or to the masonry family.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'bricklayer',
            topFamilyLabel: 'Building frame and related trades workers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-roofer',
        suite: 'developing',
        format: 'obscure_title',
        coverageKind: 'blue_collar',
        query: 'roofer',
        locale: 'en',
        description: 'Common construction trade should resolve directly.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'roofer',
            topFamilyLabel: 'Building finishers and related trades workers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-truck-driver',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'transport',
        query: 'truck driver',
        locale: 'en',
        description: 'Common European logistics title should map to heavy truck driving work.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'cargo vehicle driver',
            topFamilyLabel: 'Heavy truck and bus drivers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-farm-worker',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'blue_collar',
        query: 'farm worker',
        locale: 'en',
        description: 'Common agricultural worker title should land in crop/farm labour or skilled agricultural work.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'crop production worker',
            topFamilyLabel: 'Agricultural, forestry and fishery labourers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-cleaner',
        suite: 'developing',
        format: 'short_form',
        coverageKind: 'service',
        query: 'cleaner',
        locale: 'en',
        description: 'Short common cleaning title should prefer general cleaner/cleaning family without over-specialization.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Domestic, hotel and office cleaners and helpers',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-ro-apicultor',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'blue_collar',
        query: 'apicultor',
        locale: 'ro',
        description: 'Romanian beekeeper title should map to bee breeder.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'bee breeder',
            topFamilyLabel: 'Animal producers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-ro-pilot-drona',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'transport',
        query: 'pilot de dronă',
        locale: 'ro',
        description: 'Romanian drone pilot phrase should map to drone pilot.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'drone pilot',
            topFamilyLabel: 'Ship and aircraft controllers and technicians',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-ro-imbalsamator',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'service',
        query: 'îmbălsămător',
        locale: 'ro',
        description: 'Romanian embalmer title should resolve directly.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'embalmer',
            topFamilyLabel: 'Other personal services workers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-ro-lacatus',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'blue_collar',
        query: 'lăcătuș',
        locale: 'ro',
        description: 'Romanian locksmith title should resolve directly.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'locksmith',
            topFamilyLabel: 'Blacksmiths, toolmakers and related trades workers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-ro-somelier-vin',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'service',
        query: 'somelier de vin',
        locale: 'ro',
        description: 'Romanian wine sommelier title should resolve to the specialized leaf.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'wine sommelier',
            topFamilyLabel: 'Waiters and bartenders',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-ro-contabile',
        suite: 'developing',
        format: 'plural_variant',
        coverageKind: 'white_collar',
        query: 'contabile',
        locale: 'ro',
        description: 'Romanian feminine/plural accounting form should prefer the finance family when leaf evidence is ambiguous.',
        expectation: {
            decisionType: 'family',
            selectedLabel: 'Finance professionals',
            topFamilyLabel: 'Finance professionals',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-ro-director-magazin-management-family',
        suite: 'developing',
        format: 'manager_title',
        coverageKind: 'management',
        query: 'director magazin',
        locale: 'ro',
        description: 'Romanian store-manager wording should keep the ranked family on retail management instead of drifting to non-management siblings.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'shop manager',
            topFamilyLabel: 'Retail and wholesale trade managers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-ro-personal-vanzari-wrapper-recall',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'white_collar',
        query: 'personal vânzări',
        locale: 'ro',
        description: 'Romanian sales-personnel wording should prefer a non-management sales family instead of collapsing to a generic sales token fallback.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Sales and purchasing agents and brokers',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-ro-analista-date',
        suite: 'developing',
        format: 'plural_variant',
        coverageKind: 'technology',
        query: 'analistă de date',
        locale: 'ro',
        description: 'Romanian feminine data analyst form should resolve through folded/local variant evidence.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'data analyst',
            topFamilyLabel: 'Software and applications developers and analysts',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-ro-dezvoltatoare-software',
        suite: 'developing',
        format: 'plural_variant',
        coverageKind: 'technology',
        query: 'dezvoltatoare software',
        locale: 'ro',
        description: 'Romanian feminine software developer form should resolve to software developer.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'software developer',
            topFamilyLabel: 'Software and applications developers and analysts',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-ro-asistenta-medicala',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'care_collar',
        query: 'asistentă medicală',
        locale: 'ro',
        description: 'Romanian nursing assistant/nurse phrase should land in the nursing family without unsafe specialization.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Nursing and midwifery professionals',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-ro-creator-continut-social-media',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'creative',
        query: 'creator de conținut social media',
        locale: 'ro',
        description: 'Romanian social media content creator should use cross-locale/media evidence to avoid social-work noise.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Sales, marketing and public relations professionals',
            minimumConfidence: 0.4
        }
    },
    {
        caseKey: 'dev-ro-multi-role-commercial-worker-kitchen-helper',
        suite: 'developing',
        format: 'multi_occupation_context',
        coverageKind: 'service',
        query: 'LUCRATOR COMERCIAL / AJUTOR BUCATAR FAST FOOD',
        locale: 'ro',
        description: 'Slash-separated Romanian title should resolve each surviving occupation span independently instead of combining evidence.',
        expectation: {
            decisionType: 'multi_span',
            spanCount: 2,
            spanExpectations: [
                {
                    query: 'LUCRATOR COMERCIAL',
                    decisionType: 'leaf',
                    minimumConfidence: 0.45
                },
                {
                    query: 'AJUTOR BUCATAR FAST FOOD',
                    topFamilyLabel: 'Food preparation assistants',
                    minimumConfidence: 0.45
                }
            ]
        }
    },
    {
        caseKey: 'dev-en-gender-marker-not-multi-span',
        suite: 'developing',
        format: 'noisy_recruiter',
        coverageKind: 'technology',
        query: 'software developer (m/f)',
        locale: 'en',
        description: 'Bracketed gender marker should be stripped as title noise and must not create multiple occupation spans.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'software developer',
            topFamilyLabel: 'Software and applications developers and analysts',
            spanCount: 0,
            minimumConfidence: 0.9
        }
    },
    {
        caseKey: 'dev-hu-szoftverfejleszto',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'technology',
        query: 'szoftverfejlesztő',
        locale: 'hu',
        description: 'Hungarian software developer compound should eventually benefit from compound splitting and local alias coverage.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'software developer',
            topFamilyLabel: 'Software and applications developers and analysts',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-hu-adatelemzo',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'technology',
        query: 'adatelemző',
        locale: 'hu',
        description: 'Hungarian data analyst compound should map to data analyst once HU coverage exists.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'data analyst',
            topFamilyLabel: 'Software and applications developers and analysts',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-hu-mehesz',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'blue_collar',
        query: 'méhész',
        locale: 'hu',
        description: 'Hungarian beekeeper title should map to bee breeder once HU aliases are available.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'bee breeder',
            topFamilyLabel: 'Animal producers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-hu-lakatos',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'blue_collar',
        query: 'lakatos',
        locale: 'hu',
        description: 'Hungarian locksmith title should map to locksmith once HU aliases are available.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'locksmith',
            topFamilyLabel: 'Blacksmiths, toolmakers and related trades workers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-hu-dronpilota',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'transport',
        query: 'drónpilóta',
        locale: 'hu',
        description: 'Hungarian drone pilot compound should map to drone pilot once HU aliases are available.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'drone pilot',
            topFamilyLabel: 'Ship and aircraft controllers and technicians',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-hu-ertekesitesi-szemelyzet-wrapper-recall',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'white_collar',
        query: 'értékesítési személyzet',
        locale: 'hu',
        description: 'Hungarian sales-personnel wording should prefer a non-management sales family instead of losing the sales modifier in alias fallback.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Sales and purchasing agents and brokers',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-hu-projekt-menedzser-management-family',
        suite: 'developing',
        format: 'manager_title',
        coverageKind: 'management',
        query: 'projekt menedzser',
        locale: 'hu',
        description: 'Hungarian project-manager wording should prefer the management branch once localized management intent is fully consumed.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'project manager',
            topFamilyLabel: 'Business services and administration managers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-et-tarkvaraarendaja',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'technology',
        query: 'tarkvaraarendaja',
        locale: 'et',
        description: 'Estonian software developer compound should eventually benefit from compound splitting and local alias coverage.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'software developer',
            topFamilyLabel: 'Software and applications developers and analysts',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-et-andmeanaluutik',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'technology',
        query: 'andmeanalüütik',
        locale: 'et',
        description: 'Estonian data analyst compound should map to data analyst once ET coverage exists.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'data analyst',
            topFamilyLabel: 'Software and applications developers and analysts',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-et-mesinik',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'blue_collar',
        query: 'mesinik',
        locale: 'et',
        description: 'Estonian beekeeper title should map to bee breeder once ET aliases are available.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'bee breeder',
            topFamilyLabel: 'Animal producers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-et-lukksepp',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'blue_collar',
        query: 'lukksepp',
        locale: 'et',
        description: 'Estonian locksmith title should map to locksmith once ET aliases are available.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'locksmith',
            topFamilyLabel: 'Blacksmiths, toolmakers and related trades workers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-et-droonipiloot',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'transport',
        query: 'droonipiloot',
        locale: 'et',
        description: 'Estonian drone pilot compound should map to drone pilot once ET aliases are available.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'drone pilot',
            topFamilyLabel: 'Ship and aircraft controllers and technicians',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-et-muugi-personal-wrapper-recall',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'white_collar',
        query: 'müügi personal',
        locale: 'et',
        description: 'Estonian sales-personnel wording should prefer a non-management sales family instead of drifting to sales managers from head-only alias fallback.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Sales and purchasing agents and brokers',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-et-poe-juht-management-family',
        suite: 'developing',
        format: 'manager_title',
        coverageKind: 'management',
        query: 'poe juht',
        locale: 'et',
        description: 'Estonian store-manager wording should prefer the retail-management branch instead of non-management or unrelated manager siblings.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'shop manager',
            topFamilyLabel: 'Retail and wholesale trade managers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-medical-receptionist-frontline',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'health',
        query: 'medical receptionist',
        locale: 'en',
        description: 'Medical venue context should promote the dedicated medical-reception branch over the generic receptionist leaf.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'front line medical receptionist',
            topFamilyLabel: 'Client information workers',
            minimumConfidence: 0.7
        }
    },
    {
        caseKey: 'dev-en-clinic-receptionist-frontline',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'health',
        query: 'clinic receptionist',
        locale: 'en',
        description: 'Clinic context should resolve to the medical-reception branch instead of generic reception work.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'front line medical receptionist',
            topFamilyLabel: 'Client information workers',
            minimumConfidence: 0.65
        }
    },
    {
        caseKey: 'dev-en-hospital-receptionist-frontline',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'health',
        query: 'hospital receptionist',
        locale: 'en',
        description: 'Hospital context should keep the receptionist role but narrow to the medical reception specialization.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'front line medical receptionist',
            topFamilyLabel: 'Client information workers',
            minimumConfidence: 0.65
        }
    },
    {
        caseKey: 'dev-en-dental-receptionist-client-family',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'health',
        query: 'dental receptionist',
        locale: 'en',
        description: 'Dental-office context should stay in the receptionist family and avoid drifting to unrelated admin or health-record roles.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Client information workers',
            minimumConfidence: 0.55
        }
    },
    {
        caseKey: 'dev-en-school-receptionist-client-family',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'education',
        query: 'school receptionist',
        locale: 'en',
        description: 'School context should not erase the receptionist head and turn the title into an education-admin role.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Client information workers',
            minimumConfidence: 0.55
        }
    },
    {
        caseKey: 'dev-en-retail-assistant-sales-assistant',
        suite: 'developing',
        format: 'synonym_alias',
        coverageKind: 'service',
        query: 'retail assistant',
        locale: 'en',
        description: 'Retail-assistant wording should converge with the existing sales-assistant leaf instead of abstaining or drifting to creative families.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'sales assistant',
            topFamilyLabel: 'Shop salespersons',
            minimumConfidence: 0.65
        }
    },
    {
        caseKey: 'dev-en-store-assistant-sales-assistant',
        suite: 'developing',
        format: 'synonym_alias',
        coverageKind: 'service',
        query: 'store assistant',
        locale: 'en',
        description: 'Store-assistant wording should also normalize to the shop-sales branch.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'sales assistant',
            topFamilyLabel: 'Shop salespersons',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'dev-en-kitchen-helper-kitchen-assistant',
        suite: 'developing',
        format: 'synonym_alias',
        coverageKind: 'service',
        query: 'kitchen helper',
        locale: 'en',
        description: 'Kitchen-helper wording should resolve to kitchen assistant instead of unrelated trades families.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'kitchen assistant',
            topFamilyLabel: 'Food preparation assistants',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'dev-en-cook-assistant-foodprep-family',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'service',
        query: 'cook assistant',
        locale: 'en',
        description: 'Cook-assistant phrasing should stay inside food-preparation assistants even when the exact leaf is uncertain.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Food preparation assistants',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-en-medical-secretary-medical-admin-assistant',
        suite: 'developing',
        format: 'synonym_alias',
        coverageKind: 'health',
        query: 'medical secretary',
        locale: 'en',
        description: 'Medical-secretary wording should prefer medical administrative assistant over generic secretary abstention.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'medical administrative assistant',
            topFamilyLabel: 'Administrative and specialised secretaries',
            minimumConfidence: 0.65
        }
    },
    {
        caseKey: 'dev-en-hospital-secretary-admin-family',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'health',
        query: 'hospital secretary',
        locale: 'en',
        description: 'Hospital secretary should remain in the specialised-secretary family, not drift to generic unresolved outcomes.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Administrative and specialised secretaries',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-en-medical-records-clerk',
        suite: 'developing',
        format: 'exact_title',
        coverageKind: 'health',
        query: 'medical records clerk',
        locale: 'en',
        description: 'Direct medical-records wording should resolve to the exact clerk leaf.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'medical records clerk',
            topFamilyLabel: 'Other health associate professionals',
            minimumConfidence: 0.75
        }
    },
    {
        caseKey: 'dev-en-courier-transport-family',
        suite: 'developing',
        format: 'short_form',
        coverageKind: 'transport',
        query: 'courier',
        locale: 'en',
        description: 'Generic courier wording should at least stay in a transport/delivery family instead of clerical drift.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Transport and storage labourers',
            minimumConfidence: 0.45
        }
    },
    {
        caseKey: 'dev-en-parcel-courier-transport-family',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'transport',
        query: 'parcel courier',
        locale: 'en',
        description: 'Parcel-delivery wording should remain in the transport/delivery branch.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Transport and storage labourers',
            minimumConfidence: 0.45
        }
    },
    {
        caseKey: 'dev-en-hotel-clerk-client-family',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'service',
        query: 'hotel clerk',
        locale: 'en',
        description: 'Hotel-clerk wording should stay in the client-information/reception family rather than call-centre clerk leaves.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Client information workers',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-en-aviation-compliance-officer-regulatory-family',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'transport',
        query: 'aviation compliance officer',
        locale: 'en',
        description: 'Aviation is domain context; compliance officer should prefer the regulatory/compliance branch rather than aviation-operations drift.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Regulatory government associate professionals',
            minimumConfidence: 0.45
        }
    },
    {
        caseKey: 'dev-en-airline-compliance-auditor-regulatory-family',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'transport',
        query: 'airline compliance auditor',
        locale: 'en',
        description: 'Airline domain context should support, not dominate, the compliance-auditor role intent.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Regulatory government associate professionals',
            minimumConfidence: 0.45
        }
    },
    {
        caseKey: 'dev-en-medical-receptionist-medical-secretary-multi-span',
        suite: 'developing',
        format: 'multi_occupation_context',
        coverageKind: 'health',
        query: 'medical receptionist / medical secretary',
        locale: 'en',
        description: 'Slash-separated recruiter titles should preserve distinct medical admin spans instead of blending evidence.',
        expectation: {
            decisionType: 'multi_span',
            minimumConfidence: 0.5,
            spanCount: 2,
            spanExpectations: [
                {
                    query: 'medical receptionist',
                    decisionType: 'leaf',
                    selectedLabel: 'front line medical receptionist',
                    topFamilyLabel: 'Client information workers',
                    minimumConfidence: 0.65
                },
                {
                    query: 'medical secretary',
                    decisionType: 'leaf',
                    selectedLabel: 'medical administrative assistant',
                    topFamilyLabel: 'Administrative and specialised secretaries',
                    minimumConfidence: 0.65
                }
            ]
        }
    },
    {
        caseKey: 'dev-en-sales-assistant-kitchen-assistant-multi-span',
        suite: 'developing',
        format: 'multi_occupation_context',
        coverageKind: 'service',
        query: 'sales assistant / kitchen assistant',
        locale: 'en',
        description: 'Independent sales and kitchen spans should each preserve their own leaf target.',
        expectation: {
            decisionType: 'multi_span',
            minimumConfidence: 0.5,
            spanCount: 2,
            spanExpectations: [
                {
                    query: 'sales assistant',
                    decisionType: 'leaf',
                    selectedLabel: 'sales assistant',
                    topFamilyLabel: 'Shop salespersons',
                    minimumConfidence: 0.7
                },
                {
                    query: 'kitchen assistant',
                    decisionType: 'leaf',
                    selectedLabel: 'kitchen assistant',
                    topFamilyLabel: 'Food preparation assistants',
                    minimumConfidence: 0.7
                }
            ]
        }
    },
    {
        caseKey: 'dev-ro-lucrator-comercial-sales-assistant',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'service',
        query: 'lucrator comercial',
        locale: 'ro',
        description: 'Romanian lucrator-comercial wording should map to sales assistant instead of retail-management families.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'sales assistant',
            topFamilyLabel: 'Shop salespersons',
            minimumConfidence: 0.65
        }
    },
    {
        caseKey: 'dev-ro-asistent-magazin-sales-assistant',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'service',
        query: 'asistent magazin',
        locale: 'ro',
        description: 'Store-assistant Romanian phrasing should converge with the sales-assistant leaf.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'sales assistant',
            topFamilyLabel: 'Shop salespersons',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'dev-ro-ajutor-bucatar-fast-food-crew-member',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'service',
        query: 'ajutor bucatar fast food',
        locale: 'ro',
        description: 'Fast-food kitchen-helper wording should prefer the quick-service crew leaf over broad cook families.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'quick service restaurant crew member',
            topFamilyLabel: 'Food preparation assistants',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'dev-ro-receptioner-hotel-hospitality-receptionist',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'service',
        query: 'receptioner hotel',
        locale: 'ro',
        description: 'Romanian hotel-reception wording should resolve to the hotel receptionist leaf, not restaurant-host leaves.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'hospitality establishment receptionist',
            topFamilyLabel: 'Client information workers',
            minimumConfidence: 0.65
        }
    },
    {
        caseKey: 'dev-ro-receptioner-pensiune-hospitality-receptionist',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'service',
        query: 'receptioner pensiune',
        locale: 'ro',
        description: 'Guesthouse reception should still stay in the hospitality receptionist branch.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'hospitality establishment receptionist',
            topFamilyLabel: 'Client information workers',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'dev-ro-receptioner-clinica-frontline-medical',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'health',
        query: 'receptioner clinica',
        locale: 'ro',
        description: 'Clinic context should keep the receptionist head but specialize into the medical reception branch.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'front line medical receptionist',
            topFamilyLabel: 'Client information workers',
            minimumConfidence: 0.65
        }
    },
    {
        caseKey: 'dev-ro-registrator-medical-medical-records-clerk',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'health',
        query: 'registrator medical',
        locale: 'ro',
        description: 'Medical registrar wording should resolve to medical records clerk rather than generic health families.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'medical records clerk',
            topFamilyLabel: 'Other health associate professionals',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'dev-ro-secretara-scoala-admin-family',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'education',
        query: 'secretara scoala',
        locale: 'ro',
        description: 'School secretary should remain in specialised secretarial work, not drift to unrelated education-support families.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Administrative and specialised secretaries',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-ro-operator-depozit-warehouse-worker',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'transport',
        query: 'operator depozit',
        locale: 'ro',
        description: 'Warehouse-operator wording should prefer warehouse work over process-control machinery families.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'warehouse worker',
            topFamilyLabel: 'Transport and storage labourers',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'dev-ro-curier-transport-family',
        suite: 'developing',
        format: 'short_form',
        coverageKind: 'transport',
        query: 'curier',
        locale: 'ro',
        description: 'Romanian courier should stay in the transport/delivery branch instead of abstaining with unrelated families.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Transport and storage labourers',
            minimumConfidence: 0.45
        }
    },
    {
        caseKey: 'dev-ro-auditor-conformitate-aviatie-regulatory-family',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'transport',
        query: 'auditor conformitate aviatie',
        locale: 'ro',
        description: 'Aviation is support context; compliance-auditor wording should prefer a regulatory/compliance family.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Regulatory government associate professionals',
            minimumConfidence: 0.45
        }
    },
    {
        caseKey: 'dev-ro-auditor-conformitate-regulatory-family',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'white_collar',
        query: 'auditor conformitate',
        locale: 'ro',
        description: 'Plain compliance-auditor Romanian wording should not collapse into the finance family by default.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Regulatory government associate professionals',
            minimumConfidence: 0.45
        }
    },
    {
        caseKey: 'dev-ro-femeie-serviciu-spital-cleaners-family',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'service',
        query: 'femeie de serviciu spital',
        locale: 'ro',
        description: 'Hospital cleaner wording should stay in the cleaner/helper family while treating hospital as context only.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Domestic, hotel and office cleaners and helpers',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-ro-operator-logistica-transport-clerks-family',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'transport',
        query: 'operator logistica',
        locale: 'ro',
        description: 'Logistics-operator wording should remain in logistics/material-recording clerical work.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Material-recording and transport clerks',
            minimumConfidence: 0.45
        }
    },
    {
        caseKey: 'dev-ro-lucrator-comercial-casier-multi-span',
        suite: 'developing',
        format: 'multi_occupation_context',
        coverageKind: 'service',
        query: 'lucrator comercial / casier',
        locale: 'ro',
        description: 'Slash-separated Romanian retail titles should preserve independent sales and cashier spans.',
        expectation: {
            decisionType: 'multi_span',
            minimumConfidence: 0.5,
            spanCount: 2,
            spanExpectations: [
                {
                    query: 'lucrator comercial',
                    decisionType: 'leaf',
                    selectedLabel: 'sales assistant',
                    topFamilyLabel: 'Shop salespersons',
                    minimumConfidence: 0.6
                },
                {
                    query: 'casier',
                    decisionType: 'leaf',
                    selectedLabel: 'cashier',
                    topFamilyLabel: 'Cashiers and ticket clerks',
                    minimumConfidence: 0.7
                }
            ]
        }
    },
    {
        caseKey: 'dev-ro-operator-depozit-curier-multi-span',
        suite: 'developing',
        format: 'multi_occupation_context',
        coverageKind: 'transport',
        query: 'operator depozit / curier',
        locale: 'ro',
        description: 'Warehouse and courier spans should not be pooled into one blended transport guess.',
        expectation: {
            decisionType: 'multi_span',
            minimumConfidence: 0.45,
            spanCount: 2,
            spanExpectations: [
                {
                    query: 'operator depozit',
                    decisionType: 'leaf',
                    selectedLabel: 'warehouse worker',
                    topFamilyLabel: 'Transport and storage labourers',
                    minimumConfidence: 0.6
                },
                {
                    query: 'curier',
                    decisionType: 'family',
                    topFamilyLabel: 'Transport and storage labourers',
                    minimumConfidence: 0.45
                }
            ]
        }
    },
    {
        caseKey: 'dev-hu-egeszsegugyi-recepcios-frontline',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'health',
        query: 'egészségügyi recepciós',
        locale: 'hu',
        description: 'Hungarian health-reception wording should classify recepciós as the role head and resolve into medical reception.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'front line medical receptionist',
            topFamilyLabel: 'Client information workers',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'dev-hu-orvosi-recepcios-frontline',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'health',
        query: 'orvosi recepciós',
        locale: 'hu',
        description: 'Medical receptionist in Hungarian should not collapse into unrelated health-technical families.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'front line medical receptionist',
            topFamilyLabel: 'Client information workers',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'dev-hu-fogaszati-recepcios-frontline',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'health',
        query: 'fogászati recepciós',
        locale: 'hu',
        description: 'Dental-office reception should stay in the receptionist branch rather than broad health-associate families.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Client information workers',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-hu-szallodai-recepcios-hospitality-receptionist',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'service',
        query: 'szállodai recepciós',
        locale: 'hu',
        description: 'Hotel receptionist in Hungarian should promote to the hospitality receptionist leaf.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'hospitality establishment receptionist',
            topFamilyLabel: 'Client information workers',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'dev-hu-klinikai-recepcios-client-family',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'health',
        query: 'klinikai recepciós',
        locale: 'hu',
        description: 'Clinic receptionist should preserve the receptionist head even when the exact medical leaf is uncertain.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Client information workers',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-hu-konyhai-kisegito-kitchen-assistant',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'service',
        query: 'konyhai kisegítő',
        locale: 'hu',
        description: 'Hungarian kitchen-helper wording should resolve to kitchen assistant instead of abstaining.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'kitchen assistant',
            topFamilyLabel: 'Food preparation assistants',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'dev-hu-gyorsetermi-dolgozo-quick-service',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'service',
        query: 'gyorséttermi dolgozó',
        locale: 'hu',
        description: 'Fast-food worker should map to the quick-service restaurant crew leaf.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'quick service restaurant crew member',
            topFamilyLabel: 'Food preparation assistants',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'dev-hu-raktari-dolgozo-warehouse-worker',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'transport',
        query: 'raktári dolgozó',
        locale: 'hu',
        description: 'Warehouse worker wording in Hungarian should avoid unrelated machine-operator families.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'warehouse worker',
            topFamilyLabel: 'Transport and storage labourers',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'dev-hu-raktari-munkas-warehouse-worker',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'transport',
        query: 'raktári munkás',
        locale: 'hu',
        description: 'Warehouse labour wording should converge with the generic warehouse worker leaf.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'warehouse worker',
            topFamilyLabel: 'Transport and storage labourers',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'dev-hu-orvosi-titkar-medical-admin',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'health',
        query: 'orvosi titkár',
        locale: 'hu',
        description: 'Medical secretary in Hungarian should resolve to the medical administrative assistant branch.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'medical administrative assistant',
            topFamilyLabel: 'Administrative and specialised secretaries',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'dev-hu-iskolai-titkar-admin-family',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'education',
        query: 'iskolai titkár',
        locale: 'hu',
        description: 'School secretary should stay in specialised secretarial work, not teaching-aide families.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Administrative and specialised secretaries',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-hu-futar-transport-family',
        suite: 'developing',
        format: 'short_form',
        coverageKind: 'transport',
        query: 'futár',
        locale: 'hu',
        description: 'Hungarian courier wording should land in the transport/delivery branch rather than administration families.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Transport and storage labourers',
            minimumConfidence: 0.4
        }
    },
    {
        caseKey: 'dev-hu-eladoi-asszisztens-sales-assistant',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'service',
        query: 'eladói asszisztens',
        locale: 'hu',
        description: 'Sales-assistant Hungarian wording should preserve the retail-sales branch.',
        expectation: {
            selectedFamilyLabel: 'Shop salespersons',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'dev-hu-adozasi-auditor-finance-family',
        suite: 'developing',
        format: 'localized_target',
        coverageKind: 'white_collar',
        query: 'adózási auditor',
        locale: 'hu',
        description: 'Tax-auditor Hungarian wording should stay in a finance/regulatory auditing family rather than unrelated admin branches.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Finance professionals',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-hu-recepcios-futar-multi-span',
        suite: 'developing',
        format: 'multi_occupation_context',
        coverageKind: 'service',
        query: 'recepciós / futár',
        locale: 'hu',
        description: 'Reception and courier spans should remain independent in Hungarian multi-role titles.',
        expectation: {
            decisionType: 'multi_span',
            minimumConfidence: 0.45,
            spanCount: 2,
            spanExpectations: [
                {
                    query: 'recepciós',
                    decisionType: 'leaf',
                    selectedLabel: 'receptionist',
                    topFamilyLabel: 'Client information workers',
                    minimumConfidence: 0.65
                },
                {
                    query: 'futár',
                    decisionType: 'family',
                    topFamilyLabel: 'Transport and storage labourers',
                    minimumConfidence: 0.4
                }
            ]
        }
    },
    {
        caseKey: 'dev-hu-raktari-dolgozo-recepcios-multi-span',
        suite: 'developing',
        format: 'multi_occupation_context',
        coverageKind: 'transport',
        query: 'raktári dolgozó / recepciós',
        locale: 'hu',
        description: 'Warehouse and receptionist spans should not be blended into one Hungarian family guess.',
        expectation: {
            decisionType: 'multi_span',
            minimumConfidence: 0.45,
            spanCount: 2,
            spanExpectations: [
                {
                    query: 'raktári dolgozó',
                    decisionType: 'leaf',
                    selectedLabel: 'warehouse worker',
                    topFamilyLabel: 'Transport and storage labourers',
                    minimumConfidence: 0.6
                },
                {
                    query: 'recepciós',
                    decisionType: 'leaf',
                    selectedLabel: 'receptionist',
                    topFamilyLabel: 'Client information workers',
                    minimumConfidence: 0.65
                }
            ]
        }
    }
];
// Sourced from a manual sample evaluation of real-world Romanian/English recruiter job titles
// (out-pipeline.csv). Each case records an observed misclassification and a "better direction" the
// pipeline should move toward. Expectations here are intentionally loose (moderate minimumConfidence,
// family-level rather than leaf-level where the correct leaf is unclear) because these are recorded as
// a regression baseline for future fixes, not settled target behaviour. Do not treat failures on these
// cases as blocking — see isBlockingGoldenCase.
export const PIPELINE_FAILURE_BASELINE_CASES = [
    {
        caseKey: 'dev-en-sales-network-specialist-not-medical-sales',
        suite: 'developing',
        format: 'noisy_recruiter',
        coverageKind: 'service',
        query: 'Sales Network Specialist - Divizia Suport Vanzari',
        locale: 'en',
        description: 'Nothing indicates medical sales; wrongly resolves to medical sales representative. Better direction: sales support / sales specialist.',
        expectation: { decisionType: 'family', topFamilyLabel: 'Sales, marketing and public relations professionals', minimumConfidence: 0.4 }
    },
    {
        caseKey: 'dev-en-operational-sea-freight-specialist-not-weather-forecaster',
        suite: 'developing',
        format: 'noisy_recruiter',
        coverageKind: 'transport',
        query: 'Operational / Sea Freight Specialist',
        locale: 'en',
        description: 'Completely unrelated result; wrongly resolves to weather forecaster. Better direction: shipping/freight/logistics specialist.',
        expectation: { decisionType: 'unresolved', minimumConfidence: 0 }
    },
    {
        caseKey: 'dev-en-product-strategist-not-copywriter',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'management',
        query: 'Product Strategist (Engine & Sealing)',
        locale: 'en',
        description: 'Product strategy is not copywriting. Better direction: product/services manager / product strategist.',
        expectation: { decisionType: 'unresolved', minimumConfidence: 0 }
    },
    {
        caseKey: 'dev-en-electrical-site-manager-not-mine-manager',
        suite: 'developing',
        format: 'manager_title',
        coverageKind: 'management',
        query: 'Electrical Site Manager',
        locale: 'en',
        description: 'No mining signal; wrongly resolves to mine manager. Better direction: electrical/construction site manager.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Manufacturing, mining, construction, and distribution managers',
            minimumConfidence: 0.4
        }
    },
    {
        caseKey: 'dev-en-digital-communications-specialist-not-publications-coordinator',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'creative',
        query: 'Digital Communications Specialist',
        locale: 'en',
        description: 'Likely communications/PR rather than publications coordination. Better direction: communications/PR specialist.',
        expectation: { decisionType: 'family', topFamilyLabel: 'Sales, marketing and public relations professionals', minimumConfidence: 0.4 }
    },
    {
        caseKey: 'dev-en-ptc-windchill-specialist-not-import-export',
        suite: 'developing',
        format: 'noisy_recruiter',
        coverageKind: 'technology',
        query: 'PTC Windchill Specialist',
        locale: 'en',
        description: 'Windchill is PLM/product-lifecycle software, not import/export. Better direction: ICT/business systems/PLM specialist.',
        expectation: { decisionType: 'unresolved', minimumConfidence: 0 }
    },
    {
        caseKey: 'dev-en-nc-programmer-not-generic-software-developer',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'blue_collar',
        query: 'NC Programmer',
        locale: 'en',
        description: 'NC strongly indicates numerical-control machine programming, not general software development. Better direction: CNC/NC machine programmer.',
        expectation: { decisionType: 'family', topFamilyLabel: 'Blacksmiths, toolmakers and related trades workers', minimumConfidence: 0.4 }
    },
    {
        caseKey: 'dev-en-crime-victim-support-officer',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'care_collar',
        query: 'crime victim support officer',
        locale: 'en',
        description: 'Isolates population specialization matching on its own: victim support officer for a crime-victim support query, over generic support-worker leaves.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'victim support officer',
            topFamilyLabel: 'Social and religious professionals',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'dev-en-post-clerk-mail-channel',
        suite: 'developing',
        format: 'short_form',
        coverageKind: 'white_collar',
        query: 'post clerk',
        locale: 'en',
        description: 'Isolates channel specialization matching on its own: "post" as a synonym for "mail" should resolve to mail clerk over other generic clerk leaves.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'mail clerk',
            topFamilyLabel: 'Other clerical support workers',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'dev-en-qa-qc-inspector-not-manager',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'technology',
        query: 'QA/QC Inspector',
        locale: 'en',
        description: 'Inspector is not a manager. Better direction: quality inspector.',
        expectation: { decisionType: 'family', minimumConfidence: 0.4 }
    },
    {
        caseKey: 'dev-ro-consilier-vanzari-not-insurance-broker',
        suite: 'developing',
        format: 'noisy_recruiter',
        coverageKind: 'service',
        query: 'Consilier de vânzări (m/f)',
        locale: 'ro',
        description: 'Sales counsellor wrongly resolves to insurance broker. Better direction: sales assistant / commercial sales representative.',
        expectation: { selectedFamilyLabel: 'Shop salespersons', minimumConfidence: 0.4 }
    },
    {
        caseKey: 'dev-ro-operator-calculator-magazin-online-no-cad-signal',
        suite: 'developing',
        format: 'noisy_recruiter',
        coverageKind: 'service',
        query: 'Operator calculator - Magazin Online',
        locale: 'ro',
        description: 'No CAD signal at all; wrongly resolves to computer-aided design operator. Better direction: clerical/online-shop/computer operator.',
        expectation: { decisionType: 'unresolved', minimumConfidence: 0 }
    },
    {
        caseKey: 'dev-ro-electrician-intretinere-reparatii-no-mining-context',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'blue_collar',
        query: 'Electrician întreţinere şi reparaţii',
        locale: 'ro',
        description: 'No mining context; wrongly resolves to mining electrician. Better direction: electrician / industrial maintenance electrician.',
        expectation: { decisionType: 'family', topFamilyLabel: 'Electrical equipment installers and repairers', minimumConfidence: 0.5 }
    },
    {
        caseKey: 'dev-ro-electrician-tehnician-retele-not-inspector',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'blue_collar',
        query: 'Electrician -Tehnician retele echipamente electrice,date-voce',
        locale: 'ro',
        description: 'Title is installation/network/electrical technician, not inspector. Better direction: electrician / telecom/network technician.',
        expectation: { decisionType: 'family', topFamilyLabel: 'Electrical equipment installers and repairers', minimumConfidence: 0.4 }
    },
    {
        caseKey: 'dev-ro-jurist-not-linguist',
        suite: 'developing',
        format: 'short_form',
        coverageKind: 'white_collar',
        query: 'Jurist',
        locale: 'ro',
        description: 'Completely different profession; wrongly resolves to linguist. Better direction: legal professional / legal consultant.',
        expectation: { selectedLeafLabel: 'legal consultant', selectedFamilyLabel: 'Legal professionals', minimumConfidence: 0.5 }
    },
    {
        caseKey: 'dev-ro-asistent-manager-flota-not-clothing',
        suite: 'developing',
        format: 'noisy_recruiter',
        coverageKind: 'white_collar',
        query: 'Asistent Manager Flotă & Administrativ',
        locale: 'ro',
        description: 'No clothing/development signal; wrongly resolves to clothing development manager. Better direction: management assistant / administrative assistant.',
        expectation: { selectedFamilyLabel: 'Administration professionals', minimumConfidence: 0.35 }
    },
    {
        caseKey: 'dev-ro-tehnician-audit-produs-not-automotive-engine',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'technology',
        query: 'Tehnician audit de produs',
        locale: 'ro',
        description: 'No automotive-engine signal; wrongly resolves to motor vehicle engine tester. Better direction: product/quality inspection technician.',
        expectation: { decisionType: 'family', topFamilyLabel: 'Physical and engineering science technicians', minimumConfidence: 0.4 }
    },
    {
        caseKey: 'dev-ro-sef-tura-patiserie-not-refinery',
        suite: 'developing',
        format: 'noisy_recruiter',
        coverageKind: 'service',
        query: 'Sef tura patiserie Delissima Bakery',
        locale: 'ro',
        description: 'Bakery is not a refinery; wrongly resolves to refinery shift manager. Better direction: food-production/shift supervisor.',
        expectation: { decisionType: 'family', minimumConfidence: 0.4 }
    },
    {
        caseKey: 'dev-ro-inginer-tehnolog-industria-carnii-engineer-not-generic-technician',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'technology',
        query: 'Inginer Tehnolog-Industria Cărnii',
        locale: 'ro',
        description: '"Engineer/technologist" is stronger evidence than generic technician. Better direction: food technologist / food engineer.',
        expectation: { decisionType: 'family', topFamilyLabel: 'Food processing and related trades workers', minimumConfidence: 0.4 }
    },
    {
        caseKey: 'dev-ro-manager-program-not-hr-manager',
        suite: 'developing',
        format: 'manager_title',
        coverageKind: 'management',
        query: 'Manager Program',
        locale: 'ro',
        description: '"Program manager" is not an HR manager. Better direction: project/program manager.',
        expectation: { decisionType: 'family', minimumConfidence: 0.4 }
    },
    {
        caseKey: 'dev-ro-interfata-terti-departamente-not-ui-designer',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'white_collar',
        query: 'Interfata terti si alte departamente',
        locale: 'ro',
        description: 'Romanian means interface/liaison with third parties/departments, not UI design. Better direction: administrative/coordinator/client-relations role.',
        expectation: { decisionType: 'unresolved', minimumConfidence: 0 }
    },
    {
        caseKey: 'dev-ro-sales-advisor-nespresso-not-insurance',
        suite: 'developing',
        format: 'noisy_recruiter',
        coverageKind: 'service',
        query: 'Sales Advisor Nespresso Boutique',
        locale: 'ro',
        description: 'Retail coffee sales is not insurance. "Advisor" plus the boutique/product context legitimately favors specialised seller over the plain sales assistant.',
        expectation: { decisionType: 'leaf', selectedLabel: 'specialised seller', topFamilyLabel: 'Shop salespersons', minimumConfidence: 0.5 }
    },
    {
        caseKey: 'dev-ro-consultant-it-sap-isu-not-bioinformatics',
        suite: 'developing',
        format: 'noisy_recruiter',
        coverageKind: 'technology',
        query: 'Consultant IT SAP IS-U',
        locale: 'ro',
        description: 'SAP IS-U has nothing to do with bioinformatics. Better direction: business/ICT consultant.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Information and communications technology service managers',
            minimumConfidence: 0.4
        }
    },
    {
        caseKey: 'dev-ro-consultant-financiar-not-public-finance-accountant',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'white_collar',
        query: 'Consultant Financiar',
        locale: 'ro',
        description: 'Financial consultant is not a public finance accountant. Better direction: financial adviser/planner/consultant.',
        expectation: { decisionType: 'family', topFamilyLabel: 'Finance professionals', minimumConfidence: 0.4 }
    },
    {
        caseKey: 'dev-ro-lucrator-comercial-hervis-not-store-manager',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'service',
        query: 'Lucrator comercial Full Time - Hervis',
        locale: 'ro',
        description: 'Explicitly a commercial worker/salesperson, not a manager. Better direction: sales assistant.',
        expectation: { selectedFamilyLabel: 'Shop salespersons', minimumConfidence: 0.5 }
    },
    {
        caseKey: 'dev-ro-operator-musa-brasov-no-bakery-signal',
        suite: 'developing',
        format: 'noisy_recruiter',
        coverageKind: 'blue_collar',
        query: 'Operator musa Brasov',
        locale: 'ro',
        description: 'No bakery signal in the source title; needs investigation, likely a generic machine/operator occupation.',
        expectation: { decisionType: 'unresolved', minimumConfidence: 0 }
    },
    {
        caseKey: 'dev-ro-coordonator-logistica-balotesti-not-compensation-analyst',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'transport',
        query: 'Coordonator Logistică - Balotești',
        locale: 'ro',
        description: 'Logistics is not compensation/payroll. Better direction: logistics coordinator / logistics specialist.',
        expectation: { decisionType: 'family', topFamilyLabel: 'Transport and storage labourers', minimumConfidence: 0.4 }
    },
    {
        caseKey: 'dev-ro-operator-cnc-not-textile',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'blue_collar',
        query: 'OPERATOR MAȘINI-UNELTE CU COMANDĂ NUMERICĂ (CNC)',
        locale: 'ro',
        description: 'Explicit CNC machine tools, not textiles. Better direction: CNC machine-tool operator.',
        expectation: { decisionType: 'family', topFamilyLabel: 'Blacksmiths, toolmakers and related trades workers', minimumConfidence: 0.4 }
    },
    {
        caseKey: 'dev-ro-inginer-electronist-not-precision-engineer',
        suite: 'developing',
        format: 'short_form',
        coverageKind: 'technology',
        query: 'INGINER ELECTRONIST/ ELECTRONIST',
        locale: 'ro',
        description: 'Electronics is not precision engineering. Better direction: electronics engineer.',
        expectation: { decisionType: 'family', topFamilyLabel: 'Electrotechnology engineers', minimumConfidence: 0.4 }
    },
    {
        caseKey: 'dev-ro-mecanic-utilaje-industriale-not-assembler',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'blue_collar',
        query: 'Mecanic utilaje industriale',
        locale: 'ro',
        description: 'Mechanic repairs/maintains machinery; assembler is a different occupation. Better direction: machinery mechanic/repairer.',
        expectation: { decisionType: 'family', topFamilyLabel: 'Machinery mechanics and repairers', minimumConfidence: 0.5 }
    },
    {
        caseKey: 'dev-ro-frigotehnist-service-horeca-not-customer-service',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'blue_collar',
        query: 'Frigotehnist/Tehnician service HORECA',
        locale: 'ro',
        description: '"Service" here means technical servicing, not customer service. Better direction: refrigeration/HVAC technician.',
        expectation: { decisionType: 'family', minimumConfidence: 0.4 }
    },
    {
        caseKey: 'dev-ro-lucrator-logistica-not-analyst',
        suite: 'developing',
        format: 'short_form',
        coverageKind: 'transport',
        query: 'Lucrător logistică (m/f)',
        locale: 'ro',
        description: 'Generic logistics worker is not an analyst. Better direction: logistics/warehouse occupation.',
        expectation: { decisionType: 'family', topFamilyLabel: 'Transport and storage labourers', minimumConfidence: 0.4 }
    },
    {
        caseKey: 'dev-ro-lacatus-mecanic-reparatii-utilaje-constructii-not-assembler',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'blue_collar',
        query: 'Lacatus mecanic reparatii utilaje de constructii',
        locale: 'ro',
        description: 'Repair mechanic is not an assembler. Better direction: machinery mechanic.',
        expectation: { decisionType: 'family', topFamilyLabel: 'Machinery mechanics and repairers', minimumConfidence: 0.5 }
    },
    {
        caseKey: 'dev-ro-kfc-bran-insufficient-signal',
        suite: 'developing',
        format: 'noisy_recruiter',
        coverageKind: 'service',
        query: 'KFC Bran cauta colegi!',
        locale: 'ro',
        description: 'Generic hiring advert provides no occupation evidence and wrongly resolves to demolition supervisor. Should be rejected as insufficiently descriptive.',
        expectation: { decisionType: 'unresolved', minimumConfidence: 0 }
    },
    {
        caseKey: 'dev-ro-specialist-ofertare-hvac-not-drafter',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'blue_collar',
        query: 'Specialist Ofertare Echipamente HVAC',
        locale: 'ro',
        description: '"Offering/quoting specialist" is not a drafter. Better direction: technical sales/estimator/procurement.',
        expectation: { decisionType: 'unresolved', minimumConfidence: 0 }
    },
    {
        caseKey: 'dev-ro-cautam-manager-de-tura-not-refinery',
        suite: 'developing',
        format: 'noisy_recruiter',
        coverageKind: 'management',
        query: 'Cautam manager de tura!',
        locale: 'ro',
        description: 'Generic shift manager does not imply a refinery. Better direction: shift supervisor/manager.',
        expectation: { decisionType: 'unresolved', minimumConfidence: 0 }
    },
    {
        caseKey: 'dev-ro-senior-consultant-sap-sd-not-solar-energy',
        suite: 'developing',
        format: 'noisy_recruiter',
        coverageKind: 'technology',
        query: 'Senior Consultant SAP SD',
        locale: 'ro',
        description: 'SAP SD is not solar energy. Better direction: SAP/business/ICT consultant.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Information and communications technology service managers',
            minimumConfidence: 0.4
        }
    },
    {
        caseKey: 'dev-ro-inginer-devize-ofertare-retele-edilitare-not-telecom-technician',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'white_collar',
        query: 'Inginer devize ofertare - retele edilitare',
        locale: 'ro',
        description: 'Cost estimation for utilities is not telecom technician work. Better direction: quantity surveyor/cost estimator.',
        expectation: { decisionType: 'unresolved', minimumConfidence: 0 }
    },
    {
        caseKey: 'dev-ro-biolog-medical-specialist-not-nurse',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'health',
        query: 'Biolog medical specialist',
        locale: 'ro',
        description: 'Biologist is not a nurse. Better direction: biologist / medical laboratory professional.',
        expectation: { decisionType: 'unresolved', minimumConfidence: 0 }
    },
    {
        caseKey: 'dev-ro-racordare-cabluri-medie-tensiune-not-pharmacist',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'blue_collar',
        query: 'Specialist cu experiență în racordarea cablurilor de medie tensiune',
        locale: 'ro',
        description: 'Completely unrelated result; wrongly resolves to specialist pharmacist. Better direction: electrical/electrical installation occupation.',
        expectation: { decisionType: 'family', topFamilyLabel: 'Electrical equipment installers and repairers', minimumConfidence: 0.4 }
    },
    {
        caseKey: 'dev-ro-tehnician-mentenanta-no-airport-context',
        suite: 'developing',
        format: 'short_form',
        coverageKind: 'blue_collar',
        query: 'Tehnician Mentenanta',
        locale: 'ro',
        description: 'No airport context; wrongly resolves to airport maintenance technician. Better direction: maintenance technician.',
        expectation: { decisionType: 'family', minimumConfidence: 0.4 }
    },
    {
        caseKey: 'dev-ro-medic-de-familie-not-veterinarian',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'health',
        query: 'Medic de familie si medici specialitati clinice',
        locale: 'ro',
        description: 'Human physicians are not veterinarians. Better direction: medical doctor.',
        expectation: { selectedFamilyLabel: 'Medical doctors', minimumConfidence: 0.35 }
    },
    {
        caseKey: 'dev-ro-mecanic-stivuitoare-not-attendant',
        suite: 'developing',
        format: 'short_form',
        coverageKind: 'blue_collar',
        query: 'Mecanic stivuitoare',
        locale: 'ro',
        description: 'Forklift mechanic is not an attendant. Better direction: machinery/vehicle mechanic.',
        expectation: { decisionType: 'family', topFamilyLabel: 'Machinery mechanics and repairers', minimumConfidence: 0.4 }
    },
    {
        caseKey: 'dev-ro-sudor-mig-mag-wrong-welding-specialization',
        suite: 'developing',
        format: 'specialization_guard',
        coverageKind: 'blue_collar',
        query: 'Sudor MIG/MAG',
        locale: 'ro',
        description: 'Welding family is right but the laser-beam-welder specialization is wrong. Better direction: welder / arc welder.',
        expectation: {
            decisionType: 'family',
            topFamilyLabel: 'Sheet and structural metal workers, moulders and welders, and related workers',
            minimumConfidence: 0.5
        }
    },
    {
        caseKey: 'dev-ro-tehnician-service-sisteme-securitate-not-customer-service',
        suite: 'developing',
        format: 'ambiguous_title',
        coverageKind: 'blue_collar',
        query: 'Tehnician Service Sisteme de Securitate',
        locale: 'ro',
        description: 'Technical security-system servicing is not customer service. Better direction: security systems technician.',
        expectation: { decisionType: 'unresolved', minimumConfidence: 0 }
    },
    {
        caseKey: 'dev-ro-mecanic-auto-not-bicycle-mechanic',
        suite: 'developing',
        format: 'specialization_guard',
        coverageKind: 'blue_collar',
        query: 'Mecanic auto',
        locale: 'ro',
        description: 'Auto mechanic is not a bicycle mechanic.',
        expectation: { decisionType: 'family', topFamilyLabel: 'Machinery mechanics and repairers', minimumConfidence: 0.5 }
    },
    {
        caseKey: 'dev-ro-magaziner-iscir-not-clothing-warehouse',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'blue_collar',
        query: 'Magaziner cu Autorizatie ISCIR',
        locale: 'ro',
        description: 'No clothing signal; wrongly resolves to warehouse operator for clothing. Better direction: warehouse/storekeeper.',
        expectation: { decisionType: 'family', topFamilyLabel: 'Transport and storage labourers', minimumConfidence: 0.4 }
    },
    {
        caseKey: 'dev-ro-operatori-productie-smt-not-cosmetics',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'blue_collar',
        query: 'Operatori productie si Operatori SMT',
        locale: 'ro',
        description: 'SMT means electronics surface-mount technology, not cosmetics. Better direction: electronics/SMT production operator.',
        expectation: { decisionType: 'unresolved', minimumConfidence: 0 }
    },
    {
        caseKey: 'dev-ro-operator-productie-satu-mare-generic-not-cosmetics',
        suite: 'developing',
        format: 'noisy_recruiter',
        coverageKind: 'blue_collar',
        query: 'Operator productie Satu Mare',
        locale: 'ro',
        description: 'Generic production title contains no cosmetics evidence; wrongly resolves to cosmetics production machine operator.',
        expectation: { decisionType: 'unresolved', minimumConfidence: 0 }
    },
    {
        caseKey: 'dev-ro-inginer-calitate-quality-engineer',
        suite: 'developing',
        format: 'short_form',
        coverageKind: 'white_collar',
        query: 'Inginer calitate',
        locale: 'ro',
        description: 'One of the most common Romanian job titles in real listings; should resolve to quality engineer.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'quality engineer',
            topFamilyLabel: 'Engineering professionals (excluding electrotechnology)',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'dev-ro-manager-resurse-umane-hr-manager',
        suite: 'developing',
        format: 'short_form',
        coverageKind: 'service',
        query: 'Manager Resurse Umane',
        locale: 'ro',
        description: 'Common Romanian HR-manager title should resolve cleanly to the human resources manager leaf.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'human resources manager',
            topFamilyLabel: 'Business services and administration managers',
            minimumConfidence: 0.8
        }
    },
    {
        caseKey: 'dev-ro-educator-puericultor-not-zoo-educator',
        suite: 'developing',
        format: 'descriptive',
        coverageKind: 'service',
        query: 'Educator Puericultor',
        locale: 'ro',
        description: 'Common Romanian childcare title ("puericultor" = nursery/childcare educator) wrongly resolves to zoo educator; better direction: nanny/child care worker.',
        expectation: { decisionType: 'family', topFamilyLabel: 'Child care workers and teachers’ aides', minimumConfidence: 0.4 }
    },
    {
        caseKey: 'dev-ro-vanzator-dulciuri-confectionery-seller',
        suite: 'developing',
        format: 'short_form',
        coverageKind: 'service',
        query: 'Vanzator dulciuri',
        locale: 'ro',
        description: 'Isolates product specialization matching on its own (no industry_context riding along): confectionery seller for a sweets seller query.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'confectionery specialised seller',
            topFamilyLabel: 'Shop salespersons',
            minimumConfidence: 0.6
        }
    },
    {
        caseKey: 'dev-ro-vanzator-mobila-furniture-seller',
        suite: 'developing',
        format: 'short_form',
        coverageKind: 'service',
        query: 'Vanzator mobila',
        locale: 'ro',
        description: 'Isolates product specialization matching on its own: furniture seller for a furniture-shop assistant query.',
        expectation: {
            decisionType: 'leaf',
            selectedLabel: 'furniture specialised seller',
            topFamilyLabel: 'Shop salespersons',
            minimumConfidence: 0.6
        }
    }
];
export const ALL_PIPELINE_GOLDEN_CASES = [
    ...PIPELINE_GOLDEN_CASES,
    ...PIPELINE_DEVELOPING_GOLDEN_CASES,
    ...PIPELINE_FAILURE_BASELINE_CASES
];
export class PipelineGoldenSuiteRunner {
    _connection;
    constructor(_connection) {
        this._connection = _connection;
    }
    async run(options = {}) {
        const sourceName = options.sourceName?.trim() || DEFAULT_ESCO_SOURCE_NAME;
        const modelKey = options.modelKey?.trim() || DEFAULT_MODEL_KEY;
        const retrievalProfile = DEFAULT_RETRIEVAL_PROFILE;
        const suite = normalizeSuiteSelection(options.suite);
        const selectedCaseKeys = new Set(options.caseKeys ?? []);
        const suiteCases = casesForSuite(suite);
        const cases = selectedCaseKeys.size > 0 ? suiteCases.filter((goldenCase) => selectedCaseKeys.has(goldenCase.caseKey)) : suiteCases;
        if (cases.length === 0) {
            throw new Error('No golden cases matched the provided --case-key filters.');
        }
        const pipeline = options.runtime
            ? OccupationSearchPipeline.withRuntime(options.runtime)
            : options.retrievalEngine
                ? OccupationSearchPipeline.withEngine(options.retrievalEngine)
                : new OccupationSearchPipeline();
        const results = [];
        for (const goldenCase of cases) {
            const result = await pipeline.run({
                query: goldenCase.query,
                locale: goldenCase.locale || DEFAULT_RETRIEVAL_LOCALE,
                sourceName,
                limit: options.limit,
                siblingLimit: options.siblingLimit ?? DEFAULT_SIBLING_LIMIT
            });
            const topFamily = result.rankedFamilies[0] ?? null;
            const actual = {
                decisionType: result.decision.decisionType,
                selectedLabel: result.decision.selectedLabel,
                selectedLeafLabel: result.rankedLeaves[0]?.canonicalLabel ?? null,
                selectedFamilyLabel: topFamily?.familyLabel ?? null,
                confidence: result.decision.confidence,
                topFamilyLabel: topFamily?.familyLabel ?? null,
                spans: result.spanResults.map((span) => ({
                    query: span.query,
                    decisionType: span.decision.decisionType,
                    selectedLabel: span.decision.selectedLabel,
                    selectedLeafLabel: span.rankedLeaves[0]?.canonicalLabel ?? null,
                    selectedFamilyLabel: span.rankedFamilies[0]?.familyLabel ?? null,
                    confidence: span.decision.confidence,
                    topFamilyLabel: span.rankedFamilies[0]?.familyLabel ?? null
                }))
            };
            const failures = evaluateCase(goldenCase, actual);
            results.push({
                case: goldenCase,
                passed: failures.length === 0,
                failures,
                actual
            });
        }
        const passed = results.filter((result) => result.passed).length;
        return {
            sourceName,
            modelKey,
            retrievalProfile,
            suite,
            total: results.length,
            passed,
            failed: results.length - passed,
            blockingFailed: results.filter((result) => !result.passed && isBlockingGoldenCase(result.case)).length,
            results
        };
    }
}
function normalizeSuiteSelection(value) {
    if (value === undefined) {
        return 'stable';
    }
    if (value === 'stable' || value === 'developing' || value === 'all') {
        return value;
    }
    throw new Error(`Unsupported golden suite "${value}". Use stable, developing, or all.`);
}
function casesForSuite(suite) {
    if (suite === 'stable') {
        return PIPELINE_GOLDEN_CASES;
    }
    if (suite === 'developing') {
        return [...PIPELINE_DEVELOPING_GOLDEN_CASES, ...PIPELINE_FAILURE_BASELINE_CASES];
    }
    return ALL_PIPELINE_GOLDEN_CASES.sort((a, b) => LOCALE_ORDER.indexOf(a.locale) - LOCALE_ORDER.indexOf(b.locale));
}
function isBlockingGoldenCase(goldenCase) {
    return (goldenCase.suite ?? 'stable') !== 'developing';
}
function evaluateCase(goldenCase, actual) {
    const failures = [];
    const expectation = effectiveExpectationForEvaluation(goldenCase);
    if (expectation.decisionType !== undefined && actual.decisionType !== expectation.decisionType) {
        failures.push(`decisionType expected ${expectation.decisionType}, got ${actual.decisionType}`);
    }
    if (expectation.selectedLabel !== undefined && normalizeLabel(actual.selectedLabel) !== normalizeLabel(expectation.selectedLabel)) {
        failures.push(`selectedLabel expected "${expectation.selectedLabel}", got "${actual.selectedLabel ?? 'null'}"`);
    }
    if (expectation.selectedLeafLabel !== undefined &&
        normalizeLabel(actual.selectedLeafLabel) !== normalizeLabel(expectation.selectedLeafLabel)) {
        failures.push(`selectedLeafLabel expected "${expectation.selectedLeafLabel}", got "${actual.selectedLeafLabel ?? 'null'}"`);
    }
    if (expectation.selectedFamilyLabel !== undefined &&
        normalizeLabel(actual.selectedFamilyLabel) !== normalizeLabel(expectation.selectedFamilyLabel)) {
        failures.push(`selectedFamilyLabel expected "${expectation.selectedFamilyLabel}", got "${actual.selectedFamilyLabel ?? 'null'}"`);
    }
    if (expectation.topFamilyLabel !== undefined && normalizeLabel(actual.topFamilyLabel) !== normalizeLabel(expectation.topFamilyLabel)) {
        failures.push(`topFamilyLabel expected "${expectation.topFamilyLabel}", got "${actual.topFamilyLabel ?? 'null'}"`);
    }
    if (expectation.minimumConfidence !== undefined && actual.confidence < expectation.minimumConfidence) {
        failures.push(`confidence expected >= ${formatPercent(expectation.minimumConfidence)}, got ${formatPercent(actual.confidence)}`);
    }
    if (expectation.spanCount !== undefined && actual.spans.length !== expectation.spanCount) {
        failures.push(`spanCount expected ${expectation.spanCount}, got ${actual.spans.length}`);
    }
    for (const spanExpectation of expectation.spanExpectations ?? []) {
        const spanActual = actual.spans.find((span) => normalizeLabel(span.query) === normalizeLabel(spanExpectation.query));
        if (!spanActual) {
            failures.push(`span "${spanExpectation.query}" was not produced`);
            continue;
        }
        if (spanExpectation.decisionType !== undefined && spanActual.decisionType !== spanExpectation.decisionType) {
            failures.push(`span "${spanExpectation.query}" decisionType expected ${spanExpectation.decisionType}, got ${spanActual.decisionType}`);
        }
        if (spanExpectation.selectedLabel !== undefined &&
            normalizeLabel(spanActual.selectedLabel) !== normalizeLabel(spanExpectation.selectedLabel)) {
            failures.push(`span "${spanExpectation.query}" selectedLabel expected "${spanExpectation.selectedLabel}", got "${spanActual.selectedLabel ?? 'null'}"`);
        }
        if (spanExpectation.selectedLeafLabel !== undefined &&
            normalizeLabel(spanActual.selectedLeafLabel) !== normalizeLabel(spanExpectation.selectedLeafLabel)) {
            failures.push(`span "${spanExpectation.query}" selectedLeafLabel expected "${spanExpectation.selectedLeafLabel}", got "${spanActual.selectedLeafLabel ?? 'null'}"`);
        }
        if (spanExpectation.selectedFamilyLabel !== undefined &&
            normalizeLabel(spanActual.selectedFamilyLabel) !== normalizeLabel(spanExpectation.selectedFamilyLabel)) {
            failures.push(`span "${spanExpectation.query}" selectedFamilyLabel expected "${spanExpectation.selectedFamilyLabel}", got "${spanActual.selectedFamilyLabel ?? 'null'}"`);
        }
        if (spanExpectation.topFamilyLabel !== undefined &&
            normalizeLabel(spanActual.topFamilyLabel) !== normalizeLabel(spanExpectation.topFamilyLabel)) {
            failures.push(`span "${spanExpectation.query}" topFamilyLabel expected "${spanExpectation.topFamilyLabel}", got "${spanActual.topFamilyLabel ?? 'null'}"`);
        }
        if (spanExpectation.minimumConfidence !== undefined && spanActual.confidence < spanExpectation.minimumConfidence) {
            failures.push(`span "${spanExpectation.query}" confidence expected >= ${formatPercent(spanExpectation.minimumConfidence)}, got ${formatPercent(spanActual.confidence)}`);
        }
    }
    return failures;
}
function effectiveExpectationForEvaluation(goldenCase) {
    if (goldenCase.suite !== 'developing') {
        return goldenCase.expectation;
    }
    return {
        ...normalizeDevelopingSelectionExpectation(goldenCase.expectation),
        spanExpectations: (goldenCase.expectation.spanExpectations ?? []).map(normalizeDevelopingSpanExpectation)
    };
}
function normalizeDevelopingSelectionExpectation(expectation) {
    const isGateExpectation = expectation.decisionType === 'multi_span' || expectation.decisionType === 'unresolved';
    if (isGateExpectation) {
        return expectation;
    }
    return {
        selectedLeafLabel: expectation.selectedLeafLabel ?? (expectation.decisionType === 'leaf' ? expectation.selectedLabel : undefined),
        selectedFamilyLabel: expectation.selectedFamilyLabel ??
            expectation.topFamilyLabel ??
            (expectation.decisionType === 'family' ? expectation.selectedLabel : undefined),
        minimumConfidence: expectation.minimumConfidence,
        spanCount: expectation.spanCount
    };
}
function normalizeDevelopingSpanExpectation(expectation) {
    const isGateExpectation = expectation.decisionType === 'unresolved';
    if (isGateExpectation) {
        return expectation;
    }
    return {
        query: expectation.query,
        selectedLeafLabel: expectation.selectedLeafLabel ?? (expectation.decisionType === 'leaf' ? expectation.selectedLabel : undefined),
        selectedFamilyLabel: expectation.selectedFamilyLabel ??
            expectation.topFamilyLabel ??
            (expectation.decisionType === 'family' ? expectation.selectedLabel : undefined),
        minimumConfidence: expectation.minimumConfidence
    };
}
function normalizeLabel(value) {
    return (value ?? '').trim().toLowerCase();
}
export function formatPipelineGoldenSuiteResult(result, format) {
    if (format === 'json') {
        return JSON.stringify(result, null, 2);
    }
    const lines = [];
    lines.push(`Pipeline golden suite: ${result.passed}/${result.total} passed`);
    lines.push(`source=${result.sourceName}  retrieval_profile=${result.retrievalProfile}  model=${result.modelKey}  suite=${result.suite}`);
    lines.push(`blocking_failures=${result.blockingFailed}  developing_failures=${result.failed - result.blockingFailed}`);
    lines.push(`locales=${formatCoverageSummary(result.results, (caseResult) => caseResult.case.locale)}`);
    lines.push(`coverage=${formatCoverageSummary(result.results, (caseResult) => caseResult.case.coverageKind)}`);
    lines.push('');
    for (const caseResult of result.results) {
        const status = caseResult.passed ? 'PASS' : 'FAIL';
        lines.push([
            `${status}`,
            caseResult.case.caseKey,
            `suite=${caseResult.case.suite ?? 'stable'}`,
            `locale=${caseResult.case.locale}`,
            `format=${caseResult.case.format}`,
            `coverage=${caseResult.case.coverageKind}`,
            `query="${caseResult.case.query}"`,
            `selected=${caseResult.actual.decisionType} "${caseResult.actual.selectedLabel ?? 'null'}"`,
            `confidence=${formatPercent(caseResult.actual.confidence)}`,
            `top_family="${caseResult.actual.topFamilyLabel ?? 'null'}"`,
            `spans=${caseResult.actual.spans.length}`
        ].join('  '));
        for (const span of caseResult.actual.spans) {
            lines.push(`  span "${span.query}" selected=${span.decisionType} "${span.selectedLabel ?? 'null'}" confidence=${formatPercent(span.confidence)} top_family="${span.topFamilyLabel ?? 'null'}"`);
        }
        for (const failure of caseResult.failures) {
            lines.push(`  - ${failure}`);
        }
    }
    return lines.join('\n');
}
function formatPercent(value) {
    return `${Math.round(value * 100)}%`;
}
function formatCoverageSummary(results, key) {
    const counts = new Map();
    for (const result of results) {
        const label = key(result);
        const current = counts.get(label) ?? { passed: 0, total: 0 };
        counts.set(label, {
            passed: current.passed + (result.passed ? 1 : 0),
            total: current.total + 1
        });
    }
    return Array.from(counts.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([label, count]) => `${label}:${count.passed}/${count.total}`)
        .join(',');
}
