type IntentTerm = {
    token: string;
    normalizedToken: string;
    index: number;
};
type IntentVocabularyLookupLike = {
    roleHeads: Set<string>;
    roleModifiers: Set<string>;
    domainModifiers: Set<string>;
    ambiguousModifiers: Set<string>;
};
type TokenInSetOrVariant = (token: string, values: Set<string>, locale: 'ro') => boolean;
export declare function isRomanianNonRoleHead(token: string): boolean;
export declare function looksLikeRomanianModifierAdjective(token: string): boolean;
export declare function shouldRomanianFallbackToVenue(input: {
    terms: IntentTerm[];
    termIndex: number;
    vocabulary: IntentVocabularyLookupLike;
    venueContextTerms: Set<string>;
    tokenInSetOrVariant: TokenInSetOrVariant;
}): boolean;
export declare function shouldAttachRomanianPostHeadRoleTail(input: {
    terms: IntentTerm[];
    termIndex: number;
    selectedRoleHeadIndex: number;
    roleIndexes: Set<number>;
    venueContextTerms: Set<string>;
    tokenInSetOrVariant: TokenInSetOrVariant;
}): boolean;
export declare function inferRomanianStructuralRoleHead(input: {
    terms: IntentTerm[];
    vocabulary: IntentVocabularyLookupLike;
    venueContextTerms: Set<string>;
    framePriorityByToken: Map<string, number>;
    tokenInSetOrVariant: TokenInSetOrVariant;
}): (IntentTerm & {
    termIndex: number;
    reason: string;
}) | null;
export {};
