import type { EscoApiLocale, EscoLabelSource, EscoSearchHit, EscoTerm, LabelMatch, LabelRelation, PreparedSpan, SpanEvidence } from './types.js';
export declare const RELATION_RANK: Record<LabelRelation, number>;
export declare const LABEL_SOURCE_RANK: Record<EscoLabelSource, number>;
export declare function buildSpanEvidence(span: PreparedSpan, language: EscoApiLocale, hits: EscoSearchHit[], terms: EscoTerm[]): SpanEvidence;
export declare function familyUriFromCode(code: string): string | null;
export declare function compareLabelMatches(left: LabelMatch, right: LabelMatch): number;
