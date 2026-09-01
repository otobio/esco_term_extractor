import type { SupportedQueryLocale } from './query-preparation.js';
import type { OccupationGroup } from '../api/occupation-family-taxonomy.js';
export type QueryIntentTermKind = 'role_head' | 'role_modifier' | 'venue_context' | 'domain_modifier' | 'seniority_modifier' | 'credential_modifier' | 'ambiguous_modifier' | 'unresolved_modifier';
export type QueryIntentDecision = {
    token: string;
    normalizedToken: string;
    index: number;
    kind: QueryIntentTermKind;
    reason: string;
};
export type OccupationQueryIntent = {
    roleTokens: string[];
    roleHeadTokens: string[];
    altRoleHeadTokens: string[];
    roleModifierTokens: string[];
    altRoleModifierTokens: string[];
    genericRoleHeadTokens: string[];
    authoritativeRoleHeadTokens: string[];
    occupationClassPreference: OccupationClassPreference;
    roleHeadRequiresContext: boolean;
    roleHeadHasContext: boolean;
    venueTokens: string[];
    domainTokens: string[];
    seniorityTokens: string[];
    credentialTokens: string[];
    ambiguousTokens: string[];
    unresolvedModifierTokens: string[];
    confidence: number;
    diagnostics: QueryIntentDecision[];
};
export type OccupationQueryIntentRoleHeadAuthority = Pick<OccupationQueryIntent, 'genericRoleHeadTokens' | 'authoritativeRoleHeadTokens' | 'roleHeadRequiresContext' | 'roleHeadHasContext'>;
export type OccupationClassPreference = {
    preferredFamilyGroups: OccupationGroup[];
    disfavoredFamilyGroups: OccupationGroup[];
};
export type OccupationIntentVocabularyLocale = {
    localeCode: SupportedQueryLocale | string;
    roleHeadTerms: string[];
    roleModifierTerms: string[];
    domainModifierTerms: string[];
    credentialModifierTerms: string[];
    ambiguousModifierTerms: string[];
    rolePhrases: string[];
    domainPhrases: string[];
};
export type OccupationIntentVocabulary = {
    localeProfiles: OccupationIntentVocabularyLocale[];
    resolveLocaleProfile?: (localeCode: string) => OccupationIntentVocabularyLocale | null;
};
export type ClassifyOccupationQueryIntentInput = {
    locale: SupportedQueryLocale;
    foldedTokens: string[];
    usefulFoldedRecallTokens: string[];
    roleExpansionFoldedTokens?: string[];
    disabledRolePhraseSurfaces?: string[];
    stopTokens: string[];
    noiseTokens: string[];
    modifierTokens: string[];
    vocabulary?: OccupationIntentVocabulary | null;
};
export declare const BUILTIN_INTENT_VOCABULARY: OccupationIntentVocabulary;
export declare const BUILTIN_VENUE_CONTEXT_TERMS_BY_LOCALE: Record<SupportedQueryLocale, Set<string>>;
/**
 * This is intentionally limited to explicit management/executive intent.
 * Other occupation classes should not bias family ranking here.
 */
export declare const OCCUPATION_CLASS_HINTS_BY_LOCALE: Record<SupportedQueryLocale, Record<string, OccupationClassPreference>>;
export declare function classifyOccupationQueryIntent(input: ClassifyOccupationQueryIntentInput): OccupationQueryIntent;
export declare function computeAltRoleHeadTokens(roleHeadTokens: string[], locale: SupportedQueryLocale): string[];
export declare function inferOccupationClassPreference(input: {
    locale: SupportedQueryLocale;
    roleHeadTokens: string[];
    authoritativeRoleHeadTokens: string[];
    roleExpansionTokens?: ReadonlySet<string> | readonly string[];
}): OccupationClassPreference;
export declare function resolveRoleHeadAuthority(input: {
    locale: SupportedQueryLocale;
    roleTokens: string[];
    roleHeadTokens: string[];
    venueTokens?: string[];
    domainTokens?: string[];
    ambiguousTokens?: string[];
}): OccupationQueryIntentRoleHeadAuthority;
