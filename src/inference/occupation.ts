/**
 * Occupation inference — the single entry point the extractor and profiles use to
 * turn clauses into occupation terms. Mirrors the `infer*` naming (and the global-
 * resolver shape) of `inferLocation`.
 *
 * The occupation search engine is maintained as a standalone package (symlinked in
 * as `packages/occupation`); `inferOccupation` owns a process-**global** resolver
 * that defaults to the package's `getCanonicalTerm()`. Callers just pass clauses +
 * locale. Unlike the gazetteer, `getCanonicalTerm` is async (it runs the embedding
 * search pipeline over the runtime artifacts), so `inferOccupation` is async too.
 */

import { type GetCanonicalTermInput, type GetCanonicalTermResult, getCanonicalTerm } from 'occupation-search-engine';
import { OCCUPATION_FAMILIES } from '../finite-values.js';
import type { Clause } from '../tokenizer.js';
import type { BucketName, ExtractedTerm, SupportedLanguage } from '../types.js';
import { lookupOccupationFamilySlugs } from './facets.js';

/** The one call `inferOccupation` depends on — the package's `getCanonicalTerm`,
 *  or a stand-in installed for tests / alternate wiring. */
export type OccupationResolver = (input: GetCanonicalTermInput) => Promise<GetCanonicalTermResult>;

let resolver: OccupationResolver = getCanonicalTerm;

export interface InferOccupationOptions {
  limit?: number;
  jobFunction?: string;
  /** 'v2' (default here) routes through the newer occupation-classifier; 'v1' opts back into
   *  the legacy OccupationSearchPipeline. Passed straight through to `getCanonicalTerm`, whose
   *  own package default is still 'v1' — this call site is what makes v2 the default. */
  mode?: 'v1' | 'v2';
}

/** Install/override the global occupation resolver (tests, alternate wiring).
 *  `undefined` restores the package default. */
export function setOccupationResolver(r: OccupationResolver | undefined): void {
  resolver = r ?? getCanonicalTerm;
}

export async function inferOccupation(
  clauses: Clause[],
  locale?: SupportedLanguage,
  options: InferOccupationOptions | number = {},
): Promise<ExtractedTerm[]> {
  const input = clauses
    .map((c) => c.text)
    .join(', ')
    .trim();
  if (!input) return [];

  const resolvedOptions = typeof options === 'number' ? { limit: options } : options;
  let result: GetCanonicalTermResult;
  try {
    result = await resolver({ input, locale, mode: 'v2', ...resolvedOptions });
  } catch (err) {
    console.error('inferOccupation failed:', err);
    return [];
  }
  const lang = locale ?? 'global';
  const term = (
    bucket: BucketName,
    key: string,
    name: string,
    termType: string,
    score: number,
    span: string,
  ): ExtractedTerm => ({
    bucket,
    canonicalKey: key,
    displayName: name,
    termType,
    languageCode: lang,
    score,
    method: 'inferred',
    evidence: [{ clause: span, method: 'inferred', score }],
  });

  // A role's `capabilityTerms` are only populated by the engine when it committed to a
  // specific leaf occupation (`selectedLeafTerm`) — an alt/unselected leaf carries no
  // grounded capability list, so capabilities are only ever emitted alongside a
  // selected leaf, never alongside a fallback alt leaf.
  const roles = result.occupationContexts.map((c) => ({
    span: c.input || input,
    leaves: c.selectedLeafTerm ? [c.selectedLeafTerm] : c.altLeafCanonicalTerms,
    family: c.selectedFamilyTerm || c.altFamilyCanonicalTerms[0],
    capabilities: c.selectedLeafTerm ? c.capabilityTerms.slice(0, TOP_CAPABILITIES_LIMIT) : [],
  }));

  const out: ExtractedTerm[] = [];
  for (const role of roles) {
    for (const l of role.leaves)
      out.push(term('occupation', slugify(l.canonicalTerm), l.canonicalTerm, 'occupation', l.confidence, role.span));
    if (role.family) {
      out.push(
        term(
          'occupation',
          slugify(role.family.canonicalTerm),
          role.family.canonicalTerm,
          'occupation_group',
          role.family.confidence,
          role.span,
        ),
      );
    }
    for (const cap of role.capabilities) {
      out.push(
        term(
          'capabilities',
          `capability:${cap.capabilityType}:${slugify(cap.canonicalTerm)}`,
          cap.canonicalTerm,
          cap.capabilityType,
          cap.confidence,
          role.span,
        ),
      );
    }
  }
  return out;
}

/** Cap on how many alt-engine capabilities ride alongside a selected leaf occupation. */
const TOP_CAPABILITIES_LIMIT = 5;

const OCCUPATION_FAMILY_BY_SLUG = new Map<string, (typeof OCCUPATION_FAMILIES)[number]>(
  OCCUPATION_FAMILIES.map((f) => [f.slug, f]),
);

/**
 * Additive, lexical-only `alt_family` signal derived from a structured `job_function`
 * surface (e.g. an HU category label). No leaves, no semantic engine call — an exact
 * lookup against the ESCO occupation-family table (see `lookupOccupationFamilySlugs`).
 * Never touches job_function resolution itself; this is a sibling occupation-bucket
 * output, mirroring `inferOccupation`'s own `occupation_group` shape.
 */
export function inferAltFamilyFromJobFunction(surface: string, locale?: SupportedLanguage): ExtractedTerm[] {
  if (!locale) return [];
  const lang = locale;
  const score = 0.93;
  return lookupOccupationFamilySlugs(surface, locale).flatMap((slug) => {
    const family = OCCUPATION_FAMILY_BY_SLUG.get(slug);
    if (!family) return [];
    return [
      {
        bucket: 'occupation' as const,
        canonicalKey: family.slug,
        displayName: family.label,
        termType: 'occupation_group',
        languageCode: lang,
        score,
        method: 'lexical',
        evidence: [{ clause: surface, method: 'lexical', score }],
      },
    ];
  });
}

function slugify(label: string): string {
  return (
    label
      .normalize('NFKD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'x'
  );
}

/** An idea to expand later */
// export const capabilityAreaMap: Record<string, string[]> = {
//   'Management & Leadership': [
//     'manage',
//     'supervise',
//     'lead',
//     'oversee',
//     'direct',
//     'head',
//     'chair',
//     'deputise',
//     'own',
//     'delegate',
//     'empower',
//     'motivate',
//     'inspire',
//     'influence',
//     'encourage',
//     'foster',
//     'strive',
//     'achieve',
//     'master',
//     'managing',
//     'staff',
//     'personnel',
//     'challenge',
//   ],
//   'Planning & Organization': [
//     'plan',
//     'organise',
//     'organize',
//     'schedule',
//     'arrange',
//     'prepare',
//     'prioritise',
//     'set-up',
//     'setup',
//     'structure',
//     'coordinate',
//     'implement',
//     'execute',
//     'formulate',
//     'devise',
//     'initiate',
//     'orchestrate',
//     'budget',
//     'allocate',
//     'reserve',
//     'set',
//     'start',
//     'launch',
//     'sequence',
//     'align',
//     'establish',
//   ],
//   'Coordination & Administration': [
//     'administer',
//     'liaise',
//     'process',
//     'record',
//     'document',
//     'file',
//     'register',
//     'log',
//     'archive',
//     'transcribe',
//     'assign',
//     'dispatch',
//     'issue',
//     'order',
//     'book',
//     'tally',
//     'tabulate',
//     'summarise',
//     'compile',
//     'collect',
//     'handover',
//     'type',
//     'types',
//     'disaggregate',
//   ],
//   'Communication & Information': [
//     'communicate',
//     'inform',
//     'write',
//     'read',
//     'speak',
//     'listen',
//     'present',
//     'explain',
//     'describe',
//     'discuss',
//     'report',
//     'brief',
//     'draft',
//     'publish',
//     'broadcast',
//     'edit',
//     'proofread',
//     'translate',
//     'correspond',
//     'convey',
//     'tell',
//     'announce',
//     'express',
//     'impart',
//     'articulate',
//     'notate',
//   ],
//   'Sales & Business Development': [
//     'sell',
//     'negotiate',
//     'trade',
//     'purchase',
//     'buy',
//     'procure',
//     'acquire',
//     'upsell',
//     'market',
//     'prospect',
//     'solicit',
//     'attract',
//     'quote',
//     'price',
//     'value',
//   ],
//   'Marketing & Promotion': ['promote', 'advertise', 'self-promote', 'display', 'show'],
//   'Customer Service & Support': [
//     'support',
//     'serve',
//     'assist',
//     'help',
//     'advise',
//     'advice',
//     'counsel',
//     'guide',
//     'welcome',
//     'greet',
//     'satisfy',
//     'address',
//     'attend',
//     'respond',
//     'answer',
//     'accommodate',
//     'host',
//     'interact',
//     'engage',
//     'participate',
//     'contribute',
//     'collaborate',
//     'deal',
//     'give',
//     'meet',
//     'cope',
//     'cooperate',
//     'reassure',
//   ],
//   'Analysis & Assessment': [
//     'analyse',
//     'assess',
//     'evaluate',
//     'evaluation',
//     'examine',
//     'calculate',
//     'measure',
//     'determine',
//     'estimate',
//     'interpret',
//     'diagnose',
//     'compare',
//     'appraise',
//     'critique',
//     'forecast',
//     'predict',
//     'grade',
//     'classify',
//     'synthesise',
//     'synthesize',
//     'discern',
//     'differentiate',
//     'distinguish',
//     'solve',
//     'problem-solving',
//     'decide',
//     'judge',
//     'think',
//     'consider',
//     'comprehend',
//     'understand',
//     'perceive',
//   ],
//   'Research & Investigation': [
//     'research',
//     'investigate',
//     'study',
//     'survey',
//     'search',
//     'browse',
//     'trace',
//     'gather',
//     'observe',
//     'spot',
//     'detect',
//     'identify',
//     'identity',
//     'locate',
//     'find',
//     'discover',
//   ],
//   'Design & Creation': [
//     'design',
//     'create',
//     'creatively',
//     'develop',
//     'model',
//     'draw',
//     'sketch',
//     'conceptualise',
//     'style',
//     'customise',
//     'customize',
//     'animate',
//     'compose',
//     'craft',
//     'sculpt',
//     'carve',
//     'photograph',
//     'decorate',
//     'form',
//     'make',
//     'innovate',
//   ],
//   'Computing & Technical Systems': [
//     'program',
//     'programme',
//     'configure',
//     'automate',
//     'digitise',
//     'digital',
//     'compute',
//     'integrate',
//     'network',
//     'interface',
//     'simulate',
//     'decode',
//     'map',
//     'route',
//     'debug',
//     'ICT',
//   ],
//   'Production & Manufacturing': [
//     'produce',
//     'manufacture',
//     'manufacturing',
//     'assemble',
//     'mould',
//     'cast',
//     'cut',
//     'blend',
//     'pre-blend',
//     'mix',
//     'grind',
//     'pre-grind',
//     'heat',
//     'preheat',
//     'cool',
//     'dry',
//     'press',
//     'seal',
//     'shape',
//     'finish',
//     'coat',
//     'melt',
//     'temper',
//     'galvanise',
//     'parkerise',
//     'electroform',
//     'condense',
//   ],
//   'Operation & Control': [
//     'operate',
//     'control',
//     'tend',
//     'run',
//     'drive',
//     'steer',
//     'manoeuvre',
//     'maneuver',
//     'manoeuvere',
//     'pilot',
//     'navigate',
//     'monitor',
//     'regulate',
//     'adjust',
//     'calibrate',
//     'preset',
//     'switch',
//   ],
//   'Construction & Installation': [
//     'install',
//     'construct',
//     'build',
//     'lay',
//     'pave',
//     'grout',
//     'screed',
//     'plaster',
//     'mount',
//     'fit',
//     'connect',
//     'wire',
//     'rewire',
//     'rig',
//     'de-rig',
//     'demolish',
//     'excavate',
//     'bolt',
//     'thatch',
//     'caulk',
//     'metal',
//     'automotive',
//   ],
//   'Maintenance & Repair': [
//     'maintain',
//     'repair',
//     'fix',
//     'restore',
//     'refurbish',
//     'service',
//     'replace',
//     'troubleshoot',
//     'rectify',
//     'tune',
//     'lubricate',
//     'sharpen',
//     'patch',
//     'reconstruct',
//     'remediate',
//     're-assemble',
//     'dismantle',
//     'disassemble',
//   ],
//   'Inspection, Testing & Quality': [
//     'inspect',
//     'test',
//     'check',
//     'verify',
//     'validate',
//     'screen',
//     'scan',
//     'audit',
//     'stamp',
//     'mark',
//     'label',
//     'certify',
//     'authenticate',
//     'accurately',
//     'accurise',
//   ],
//   'Legal, Regulatory & Compliance': [
//     'comply',
//     'adhere',
//     'enforce',
//     'regulate',
//     'license',
//     'authorise',
//     'ban',
//     'obey',
//     'abide',
//     'conform',
//   ],
//   'Finance & Accounting': ['audit', 'balance', 'pay', 'reconcile'],
//   'Transportation & Logistics': [
//     'transport',
//     'deliver',
//     'transfer',
//     'dispatch',
//     'load',
//     'unload',
//     'pack',
//     'package',
//     'repackage',
//     'store',
//     'restock',
//     'stock',
//     'stow',
//     'rack',
//     'tow',
//     'haul',
//     'shunt',
//     'dock',
//     'moor',
//     'unmoor',
//     'pallets',
//   ],
//   'Education, Training & Coaching': [
//     'teach',
//     'train',
//     'instruct',
//     'educate',
//     'coach',
//     'mentor',
//     'tutor',
//     'demonstrate',
//     'facilitate',
//     'moderate',
//     'acclimatise',
//     'familiarise',
//   ],
//   'Healthcare & Clinical': [
//     'treat',
//     'prescribe',
//     'nurse',
//     'triage',
//     'rehabilitate',
//     'sterilise',
//     'clinical',
//     'implant',
//     'discharge',
//     'admit',
//     'inject',
//   ],
//   'Care & Human Assistance': [
//     'care',
//     'assist',
//     'help',
//     'protect',
//     'safeguard',
//     'bathe',
//     'feed',
//     'dress',
//     'escort',
//     'accompany',
//     'advocate',
//     'intervene',
//     'empathise',
//   ],
//   'Security & Protection': [
//     'protect',
//     'guard',
//     'secure',
//     'patrol',
//     'watch',
//     'defend',
//     'detain',
//     'restrain',
//     'disarm',
//     'evacuate',
//     'extinguish',
//     'prevent',
//     'mitigate',
//     'covert',
//   ],
//   'Cleaning & Sanitation': [
//     'clean',
//     'wash',
//     'vacuum',
//     'rinse',
//     'polish',
//     'buff',
//     'sanitise',
//     'disinfect',
//     'decontaminate',
//     'clear',
//     'empty',
//     'dispose',
//     'drain',
//     'filter',
//     'recycle',
//     'depurate',
//   ],
//   'Food Preparation & Service': [
//     'cook',
//     'bake',
//     'roast',
//     'boil',
//     'knead',
//     'slice',
//     'stir',
//     'pour',
//     'flavour',
//     'taste',
//     'preserve',
//     'food',
//     'ferment',
//     'malt',
//   ],
//   'Agriculture & Environment': [
//     'cultivate',
//     'plant',
//     'harvest',
//     'grow',
//     'breed',
//     'rear',
//     'milk',
//     'prune',
//     'seed',
//     'propagate',
//     'irrigate',
//     'slaughter',
//     'fell',
//     'trap',
//     'hunt',
//     'conserve',
//     'vegetation',
//     'de-limb',
//     'manure',
//   ],
//   'Physical & Manual Handling': [
//     'handle',
//     'handling',
//     'lift',
//     'carry',
//     'move',
//     'push',
//     'shift',
//     'position',
//     'place',
//     'stack',
//     'bundle',
//     'tie',
//     'wrap',
//     'clip',
//     'fasten',
//     'clamp',
//     'dump',
//     'dig',
//     'insert',
//     'put',
//     'attach',
//     'affix',
//   ],
//   'Personal & Appearance Services': ['style', 'groom', 'curl', 'dye', 'colour', 'tattoo', 'wax', 'brush', 'shine'],
// };

// export const OCCUPATION_FAMILY_CAPABILITY_AREAS: Record<number, string[]> = {
//   // Commissioned armed forces officers
//   14659: ['Management & Leadership', 'Security & Protection', 'Operation & Control', 'Planning & Organization'],

//   // Non-commissioned armed forces officers
//   14662: ['Management & Leadership', 'Security & Protection', 'Operation & Control', 'Physical & Manual Handling'],

//   // Armed forces occupations, other ranks
//   14665: ['Security & Protection', 'Operation & Control', 'Physical & Manual Handling', 'Construction & Installation'],

//   // Legislators and senior officials
//   14669: [
//     'Management & Leadership',
//     'Planning & Organization',
//     'Communication & Information',
//     'Legal, Regulatory & Compliance',
//   ],

//   // Managing directors and chief executives
//   14674: ['Management & Leadership', 'Planning & Organization', 'Finance & Accounting', 'Sales & Business Development'],

//   // Business services and administration managers
//   14677: [
//     'Management & Leadership',
//     'Coordination & Administration',
//     'Planning & Organization',
//     'Finance & Accounting',
//   ],

//   // Sales, marketing and development managers
//   14682: [
//     'Management & Leadership',
//     'Sales & Business Development',
//     'Marketing & Promotion',
//     'Planning & Organization',
//   ],

//   // Production managers in agriculture, forestry and fisheries
//   14687: [
//     'Management & Leadership',
//     'Agriculture & Environment',
//     'Production & Manufacturing',
//     'Planning & Organization',
//   ],

//   // Manufacturing, mining, construction, and distribution managers
//   14690: [
//     'Management & Leadership',
//     'Production & Manufacturing',
//     'Construction & Installation',
//     'Transportation & Logistics',
//   ],

//   // Information and communications technology service managers
//   14695: [
//     'Management & Leadership',
//     'Computing & Technical Systems',
//     'Planning & Organization',
//     'Analysis & Assessment',
//   ],

//   // Professional services managers
//   14697: [
//     'Management & Leadership',
//     'Planning & Organization',
//     'Coordination & Administration',
//     'Customer Service & Support',
//   ],

//   // Hotel and restaurant managers
//   14706: [
//     'Management & Leadership',
//     'Customer Service & Support',
//     'Food Preparation & Service',
//     'Planning & Organization',
//   ],

//   // Retail and wholesale trade managers
//   14709: [
//     'Management & Leadership',
//     'Sales & Business Development',
//     'Customer Service & Support',
//     'Finance & Accounting',
//   ],

//   // Other services managers
//   14711: [
//     'Management & Leadership',
//     'Customer Service & Support',
//     'Planning & Organization',
//     'Coordination & Administration',
//   ],

//   // Physical and earth science professionals
//   14716: ['Analysis & Assessment', 'Research & Investigation', 'Design & Creation', 'Communication & Information'],

//   // Mathematicians, actuaries and statisticians
//   14721: ['Analysis & Assessment', 'Finance & Accounting', 'Computing & Technical Systems', 'Planning & Organization'],

//   // Life science professionals
//   14723: ['Research & Investigation', 'Analysis & Assessment', 'Healthcare & Clinical', 'Agriculture & Environment'],

//   // Engineering professionals (excluding electrotechnology)
//   14727: ['Design & Creation', 'Analysis & Assessment', 'Production & Manufacturing', 'Construction & Installation'],

//   // Electrotechnology engineers
//   14735: ['Design & Creation', 'Computing & Technical Systems', 'Construction & Installation', 'Maintenance & Repair'],

//   // Architects, planners, surveyors and designers
//   14739: ['Design & Creation', 'Planning & Organization', 'Construction & Installation', 'Analysis & Assessment'],

//   // Medical doctors
//   14747: ['Healthcare & Clinical', 'Analysis & Assessment', 'Customer Service & Support', 'Research & Investigation'],

//   // Nursing and midwifery professionals
//   14750: [
//     'Healthcare & Clinical',
//     'Care & Human Assistance',
//     'Customer Service & Support',
//     'Inspection, Testing & Quality',
//   ],

//   // Traditional and complementary medicine professionals
//   14753: ['Healthcare & Clinical', 'Customer Service & Support', 'Analysis & Assessment'],

//   // Veterinarians
//   14757: ['Healthcare & Clinical', 'Agriculture & Environment', 'Analysis & Assessment', 'Research & Investigation'],

//   // Other health professionals
//   14759: ['Healthcare & Clinical', 'Customer Service & Support', 'Analysis & Assessment'],

//   // University and higher education teachers
//   14769: [
//     'Education, Training & Coaching',
//     'Communication & Information',
//     'Research & Investigation',
//     'Analysis & Assessment',
//   ],

//   // Vocational education teachers
//   14771: ['Education, Training & Coaching', 'Communication & Information', 'Design & Creation'],

//   // Secondary education teachers
//   14773: ['Education, Training & Coaching', 'Communication & Information', 'Customer Service & Support'],

//   // Primary school and early childhood teachers
//   14775: [
//     'Education, Training & Coaching',
//     'Care & Human Assistance',
//     'Customer Service & Support',
//     'Communication & Information',
//   ],

//   // Other teaching professionals
//   14778: ['Education, Training & Coaching', 'Communication & Information'],

//   // Finance professionals
//   14787: ['Finance & Accounting', 'Analysis & Assessment', 'Planning & Organization', 'Legal, Regulatory & Compliance'],

//   // Administration professionals
//   14791: [
//     'Coordination & Administration',
//     'Planning & Organization',
//     'Legal, Regulatory & Compliance',
//     'Communication & Information',
//   ],

//   // Sales, marketing and public relations professionals
//   14796: [
//     'Sales & Business Development',
//     'Marketing & Promotion',
//     'Communication & Information',
//     'Analysis & Assessment',
//   ],

//   // Software and applications developers and analysts
//   14802: ['Computing & Technical Systems', 'Design & Creation', 'Analysis & Assessment', 'Maintenance & Repair'],

//   // Database and network professionals
//   14808: ['Computing & Technical Systems', 'Operation & Control', 'Maintenance & Repair', 'Security & Protection'],

//   // Legal professionals
//   14814: [
//     'Legal, Regulatory & Compliance',
//     'Analysis & Assessment',
//     'Communication & Information',
//     'Management & Leadership',
//   ],

//   // Librarians, archivists and curators
//   14818: [
//     'Coordination & Administration',
//     'Communication & Information',
//     'Research & Investigation',
//     'Customer Service & Support',
//   ],

//   // Social and religious professionals
//   14821: [
//     'Care & Human Assistance',
//     'Customer Service & Support',
//     'Education, Training & Coaching',
//     'Communication & Information',
//   ],

//   // Authors, journalists and linguists
//   14828: ['Communication & Information', 'Design & Creation', 'Research & Investigation'],

//   // Creative and performing artists
//   14832: ['Design & Creation', 'Communication & Information', 'Personal & Appearance Services'],

//   // Physical and engineering science technicians
//   14842: [
//     'Inspection, Testing & Quality',
//     'Analysis & Assessment',
//     'Computing & Technical Systems',
//     'Production & Manufacturing',
//   ],

//   // Mining, manufacturing and construction supervisors
//   14852: [
//     'Management & Leadership',
//     'Operation & Control',
//     'Inspection, Testing & Quality',
//     'Construction & Installation',
//   ],

//   // Process control technicians
//   14856: ['Operation & Control', 'Inspection, Testing & Quality', 'Maintenance & Repair'],

//   // Life science technicians and related associate professionals
//   14863: ['Research & Investigation', 'Analysis & Assessment', 'Inspection, Testing & Quality'],

//   // Ship and aircraft controllers and technicians
//   14867: [
//     'Operation & Control',
//     'Transportation & Logistics',
//     'Inspection, Testing & Quality',
//     'Communication & Information',
//   ],

//   // Medical and pharmaceutical technicians
//   14874: ['Healthcare & Clinical', 'Inspection, Testing & Quality', 'Analysis & Assessment'],

//   // Nursing and midwifery associate professionals
//   14879: ['Healthcare & Clinical', 'Care & Human Assistance', 'Customer Service & Support'],

//   // Traditional and complementary medicine associate professionals
//   14882: ['Healthcare & Clinical', 'Customer Service & Support'],

//   // Veterinary technicians and assistants
//   14884: ['Healthcare & Clinical', 'Agriculture & Environment', 'Care & Human Assistance'],

//   // Other health associate professionals
//   14886: ['Healthcare & Clinical', 'Customer Service & Support', 'Inspection, Testing & Quality'],

//   // Financial and mathematical associate professionals
//   14897: ['Finance & Accounting', 'Coordination & Administration', 'Analysis & Assessment'],

//   // Sales and purchasing agents and brokers
//   14903: ['Sales & Business Development', 'Transportation & Logistics', 'Coordination & Administration'],

//   // Business services agents
//   14908: ['Sales & Business Development', 'Coordination & Administration', 'Customer Service & Support'],

//   // Administrative and specialised secretaries
//   14914: ['Coordination & Administration', 'Communication & Information', 'Planning & Organization'],

//   // Regulatory government associate professionals
//   14919: ['Legal, Regulatory & Compliance', 'Inspection, Testing & Quality', 'Coordination & Administration'],

//   // Legal, social and religious associate professionals
//   14927: ['Legal, Regulatory & Compliance', 'Care & Human Assistance', 'Coordination & Administration'],

//   // Sports and fitness workers
//   14931: ['Education, Training & Coaching', 'Customer Service & Support', 'Personal & Appearance Services'],

//   // Artistic, cultural and culinary associate professionals
//   14935: ['Design & Creation', 'Food Preparation & Service', 'Communication & Information'],

//   // ICT operations and user support technicians
//   14942: ['Computing & Technical Systems', 'Customer Service & Support', 'Maintenance & Repair'],

//   // Telecommunications and broadcasting technicians
//   14947: ['Computing & Technical Systems', 'Maintenance & Repair', 'Construction & Installation'],

//   // General office clerks
//   14952: ['Coordination & Administration', 'Communication & Information', 'Planning & Organization'],

//   // Secretaries (general)
//   14954: ['Coordination & Administration', 'Communication & Information'],

//   // Keyboard operators
//   14956: ['Coordination & Administration', 'Communication & Information'],

//   // Tellers, money collectors and related clerks
//   14960: ['Finance & Accounting', 'Customer Service & Support', 'Coordination & Administration'],

//   // Client information workers
//   14965: ['Customer Service & Support', 'Communication & Information', 'Coordination & Administration'],

//   // Numerical clerks
//   14975: ['Finance & Accounting', 'Coordination & Administration'],

//   // Material-recording and transport clerks
//   14979: ['Transportation & Logistics', 'Coordination & Administration', 'Physical & Manual Handling'],

//   // Other clerical support workers
//   14984: ['Coordination & Administration', 'Communication & Information'],

//   // Travel attendants, conductors and guides
//   14994: ['Customer Service & Support', 'Transportation & Logistics', 'Communication & Information'],

//   // Cooks
//   14998: ['Food Preparation & Service', 'Cleaning & Sanitation', 'Physical & Manual Handling'],

//   // Waiters and bartenders
//   15000: ['Customer Service & Support', 'Food Preparation & Service', 'Cleaning & Sanitation'],

//   // Hairdressers, beauticians and related workers
//   15003: ['Personal & Appearance Services', 'Customer Service & Support', 'Cleaning & Sanitation'],

//   // Building and housekeeping supervisors
//   15006: ['Management & Leadership', 'Cleaning & Sanitation', 'Maintenance & Repair'],

//   // Other personal services workers
//   15010: ['Personal & Appearance Services', 'Customer Service & Support'],

//   // Street and market salespersons
//   15018: ['Sales & Business Development', 'Customer Service & Support'],

//   // Shop salespersons
//   15021: ['Sales & Business Development', 'Customer Service & Support', 'Transportation & Logistics'],

//   // Cashiers and ticket clerks
//   15025: ['Finance & Accounting', 'Customer Service & Support', 'Coordination & Administration'],

//   // Other sales workers
//   15027: ['Sales & Business Development', 'Customer Service & Support'],

//   // Child care workers and teachers’ aides
//   15036: ['Care & Human Assistance', 'Education, Training & Coaching', 'Customer Service & Support'],

//   // Personal care workers in health services
//   15039: ['Healthcare & Clinical', 'Care & Human Assistance', 'Customer Service & Support'],

//   // Protective services workers
//   15044: ['Security & Protection', 'Customer Service & Support', 'Operation & Control'],

//   // Market gardeners and crop growers
//   15052: ['Agriculture & Environment', 'Physical & Manual Handling', 'Operation & Control'],

//   // Animal producers
//   15057: ['Agriculture & Environment', 'Physical & Manual Handling', 'Care & Human Assistance'],

//   // Mixed crop and animal producers
//   15062: ['Agriculture & Environment', 'Physical & Manual Handling', 'Operation & Control'],

//   // Forestry and related workers
//   15065: ['Agriculture & Environment', 'Physical & Manual Handling', 'Operation & Control'],

//   // Fishery workers, hunters and trappers
//   15067: ['Agriculture & Environment', 'Transportation & Logistics', 'Physical & Manual Handling'],

//   // Building frame and related trades workers
//   15083: ['Construction & Installation', 'Physical & Manual Handling', 'Maintenance & Repair'],

//   // Building finishers and related trades workers
//   15090: ['Construction & Installation', 'Physical & Manual Handling', 'Maintenance & Repair'],

//   // Painters, building structure cleaners and related trades workers
//   15098: ['Construction & Installation', 'Cleaning & Sanitation', 'Physical & Manual Handling'],

//   // Sheet and structural metal workers, moulders and welders
//   15103: ['Production & Manufacturing', 'Construction & Installation', 'Physical & Manual Handling'],

//   // Blacksmiths, toolmakers and related trades workers
//   15109: ['Production & Manufacturing', 'Maintenance & Repair', 'Physical & Manual Handling'],

//   // Machinery mechanics and repairers
//   15114: ['Maintenance & Repair', 'Inspection, Testing & Quality', 'Physical & Manual Handling'],

//   // Handicraft workers
//   15120: ['Design & Creation', 'Production & Manufacturing', 'Physical & Manual Handling'],

//   // Printing trades workers
//   15130: ['Production & Manufacturing', 'Operation & Control', 'Maintenance & Repair'],

//   // Electrical equipment installers and repairers
//   15135: ['Construction & Installation', 'Maintenance & Repair', 'Inspection, Testing & Quality'],

//   // Electronics and telecommunications installers and repairers
//   15139: ['Computing & Technical Systems', 'Construction & Installation', 'Maintenance & Repair'],

//   // Food processing and related trades workers
//   15143: ['Food Preparation & Service', 'Production & Manufacturing', 'Cleaning & Sanitation'],

//   // Wood treaters, cabinet-makers and related trades workers
//   15150: ['Production & Manufacturing', 'Construction & Installation', 'Physical & Manual Handling'],

//   // Garment and related trades workers
//   15154: ['Production & Manufacturing', 'Design & Creation', 'Physical & Manual Handling'],

//   // Other craft and related workers
//   15161: ['Production & Manufacturing', 'Construction & Installation', 'Physical & Manual Handling'],

//   // Mining and mineral processing plant operators
//   15169: ['Operation & Control', 'Production & Manufacturing', 'Maintenance & Repair'],

//   // Metal processing and finishing plant operators
//   15174: ['Production & Manufacturing', 'Operation & Control', 'Inspection, Testing & Quality'],

//   // Chemical and photographic products plant operators
//   15177: ['Production & Manufacturing', 'Operation & Control', 'Inspection, Testing & Quality'],

//   // Rubber, plastic and paper products machine operators
//   15180: ['Production & Manufacturing', 'Operation & Control', 'Maintenance & Repair'],

//   // Textile, fur and leather products machine operators
//   15184: ['Production & Manufacturing', 'Operation & Control', 'Maintenance & Repair'],

//   // Food and related products machine operators
//   15193: ['Production & Manufacturing', 'Operation & Control', 'Food Preparation & Service'],

//   // Wood processing and papermaking plant operators
//   15195: ['Production & Manufacturing', 'Operation & Control', 'Maintenance & Repair'],

//   // Other stationary plant and machine operators
//   15198: ['Operation & Control', 'Production & Manufacturing', 'Maintenance & Repair'],

//   // Assemblers
//   15204: ['Production & Manufacturing', 'Physical & Manual Handling', 'Inspection, Testing & Quality'],

//   // Locomotive engine drivers and related workers
//   15209: ['Transportation & Logistics', 'Operation & Control', 'Maintenance & Repair'],

//   // Car, van and motorcycle drivers
//   15212: ['Transportation & Logistics', 'Operation & Control', 'Maintenance & Repair'],

//   // Heavy truck and bus drivers
//   15215: ['Transportation & Logistics', 'Operation & Control', 'Maintenance & Repair'],

//   // Mobile plant operators
//   15218: ['Operation & Control', 'Construction & Installation', 'Maintenance & Repair'],

//   // Ships’ deck crews and related workers
//   15223: ['Transportation & Logistics', 'Operation & Control', 'Security & Protection'],

//   // Domestic, hotel and office cleaners and helpers
//   15227: ['Cleaning & Sanitation', 'Customer Service & Support', 'Physical & Manual Handling'],

//   // Vehicle, window, laundry and other hand cleaning workers
//   15230: ['Cleaning & Sanitation', 'Physical & Manual Handling', 'Maintenance & Repair'],

//   // Agricultural, forestry and fishery labourers
//   15236: ['Agriculture & Environment', 'Physical & Manual Handling'],

//   // Mining and construction labourers
//   15244: ['Construction & Installation', 'Physical & Manual Handling'],

//   // Manufacturing labourers
//   15248: ['Production & Manufacturing', 'Physical & Manual Handling'],

//   // Transport and storage labourers
//   15251: ['Transportation & Logistics', 'Physical & Manual Handling'],

//   // Food preparation assistants
//   15257: ['Food Preparation & Service', 'Cleaning & Sanitation', 'Physical & Manual Handling'],

//   // Street and related service workers
//   15261: ['Customer Service & Support', 'Sales & Business Development'],

//   // Street vendors (excluding food)
//   15263: ['Sales & Business Development', 'Customer Service & Support'],

//   // Refuse workers
//   15266: ['Cleaning & Sanitation', 'Physical & Manual Handling', 'Transportation & Logistics'],

//   // Other elementary workers
//   15270: ['Physical & Manual Handling', 'Coordination & Administration'],
// };

// export const OCCUPATION_FAMILY_VERBS: Record<number, string[]> = {
//   14659: [
//     'manage',
//     'supervise',
//     'lead',
//     'oversee',
//     'direct',
//     'command',
//     'protect',
//     'guard',
//     'secure',
//     'patrol',
//     'operate',
//     'control',
//     'monitor',
//     'plan',
//     'organise',
//   ],
//   14662: [
//     'supervise',
//     'lead',
//     'command',
//     'train',
//     'instruct',
//     'protect',
//     'guard',
//     'secure',
//     'operate',
//     'control',
//     'handle',
//     'carry',
//   ],
//   14665: [
//     'protect',
//     'guard',
//     'secure',
//     'patrol',
//     'defend',
//     'detain',
//     'restrain',
//     'evacuate',
//     'operate',
//     'control',
//     'handle',
//     'carry',
//     'lift',
//     'install',
//     'construct',
//   ],
//   14669: [
//     'manage',
//     'lead',
//     'direct',
//     'oversee',
//     'plan',
//     'organise',
//     'communicate',
//     'inform',
//     'write',
//     'speak',
//     'comply',
//     'adhere',
//     'enforce',
//     'regulate',
//   ],
//   14674: [
//     'manage',
//     'lead',
//     'direct',
//     'oversee',
//     'head',
//     'chair',
//     'plan',
//     'organise',
//     'budget',
//     'allocate',
//     'negotiate',
//     'evaluate',
//     'assess',
//     'decide',
//     'delegate',
//   ],
//   14677: [
//     'manage',
//     'supervise',
//     'administer',
//     'liaise',
//     'process',
//     'record',
//     'document',
//     'plan',
//     'organise',
//     'coordinate',
//     'audit',
//     'balance',
//   ],
//   14682: [
//     'manage',
//     'direct',
//     'lead',
//     'sell',
//     'negotiate',
//     'market',
//     'promote',
//     'advertise',
//     'plan',
//     'strategy',
//     'analyse',
//     'assess',
//   ],
//   14687: [
//     'manage',
//     'supervise',
//     'cultivate',
//     'plant',
//     'harvest',
//     'grow',
//     'breed',
//     'rear',
//     'plan',
//     'organise',
//     'operate',
//     'monitor',
//   ],
//   14690: [
//     'manage',
//     'supervise',
//     'produce',
//     'manufacture',
//     'assemble',
//     'construct',
//     'build',
//     'install',
//     'transport',
//     'deliver',
//     'dispatch',
//     'plan',
//     'organise',
//   ],
//   14695: [
//     'manage',
//     'direct',
//     'program',
//     'configure',
//     'integrate',
//     'network',
//     'debug',
//     'plan',
//     'organise',
//     'analyse',
//     'assess',
//     'support',
//   ],
//   14697: [
//     'manage',
//     'supervise',
//     'coordinate',
//     'administer',
//     'support',
//     'serve',
//     'assist',
//     'plan',
//     'organise',
//     'consult',
//     'advise',
//   ],
//   14706: [
//     'manage',
//     'supervise',
//     'host',
//     'welcome',
//     'greet',
//     'accommodate',
//     'serve',
//     'cook',
//     'bake',
//     'clean',
//     'organise',
//     'budget',
//   ],
//   14709: [
//     'manage',
//     'supervise',
//     'sell',
//     'purchase',
//     'buy',
//     'procure',
//     'stock',
//     'restock',
//     'price',
//     'negotiate',
//     'customer service',
//   ],
//   14711: ['manage', 'supervise', 'coordinate', 'administer', 'support', 'assist', 'plan', 'organise', 'facilitate'],
//   14716: [
//     'analyse',
//     'assess',
//     'evaluate',
//     'examine',
//     'calculate',
//     'measure',
//     'determine',
//     'estimate',
//     'interpret',
//     'research',
//     'investigate',
//     'study',
//   ],
//   14721: [
//     'calculate',
//     'measure',
//     'determine',
//     'estimate',
//     'forecast',
//     'predict',
//     'analyse',
//     'assess',
//     'evaluate',
//     'compute',
//     'programme',
//   ],
//   14723: [
//     'research',
//     'investigate',
//     'study',
//     'survey',
//     'analyse',
//     'assess',
//     'evaluate',
//     'examine',
//     'breed',
//     'cultivate',
//     'observe',
//   ],
//   14727: [
//     'design',
//     'create',
//     'develop',
//     'model',
//     'draw',
//     'analyse',
//     'assess',
//     'calculate',
//     'construct',
//     'build',
//     'test',
//     'inspect',
//   ],
//   14735: [
//     'design',
//     'develop',
//     'program',
//     'configure',
//     'integrate',
//     'install',
//     'connect',
//     'wire',
//     'test',
//     'inspect',
//     'troubleshoot',
//     'repair',
//   ],
//   14739: [
//     'design',
//     'create',
//     'develop',
//     'draw',
//     'sketch',
//     'plan',
//     'organise',
//     'structure',
//     'measure',
//     'survey',
//     'construct',
//   ],
//   14747: [
//     'treat',
//     'prescribe',
//     'diagnose',
//     'examine',
//     'assess',
//     'evaluate',
//     'consult',
//     'advise',
//     'counsel',
//     'care',
//     'observe',
//     'record',
//   ],
//   14750: [
//     'nurse',
//     'treat',
//     'care',
//     'assist',
//     'help',
//     'monitor',
//     'administer',
//     'record',
//     'triage',
//     'rehabilitate',
//     'comfort',
//   ],
//   14753: ['treat', 'counsel', 'advise', 'guide', 'evaluate', 'diagnose', 'massage', 'heal', 'care'],
//   14757: ['treat', 'prescribe', 'diagnose', 'operate', 'surgery', 'examine', 'breed', 'vaccinate', 'care', 'rescue'],
//   14759: ['treat', 'assess', 'diagnose', 'advise', 'counsel', 'rehabilitate', 'support', 'assist', 'test', 'screen'],
//   14769: [
//     'teach',
//     'train',
//     'instruct',
//     'educate',
//     'lecturer',
//     'research',
//     'study',
//     'write',
//     'publish',
//     'present',
//     'assess',
//     'grade',
//   ],
//   14771: [
//     'teach',
//     'train',
//     'instruct',
//     'educate',
//     'demonstrate',
//     'coach',
//     'mentor',
//     'assess',
//     'grade',
//     'plan',
//     'prepare',
//   ],
//   14773: ['teach', 'instruct', 'educate', 'train', 'guide', 'evaluate', 'grade', 'manage', 'supervise', 'communicate'],
//   14775: [
//     'teach',
//     'educate',
//     'care',
//     'supervise',
//     'guide',
//     'nurture',
//     'play',
//     'engage',
//     'protect',
//     'safeguard',
//     'support',
//   ],
//   14778: ['teach', 'instruct', 'train', 'educate', 'guide', 'demonstrate', 'facilitate'],
//   14787: [
//     'audit',
//     'balance',
//     'reconcile',
//     'pay',
//     'calculate',
//     'analyse',
//     'assess',
//     'evaluate',
//     'forecast',
//     'budget',
//     'record',
//   ],
//   14791: [
//     'administer',
//     'coordinate',
//     'process',
//     'record',
//     'document',
//     'file',
//     'plan',
//     'organise',
//     'comply',
//     'adhere',
//     'report',
//   ],
//   14796: [
//     'sell',
//     'negotiate',
//     'market',
//     'promote',
//     'advertise',
//     'communicate',
//     'write',
//     'present',
//     'network',
//     'analyse',
//     'research',
//   ],
//   14802: [
//     'program',
//     'programme',
//     'develop',
//     'design',
//     'configure',
//     'integrate',
//     'debug',
//     'test',
//     'analyze',
//     'solve',
//     'code',
//     'build',
//   ],
//   14808: [
//     'configure',
//     'network',
//     'interface',
//     'integrate',
//     'maintain',
//     'repair',
//     'troubleshoot',
//     'secure',
//     'monitor',
//     'administer',
//     'manage',
//   ],
//   14814: [
//     'advise',
//     'negotiate',
//     'represent',
//     'litigate',
//     'research',
//     'investigate',
//     'draft',
//     'write',
//     'comply',
//     'adhere',
//     'arbitrate',
//     'mediate',
//   ],
//   14818: [
//     'archive',
//     'catalog',
//     'classify',
//     'record',
//     'document',
//     'organise',
//     'research',
//     'search',
//     'preserve',
//     'curate',
//     'assist',
//     'guide',
//   ],
//   14821: [
//     'counsel',
//     'advise',
//     'guide',
//     'support',
//     'assist',
//     'listen',
//     'empathise',
//     'intervene',
//     'advocate',
//     'lead',
//     'preach',
//     'comfort',
//   ],
//   14828: [
//     'write',
//     'read',
//     'edit',
//     'proofread',
//     'translate',
//     'broadcast',
//     'publish',
//     'interview',
//     'investigate',
//     'report',
//     'communicate',
//   ],
//   14832: [
//     'perform',
//     'act',
//     'sing',
//     'dance',
//     'play',
//     'paint',
//     'draw',
//     'sculpt',
//     'compose',
//     'design',
//     'create',
//     'rehearse',
//   ],
//   14842: [
//     'test',
//     'inspect',
//     'check',
//     'verify',
//     'measure',
//     'calculate',
//     'operate',
//     'monitor',
//     'maintain',
//     'repair',
//     'troubleshoot',
//   ],
//   14852: [
//     'supervise',
//     'manage',
//     'oversee',
//     'inspect',
//     'check',
//     'monitor',
//     'coordinate',
//     'instruct',
//     'train',
//     'ensure safety',
//   ],
//   14856: [
//     'monitor',
//     'regulate',
//     'operate',
//     'control',
//     'adjust',
//     'calibrate',
//     'inspect',
//     'test',
//     'check',
//     'troubleshoot',
//   ],
//   14863: ['test', 'analyse', 'assess', 'examine', 'sample', 'measure', 'record', 'clean', 'sterilise', 'prepare'],
//   14867: ['pilot', 'navigate', 'steer', 'monitor', 'communicate', 'direct', 'control', 'operate', 'track', 'dispatch'],
//   14874: ['test', 'analyse', 'examine', 'sample', 'prepare', 'dispense', 'sterilise', 'operate', 'record', 'maintain'],
//   14879: ['nurse', 'care', 'assist', 'support', 'monitor', 'record', 'administer', 'triage', 'comfort'],
//   14882: ['treat', 'counsel', 'advise', 'massage', 'support', 'assist', 'care'],
//   14884: ['assist', 'care', 'feed', 'groom', 'clean', 'sterilise', 'handle', 'restrain', 'monitor', 'prepare'],
//   14886: ['test', 'screen', 'examine', 'assist', 'support', 'treat', 'advise', 'counsel', 'rehabilitate'],
//   14897: ['calculate', 'reconcile', 'process', 'record', 'audit', 'assess', 'evaluate', 'assist', 'administer'],
//   14903: ['sell', 'negotiate', 'purchase', 'procure', 'broker', 'quote', 'price', 'market', 'bid', 'contact', 'liaise'],
//   14908: ['liaise', 'administer', 'coordinate', 'process', 'assist', 'support', 'service', 'schedule', 'organise'],
//   14914: [
//     'administer',
//     'type',
//     'transcribe',
//     'record',
//     'file',
//     'document',
//     'schedule',
//     'organise',
//     'correspond',
//     'manage calendar',
//   ],
//   14919: ['inspect', 'audit', 'investigate', 'enforce', 'regulate', 'comply', 'report', 'verify', 'assess', 'check'],
//   14927: ['assist', 'advise', 'support', 'investigate', 'administer', 'mediate', 'counsel', 'facilitate'],
//   14931: ['train', 'coach', 'instruct', 'demonstrate', 'exercise', 'motivate', 'guide', 'referee', 'umpire', 'lead'],
//   14935: ['prepare', 'cook', 'create', 'style', 'design', 'serve', 'host', 'entertain', 'guide', 'curate'],
//   14942: [
//     'support',
//     'assist',
//     'help',
//     'troubleshoot',
//     'repair',
//     'configure',
//     'install',
//     'diagnose',
//     'resolve',
//     'respond',
//   ],
//   14947: ['install', 'repair', 'maintain', 'configure', 'connect', 'test', 'troubleshoot', 'broadcast', 'operate'],
//   14952: ['process', 'record', 'document', 'file', 'sort', 'copy', 'scan', 'print', 'distribute', 'organise'],
//   14954: ['type', 'transcribe', 'record', 'file', 'schedule', 'correspond', 'answer', 'manage', 'coordinate'],
//   14956: ['type', 'input', 'enter', 'process', 'verify', 'record', 'transcribe'],
//   14960: ['collect', 'pay', 'receive', 'count', 'tally', 'record', 'balance', 'handle cash', 'serve'],
//   14965: ['greet', 'welcome', 'assist', 'serve', 'inform', 'answer', 'direct', 'guide', 'handle enquiries'],
//   14975: ['calculate', 'tally', 'tabulate', 'record', 'process', 'reconcile', 'check', 'verify', 'balance'],
//   14979: ['record', 'log', 'track', 'dispatch', 'load', 'unload', 'pack', 'store', 'inventory', 'stock', 'weigh'],
//   14984: ['administer', 'process', 'record', 'organise', 'file', 'sort', 'check'],
//   14994: ['serve', 'assist', 'welcome', 'guide', 'accompany', 'escort', 'announce', 'ensure safety', 'attend'],
//   14998: ['cook', 'bake', 'roast', 'boil', 'chop', 'slice', 'mix', 'stir', 'season', 'prepare', 'clean', 'store food'],
//   15000: ['serve', 'pour', 'mix', 'take orders', 'greet', 'welcome', 'clean', 'clear', 'cash', 'pay'],
//   15003: ['cut', 'style', 'wash', 'dye', 'colour', 'shave', 'groom', 'massage', 'treat', 'clean', 'sanitize'],
//   15006: ['supervise', 'manage', 'inspect', 'clean', 'maintain', 'coordinate', 'schedule', 'check'],
//   15010: ['assist', 'serve', 'guide', 'groom', 'clean', 'care', 'support'],
//   15018: ['sell', 'display', 'market', 'promote', 'attract', 'negotiate', 'pack', 'weigh', 'cash'],
//   15021: ['sell', 'assist', 'serve', 'display', 'stock', 'replenish', 'package', 'wrap', 'cash', 'advise'],
//   15025: ['scan', 'cash', 'pay', 'collect', 'bag', 'wrap', 'greet', 'assist', 'count'],
//   15027: ['sell', 'promote', 'demonstrate', 'assist', 'serve', 'advise'],
//   15036: ['care', 'supervise', 'feed', 'play', 'engage', 'teach', 'assist', 'protect', 'safeguard', 'clean'],
//   15039: ['care', 'assist', 'nurse', 'bathe', 'feed', 'dress', 'lift', 'move', 'support', 'monitor', 'reassure'],
//   15044: [
//     'protect',
//     'guard',
//     'secure',
//     'patrol',
//     'watch',
//     'defend',
//     'detain',
//     'restrain',
//     'prevent',
//     'respond',
//     'control',
//   ],
//   15052: ['cultivate', 'plant', 'harvest', 'grow', 'prune', 'weed', 'irrigate', 'plough', 'operate', 'drive', 'dig'],
//   15057: ['breed', 'rear', 'feed', 'milk', 'shear', 'clean', 'treat', 'vaccinate', 'slaughter', 'manage'],
//   15062: ['cultivate', 'plant', 'harvest', 'grow', 'breed', 'rear', 'feed', 'operate', 'drive', 'manage'],
//   15065: ['fell', 'cut', 'prune', 'plant', 'harvest', 'operate', 'chain-saw', 'clear', 'load', 'transport'],
//   15067: ['fish', 'hunt', 'trap', 'catch', 'net', 'haul', 'navigate', 'steer', 'process', 'store'],
//   15083: [
//     'construct',
//     'build',
//     'lay',
//     'pave',
//     'pour',
//     'mix',
//     'grout',
//     'screed',
//     'plaster',
//     'demolish',
//     'excavate',
//     'lift',
//   ],
//   15090: ['install', 'fit', 'plaster', 'tile', 'paint', 'paper', 'insulate', 'seal', 'finish', 'cut', 'measure'],
//   15098: ['paint', 'clean', 'wash', 'sand', 'scrape', 'coat', 'seal', 'prepare', 'spray'],
//   15103: ['cut', 'weld', 'bend', 'shape', 'mould', 'cast', 'assemble', 'bolt', 'rivet', 'install', 'fabricate'],
//   15109: ['forge', 'shape', 'cut', 'grind', 'weld', 'temper', 'heat', 'repair', 'sharpen', 'manufacture'],
//   15114: [
//     'repair',
//     'maintain',
//     'fix',
//     'service',
//     'replace',
//     'dismantle',
//     'disassemble',
//     'troubleshoot',
//     'tune',
//     'inspect',
//     'test',
//   ],
//   15120: ['craft', 'carve', 'weave', 'sculpt', 'shape', 'decorate', 'sew', 'assemble', 'create', 'design'],
//   15130: ['operate', 'print', 'bind', 'cut', 'feed', 'set', 'prepare', 'maintain', 'inspect'],
//   15135: ['install', 'wire', 'rewire', 'connect', 'test', 'inspect', 'repair', 'maintain', 'troubleshoot'],
//   15139: ['install', 'connect', 'configure', 'test', 'repair', 'maintain', 'troubleshoot', 'solder', 'splice'],
//   15143: ['cook', 'bake', 'slaughter', 'cut', 'slice', 'mix', 'blend', 'cure', 'smoke', 'ferment', 'pack', 'inspect'],
//   15150: ['cut', 'shape', 'plane', 'sand', 'assemble', 'glue', 'construct', 'carve', 'polish', 'treat'],
//   15154: ['sew', 'stitch', 'cut', 'measure', 'pattern', 'iron', 'press', 'repair', 'alter'],
//   15161: ['assemble', 'manufacture', 'produce', 'pack', 'sort', 'inspect', 'handle'],
//   15169: ['operate', 'monitor', 'control', 'drill', 'crush', 'grind', 'screen', 'load', 'maintain'],
//   15174: ['operate', 'monitor', 'control', 'melt', 'cast', 'roll', 'extrude', 'heat', 'cool', 'coat'],
//   15177: ['operate', 'monitor', 'control', 'mix', 'blend', 'pump', 'filter', 'distil', 'test', 'regulate'],
//   15180: ['operate', 'monitor', 'extrudes', 'mould', 'press', 'cut', 'feed', 'recycle', 'inspect'],
//   15184: ['operate', 'monitor', 'spin', 'weave', 'knit', 'dye', 'bleach', 'cut', 'sew'],
//   15193: ['operate', 'monitor', 'mix', 'bake', 'cook', 'fill', 'pack', 'seal', 'clean'],
//   15195: ['operate', 'monitor', 'cut', 'chip', 'press', 'dry', 'bleach', 'roll', 'glue'],
//   15198: ['operate', 'monitor', 'control', 'start', 'stop', 'adjust', 'maintain'],
//   15204: ['assemble', 'fit', 'screw', 'bolt', 'glue', 'clip', 'fasten', 'inspect', 'test', 'pack'],
//   15209: ['drive', 'operate', 'steer', 'brake', 'start', 'stop', 'monitor', 'signal', 'maintain'],
//   15212: ['drive', 'operate', 'steer', 'deliver', 'navigate', 'load', 'unload', 'maintain', 'refuel'],
//   15215: ['drive', 'operate', 'steer', 'haul', 'tow', 'deliver', 'load', 'unload', 'inspect', 'maintain'],
//   15218: ['operate', 'drive', 'dig', 'lift', 'load', 'dump', 'grade', 'steer', 'maintain'],
//   15223: ['sail', 'navigate', 'steer', 'moor', 'dock', 'load', 'unload', 'clean', 'maintain', 'watch'],
//   15227: ['clean', 'wash', 'vacuum', 'dust', 'sweep', 'mop', 'polish', 'tidy', 'empty', 'change'],
//   15230: ['clean', 'wash', 'launder', 'iron', 'dry', 'polish', 'scrub'],
//   15236: ['plant', 'harvest', 'weeding', 'pick', 'dig', 'load', 'carry', 'feed', 'clean'],
//   15244: ['dig', 'excavate', 'demolish', 'load', 'unload', 'carry', 'lift', 'mix', 'clean'],
//   15248: ['load', 'unload', 'pack', 'unpack', 'carry', 'lift', 'sort', 'feed', 'clean'],
//   15251: ['load', 'unload', 'lift', 'carry', 'stack', 'move', 'pack', 'wrap', 'sort'],
//   15257: ['peel', 'chop', 'slice', 'wash', 'clean', 'mix', 'assist', 'clear', 'wipe'],
//   15261: ['sell', 'serve', 'clean', 'assist', 'carry', 'promote'],
//   15263: ['sell', 'display', 'market', 'pack', 'carry', 'announce'],
//   15266: ['collect', 'empty', 'load', 'sort', 'recycle', 'dispose', 'sweep'],
//   15270: ['clean', 'carry', 'deliver', 'sort', 'assist', 'pack'],
// };

// // Helper to map numeric ID to slug
// function getIdToSlugMap(): Record<number, string> {
//   const map: Record<number, string> = {};
//   for (const fam of OCCUPATION_FAMILIES) {
//     map[fam.id] = fam.slug;
//   }
//   return map;
// }

// const idToSlug = getIdToSlugMap();

// /**
//  * Resolves occupation family slugs based on verbs, a capability area, or both (intersection).
//  *
//  * @param verbs Optional array of action verbs (e.g., ["program", "design"])
//  * @param capabilityArea Optional capability area string (e.g., "Computing & Technical Systems")
//  * @returns Array of unique occupation family slugs matching the criteria
//  */
// export function resolveOccupationSlugs(verbs?: string[], capabilityArea?: string): string[] {
//   let matchedIds = new Set<number>();
//   const allIds = Object.keys(OCCUPATION_FAMILY_VERBS).map(Number);

//   const hasVerbs = verbs && verbs.length > 0;
//   const hasArea = Boolean(capabilityArea);

//   // Case 1: Neither provided - return empty or all (let's return empty for safety)
//   if (!hasVerbs && !hasArea) {
//     return [];
//   }

//   // Determine candidate IDs based on Capability Area if provided
//   const areaValidIds = new Set<number>();
//   if (hasArea) {
//     const areaVerbs = capabilityAreaMap[capabilityArea!] || [];
//     const normalizedAreaVerbs = new Set(areaVerbs.map((v) => v.toLowerCase()));

//     for (const id of allIds) {
//       const famVerbs = OCCUPATION_FAMILY_VERBS[id] || [];
//       // Check if this occupation family shares at least one verb with the capability area
//       const hasOverlap = famVerbs.some((v) => normalizedAreaVerbs.has(v.toLowerCase()));
//       if (hasOverlap) {
//         areaValidIds.add(id);
//       }
//     }
//   }

//   // Determine candidate IDs based on Verbs if provided
//   const verbValidIds = new Set<number>();
//   if (hasVerbs) {
//     const normalizedSearchVerbs = verbs!.map((v) => v.toLowerCase());

//     for (const id of allIds) {
//       const famVerbs = (OCCUPATION_FAMILY_VERBS[id] || []).map((v) => v.toLowerCase());
//       // Check if the occupation family contains all or any of the searched verbs.
//       // Using 'every' forces an intersection match for the verbs provided.
//       const matchesAllVerbs = normalizedSearchVerbs.every((searchVerb) => famVerbs.includes(searchVerb));

//       if (matchesAllVerbs) {
//         verbValidIds.add(id);
//       }
//     }
//   }

//   // Perform Intersection or Single Source resolution
//   if (hasVerbs && hasArea) {
//     // Both provided: Intersection (Must match area criteria AND verb criteria)
//     for (const id of allIds) {
//       if (areaValidIds.has(id) && verbValidIds.has(id)) {
//         matchedIds.add(id);
//       }
//     }
//   } else if (hasVerbs) {
//     // Only verbs provided
//     matchedIds = verbValidIds;
//   } else if (hasArea) {
//     // Only capability area provided
//     matchedIds = areaValidIds;
//   }

//   // Convert numeric IDs to slugs
//   return Array.from(matchedIds)
//     .map((id) => idToSlug[id])
//     .filter(Boolean);
// }
