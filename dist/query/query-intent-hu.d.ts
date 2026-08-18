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
type TokenInSetOrVariant = (token: string, values: Set<string>, locale: 'hu') => boolean;
export declare function inferHungarianStructuralRoleHead(input: {
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
