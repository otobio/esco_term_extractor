import type { CommonRolePhraseEntry } from './common-role-phrase-atlas.js';
import type { FamilyAliasEntry } from './family-alias-atlas.js';
type ReviewedNoiseRule = {
    kind: string;
    matchType: 'phrase' | 'token';
    confidence: number;
    terms?: readonly string[];
};
export declare function reviewedCommonRolePhraseEntries(): CommonRolePhraseEntry[];
export declare function reviewedFamilyAliasEntries(): FamilyAliasEntry[];
export declare function reviewedNoiseRules(locale: 'ro' | 'hu'): ReviewedNoiseRule[];
export {};
