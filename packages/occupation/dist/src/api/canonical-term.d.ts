import { type OccupationSearchPipelineResult, type PipelineCoverageStatus } from '../search-pipeline/occupation-search-pipeline.js';
import type { RuntimeResult } from '../occupation-classifier/index.js';
export type CanonicalTerm = {
    graphNodeId: number;
    canonicalTerm: string;
    confidence: number;
    fitTier?: string;
    fitReasons?: string[];
};
export type CapabilityCanonicalTerm = {
    capabilityId: number;
    canonicalTerm: string;
    capabilityType: 'skill' | 'knowledge' | 'tool' | 'software' | 'language';
    confidence: number;
};
export type GetCanonicalTermInput = {
    input: string;
    locale?: string;
    limit?: number;
    jobFunction?: string;
    mode?: 'v1' | 'v2';
};
export type GetCanonicalTermOptions = GetCanonicalTermInput & {
    sourceName?: string;
    siblingLimit?: number;
};
export type CanonicalDecision = {
    decisionType: OccupationSearchPipelineResult['decision']['decisionType'];
    selectedCanonicalTerm: string | null;
    selectedGraphNodeId: number | null;
    confidence: number;
};
export type GetCanonicalTermResult = {
    input: string;
    locale: string;
    occupationContexts: CanonicalOccupationContext[];
};
export type CanonicalOccupationContext = {
    spanIndex: number;
    input: string;
    decision: CanonicalDecision;
    coverageStatus: PipelineCoverageStatus | RuntimeResult['coverage']['status'];
    selectedLeafTerm: CanonicalTerm | null;
    selectedFamilyTerm: CanonicalTerm | null;
    altLeafCanonicalTerms: CanonicalTerm[];
    altFamilyCanonicalTerms: CanonicalTerm[];
    capabilityTerms: CapabilityCanonicalTerm[];
};
export declare function getCanonicalTerm(options: GetCanonicalTermInput): Promise<GetCanonicalTermResult>;
