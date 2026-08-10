import type { CommonRolePhraseEntry } from './common-role-phrase-atlas.js';
import type { FamilyAliasEntry } from './family-alias-atlas.js';
import type { OccupationNoiseRule, SupportedOccupationNoiseLocale } from './occupation-noise-peeling.js';
export declare function reviewedCommonRolePhraseEntries(): CommonRolePhraseEntry[];
export declare function reviewedFamilyAliasEntries(): FamilyAliasEntry[];
export declare function reviewedNoiseRules(locale: SupportedOccupationNoiseLocale): OccupationNoiseRule[];
