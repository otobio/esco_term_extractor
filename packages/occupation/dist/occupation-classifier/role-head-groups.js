// Coarse, hand-built groupings of English role-head words that name the same general kind of
// role (e.g. "agent"/"representative"/"trader" all under sales_trade). Not curated from real
// per-leaf review data -- weaker evidence than roleModes, used as a last-ditch signal in scoring
// (candidates.ts) and to widen recall (retrieval.ts) so a candidate worded differently from the
import { LEVEL_SPECIALIZATION_SYNONYMS, detectLeafLevelKind } from '../runtime/occupation-leaf-structure-rules.js';
export const STRICTLY_RANK_ONLY_ROLE_HEAD_GROUPS = {
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
        'noorem',
        "ordinary"
    ],
    senior: ['experimentat', 'avansat', 'tapasztalt', 'halado', 'kogenud', 'senior', 'advanced', 'vanem'],
    lead: [
        "coordonator",
        "conducator",
        "vezeto",
        "csoportvezeto",
        "meeskonnajuht",
        "tiimijuht",
        "lead",
        "leader",
        "teamlead",
        "teamleader",
        "lider"
    ],
    supervisor: [],
    manager: [],
    director: ["head"],
    chief: ["boss", "chief"]
};
export const STRICT_SIMILARITY_ROLE_HEAD_GROUPS = {
    academic_leadership: ['dean', 'headteacher', 'principal'],
    acting: ['actor', 'actress'],
    advising: ['adviser', 'consultant', 'mentor'],
    agenting: ['agent', 'representative'],
    aiding: ['aide', 'assistant', 'companion'],
    anchoring: ['anchor', 'presenter'],
    animating: ['animator', 'cartoonist'],
    appraising: ['appraiser', 'assessor', 'estimator', 'valuer', 'adjuster', 'examiner', 'surveyor', 'underwriter'],
    arboriculture: ['arboriculturist', 'landscaper'],
    archiving: ['archivist', 'curator'],
    astronomy: ['astronomer', 'cosmologist'],
    athletics: ['athlete', 'jockey'],
    babysitting: ['babysitter', 'minder', 'sitter', 'nanny'],
    background_acting: ['extra', 'stand-in'],
    blogging: ['blogger', 'vlogger'],
    brokering: ['broker', 'dealer', 'trader'],
    building: ['builder', 'contractor'],
    butchering: ['butcher', 'slaughterer'],
    buying: ['buyer', 'purchaser', 'shopper'],
    captioning_transcription: ['describer', 'subtitler', 'transcriptionist'],
    caretaking: ['caretaker', 'handyperson'],
    cashiering: ['cashier', 'teller'],
    ceramics: ['ceramicist', 'potter'],
    channeling: ['medium', 'psychic'],
    checking: ['checker', 'inspector', 'tester', 'screener', 'grader', 'marker'],
    choreography: ['choreographer', 'choreologist'],
    cleaning: ['cleaner', 'housekeeper'],
    clergy: ['chaplain', 'minister'],
    coaching: ['coach', 'trainer', 'instructor', 'tutor'],
    coding: ['coder', 'developer', 'programmer'],
    commissioned_authority: ['commissioner', 'officer'],
    communicating: ['communicator', 'spokesperson'],
    conserving: ['conservator', 'restorer'],
    cooking: ['cook', 'chef'],
    correspondence: ['correspondent', 'journalist', 'photojournalist', 'reporter'],
    counselling: ['counsellor', 'therapist', 'psychotherapist'],
    deckhanding: ['deckhand', 'decksman'],
    delivering: ['courier', 'postman'],
    detecting: ['detective', 'investigator'],
    dietetics: ['dietitian', 'nutritionist'],
    diplomacy: ['ambassador', 'consul', 'diplomat'],
    dispatching: ['controller', 'dispatcher'],
    distilling: ['brewmaster', 'distiller', 'fermenter'],
    dressmaking: ['dressmaker', 'tailor'],
    driving: ['chauffeur', 'driver'],
    editing_proofreading: ['editor', 'proofreader', 'scopist'],
    enlisted_military: ['corporal', 'sergeant', 'soldier'],
    excavating: ['digger', 'miner'],
    explosives: ['neutraliser', 'pyrotechnician', 'shotfirer'],
    farming: ['agronomist', 'farmer'],
    fitting: ['fitter', 'jointer', 'installer'],
    forecasting: ['forecaster', 'meteorologist', 'climatologist'],
    geological_science: ['geochemist', 'geologist', 'geophysicist'],
    glassworking: ['blower', 'glazier'],
    governance: ['councillor', 'governor', 'mayor', 'minister', 'senator'],
    grooming: ['groom', 'groomer'],
    groundskeeping: ['groundsman', 'keeper', 'ranger'],
    guarding: ['guard', 'guardian', 'warden'],
    hairdressing: ['hairdresser', 'stylist', 'barber'],
    heading: ['boss', 'chief', 'head', 'leader', 'director'],
    headteaching: ['headteacher', 'principal'],
    higher_ed_teaching: ['educator', 'lecturer'],
    hosting: ['host', 'hostess'],
    hunting: ['catcher', 'hunter'],
    investing: ['capitalist', 'investor'],
    jewelcraft: ['gemmologist', 'jeweller', 'mounter'],
    journalism: ['columnist', 'journalist', 'reporter'],
    judging: ['judge', 'justice'],
    laboring: ['worker', 'labourer', 'operative'],
    legal_counsel: ['counsellor', 'lawyer', 'prosecutor'],
    linguistics: ['lexicographer', 'linguist'],
    localising: ['localiser', 'translator', 'interpreter'],
    machining: ['grinder', 'machinist', 'planer', 'turner'],
    maintaining: ['maintainer', 'servicer', 'repairer', 'handyperson'],
    manicuring: ['manicurist', 'pedicure', 'pedicurist'],
    mapping: ['cartographer', 'geographer'],
    marketing: ['marketer', 'promoter'],
    masonry: ['bricklayer', 'stonemason'],
    mathematical_science: ['mathematician', 'statistician'],
    meeting_greeting: ['receptionist', 'concierge'],
    monastic: ['monk', 'nun'],
    moulding: ['caster', 'moulder', 'mouldmaker'],
    moving: ['mover', 'transporter', 'carrier', 'porter', 'handler', 'stevedore'],
    music_making: ['musician', 'singer'],
    negotiating: ['negotiator', 'mediator'],
    notarial: ['closer', 'notary'],
    nursing: ['midwife', 'nurse'],
    oddsmaking: ['bookmaker', 'compiler'],
    optics: ['optician', 'optometrist'],
    organising: ['organiser', 'planner', 'scheduler', 'coordinator'],
    packing_sorting: ['packer', 'sorter'],
    pharmacy: ['pharmacist', 'pharmacologist'],
    photography: ['photographer', 'photojournalist'],
    physics: ['cosmologist', 'physicist'],
    practicing: ['doctor', 'practitioner'],
    precious_smithing: ['goldsmith', 'silversmith'],
    pressing: ['presser', 'ironer'],
    printmaking: ['lithographer', 'printer', 'printmaker', 'typesetter'],
    prosthetics: ['orthotist', 'prosthetist'],
    responding: ['paramedic', 'responder'],
    roughnecking: ['roughneck', 'roustabout'],
    seafaring: ['seaman', 'sailor'],
    selling: ['seller', 'vendor', 'hawker'],
    sewing: ['sewer', 'stitcher'],
    shoemaking: ['shoemaker', 'tanner'],
    skippering: ['skipper', 'boatmaster', 'captain'],
    smithing: ['smith', 'blacksmith'],
    stewarding: ['steward', 'stewardess', 'attendant', 'valet'],
    sweeping: ['sweep', 'sweeper'],
    teaching: ['teacher', 'educator', 'pedagogue'],
    textile_dyeing: ['bleacher', 'dyer'],
    ushering: ['usher', 'doorman'],
    waiting: ['waiter', 'waitress'],
    wall_finishing: ['coverer', 'paperhanger'],
    weaving_spinning: ['spinner', 'weaver'],
    welding_fabrication: ['annealer', 'brazier', 'riveter', 'solderer', 'welder'],
    woodcraft: ['woodcarver', 'woodturner'],
    writing: ['copywriter', 'speechwriter', 'writer'],
};
// Looser "broadly similar" (same general field, NOT necessarily the same job) domain clusters --
// merged straight from ROLE_HEAD_GROUPS_BATCH_1..12. Consumers should score same-strict-group
// (STRICT_SIMILARITY_ROLE_HEAD_GROUPS) matches as exact/equivalent, and same-broad-group-but-not-
// strictly-equivalent matches as a weaker,
// lower-scored "broad similarity" signal -- never the same weight as strict equivalence.
export const BROAD_SIMILARITY_ROLE_HEAD_META_GROUPS = {
    academic_administration: ['dean', 'headteacher', 'principal'],
    accounting_bookkeeping: ['accountant', 'auditor', 'bookkeeper', 'cashier', 'teller', 'treasurer'],
    acting_performance: ['actor', 'actress', 'comedian', 'extra', 'model', 'performer', 'puppeteer', 'stand-in'],
    aerospace_spaceflight: ['astronaut'],
    allied_health_diagnostics: ['audiologist', 'cytotechnologist', 'phlebotomist', 'radiographer'],
    alternative_holistic_health: ['acupuncturist', 'aromatherapist', 'homeopath', 'hydrotherapist', 'masseur', 'sophrologist'],
    animal_care_husbandry: ['breeder', 'farrier', 'groom', 'groomer', 'pedicure', 'sexer', 'shepherd', 'zookeeper'],
    apparel_fashion_styling: ['dresser', 'milliner'],
    apparel_pattern_cutting: ['cutter', 'patternmaker'],
    archives_curation: ['archivist', 'conservator', 'curator', 'librarian', 'restorer'],
    asset_valuation_risk: ['adjuster', 'appraiser', 'assessor', 'estimator', 'examiner', 'surveyor', 'underwriter', 'valuer'],
    audio_speech_media: ['describer', 'prompter', 'subtitler', 'transcriptionist'],
    banking_financial_investments: ['banker', 'capitalist', 'investor', 'pawnbroker'],
    behavioral_psychological_sciences: ['behaviourist', 'graphologist', 'psychologist'],
    beverage_crafting: ['barista', 'bartender', 'brewmaster', 'distiller', 'fermenter', 'oenologist', 'sommelier', 'taster'],
    biological_sciences: ['biochemist', 'biologist', 'biometrician', 'biophysicist', 'botanist', 'ecologist', 'geneticist', 'microbiologist'],
    biomedical_health_sciences: ['biotechnologist', 'epidemiologist', 'immunologist', 'physiologist'],
    building_construction_trades: ['builder', 'carpenter', 'caulker', 'contractor', 'digger', 'driller', 'layer', 'miner', 'roofer', 'scaffolder', 'steeplejack', 'worker'],
    buying_procurement: ['buyer', 'purchaser', 'shopper'],
    care_assistance: ['aide', 'caretaker', 'companion'],
    casting_moulding: ['caster', 'moulder', 'mouldmaker'],
    ceramic_glass_crafting: ['beveller', 'blower', 'burner', 'ceramicist', 'firer', 'glazier', 'potter'],
    childcare_minding: ['babysitter', 'minder', 'nanny', 'pair', 'sitter'],
    cleaning_sanitation: ['cleaner', 'handyperson', 'housekeeper', 'ironer', 'sweep', 'sweeper'],
    commercial_trading: ['broker', 'dealer', 'distributor', 'hawker', 'merchant', 'negotiator', 'shipbroker', 'trader'],
    culinary_kitchen_food_craft: ['baker', 'chef', 'chocolatier', 'confectioner', 'cook', 'pizzaiolo'],
    cybersecurity_digital_ops: ['hacker'],
    dance_choreography: ['choreographer', 'choreologist', 'dancer', 'repetiteur'],
    dental_oral_care: ['dentist', 'hygienist'],
    diplomatic_corps: ['ambassador', 'consul', 'diplomat'],
    divination_esoteric: ['astrologer', 'medium', 'psychic'],
    domestic_personal_services: ['butler', 'escort'],
    editing_proofreading: ['proofreader', 'scopist'],
    elected_governance_politics: ['councillor', 'governor', 'mayor', 'member', 'minister', 'official', 'senator'],
    engineering_disciplines: ['architect', 'bioengineer', 'engineer', 'geotechnician', 'nanoengineer', 'technologist'],
    equipment_machinery_operations: ['operator', 'tender'],
    earth_atmospheric_sciences: ["climatologist", "forecaster", "geochemist", "geologist", "geophysicist", "hydrogeologist", "hydrologist", "meteorologist", "oceanographer", "seismologist"],
    executive_leadership: ["boss", "chief", "entrepreneur", "executive", "head", "leader", "manager", "master"],
    eye_care_optics: ['optician', 'optometrist', 'orthoptist'],
    farming_forestry: ['agronomist', 'arboriculturist', 'farmer', 'forester', 'landscaper', 'sprayer'],
    food_processing_preparation: ['blender', 'brander', 'butcher', 'canner', 'clarifier', 'extractor', 'miller', 'presser', 'roaster', 'slaughterer', 'processor', 'trimmer'],
    food_service_waiting: ['attendant', 'steward', 'stewardess', 'waiter', 'waitress'],
    freight_dispatch_handling: ['carrier', 'collector', 'courier', 'dispatcher', 'hand', 'handler', 'mover', 'packer', 'person', 'picker', 'porter', 'postman', 'sorter', 'stevedore', 'tier', 'transporter'],
    front_desk_reception: ['concierge', 'doorman', 'host', 'hostess', 'receptionist', 'usher', 'valet'],
    gambling_betting_operations: ['bookmaker', 'compiler'],
    general_manual_labor: ['labourer', 'operative'],
    geography_mapping: ['cartographer', 'geographer'],
    hair_beauty_grooming: ['aesthetician', 'barber', 'hairdresser', 'manicurist', 'pedicurist', 'stylist'],
    handicrafts_artisan: ['basketmaker', 'cooper', 'papermaker', 'reproducer', 'maker', 'toymaker', 'watchmaker'],
    hazardous_explosives_handling: ['neutraliser', 'pyrotechnician', 'shotfirer'],
    industrial_assembly_fabrication: ['assembler', 'filler', 'manufacturer', 'rigger'],
    industrial_materials_processing: ['chipper', 'laminator', 'mixer', 'pelletiser', 'rustproofer', 'treater', 'vulcaniser', 'winder'],
    jewelry_gemology_precious: ['assayer', 'enameller', 'gemmologist', 'jeweller', 'mounter'],
    journalism_reporting: ['columnist', 'correspondent', 'critic', 'journalist', 'photojournalist', 'reporter'],
    judicial_prosecution: ['bailiff', 'judge', 'justice', 'prosecutor'],
    language_translation: ['interpreter', 'localiser', 'translator'],
    leather_footwear: ['shoemaker', 'tanner', 'upholsterer'],
    legal_notarial_compliance: ['adviser', 'closer', 'consultant', 'coroner', 'counsellor', 'lawyer', 'mediator', 'mentor', 'notary', 'ombudsman', 'trustee'],
    linguistics_philology: ['lexicographer', 'linguist'],
    machining_shaping: ['grinder', 'machinist', 'planer', 'turner'],
    maintenance_repair: ['electrician', 'greaser', 'installer', 'maintainer', 'mechanic', 'repairer', 'servicer', 'technician'],
    masonry_plastering: ['bricklayer', 'plasterer', 'setter', 'splitter', 'stonemason'],
    materials_metallurgical_sciences: ['metallurgist', 'mineralogist'],
    media_broadcasting: ['anchor', 'blogger', 'presenter', 'vlogger'],
    medical_physicians: ['doctor', 'practitioner', 'surgeon'],
    mental_health_counseling: ['counsellor', 'psychotherapist', 'therapist'],
    metrology_measurement: ['gauger', 'metrologist'],
    military_commissioned_officers: ['brigadier', 'captain', 'colonel', 'commander', 'general', 'lieutenant', 'major'],
    military_non_commissioned: ['corporal', 'sergeant', 'soldier'],
    monitoring_surveillance: ['interceptor', 'observer'],
    mortuary_services: ['embalmer'],
    music_composition_vocal: ['arranger', 'choirmaster', 'composer', 'lyricist', 'musician', 'producer', 'singer'],
    nursing_emergency_care: ['midwife', 'nurse', 'paramedic', 'responder'],
    nutrition_dietetics: ['dietitian', 'nutritionist'],
    office_administrative: ['administrator', 'assistant', 'clerk', 'registrar', 'secretary', 'typist'],
    oil_gas_rig_operations: ['derrickhand', 'logger', 'motorhand', 'pusher', 'roughneck', 'roustabout'],
    operational_supervision: ['commissioner', 'controller', 'coordinator', 'director', 'officer', 'superintendent', 'supervisor'],
    orthotics_prosthetics: ['orthotist', 'prosthetist'],
    painting_decorating: ['coverer', 'paperhanger', 'plasterer'],
    paleontology_historical_sciences: ['anthropologist', 'archaeologist', 'genealogist', 'palaeontologist'],
    park_grounds_keeping: ['groundsman', 'keeper', 'ranger'],
    pharmacology_toxicology: ['pharmacist', 'pharmacologist', 'toxicologist'],
    philosophy_academia: ['philosopher', 'scholar'],
    photography_visual_media: ['photographer'],
    physical_mathematical_sciences: ['astronomer', 'chemist', 'cosmologist', 'mathematician', 'physicist', 'statistician'],
    physical_rehabilitation: ['chiropractor', 'kinesiologist', 'osteopath', 'physiotherapist'],
    planning_scheduling: ['organiser', 'planner', 'scheduler'],
    plumbing_fitting: ['fitter', 'jointer', 'plumber', 'repairer'],
    podiatry_foot_care: ['podiatrist'],
    print_typesetting: ['imagesetter', 'lithographer', 'printer', 'printmaker', 'typesetter'],
    public_relations_marketing: ['communicator', 'marketer', 'merchandiser', 'promoter', 'spokesperson'],
    quality_inspection: ['checker', 'grader', 'inspector', 'marker', 'reader', 'screener', 'tester'],
    rail_aviation_transit_ops: ['conductor', 'marshaller', 'preparer', 'shunter', 'signalperson', 'switchperson'],
    research_analysis: ['analyst', 'chromatographer', 'expert', 'professional', 'researcher', 'scientist', 'specialist'],
    sales_representation: ['agent', 'auctioneer', 'caller', 'canvasser', 'demonstrator', 'representative', 'seller', 'vendor'],
    seafaring_maritime: ['boatman', 'boatmaster', 'boatswain', 'deckhand', 'decksman', 'sailor', 'seaman', 'skipper'],
    security_enforcement: ['bodyguard', 'detective', 'firefighter', 'guard', 'guardian', 'investigator', 'warden'],
    smithing_metalwork: ['blacksmith', 'coppersmith', 'goldsmith', 'gunsmith', 'ironworker', 'locksmith', 'shipwright', 'silversmith', 'smith'],
    social_humanities_sciences: ['criminologist', 'demographer', 'economist', 'historian', 'sociologist'],
    software_development: ['coder', 'configurator', 'developer', 'integrator', 'programmer', 'webmaster'],
    specialized_guiding_hospitality: ['guide'],
    specialized_preservation_craft: ['engraver', 'taxidermist'],
    spiritual_clergy: ['chaplain', 'missionary', 'monk', 'nun', 'verger'],
    sports_athletics: ['athlete', 'jockey'],
    surface_finishing: ['finisher', 'polisher', 'sander'],
    survey_data_collection: ['enumerator', 'interviewer'],
    tailoring_garment: ['dressmaker', 'embroiderer', 'knitter', 'sewer', 'stitcher', 'tailor'],
    teaching_instruction: ['coach', 'educator', 'instructor', 'lecturer', 'pedagogue', 'teacher', 'trainer', 'tutor'],
    textile_processing: ['bleacher', 'colourist', 'dyer', 'spinner', 'weaver'],
    theater_stage_production: ['dramaturge', 'projectionist', 'stagehand'],
    underwater_maritime_ops: ['diver'],
    vehicle_crafting_coachbuilding: ['coachbuilder'],
    vehicle_driving: ['chauffeur', 'driver', 'helmsman', 'pilot'],
    veterinary_medicine: ['veterinarian'],
    visual_arts_design: ['animator', 'artist', 'cartoonist', 'designer', 'drafter', 'illustrator', 'modeller', 'painter', 'prototyper', 'sculptor'],
    welding_fabrication: ['annealer', 'boilermaker', 'brazier', 'riveter', 'solderer', 'welder'],
    wildlife_harvesting_trapping: ['catcher', 'hunter'],
    woodworking: ['carpenter', 'woodcarver', 'woodturner'],
    workplace_ergonomics: ['ergonomist'],
    writing_editorial: ['copywriter', 'editor', 'publisher', 'speechwriter', 'writer']
};
// Role-head words so generic that using them as a standalone canonical-label search term (each
// roleHeadEquivalentTerms entry is queried on its own, AND-token-matched against every label) floods
// recall with unrelated leaves that merely happen to share the word (e.g. "manager" matches every
// "X manager" leaf in the graph). Excluded from recall widening entirely -- they carry no
// role-discriminating signal on their own, unlike a specific head such as "welder" or "cartographer".
export const RETRIEVAL_ONLY_NOISY_ROLE_HEAD_TOKENS = new Set(['manager']);
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
    'aide',
    'coordinator'
]);
const AUTHORITY_TIER_LEVEL_KINDS = new Set(['supervisor', 'manager', 'director', 'chief']);
// Every word appearing anywhere in the authority-level synonyms seed, including dual-use words
// (e.g. "director", "administrator") that also name a genuine standalone occupation and so aren't
// excluded from GENERIC/pure-rank filtering. A role head absent from this set carries no rank
// connotation at all, so it's more likely to be the query's real, unique occupational identity.
const ANY_AUTHORITY_LEVEL_SYNONYM_TOKENS = new Set(Object.values(LEVEL_SPECIALIZATION_SYNONYMS).flat());
const MAX_ROLE_HEADS_FOR_CONTEXT_INFERENCE = 8;
const MAX_TIED_FAMILIES_FOR_CONTEXT_INFERENCE = 3;
const NON_OCCUPATIONAL_CONTEXT_CONCEPT_IDS = new Set(['shift_work_object']);
export function isRankRoleHead(token, mode) {
    const levelKind = detectLeafLevelKind(new Set([token]));
    switch (mode) {
        case 'authority':
            return isAuthorityTier(levelKind);
        case 'non-authority':
            return levelKind !== 'none' && !isAuthorityTier(levelKind);
        case 'pure':
            return Object.values(STRICTLY_RANK_ONLY_ROLE_HEAD_GROUPS).some((group) => group.includes(token));
    }
}
export function isAuthorityTier(levelKind) {
    return AUTHORITY_TIER_LEVEL_KINDS.has(levelKind);
}
export function leafAuthorityLevelKindsContradict(queryLevelKind, leafLevelKind) {
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
export const ROLE_HEAD_SPELLING_VARIANTS = [['adviser', 'advisor']];
export function expandRoleHeadSpellingVariants(tokens) {
    const inputSet = new Set(tokens);
    const expanded = new Set();
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
export function selectStrongRoleHeads(roleHeads) {
    const strongHeads = [];
    const genericHeads = [];
    const rankHeads = [];
    const seen = new Set();
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
export function inferRoleHeadsFromStructuralContext(input) {
    if (input.roleHeads.some((roleHead) => !isRankRoleHead(roleHead, 'authority') && !isRankRoleHead(roleHead, 'non-authority'))) {
        return [];
    }
    const queryRoleHeads = new Set(input.roleHeads);
    const conceptFamilyFrequency = computeConceptFamilyFrequency(input.familyRules);
    const inferred = [];
    let strongestMatchScore = 0;
    for (const rule of input.familyRules) {
        if (rule.roleHeads.length > MAX_ROLE_HEADS_FOR_CONTEXT_INFERENCE) {
            continue;
        }
        if (input.authority === 'none' && !rule.authorityLevels.includes('none')) {
            continue;
        }
        if (input.authority !== 'none' &&
            !rule.authorityLevels.some((familyAuthority) => !leafAuthorityLevelKindsContradict(input.authority, familyAuthority))) {
            continue;
        }
        const matchedConceptIds = [];
        for (const [dimension, queryConceptIds] of input.conceptIdsByDimension) {
            const familyConceptIds = new Set(rule.conceptsByDimension.get(dimension) ?? []);
            for (const conceptId of queryConceptIds) {
                if (!NON_OCCUPATIONAL_CONTEXT_CONCEPT_IDS.has(conceptId) &&
                    familyConceptIds.has(conceptId) &&
                    !matchedConceptIds.includes(conceptId)) {
                    matchedConceptIds.push(conceptId);
                }
            }
        }
        if (matchedConceptIds.length === 0) {
            continue;
        }
        // A family's own role-head roster already recognizing one of the query's role heads, under a real
        // concept match, is structural proof the query already has its identity ("construction manager" is
        // a genuine leaf in the construction-managers family) -- there's no gap to rescue via inference. That
        // proof isn't scoped to this one family: a query role head can still be a bare rank word with no real
        // identity of its own (e.g. "chief"/"boss" for "sef tura patiserie"), which only ever confirms itself
        // against a wrong family, if any -- so an unrelated family also matching the same broad concept (e.g.
        // painters/cleaners sharing "construction") must not get to contribute its own, unrelated role heads
        // just because a different family already vouched for the query.
        if (rule.roleHeads.some((roleHead) => queryRoleHeads.has(roleHead))) {
            return [];
        }
        const inferableRoleHeads = [];
        for (const roleHead of rule.roleHeads) {
            if (queryRoleHeads.has(roleHead)) {
                continue;
            }
            if (isRankRoleHead(roleHead, 'pure')) {
                continue;
            }
            // The query itself never asked for a management-level role -- don't let one leak in just
            // because the family's rule also happens to cover a supervisor/manager tier.
            if (input.authority === 'none' && (isRankRoleHead(roleHead, 'authority') || isRankRoleHead(roleHead, 'non-authority'))) {
                continue;
            }
            inferableRoleHeads.push(roleHead);
        }
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
function computeConceptFamilyFrequency(familyRules) {
    const frequency = new Map();
    for (const rule of familyRules) {
        const conceptsInRule = new Set();
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
function dedupeInferredRoleHeads(inferred) {
    const byRoleHead = new Map();
    for (const inference of inferred) {
        const existing = byRoleHead.get(inference.roleHead);
        if (!existing || existing.matchScore < inference.matchScore) {
            byRoleHead.set(inference.roleHead, inference);
        }
    }
    return [...byRoleHead.values()];
}
const ROLE_HEAD_GROUP_BY_TOKEN = new Map();
for (const [group, roleHeads] of Object.entries(BROAD_SIMILARITY_ROLE_HEAD_META_GROUPS)) {
    for (const roleHead of roleHeads) {
        ROLE_HEAD_GROUP_BY_TOKEN.set(roleHead, group);
    }
}
export const ROLE_HEAD_STRICT_GROUP_BY_TOKEN = new Map();
for (const [group, roleHeads] of Object.entries(STRICT_SIMILARITY_ROLE_HEAD_GROUPS)) {
    for (const roleHead of roleHeads) {
        ROLE_HEAD_STRICT_GROUP_BY_TOKEN.set(roleHead, group);
    }
}
// Used to find which local-language token a translated English role head came from: loop the
// query's matched-token pairs and pick the local token whose English translation lands in a known
// role-head group -- that identifies the local role head without needing a dedicated local-language
// role-head list.
export function isKnownRoleHeadWord(token) {
    return ROLE_HEAD_GROUP_BY_TOKEN.has(token) || ROLE_HEAD_STRICT_GROUP_BY_TOKEN.has(token);
}
// Same general field, NOT necessarily the same job (e.g. "electrician"/"plumber", both
// maintenance_repair) -- callers should score this weaker than same-strict-group equivalence
// (ROLE_HEAD_STRICT_GROUP_BY_TOKEN), per BROAD_SIMILARITY_ROLE_HEAD_META_GROUPS.
export function roleHeadsAreBroadlySimilar(left, right) {
    if (left === '' || right === '') {
        return false;
    }
    if (left === right) {
        return true;
    }
    const leftGroup = ROLE_HEAD_GROUP_BY_TOKEN.get(left);
    return leftGroup !== undefined && leftGroup === ROLE_HEAD_GROUP_BY_TOKEN.get(right);
}
export function sharesRoleHeadGroup(queryTokens, candidateTokens) {
    const queryGroups = new Set(queryTokens.map((token) => ROLE_HEAD_GROUP_BY_TOKEN.get(token)).filter((group) => !!group));
    if (queryGroups.size === 0) {
        return false;
    }
    return candidateTokens.some((token) => {
        const group = ROLE_HEAD_GROUP_BY_TOKEN.get(token);
        return group !== undefined && queryGroups.has(group);
    });
}
// Returns every other word in the same strict role-head group(s) as the given tokens -- used to widen
// recall so a candidate worded differently from the query's role head (e.g. "actress" for a query
// using "actor") still gets pulled in as a candidate before any gate/score ever runs. Uses the
// strict (same-job) list rather than the broad (same-field) list, since it is smaller and generates
// less retrieval noise.
export function expandRoleHeadGroupTerms(tokens) {
    const inputSet = new Set(tokens);
    const groups = new Set(tokens.map((token) => ROLE_HEAD_STRICT_GROUP_BY_TOKEN.get(token)).filter((group) => !!group));
    const expanded = new Set();
    for (const group of groups) {
        for (const term of STRICT_SIMILARITY_ROLE_HEAD_GROUPS[group]) {
            if (!inputSet.has(term) && !RETRIEVAL_ONLY_NOISY_ROLE_HEAD_TOKENS.has(term)) {
                expanded.add(term);
            }
        }
    }
    return [...expanded];
}
