import type { SupportedQueryLocale } from './query-preparation.js';
export type QueryIntentTermKind = 'role_head' | 'role_modifier' | 'domain_modifier' | 'seniority_modifier' | 'credential_modifier' | 'ambiguous_modifier' | 'unresolved_modifier';
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
    domainTokens: string[];
    seniorityTokens: string[];
    credentialTokens: string[];
    ambiguousTokens: string[];
    unresolvedModifierTokens: string[];
    confidence: number;
    diagnostics: QueryIntentDecision[];
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
};
export type ClassifyOccupationQueryIntentInput = {
    locale: SupportedQueryLocale;
    foldedTokens: string[];
    usefulFoldedTokens: string[];
    roleExpansionFoldedTokens?: string[];
    stopTokens: string[];
    noiseTokens: string[];
    modifierTokens: string[];
    vocabulary?: OccupationIntentVocabulary | null;
};
export declare function classifyOccupationQueryIntent(input: ClassifyOccupationQueryIntentInput): OccupationQueryIntent;
