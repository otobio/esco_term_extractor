export type OccupationNoiseOrigin = 'lead' | 'middle' | 'trail';
export type SupportedOccupationNoiseLocale = 'ro' | 'hu';
export type OccupationNoiseKind = 'noise_ui_artifact' | 'noise_employment_flag' | 'noise_shift' | 'noise_date' | 'noise_salary' | 'noise_identifier' | 'noise_application_cta' | 'noise_language' | 'noise_location' | 'noise_employer_brand' | 'noise_parenthetical_info';
export interface OccupationNoiseRule {
    kind: OccupationNoiseKind;
    matchType: 'phrase' | 'token';
    confidence: number;
    terms?: readonly string[];
    regexes?: readonly RegExp[];
}
export interface OccupationNoisePeelingProfile {
    locale: string;
    noiseRules: readonly OccupationNoiseRule[];
    normalizedOccupationExemptions: readonly string[];
    normalizedLocationHints: readonly string[];
    normalizedLocationContextMarkers: readonly string[];
    normalizedLocationSuffixHints: readonly string[];
    normalizedShiftTerms: readonly string[];
}
export interface OccupationNoiseChunk {
    surface: string;
    normalizedSurface: string;
    origin: OccupationNoiseOrigin;
    isBracket: boolean;
    kind: OccupationNoiseKind | null;
    matchType: 'phrase' | 'token' | 'chunk' | null;
    confidence: number | null;
}
export interface OccupationNoisePeelingResult {
    locale: string;
    supportedLocale: boolean;
    originalTitle: string;
    normalizedTitle: string;
    chunks: OccupationNoiseChunk[];
    noiseChunks: OccupationNoiseChunk[];
    retainedChunks: OccupationNoiseChunk[];
    peeledTitle: string;
}
export interface BuildOccupationNoisePeelingProfileInput {
    locale: string;
    noiseRules: readonly OccupationNoiseRule[];
    occupationExemptions: readonly string[];
    locationHints: readonly string[];
    locationContextMarkers: readonly string[];
    locationSuffixHints: readonly string[];
}
export declare function buildOccupationNoisePeelingProfile(input: BuildOccupationNoisePeelingProfileInput): OccupationNoisePeelingProfile;
export declare function getOccupationNoisePeelingProfile(locale: string | undefined): OccupationNoisePeelingProfile | null;
export declare function peelOccupationTitleNoise(title: string, locale: string | undefined): OccupationNoisePeelingResult;
export declare function peelOccupationTitleNoiseWithProfile(title: string, profile: OccupationNoisePeelingProfile): OccupationNoisePeelingResult;
export declare function extractOccupationTitleChunks(title: string): Array<{
    surface: string;
    origin: OccupationNoiseOrigin;
    isBracket: boolean;
}>;
export declare function normalizeSearchText(value: string): string;
