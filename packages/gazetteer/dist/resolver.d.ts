/**
 * Gazetteer resolver — turns clauses (+ an optional structured location field)
 * into canonical location terms. Pure string + admin-hierarchy logic, no
 * embeddings. See docs/GAZETTEER_PLAN.md §7 for the pipeline.
 *
 * Notes on non-obvious behavior:
 * - `countryCode` gates by COUNTRY (a place's `languageCode` field actually
 *   holds the country bucket — ro/ng/hu/ee), not by text language: a Nigerian
 *   listing is country `ng` even when its text is English.
 * - Fuzzy matching is enabled only for the structured location field (a
 *   deliberate, possibly typo'd place); it stays off for free text, where
 *   edit-distance-1 of common words is catastrophic (munca→Lunca, masina→Magina).
 * - `accept()` is the precision core for a bare single-token leaf mention: it is
 *   trusted only if it's a major/container place, a "primary seat" (a leaf named
 *   like its own coarser ancestor — Iași, Tartu), or corroborated by an ancestor
 *   container appearing elsewhere in the text.
 * - `disambiguate()` first checks per-locale depth-shape templates ({@link
 *   SpecificityTemplate} in patterns.ts): a duplicate-name ancestor/descendant
 *   collision resolves to the more specific place once its own coarser ancestor
 *   is separately named in the text. Otherwise it scores by major > corroborated
 *   > seat > coarser-depth, and abstains if the winner has no distinguishing
 *   signal (a guess among same-named villages is worse than a miss).
 * - `toTerm()` prefers the literal matched surface (e.g. "Bucuresti") as
 *   `displayName` over the entity's canonical name (e.g. "Bucharest"), falling
 *   back to canonical only for ancestors added purely by hierarchy expansion.
 * - `GazetteerConfig.stopNames` / `subdivisions` / `specificityTemplates` default
 *   to the merged per-locale views in patterns.ts, but are injectable so tests
 *   can supply synthetic data without coupling to real locale data.
 */
import type { GazetteerReader } from './gazetteer-index.js';
import type { SpecificityTemplate } from './patterns.js';
import type { Clause, ExtractedTerm, SupportedLanguage } from './types.js';
export interface GazetteerConfig {
    maxPerBucket: number;
    fuzzyMinLen: number;
    enableFuzzy: boolean;
    enableHierarchyExpansion: boolean;
    scores: {
        structured: number;
        exact: number;
        fuzzy: number;
        inferred: number;
    };
    stopNames: ReadonlySet<string>;
    subdivisions: readonly {
        re: RegExp;
        parentKey: string;
    }[];
    specificityTemplates: ReadonlyMap<SupportedLanguage, readonly SpecificityTemplate[]>;
}
export declare const GAZETTEER_CONFIG: GazetteerConfig;
export declare class GazetteerResolver {
    private readonly gaz;
    private readonly cfg;
    constructor(gaz: GazetteerReader, cfg?: GazetteerConfig);
    resolve(clauses: Clause[], structuredLocation?: string, countryCode?: string): ExtractedTerm[];
    displayTitleForKey(key: string): string | null;
    private scanSpans;
    private scanSubdivisions;
    private accept;
    private isPrimarySeat;
    private corroborated;
    private disambiguate;
    private add;
    private toTerm;
}
