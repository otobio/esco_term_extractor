export type SupportedOccupationNoiseLocale = 'ro' | 'hu';
export type OccupationNoiseKind = 'noise_ui_artifact' | 'noise_employment_flag' | 'noise_shift' | 'noise_date' | 'noise_salary' | 'noise_identifier' | 'noise_application_cta' | 'noise_language' | 'noise_location' | 'noise_employer_brand' | 'noise_parenthetical_info';
export interface OccupationNoiseRule {
    kind: OccupationNoiseKind;
    matchType: 'phrase' | 'token';
    confidence: number;
    terms?: readonly string[];
}
export declare function peelOccupationTitleNoise(title: string, locale: string | undefined): string;
