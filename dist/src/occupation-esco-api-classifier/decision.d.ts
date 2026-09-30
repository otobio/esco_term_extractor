import type { LabelMatch, SpanDecision, SpanEvidence } from './types.js';
export declare function selectSpanDecision(evidence: SpanEvidence): SpanDecision;
export declare function altLeafConfidence(match: LabelMatch | null): number;
