import type { RuntimeResult } from '../occupation-classifier/index.js';
import type { EscoApiClassification } from '../occupation-esco-api-classifier/index.js';
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
    mode?: 'v2' | 'v3';
};
export type CanonicalDecision = {
    decisionType: RuntimeResult['decision']['type'] | EscoApiClassification['decision']['type'];
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
    coverageStatus: RuntimeResult['coverage']['status'];
    selectedLeafTerm: CanonicalTerm | null;
    selectedFamilyTerm: CanonicalTerm | null;
    altLeafCanonicalTerms: CanonicalTerm[];
    altFamilyCanonicalTerms: CanonicalTerm[];
    capabilityTerms: CapabilityCanonicalTerm[];
};
export declare function getCanonicalTerm(options: GetCanonicalTermInput): Promise<GetCanonicalTermResult>;
