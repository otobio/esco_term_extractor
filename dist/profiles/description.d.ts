/**
 * Description resolve profile — section-aware, locale-first extraction for noisy
 * job-body text.
 *
 * The description body is not a generic clause firehose. It is parsed into coarse
 * sections (requirements / responsibilities / benefits / company / application /
 * unknown) with locale-first header detection for ro/hu/et and English fallback.
 * Bucket extraction is then routed by section:
 *
 *   - capabilities   → requirements/unknown only, lexical span led
 *   - qualifications → requirements/unknown only, with qualification cues
 *   - benefits       → benefits/unknown only, with offer/perk cues
 *   - compensation   → benefits/unknown only, with pay cues
 *   - workplace / employment / schedule → explicit clauses only, never from
 *     responsibilities/company/application sections
 *   - location       → gazetteer-owned over the full body
 *
 * Identity-like and highly ambiguous buckets (occupation, level, sector,
 * job_function, company_size, collar_kind) are intentionally excluded from the
 * description profile by default. Precision is the point.
 */
import type { GazetteerResolver } from '@term-extractor/gazetteer';
import type { LexicalIndex } from '../lexical-index.js';
import { type ResolvedTerm } from '../matchers/finite.js';
import type { OpenSearchClient } from '../matchers/types.js';
import type { BucketName } from '../types.js';
export type DescriptionSectionKind = 'requirements' | 'responsibilities' | 'benefits' | 'company' | 'application' | 'unknown';
export interface DescriptionSection {
    kind: DescriptionSectionKind;
    header?: string;
    text: string;
    clauses: string[];
    confidence?: number;
    reasons?: string[];
}
export interface DescriptionDeps {
    client: OpenSearchClient;
    lexical: LexicalIndex;
    gazetteer?: GazetteerResolver;
    locale?: string;
    countryCode?: string;
    buckets?: BucketName[];
}
export interface DescriptionProfileResult {
    sections: DescriptionSection[];
    byBucket: Record<string, ResolvedTerm[]>;
    /** Section kinds whose clauses contributed to each bucket's resolved terms. */
    sectionsByBucket: Record<string, DescriptionSectionKind[]>;
}
export declare function parseDescriptionSections(text: string, locale?: string): DescriptionSection[];
export declare function resolveDescription(rawText: string, deps: DescriptionDeps): Promise<DescriptionProfileResult>;
