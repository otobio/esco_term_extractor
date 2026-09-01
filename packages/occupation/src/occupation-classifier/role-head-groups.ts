// Coarse, hand-built groupings of English role-head words that name the same general kind of
// role (e.g. "agent"/"representative"/"trader" all under sales_trade). Not curated from real
// per-leaf review data -- weaker evidence than roleModes, used as a last-ditch signal in scoring
// (candidates.ts) and to widen recall (retrieval.ts) so a candidate worded differently from the

import { detectLeafLevelKind } from '../runtime/occupation-leaf-structure-rules.js';

// query's role head still gets a chance to be considered.
// export const DEFAULT_ROLE_HEAD_GROUPS: Record<string, readonly string[]> = {
//   advisory_strategy: ['consultant', 'expert', 'mentor', 'specialist'],
//   software_build: ['coder', 'developer', 'programmer'],
//   teaching: ['coach', 'headteacher', 'instructor', 'lecturer', 'teacher', 'trainer', 'tutor'],
//   records_heritage: ['archivist', 'cartographer', 'conservator', 'curator', 'librarian', 'restorer'],
//   writing_editorial: ['columnist', 'copywriter', 'editor', 'journalist', 'translator', 'writer'],
//   design_visual: ['animator', 'arranger', 'artist', 'designer', 'drafter', 'illustrator', 'printmaker', 'producer'],
//   medicine_clinical: ['chiropractor', 'coroner', 'dentist', 'doctor', 'nurse', 'optometrist', 'pharmacist', 'physiotherapist', 'podiatrist', 'psychologist', 'therapist', 'veterinarian'],
//   wellness_therapy: ['aromatherapist', 'behaviourist', 'hygienist', 'kinesiologist', 'optician', 'orthoptist', 'psychotherapist', 'sophrologist'],
//   finance_risk: ['accountant', 'auditor', 'banker', 'bookkeeper', 'cashier', 'pawnbroker', 'teller', 'treasurer', 'underwriter', 'valuer'],
//   sales_trade: [
//     'agent',
//     'auctioneer',
//     'broker',
//     'buyer',
//     'dealer',
//     'demonstrator',
//     'distributor',
//     'hawker',
//     'merchant',
//     'purchaser',
//     'representative',
//     'seller',
//     'shipbroker',
//     'shopper',
//     'trader',
//     'vendor'
//   ],
//   customer_service: ['attendant', 'butler', 'escort', 'guide', 'host', 'hostess', 'receptionist', 'steward', 'stewardess', 'usher', 'waiter', 'waitress'],
//   office_admin: ['administrator', 'assistant', 'chief', 'clerk', 'controller', 'coordinator', 'executive', 'manager', 'officer', 'registrar', 'secretary', 'supervisor'],
//   fabrication_repair: ['assembler', 'electrician', 'fitter', 'greaser', 'installer', 'maintainer', 'maker', 'mechanic', 'operator', 'repairer', 'technician', 'tester'],
//   construction_finish: ['bricklayer', 'builder', 'contractor', 'coverer', 'labourer', 'plasterer', 'plumber', 'roofer', 'scaffolder', 'surveyor', 'worker'],
//   industrial_machining: ['annealer', 'boilermaker', 'brazier', 'clarifier', 'driller', 'engraver', 'filler', 'finisher', 'gauger', 'ironworker', 'metallurgist', 'mixer', 'moulder', 'mouldmaker', 'riveter', 'shotfirer', 'solderer', 'turner', 'welder'],
//   crafts_materials: ['basketmaker', 'bookmaker', 'ceramicist', 'coachbuilder', 'cooper', 'cutter', 'dressmaker', 'dresser', 'embroiderer', 'enameller', 'ironer', 'jeweller', 'knitter', 'milliner', 'modeller', 'painter', 'patternmaker', 'polisher', 'potter', 'printer', 'rustproofer', 'shoemaker', 'smith', 'tailor', 'tanner', 'toymaker', 'upholsterer', 'watchmaker', 'weaver', 'woodcarver', 'woodturner'],
//   science_research: ['analyst', 'biologist', 'chemist', 'criminologist', 'economist', 'ergonomist', 'geologist', 'mathematician', 'philosopher', 'researcher', 'scientist', 'statistician'],
//   natural_science: ['anthropologist', 'archaeologist', 'astronomer', 'biochemist', 'biometrician', 'biophysicist', 'botanist', 'climatologist', 'cosmologist', 'ecologist', 'epidemiologist', 'genealogist', 'geneticist', 'geochemist', 'geographer', 'geophysicist', 'historian', 'hydrogeologist', 'hydrologist', 'immunologist', 'microbiologist', 'mineralogist', 'oceanographer', 'palaeontologist', 'physicist', 'physiologist', 'seismologist', 'sociologist', 'toxicologist'],
//   research_analysis: ['analyst', 'assayer', 'assessor', 'chromatographer', 'cytotechnologist', 'demographer', 'economist', 'gemmologist', 'graphologist', 'grader', 'interviewer', 'investigator', 'metrologist', 'observer', 'proofreader', 'researcher', 'scopist', 'statistician', 'valuer'],
//   transport_marine: ['boatmaster', 'boatman', 'decksman', 'diver', 'driver', 'helmsman', 'pilot', 'rigger', 'sailor', 'seaman', 'shunter', 'skipper'],
//   logistics_movement: ['collector', 'conductor', 'dispatcher', 'driver', 'handler', 'mover', 'operative', 'picker', 'porter', 'processor', 'shipbroker', 'transporter'],
//   hospitality_service: ['bartender', 'cook', 'housekeeper', 'receptionist', 'steward', 'stewardess', 'waiter', 'waitress'],
//   culinary_food: ['baker', 'bartender', 'brewmaster', 'butcher', 'chef', 'chocolatier', 'confectioner', 'cook', 'miller', 'roaster', 'slaughterer', 'sommelier'],
//   beauty_wellness: ['aesthetician', 'barber', 'hairdresser', 'manicurist', 'pedicurist', 'stylist'],
//   language_communication: ['communicator', 'interpreter', 'lexicographer', 'linguist', 'localiser', 'presenter', 'prompter', 'speechwriter', 'subtitler', 'transcriptionist', 'translator', 'typist'],
//   legal_governance: ['adviser', 'ambassador', 'counsellor', 'governor', 'lawyer', 'mayor', 'mediator', 'ombudsman', 'prosecutor', 'senator'],
//   therapy_care: ['babysitter', 'caretaker', 'educator', 'hydrotherapist', 'minder', 'nutritionist', 'nurse', 'practitioner', 'sitter', 'tender', 'therapist', 'tutor'],
//   pharmacy_labs: ['acupuncturist', 'audiologist', 'dietitian', 'doctor', 'pharmacist', 'pharmacologist', 'phlebotomist', 'radiographer'],
//   media_performance: ['actor', 'actress', 'blogger', 'cartoonist', 'choreographer', 'choreologist', 'composer', 'dancer', 'director', 'lyricist', 'musician', 'photojournalist', 'photographer', 'producer', 'projectionist', 'promoter', 'puppeteer', 'reporter', 'sculptor', 'singer', 'vlogger'],
//   planning_scheduling: ['coordinator', 'controller', 'leader', 'marketer', 'merchandiser', 'planner', 'promoter', 'scheduler'],
//   technical_engineering: ['architect', 'bioengineer', 'configurator', 'developer', 'engineer', 'ergonomist', 'geotechnician', 'hacker', 'imagesetter', 'inspector', 'installer', 'interceptor', 'machinist', 'nanoengineer', 'operator', 'programmer', 'prototyper', 'pyrotechnician', 'repairer', 'technician', 'technologist', 'webmaster'],
//   agriculture_animals: ['agronomist', 'arboriculturist', 'breeder', 'catcher', 'farrier', 'forester', 'groomer', 'hunter', 'landscaper', 'oenologist', 'zookeeper'],
//   civic_protection: ['firefighter', 'guard', 'guardian'],
//   mortuary_preservation: ['embalmer', 'taxidermist'],
//   command_titles: ['brigadier', 'director', 'head', 'leader', 'master'],
//   print_prepress: ['lithographer', 'marker', 'typesetter'],
//   faith_ceremony: ['astrologer', 'monk', 'nun', 'verger'],
//   facility_support: ['cleaner'],
//   climate_science: ['meteorologist']
// } as const;

export const DEFAULT_ROLE_HEAD_GROUPS: Record<string, readonly string[]> = {
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
  maintenance_repair: ['electrician', 'installer', 'maintainer', 'mechanic', 'repairer', 'servicer', 'technician'],
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
} as const;

// Role-head words so generic that using them as a standalone canonical-label search term (each
// roleHeadEquivalentTerms entry is queried on its own, AND-token-matched against every label) floods
// recall with unrelated leaves that merely happen to share the word (e.g. "manager" matches every
// "X manager" leaf in the graph). Excluded from recall widening entirely -- they carry no
// role-discriminating signal on their own, unlike a specific head such as "welder" or "cartographer".
export const NOISY_ROLE_HEAD_TERMS = new Set<string>(['manager']);

// Role heads with no real disambiguating signal of their own. An exact match on one of these
// says little about semantic equivalence, so callers should prefer a non-rank, non-generic head
// when a profile exposes one.
export const GENERIC_ROLE_HEAD_TOKENS = new Set([
  'worker',
  'specialist',
  'professional',
  'personnel',
  'staff',
  'person',
  'practitioner',
  'attendant',
  'handler',
  'labourer',
  'operative',
  'officer',
  'hand',
  'handyperson',
  'aide'
]);

export function isRankRoleHead(token: string, mode: 'authority' | 'non-authority' | null = null): boolean {
  const tokens = new Set([token]);

  switch (mode) {
    case null:
    default:
      return detectLeafLevelKind(tokens) !== 'none';
    case 'authority':
      return ['supervisor', 'manager', 'director', 'chief'].some((levelKind) => {
        return detectLeafLevelKind(tokens) === levelKind;
      });
    case 'non-authority':
      return ['assistant', 'junior', 'senior', 'lead'].some((levelKind) => {
        return detectLeafLevelKind(tokens) === levelKind;
      });
  }
}

// Curated spelling-variant siblings for the same English role-head word (e.g. British vs. American
// spelling) -- unlike DEFAULT_ROLE_HEAD_GROUPS (same *kind* of role), these are the exact same role
// head spelled differently, so every sibling is an equal, correctness-safe substitute rather than a
// mere "same kind" widening signal. Static and hand-built for fast iteration; extend as new pairs
// are found (e.g. adviser/advisor) rather than relying on a generic suffix-swap heuristic.
export const ROLE_HEAD_SPELLING_VARIANTS: readonly (readonly string[])[] = [['adviser', 'advisor']];

export function expandRoleHeadSpellingVariants(tokens: readonly string[]): string[] {
  const inputSet = new Set(tokens);
  const expanded = new Set<string>();

  for (const row of ROLE_HEAD_SPELLING_VARIANTS) {
    if (!row.some((variant) => inputSet.has(variant))) {
      continue;
    }

    for (const variant of row) {
      if (!inputSet.has(variant)) {
        expanded.add(variant);
      }
    }
  }

  return [...expanded];
}

export function selectPrimaryRoleHead(roleHeads: readonly string[]): string {
  const uniqueHead = roleHeads.find((token) => !isRankRoleHead(token) && !GENERIC_ROLE_HEAD_TOKENS.has(token));
  if (uniqueHead) {
    return uniqueHead;
  }

  const genericHead = roleHeads.find((token) => GENERIC_ROLE_HEAD_TOKENS.has(token));
  if (genericHead) {
    return genericHead;
  }

  return roleHeads[0] ?? '';
}

const ROLE_HEAD_GROUP_BY_TOKEN = new Map<string, string>();
for (const [group, roleHeads] of Object.entries(DEFAULT_ROLE_HEAD_GROUPS)) {
  for (const roleHead of roleHeads) {
    ROLE_HEAD_GROUP_BY_TOKEN.set(roleHead, group);
  }
}

// Used to find which local-language token a translated English role head came from: loop the
// query's matched-token pairs and pick the local token whose English translation lands in a known
// role-head group -- that identifies the local role head without needing a dedicated local-language
// role-head list.
export function isKnownRoleHeadWord(token: string): boolean {
  return ROLE_HEAD_GROUP_BY_TOKEN.has(token);
}

export function sharesRoleHeadGroup(queryTokens: readonly string[], candidateTokens: readonly string[]): boolean {
  const queryGroups = new Set(queryTokens.map((token) => ROLE_HEAD_GROUP_BY_TOKEN.get(token)).filter((group): group is string => !!group));
  if (queryGroups.size === 0) {
    return false;
  }
  return candidateTokens.some((token) => {
    const group = ROLE_HEAD_GROUP_BY_TOKEN.get(token);
    return group !== undefined && queryGroups.has(group);
  });
}

// Returns every other word in the same role-head group(s) as the given tokens -- used to widen
// recall so a candidate worded differently from the query's role head (e.g. "representative" for
// a query using "agent") still gets pulled in as a candidate before any gate/score ever runs.
export function expandRoleHeadGroupTerms(tokens: readonly string[]): string[] {
  const inputSet = new Set(tokens);
  const groups = new Set(tokens.map((token) => ROLE_HEAD_GROUP_BY_TOKEN.get(token)).filter((group): group is string => !!group));

  const expanded = new Set<string>();
  for (const group of groups) {
    for (const term of DEFAULT_ROLE_HEAD_GROUPS[group as keyof typeof DEFAULT_ROLE_HEAD_GROUPS]) {
      if (!inputSet.has(term) && !NOISY_ROLE_HEAD_TERMS.has(term)) {
        expanded.add(term);
      }
    }
  }

  return [...expanded];
}
