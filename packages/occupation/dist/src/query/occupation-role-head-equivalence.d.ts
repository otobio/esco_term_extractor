import { defaultOccupationRoleHeadEquivalentsArtifactPath, loadOccupationRoleHeadEquivalenceArtifactRequired, parseRoleHeadEquivalenceArtifact, type RoleHeadEquivalenceArtifact, type RoleHeadEquivalenceArtifactEntry, type RoleHeadEquivalenceClass } from '../runtime/occupation-role-head-equivalence-artifact.js';
import { type SupportedQueryLocale } from './query-preparation.js';
export type { RoleHeadEquivalenceArtifact, RoleHeadEquivalenceArtifactEntry, RoleHeadEquivalenceClass };
export { defaultOccupationRoleHeadEquivalentsArtifactPath, loadOccupationRoleHeadEquivalenceArtifactRequired, parseRoleHeadEquivalenceArtifact };
export declare function occupationRoleHeadSharesEquivalentClass(token: string, locale: SupportedQueryLocale, labelTokens: ReadonlySet<string>): boolean;
export declare function occupationRoleHeadSharesEquivalentClassWithEnglishLabel(token: string, locale: SupportedQueryLocale, englishLabelTokens: ReadonlySet<string>): boolean;
export declare function englishRoleHeadEquivalents(token: string, locale: SupportedQueryLocale): string[];
