import { type SupportedQueryLocale } from './query-preparation.js';
type RoleHeadEquivalenceClass = {
    id: string;
    terms?: string[];
    termsByLocale: Partial<Record<SupportedQueryLocale, string[]>>;
};
export type RoleHeadEquivalenceArtifact = {
    description?: string;
    classes: RoleHeadEquivalenceClass[];
};
export type RoleHeadEquivalenceArtifactEntry = {
    artifactPath: string;
    artifact: RoleHeadEquivalenceArtifact;
};
export declare function defaultOccupationRoleHeadEquivalentsArtifactPath(): string;
export declare function loadOccupationRoleHeadEquivalenceArtifactRequired(): RoleHeadEquivalenceArtifactEntry;
export declare function occupationRoleHeadSharesEquivalentClass(token: string, locale: SupportedQueryLocale, labelTokens: ReadonlySet<string>): boolean;
export declare function parseRoleHeadEquivalenceArtifact(contents: string, artifactPath: string): RoleHeadEquivalenceArtifact;
export {};
