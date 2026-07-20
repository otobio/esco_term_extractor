/**
 * Location patterns, organized per locale so every supported language contributes
 * its own data and adding a locale is a single self-contained block. The gazetteer
 * consumes the MERGED views (`MAJOR_CITIES`, `STOP_NAMES`, `SUBDIVISIONS`) because
 * a posting in one language may still name a place in another.
 *
 * The structural resolver logic (corroboration, admin-level, county-seat,
 * abstention, hierarchy) is language-agnostic; these lists only add per-locale
 * precision/recall and are the place to extend as coverage grows.
 */
import type { SupportedLanguage } from './types.js';
export interface LocalePatterns {
    language: SupportedLanguage;
    /** normalized city name -> the slug of the parent subdivision it sits under
     *  (matched against an ancestor's `location:<...>:<slug>`, e.g. its county/state). */
    majorCities: Record<string, string>;
    /** common words that collide with place names (single-token free-text is dropped). */
    stopNames: string[];
    /** city subdivisions ("Sector 2", "kerület") -> the parent place they resolve to. */
    subdivisions?: {
        re: RegExp;
        parentKey: string;
    }[];
    /** foreign / alternate-language names -> the canonical key they denote
     *  ("bucharest" -> location:depth2:bucuresti). Injected as extra exact surfaces so
     *  an exonym resolves to the same place as its native name. */
    exonyms?: Record<string, string>;
    /** Depth-shape rules this locale's listings commonly follow (see
     *  {@link SpecificityTemplate}); adding coverage for a new shape is a template
     *  reference here, not new resolver code. */
    specificityTemplates?: SpecificityTemplate[];
}
/**
 * Depth-shape rule for a duplicate-name collision between a place and its own
 * like-named ancestor (e.g. depth-2 "Bucharest" vs. depth-1 "București", both
 * matching the literal span "bucharest"). The generic disambiguation tie-break
 * prefers the coarser candidate — right for genuinely ambiguous same-named
 * places, wrong here since the mention is naming the specific place. When the
 * coarser candidate's own ancestor at `contextDepth` is *separately* resolved
 * elsewhere in the same text (already named explicitly, so it isn't standing
 * in for the specific place), the deeper candidate wins instead.
 *
 * Locales opt in by listing the named templates that match their common
 * listing conventions. Coverage for a new shape (a locale with a different
 * hierarchy depth, or a different common trailing qualifier) is a matter of
 * writing a new `pattern` string below, not a resolver code change.
 */
export interface SpecificityTemplate {
    name: string;
    /** Depth shape, e.g. "{DEPTH_2},{DEPTH_0}" — resolve to the first depth once
     *  the second depth is separately present elsewhere in the same text. */
    pattern: string;
    descendantDepth: number;
    contextDepth: number;
}
/** "{city}, {country}" — the near-universal job-listing convention. */
export declare const TEMPLATE_CITY_COUNTRY: SpecificityTemplate;
export declare const LOCALE_PATTERNS: readonly LocalePatterns[];
export declare const MAJOR_CITIES: ReadonlyMap<string, string>;
export declare const STOP_NAMES: ReadonlySet<string>;
export declare const SUBDIVISIONS: readonly {
    re: RegExp;
    parentKey: string;
}[];
/** normalized exonym -> canonical key (merged across locales). */
export declare const EXONYMS: ReadonlyMap<string, string>;
/** language -> its opted-in specificity templates (per-locale, not merged flat —
 *  depth semantics differ by country, so a template must only apply to its own). */
export declare const SPECIFICITY_TEMPLATES: ReadonlyMap<SupportedLanguage, readonly SpecificityTemplate[]>;
