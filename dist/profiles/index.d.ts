/**
 * Resolve profiles — input-specific pipelines over the shared matcher tools.
 *
 * `title` runs the full longest-match span scan (worth it for short,
 * bucket-dense titles). Other profiles (e.g. a lighter `description` path) can
 * be added here without touching the matcher or the default CLI behavior.
 */
export type { DescriptionProfileResult, DescriptionSection, DescriptionSectionKind } from './description.js';
export { parseDescriptionSections, resolveDescription } from './description.js';
export type { ProfileResult, ResolvedTerm, TitleDeps, Verifier } from './title.js';
export { resolveTitle } from './title.js';
import { resolveDescription } from './description.js';
import { resolveTitle } from './title.js';
/** Registry of available profiles by name. */
export declare const PROFILES: {
    readonly title: typeof resolveTitle;
    readonly description: typeof resolveDescription;
};
export type ProfileName = keyof typeof PROFILES;
