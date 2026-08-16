import type { RuntimeAliasRecord } from './occupation-search-meta-artifact.js';
declare const ALIAS_ROLES: readonly ["locale_primary", "locale_supporting", "reviewed_crosswalk", "family_supporting", "english_backbone"];
type ReviewedAliasSeed = {
    sourceName: string;
    leafNodeId: number;
    leafLabel: string;
    locale: string;
    alias: string;
    aliasRole: (typeof ALIAS_ROLES)[number];
    weight: number;
    note?: string;
};
type AliasOverrideRecord = {
    graphNodeId: number;
    canonicalLabel: string;
    aliases: RuntimeAliasRecord[];
};
export declare function reviewedAliasSeeds(): readonly ReviewedAliasSeed[];
export declare function applyReviewedAliasSeeds<T extends AliasOverrideRecord>(sourceName: string, record: T): T;
export {};
