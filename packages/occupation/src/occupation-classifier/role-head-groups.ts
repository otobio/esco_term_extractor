// Coarse, hand-built groupings of English role-head words that name the same general kind of
// role (e.g. "agent"/"representative"/"trader" all under sales_trade). Not curated from real
// per-leaf review data -- weaker evidence than roleModes, used as a last-ditch signal in scoring
// (candidates.ts) and to widen recall (retrieval.ts) so a candidate worded differently from the

import { LEVEL_SPECIALIZATION_SYNONYMS, detectLeafLevelKind, type LeafLevelKind } from '../runtime/occupation-leaf-structure-rules.js';

// query's role head still gets a chance to be considered.
// export const BROAD_SIMILARITY_ROLE_HEAD_GROUPS: Record<string, readonly string[]> = {
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

// Words that are ONLY ever a rank/level modifier on some other role (e.g. "senior accountant",
// "assistant editor") and never name a standalone occupation on their own -- unlike "manager",
// "director", "chief" or "supervisor", which DO convey authority level but are themselves real,
// standalone occupation words (see BROAD_SIMILARITY_ROLE_HEAD_GROUPS's executive_leadership/
// operational_supervision groups below). Those stay out of this list; authority-level detection
// and comparison (detectLeafLevelKind / LEVEL_SPECIALIZATION_SYNONYMS) still covers them as-is.
export const STRICTLY_RANK_ONLY_ROLE_HEAD_GROUPS: Record<string, readonly string[]> = {
  none: [],
  assistant: ['ajutor', 'segito', 'abistaja', 'assistant', 'asistent', 'asistenta', 'asszisztens', 'assistent', 'deputy', 'associate'],
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
  senior: ['experimentat', 'avansat', 'tapasztalt', 'halado', 'kogenud', 'senior', 'advanced', 'vanem']
};

export const BROAD_SIMILARITY_ROLE_HEAD_GROUPS: Record<string, readonly string[]> = {
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
export const RETRIEVAL_ONLY_NOISY_ROLE_HEAD_TOKENS = new Set<string>(['manager']);

// Role heads with no real disambiguating signal of their own. An exact match on one of these
// says little about semantic equivalence, so callers should prefer a non-rank, non-generic head
// when a profile exposes one.
export const VAGUE_ROLE_HEAD_TOKENS = new Set([
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

const AUTHORITY_TIER_LEVEL_KINDS = new Set<LeafLevelKind>(['supervisor', 'manager', 'director', 'chief']);

// Every word appearing anywhere in the authority-level synonyms seed, including dual-use words
// (e.g. "director", "administrator") that also name a genuine standalone occupation and so aren't
// excluded from GENERIC/pure-rank filtering. A role head absent from this set carries no rank
// connotation at all, so it's more likely to be the query's real, unique occupational identity.
const ANY_AUTHORITY_LEVEL_SYNONYM_TOKENS = new Set(Object.values(LEVEL_SPECIALIZATION_SYNONYMS).flat());
const MAX_ROLE_HEADS_FOR_CONTEXT_INFERENCE = 8;
const MAX_TIED_FAMILIES_FOR_CONTEXT_INFERENCE = 3;
const NON_OCCUPATIONAL_CONTEXT_CONCEPT_IDS = new Set(['shift_work_object']);

export function isRankRoleHead(token: string, mode: 'authority' | 'non-authority' | 'pure'): boolean {
  const levelKind = detectLeafLevelKind(new Set([token]));

  switch (mode) {
    case 'authority':
      return isAuthorityTier(levelKind);
    case 'non-authority':
      return levelKind !== 'none' && !isAuthorityTier(levelKind);
    case 'pure':
      return Object.values(STRICTLY_RANK_ONLY_ROLE_HEAD_GROUPS).some((group) => (group as readonly string[]).includes(token));
  }
}

export function isAuthorityTier(levelKind: LeafLevelKind): boolean {
  return AUTHORITY_TIER_LEVEL_KINDS.has(levelKind);
}

export function leafAuthorityLevelKindsContradict(queryLevelKind: LeafLevelKind, leafLevelKind: LeafLevelKind): boolean {
  if (queryLevelKind === 'none') {
    return isAuthorityTier(leafLevelKind);
  }

  return isAuthorityTier(queryLevelKind) !== isAuthorityTier(leafLevelKind);
}

// Curated spelling-variant siblings for the same English role-head word (e.g. British vs. American
// spelling) -- unlike BROAD_SIMILARITY_ROLE_HEAD_GROUPS (same *kind* of role), these are the exact same role
// head spelled differently, so every sibling is an equal, correctness-safe substitute rather than a
// mere "same kind" widening signal. Static and hand-built for fast iteration; extend as new pairs
// are found (e.g. adviser/advisor) rather than relying on a generic suffix-swap heuristic.
export const ROLE_HEAD_SPELLING_VARIANTS: readonly (readonly string[])[] = [['adviser', 'advisor']];

type StructuralContextRoleHeadInferenceRule = {
  familyNodeId: number;
  familyLabel: string;
  roleHeads: readonly string[];
  authorityLevels: readonly LeafLevelKind[];
  conceptsByDimension: ReadonlyMap<string, readonly string[]>;
};

export type InferredRoleHeadFromStructuralContext = {
  roleHead: string;
  familyNodeId: number;
  familyLabel: string;
  matchedConceptIds: readonly string[];
  matchScore: number;
};

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

export function selectStrongRoleHeads(roleHeads: readonly string[]): string[] {
  const strongHeads: string[] = [];
  const genericHeads: string[] = [];
  const rankHeads: string[] = [];
  const seen = new Set<string>();

  for (const roleHead of roleHeads) {
    if (seen.has(roleHead)) {
      continue;
    }
    seen.add(roleHead);

    if (VAGUE_ROLE_HEAD_TOKENS.has(roleHead)) {
      genericHeads.push(roleHead);
      continue;
    }
    if (isRankRoleHead(roleHead, 'pure')) {
      rankHeads.push(roleHead);
      continue;
    }
    strongHeads.push(roleHead);
  }

  if (strongHeads.length > 0) {
    // Among strong heads, a word with no authority-level connotation at all is more likely to be
    // the query's real occupational identity than a dual-use word that also happens to double as a
    // rank modifier (e.g. "administrator", "director") -- prefer those when both kinds are present.
    const nonAuthority = strongHeads.filter((roleHead) => !ANY_AUTHORITY_LEVEL_SYNONYM_TOKENS.has(roleHead));
    return nonAuthority.length > 0 ? nonAuthority : strongHeads;
  }

  return genericHeads.length > 0 ? genericHeads : rankHeads;
}

// Aim is to infer quality role-head not common ones like general or boss etc.
export function inferRoleHeadsFromStructuralContext(input: {
  authority: LeafLevelKind;
  roleHeads: readonly string[];
  conceptIdsByDimension: ReadonlyMap<string, readonly string[]>;
  familyRules: readonly StructuralContextRoleHeadInferenceRule[];
}): InferredRoleHeadFromStructuralContext[] {
  if (input.roleHeads.some((roleHead) => !isRankRoleHead(roleHead, 'authority') && !isRankRoleHead(roleHead, 'non-authority'))) {
    return [];
  }

  const queryRoleHeads = new Set(input.roleHeads);
  const conceptFamilyFrequency = computeConceptFamilyFrequency(input.familyRules);
  const inferred: InferredRoleHeadFromStructuralContext[] = [];
  let strongestMatchScore = 0;

  for (const rule of input.familyRules) {
    if (rule.roleHeads.length > MAX_ROLE_HEADS_FOR_CONTEXT_INFERENCE) {
      continue;
    }

    if (input.authority === 'none' && !rule.authorityLevels.includes('none')) {
      continue;
    }

    if (
      input.authority !== 'none' &&
      !rule.authorityLevels.some((familyAuthority) => !leafAuthorityLevelKindsContradict(input.authority, familyAuthority))
    ) {
      continue;
    }

    const matchedConceptIds: string[] = [];
    for (const [dimension, queryConceptIds] of input.conceptIdsByDimension) {
      const familyConceptIds = new Set(rule.conceptsByDimension.get(dimension) ?? []);
      for (const conceptId of queryConceptIds) {
        if (
          !NON_OCCUPATIONAL_CONTEXT_CONCEPT_IDS.has(conceptId) &&
          familyConceptIds.has(conceptId) &&
          !matchedConceptIds.includes(conceptId)
        ) {
          matchedConceptIds.push(conceptId);
        }
      }
    }

    if (matchedConceptIds.length === 0) {
      continue;
    }

    const inferableRoleHeads = rule.roleHeads.filter(
      (roleHead) =>
        !queryRoleHeads.has(roleHead) &&
        !isRankRoleHead(roleHead, 'pure') &&
        !isRankRoleHead(roleHead, 'authority') &&
        !isRankRoleHead(roleHead, 'non-authority') &&
        !VAGUE_ROLE_HEAD_TOKENS.has(roleHead)
    );
    if (inferableRoleHeads.length === 0) {
      continue;
    }

    // Not every matched concept is equally good evidence: a concept shared by dozens of families
    // (e.g. a generic "support" task) barely narrows anything down, while one that appears in only
    // a couple of families is a strong, specific signal. Weight each match by its rarity across the
    // known families instead of just counting matches, so a rare concept can outrank a family that
    // merely piled up several generic ones.
    const matchScore = matchedConceptIds.reduce((sum, conceptId) => sum + 1 / (conceptFamilyFrequency.get(conceptId) ?? 1), 0);
    strongestMatchScore = Math.max(strongestMatchScore, matchScore);

    for (const roleHead of inferableRoleHeads) {
      inferred.push({
        roleHead,
        familyNodeId: rule.familyNodeId,
        familyLabel: rule.familyLabel,
        matchedConceptIds,
        matchScore
      });
    }
  }

  // A family whose concept overlap is weaker (rarer concepts count for more) than another matching
  // family's is a noisier, less trustworthy signal -- keeping its role heads alongside the stronger
  // match's is how a query like "business development manager" ended up pulling in a barely-related
  // family's role heads too. Only the family (or families, on a genuine tie) with the strongest
  // concept-specificity score gets to contribute inferred role heads.
  const strongestMatches = inferred.filter((inference) => Math.abs(inference.matchScore - strongestMatchScore) < 1e-9);
  const strongestMatchFamilyCount = new Set(strongestMatches.map((inference) => inference.familyNodeId)).size;

  // When many unrelated families all tie for the same, weakest possible concept match (a query like
  // "client support ... start date" only ever matches one broad, generic task concept at a time), that
  // tie isn't evidence pointing at any of them -- it's a sign the matched concept is too generic to
  // discriminate. A real match should only ever tie across a couple of genuinely related families
  // (e.g. two related trades sharing one context concept), not a dozen unrelated occupations.
  if (strongestMatchFamilyCount > MAX_TIED_FAMILIES_FOR_CONTEXT_INFERENCE) {
    return [];
  }

  return dedupeInferredRoleHeads(strongestMatches);
}

function computeConceptFamilyFrequency(familyRules: readonly StructuralContextRoleHeadInferenceRule[]): Map<string, number> {
  const frequency = new Map<string, number>();

  for (const rule of familyRules) {
    const conceptsInRule = new Set<string>();
    for (const conceptIds of rule.conceptsByDimension.values()) {
      for (const conceptId of conceptIds) {
        conceptsInRule.add(conceptId);
      }
    }
    for (const conceptId of conceptsInRule) {
      frequency.set(conceptId, (frequency.get(conceptId) ?? 0) + 1);
    }
  }

  return frequency;
}

function dedupeInferredRoleHeads(inferred: readonly InferredRoleHeadFromStructuralContext[]): InferredRoleHeadFromStructuralContext[] {
  const byRoleHead = new Map<string, InferredRoleHeadFromStructuralContext>();

  for (const inference of inferred) {
    const existing = byRoleHead.get(inference.roleHead);
    if (!existing || existing.matchScore < inference.matchScore) {
      byRoleHead.set(inference.roleHead, inference);
    }
  }

  return [...byRoleHead.values()];
}

const ROLE_HEAD_GROUP_BY_TOKEN = new Map<string, string>();
for (const [group, roleHeads] of Object.entries(BROAD_SIMILARITY_ROLE_HEAD_GROUPS)) {
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

export function roleHeadsAreBroadlySimilar(left: string, right: string): boolean {
  if (left === '' || right === '') {
    return false;
  }
  if (left === right) {
    return true;
  }

  const leftGroup = ROLE_HEAD_GROUP_BY_TOKEN.get(left);
  return leftGroup !== undefined && leftGroup === ROLE_HEAD_GROUP_BY_TOKEN.get(right);
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
    for (const term of BROAD_SIMILARITY_ROLE_HEAD_GROUPS[group as keyof typeof BROAD_SIMILARITY_ROLE_HEAD_GROUPS]) {
      if (!inputSet.has(term) && !RETRIEVAL_ONLY_NOISY_ROLE_HEAD_TOKENS.has(term)) {
        expanded.add(term);
      }
    }
  }

  return [...expanded];
}
