import type { Connection } from 'mysql2/promise';
import {
  DEFAULT_ESCO_SOURCE_NAME,
  DEFAULT_MODEL_KEY,
  DEFAULT_RETRIEVAL_PROFILE,
  DEFAULT_RETRIEVAL_LOCALE,
  type RetrievalProfile
} from '../retrieval/occupation-candidates.js';
import { DEFAULT_SIBLING_LIMIT } from '../retrieval/occupation-candidate-branches.js';
import { OccupationSearchPipeline, type PipelineDecision } from './occupation-search-pipeline.js';
import type { OccupationRetrievalEngine } from '../retrieval/retrieval-engine.js';

export type GoldenQueryFormat =
  | 'exact_title'
  | 'modifier_removed'
  | 'generic_tail'
  | 'short_form'
  | 'synonym_alias'
  | 'descriptive'
  | 'plural_variant'
  | 'broad_family'
  | 'specialization_guard'
  | 'multi_word_exact'
  | 'noisy_recruiter'
  | 'manager_title'
  | 'obscure_title'
  | 'localized_target'
  | 'ambiguous_title'
  | 'multi_occupation_context';

export type GoldenSuiteKind = 'stable' | 'developing';
export type GoldenSuiteSelection = GoldenSuiteKind | 'all';

export type GoldenCoverageKind =
  | 'white_collar'
  | 'blue_collar'
  | 'pink_collar'
  | 'care_collar'
  | 'education'
  | 'service'
  | 'creative'
  | 'health'
  | 'transport'
  | 'technology'
  | 'management';

export type GoldenExpectation = {
  decisionType: PipelineDecision['decisionType'];
  selectedLabel?: string;
  topFamilyLabel?: string;
  minimumConfidence?: number;
  spanCount?: number;
  spanExpectations?: GoldenSpanExpectation[];
};

export type GoldenSpanExpectation = {
  query: string;
  decisionType?: PipelineDecision['decisionType'];
  selectedLabel?: string;
  topFamilyLabel?: string;
  minimumConfidence?: number;
};

export type GoldenCase = {
  caseKey: string;
  suite?: GoldenSuiteKind;
  format: GoldenQueryFormat;
  coverageKind: GoldenCoverageKind;
  query: string;
  locale: string;
  description: string;
  expectation: GoldenExpectation;
};

export type PipelineGoldenSuiteOptions = {
  sourceName?: string;
  modelKey?: string;
  suite?: GoldenSuiteSelection;
  limit?: number;
  siblingLimit?: number;
  caseKeys?: string[];
  retrievalEngine?: OccupationRetrievalEngine;
};

export type GoldenCaseResult = {
  case: GoldenCase;
  passed: boolean;
  failures: string[];
  actual: {
    decisionType: PipelineDecision['decisionType'];
    selectedLabel: string | null;
    confidence: number;
    topFamilyLabel: string | null;
    spans: GoldenCaseSpanActual[];
  };
};

export type GoldenCaseSpanActual = {
  query: string;
  decisionType: PipelineDecision['decisionType'];
  selectedLabel: string | null;
  confidence: number;
  topFamilyLabel: string | null;
};

export type PipelineGoldenSuiteResult = {
  sourceName: string;
  modelKey: string;
  retrievalProfile: RetrievalProfile;
  suite: GoldenSuiteSelection;
  total: number;
  passed: number;
  failed: number;
  blockingFailed: number;
  results: GoldenCaseResult[];
};

export const PIPELINE_GOLDEN_CASES: GoldenCase[] = [
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

export const PIPELINE_DEVELOPING_GOLDEN_CASES: GoldenCase[] = [
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
  }
];

export const ALL_PIPELINE_GOLDEN_CASES: GoldenCase[] = [
  ...PIPELINE_GOLDEN_CASES,
  ...PIPELINE_DEVELOPING_GOLDEN_CASES
];

export class PipelineGoldenSuiteRunner {
  public constructor(private readonly connection: Connection) {}

  public async run(options: PipelineGoldenSuiteOptions = {}): Promise<PipelineGoldenSuiteResult> {
    const sourceName = options.sourceName?.trim() || DEFAULT_ESCO_SOURCE_NAME;
    const modelKey = options.modelKey?.trim() || DEFAULT_MODEL_KEY;
    const retrievalProfile = DEFAULT_RETRIEVAL_PROFILE;
    const suite = normalizeSuiteSelection(options.suite);
    const selectedCaseKeys = new Set(options.caseKeys ?? []);
    const suiteCases = casesForSuite(suite);
    const cases = selectedCaseKeys.size > 0
      ? suiteCases.filter((goldenCase) => selectedCaseKeys.has(goldenCase.caseKey))
      : suiteCases;

    if (cases.length === 0) {
      throw new Error('No golden cases matched the provided --case-key filters.');
    }

    const pipeline = options.retrievalEngine
      ? OccupationSearchPipeline.withEngine(options.retrievalEngine)
      : new OccupationSearchPipeline();
    const results: GoldenCaseResult[] = [];

    for (const goldenCase of cases) {
      const result = await pipeline.run({
        query: goldenCase.query,
        locale: goldenCase.locale || DEFAULT_RETRIEVAL_LOCALE,
        sourceName,
        modelKey,
        limit: options.limit,
        siblingLimit: options.siblingLimit ?? DEFAULT_SIBLING_LIMIT
      });
      const topFamily = result.rankedFamilies[0] ?? null;
      const actual = {
        decisionType: result.decision.decisionType,
        selectedLabel: result.decision.selectedLabel,
        confidence: result.decision.confidence,
        topFamilyLabel: topFamily?.familyLabel ?? null,
        spans: result.spanResults.map((span) => ({
          query: span.query,
          decisionType: span.decision.decisionType,
          selectedLabel: span.decision.selectedLabel,
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

function normalizeSuiteSelection(value: GoldenSuiteSelection | undefined): GoldenSuiteSelection {
  if (value === undefined) {
    return 'stable';
  }

  if (value === 'stable' || value === 'developing' || value === 'all') {
    return value;
  }

  throw new Error(`Unsupported golden suite "${value}". Use stable, developing, or all.`);
}

function casesForSuite(suite: GoldenSuiteSelection): GoldenCase[] {
  if (suite === 'stable') {
    return PIPELINE_GOLDEN_CASES;
  }

  if (suite === 'developing') {
    return PIPELINE_DEVELOPING_GOLDEN_CASES;
  }

  return ALL_PIPELINE_GOLDEN_CASES;
}

function isBlockingGoldenCase(goldenCase: GoldenCase): boolean {
  return (goldenCase.suite ?? 'stable') !== 'developing';
}

function evaluateCase(goldenCase: GoldenCase, actual: GoldenCaseResult['actual']): string[] {
  const failures: string[] = [];
  const expectation = goldenCase.expectation;

  if (actual.decisionType !== expectation.decisionType) {
    failures.push(`decisionType expected ${expectation.decisionType}, got ${actual.decisionType}`);
  }

  if (expectation.selectedLabel !== undefined && normalizeLabel(actual.selectedLabel) !== normalizeLabel(expectation.selectedLabel)) {
    failures.push(`selectedLabel expected "${expectation.selectedLabel}", got "${actual.selectedLabel ?? 'null'}"`);
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

    if (spanExpectation.selectedLabel !== undefined && normalizeLabel(spanActual.selectedLabel) !== normalizeLabel(spanExpectation.selectedLabel)) {
      failures.push(`span "${spanExpectation.query}" selectedLabel expected "${spanExpectation.selectedLabel}", got "${spanActual.selectedLabel ?? 'null'}"`);
    }

    if (spanExpectation.topFamilyLabel !== undefined && normalizeLabel(spanActual.topFamilyLabel) !== normalizeLabel(spanExpectation.topFamilyLabel)) {
      failures.push(`span "${spanExpectation.query}" topFamilyLabel expected "${spanExpectation.topFamilyLabel}", got "${spanActual.topFamilyLabel ?? 'null'}"`);
    }

    if (spanExpectation.minimumConfidence !== undefined && spanActual.confidence < spanExpectation.minimumConfidence) {
      failures.push(`span "${spanExpectation.query}" confidence expected >= ${formatPercent(spanExpectation.minimumConfidence)}, got ${formatPercent(spanActual.confidence)}`);
    }
  }

  return failures;
}

function normalizeLabel(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function formatPipelineGoldenSuiteResult(result: PipelineGoldenSuiteResult, format: 'text' | 'json'): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  const lines: string[] = [];
  lines.push(`Pipeline golden suite: ${result.passed}/${result.total} passed`);
  lines.push(`source=${result.sourceName}  retrieval_profile=${result.retrievalProfile}  model=${result.modelKey}  suite=${result.suite}`);
  lines.push(`blocking_failures=${result.blockingFailed}  developing_failures=${result.failed - result.blockingFailed}`);
  lines.push(`locales=${formatCoverageSummary(result.results, (caseResult) => caseResult.case.locale)}`);
  lines.push(`coverage=${formatCoverageSummary(result.results, (caseResult) => caseResult.case.coverageKind)}`);
  lines.push('');

  for (const caseResult of result.results) {
    const status = caseResult.passed ? 'PASS' : 'FAIL';
    lines.push(
      [
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
      ].join('  ')
    );

    for (const span of caseResult.actual.spans) {
      lines.push(
        `  span "${span.query}" selected=${span.decisionType} "${span.selectedLabel ?? 'null'}" confidence=${formatPercent(span.confidence)} top_family="${span.topFamilyLabel ?? 'null'}"`
      );
    }

    for (const failure of caseResult.failures) {
      lines.push(`  - ${failure}`);
    }
  }

  return lines.join('\n');
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatCoverageSummary(results: GoldenCaseResult[], key: (result: GoldenCaseResult) => string): string {
  const counts = new Map<string, { passed: number; total: number }>();

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
