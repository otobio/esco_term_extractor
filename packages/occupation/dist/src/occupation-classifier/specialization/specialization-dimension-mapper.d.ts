export declare const SPECIALIZATION_DIMENSIONS: readonly ["venue", "channel", "product", "population", "task", "industry", "knowledge_domain", "work_object", "role_head"];
export type SpecializationDimension = (typeof SPECIALIZATION_DIMENSIONS)[number];
export type SpecializationRoleMode = 'commercial' | 'creative' | 'education' | 'knowledge' | 'technical';
export type SpecializationConceptRule = {
    dimension: Exclude<SpecializationDimension, 'role_head'>;
    roleModes: SpecializationRoleMode[];
};
export type SpecializationConceptAlias = {
    priority?: number;
    value: string;
};
export type TitleClassification = Record<SpecializationDimension, string[]> & {
    available: Record<SpecializationDimension, string[]>;
    concept: Record<SpecializationDimension, string[]>;
    literal: Record<SpecializationDimension, string[]>;
    structural_combination: StructuralCombinationMatch[];
    tokens: string[];
    unresolved: string[];
};
export type TokenClassification = {
    token: string;
    normalized: string;
    dimension: SpecializationDimension | null;
    status: 'assigned' | 'stopword' | 'unresolved';
};
export type DetailedTitleClassification = TitleClassification & {
    assignments: TokenClassification[];
};
export type ResolvedSpecializationConcept = {
    aliases: string[];
    canonicalTokens: string[];
    conceptId: string;
    dimension: Exclude<SpecializationDimension, 'role_head'>;
    end: number;
    priority: number;
    start: number;
};
export type StructuralCombinationConceptMatch = {
    canonicalTokens: string[];
    conceptId: string;
    dimension: Exclude<SpecializationDimension, 'role_head'>;
    end: number;
    start: number;
};
export type StructuralCombinationMatch = {
    id: string;
    concepts: StructuralCombinationConceptMatch[];
    derivedRoleHeads: string[];
    roleHeads: string[];
};
export type QuerySpecializationClassification = TitleClassification & {
    concepts: ResolvedSpecializationConcept[];
    roleModes: SpecializationRoleMode[];
};
export type SpecializationConcept = {
    aliases: Array<string | SpecializationConceptAlias>;
    canonical?: string;
    dimension?: Exclude<SpecializationDimension, 'role_head'>;
    id: string;
    rules?: SpecializationConceptRule[];
};
export type SpecializationSchema = {
    acronymDimensions: Record<string, Exclude<SpecializationDimension, 'role_head'>>;
    conceptEquivalences: Array<{
        conceptIds: string[];
        dimension: Exclude<SpecializationDimension, 'role_head'>;
        note?: string;
    }>;
    concepts: SpecializationConcept[];
    phraseDimensions: Array<{
        aliases: string[];
        dimension: Exclude<SpecializationDimension, 'role_head'>;
    }>;
    roleHeads: string[];
    roleHeadAliases?: Array<{
        alias: string;
        roleHead: string;
    }>;
    structuralCombinations?: Array<{
        conceptIds: string[];
        derivedRoleHeads: string[];
        id: string;
        roleHeads: string[];
    }>;
    roleModes: Record<SpecializationRoleMode, string[]>;
    stopwords: string[];
};
export type ClassifierOptions = {
    locale?: string;
    schema?: SpecializationSchema;
};
export declare const DEFAULT_ROLE_HEAD_GROUPS: {
    readonly academic_administration: readonly ["dean", "headteacher", "principal"];
    readonly accounting_bookkeeping: readonly ["accountant", "auditor", "bookkeeper", "cashier", "teller", "treasurer"];
    readonly acting_performance: readonly ["actor", "actress", "comedian", "extra", "performer", "puppeteer", "stand-in"];
    readonly animal_care_husbandry: readonly ["breeder", "farrier", "groom", "groomer", "shepherd", "zookeeper"];
    readonly archives_curation: readonly ["archivist", "conservator", "curator", "librarian", "restorer"];
    readonly asset_valuation_risk: readonly ["adjuster", "appraiser", "assessor", "examiner", "underwriter", "valuer"];
    readonly audio_speech_media: readonly ["describer", "prompter", "subtitler", "transcriptionist"];
    readonly beverage_crafting: readonly ["barista", "bartender", "brewmaster", "distiller", "sommelier"];
    readonly biological_sciences: readonly ["biochemist", "biologist", "botanist", "ecologist", "geneticist", "microbiologist"];
    readonly building_construction: readonly ["builder", "carpenter", "contractor", "worker"];
    readonly buying_procurement: readonly ["buyer", "purchaser", "shopper"];
    readonly care_assistance: readonly ["aide", "caretaker", "companion"];
    readonly casting_moulding: readonly ["caster", "moulder", "mouldmaker"];
    readonly ceramic_glass_crafting: readonly ["blower", "ceramicist", "potter"];
    readonly childcare_minding: readonly ["babysitter", "minder", "nanny", "pair", "sitter"];
    readonly cleaning_sanitation: readonly ["cleaner", "handyperson", "housekeeper", "sweep", "sweeper"];
    readonly commercial_trading: readonly ["broker", "dealer", "merchant", "trader"];
    readonly culinary_kitchen: readonly ["baker", "chef", "cook", "pizzaiolo"];
    readonly dance_choreography: readonly ["choreographer", "choreologist", "dancer", "repetiteur"];
    readonly diplomatic_corps: readonly ["ambassador", "consul", "diplomat"];
    readonly divination_esoteric: readonly ["astrologer", "medium", "psychic"];
    readonly earth_geological_sciences: readonly ["climatologist", "geochemist", "geologist", "geophysicist", "hydrogeologist", "hydrologist", "meteorologist", "oceanographer", "seismologist"];
    readonly elected_governance: readonly ["councillor", "mayor", "senator"];
    readonly engineering_disciplines: readonly ["architect", "bioengineer", "engineer", "nanoengineer", "technologist"];
    readonly executive_leadership: readonly ["boss", "chief", "executive", "head", "leader", "manager"];
    readonly eye_care_optics: readonly ["optician", "optometrist", "orthoptist"];
    readonly farming_forestry: readonly ["agronomist", "arboriculturist", "farmer", "forester", "landscaper"];
    readonly food_service_waiting: readonly ["attendant", "steward", "stewardess", "waiter", "waitress"];
    readonly freight_dispatch_handling: readonly ["courier", "dispatcher", "handler", "mover", "packer", "porter", "postman", "transporter"];
    readonly front_desk_reception: readonly ["concierge", "doorman", "host", "hostess", "receptionist", "usher", "valet"];
    readonly hair_beauty_grooming: readonly ["aesthetician", "barber", "hairdresser", "manicurist", "pedicurist", "stylist"];
    readonly judicial_prosecution: readonly ["bailiff", "judge", "justice", "prosecutor"];
    readonly language_translation: readonly ["interpreter", "localiser", "translator"];
    readonly leather_footwear: readonly ["shoemaker", "tanner", "upholsterer"];
    readonly legal_counseling: readonly ["adviser", "counsellor", "lawyer"];
    readonly machining_shaping: readonly ["grinder", "machinist", "planer", "turner"];
    readonly maintenance_repair: readonly ["installer", "maintainer", "mechanic", "repairer", "servicer", "technician"];
    readonly masonry_plastering: readonly ["bricklayer", "plasterer", "stonemason"];
    readonly media_broadcasting: readonly ["anchor", "blogger", "presenter", "vlogger"];
    readonly medical_physicians: readonly ["doctor", "practitioner", "surgeon"];
    readonly mental_health_counseling: readonly ["counsellor", "psychotherapist", "therapist"];
    readonly military_commissioned_officers: readonly ["brigadier", "captain", "colonel", "commander", "general", "lieutenant", "major"];
    readonly military_non_commissioned: readonly ["corporal", "sergeant", "soldier"];
    readonly music_composition_vocal: readonly ["choirmaster", "composer", "lyricist", "musician", "singer"];
    readonly office_administrative: readonly ["administrator", "assistant", "clerk", "registrar", "secretary"];
    readonly operational_supervision: readonly ["controller", "coordinator", "director", "officer", "supervisor"];
    readonly painting_decorating: readonly ["coverer", "paperhanger", "plasterer"];
    readonly pharmacology_toxicology: readonly ["pharmacist", "pharmacologist", "toxicologist"];
    readonly physical_mathematical_sciences: readonly ["astronomer", "chemist", "cosmologist", "mathematician", "physicist", "statistician"];
    readonly physical_rehabilitation: readonly ["chiropractor", "osteopath", "physiotherapist"];
    readonly plumbing_fitting: readonly ["fitter", "plumber", "repairer"];
    readonly print_typesetting: readonly ["printer", "printmaker", "typesetter"];
    readonly quality_inspection: readonly ["checker", "inspector", "tester"];
    readonly sales_representation: readonly ["agent", "canvasser", "demonstrator", "representative", "seller", "vendor"];
    readonly seafaring_maritime: readonly ["boatman", "boatmaster", "boatswain", "deckhand", "decksman", "sailor", "seaman", "skipper"];
    readonly security_enforcement: readonly ["bodyguard", "detective", "firefighter", "guard", "guardian", "investigator", "warden"];
    readonly smithing_metalwork: readonly ["blacksmith", "coppersmith", "goldsmith", "gunsmith", "locksmith", "shipwright", "silversmith", "smith"];
    readonly social_humanities_sciences: readonly ["anthropologist", "archaeologist", "criminologist", "demographer", "economist", "historian", "sociologist"];
    readonly software_development: readonly ["coder", "developer", "programmer"];
    readonly spiritual_clergy: readonly ["chaplain", "missionary", "monk", "nun", "verger"];
    readonly tailoring_garment: readonly ["dressmaker", "embroiderer", "knitter", "sewer", "stitcher", "tailor", "weaver"];
    readonly teaching_instruction: readonly ["coach", "educator", "instructor", "lecturer", "teacher", "trainer", "tutor"];
    readonly vehicle_driving: readonly ["chauffeur", "driver", "helmsman", "pilot"];
    readonly visual_arts_design: readonly ["animator", "artist", "cartoonist", "designer", "drafter", "illustrator", "painter", "sculptor"];
    readonly welding_fabrication: readonly ["annealer", "boilermaker", "brazier", "riveter", "solderer", "welder"];
    readonly woodworking: readonly ["carpenter", "woodcarver", "woodturner"];
    readonly writing_editorial: readonly ["columnist", "copywriter", "editor", "journalist", "reporter", "writer"];
};
export declare const BASE_SPECIALIZATION_SCHEMA: SpecializationSchema;
export declare const DEFAULT_SPECIALIZATION_SCHEMA: SpecializationSchema;
export declare function tokenizeTitle(text: string): string[];
export declare function classifySpecializationQuery(title: string, options?: ClassifierOptions): QuerySpecializationClassification;
export declare function classifySpecializationTitle(title: string, options?: ClassifierOptions): TitleClassification;
export declare function classifySpecializationTitleDetailed(title: string, options?: ClassifierOptions): DetailedTitleClassification;
export declare function loadSpecializationSchemaFromCsv(schemaDir?: string, locale?: string): SpecializationSchema | null;
