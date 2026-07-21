import type { Connection } from 'mysql2/promise';
import { type RetrievalProfile } from '../retrieval/occupation-candidates.js';
import { type PipelineDecision } from './occupation-search-pipeline.js';
import type { OccupationRetrievalEngine } from '../retrieval/retrieval-engine.js';
export type GoldenQueryFormat = 'exact_title' | 'modifier_removed' | 'generic_tail' | 'short_form' | 'synonym_alias' | 'descriptive' | 'plural_variant' | 'broad_family' | 'specialization_guard' | 'multi_word_exact' | 'noisy_recruiter' | 'manager_title' | 'obscure_title' | 'localized_target' | 'ambiguous_title' | 'multi_occupation_context';
export type GoldenSuiteKind = 'stable' | 'developing';
export type GoldenSuiteSelection = GoldenSuiteKind | 'all';
export type GoldenCoverageKind = 'white_collar' | 'blue_collar' | 'pink_collar' | 'care_collar' | 'education' | 'service' | 'creative' | 'health' | 'transport' | 'technology' | 'management';
export type GoldenExpectation = {
    decisionType: PipelineDecision['decisionType'];
    selectedLabel?: string;
    topFamilyLabel?: string;
    minimumConfidence?: number;
    spanCount?: number;
    spanExpectations?: GoldenSpanExpectation[];
};
export type GoldenSpanExpectation = {
    query: string;
    decisionType?: PipelineDecision['decisionType'];
    selectedLabel?: string;
    topFamilyLabel?: string;
    minimumConfidence?: number;
};
export type GoldenCase = {
    caseKey: string;
    suite?: GoldenSuiteKind;
    format: GoldenQueryFormat;
    coverageKind: GoldenCoverageKind;
    query: string;
    locale: string;
    description: string;
    expectation: GoldenExpectation;
};
export type PipelineGoldenSuiteOptions = {
    sourceName?: string;
    modelKey?: string;
    suite?: GoldenSuiteSelection;
    limit?: number;
    siblingLimit?: number;
    caseKeys?: string[];
    retrievalEngine?: OccupationRetrievalEngine;
};
export type GoldenCaseResult = {
    case: GoldenCase;
    passed: boolean;
    failures: string[];
    actual: {
        decisionType: PipelineDecision['decisionType'];
        selectedLabel: string | null;
        confidence: number;
        topFamilyLabel: string | null;
        spans: GoldenCaseSpanActual[];
    };
};
export type GoldenCaseSpanActual = {
    query: string;
    decisionType: PipelineDecision['decisionType'];
    selectedLabel: string | null;
    confidence: number;
    topFamilyLabel: string | null;
};
export type PipelineGoldenSuiteResult = {
    sourceName: string;
    modelKey: string;
    retrievalProfile: RetrievalProfile;
    suite: GoldenSuiteSelection;
    total: number;
    passed: number;
    failed: number;
    blockingFailed: number;
    results: GoldenCaseResult[];
};
export declare const PIPELINE_GOLDEN_CASES: GoldenCase[];
export declare const PIPELINE_DEVELOPING_GOLDEN_CASES: GoldenCase[];
export declare const ALL_PIPELINE_GOLDEN_CASES: GoldenCase[];
export declare class PipelineGoldenSuiteRunner {
    private readonly connection;
    constructor(connection: Connection);
    run(options?: PipelineGoldenSuiteOptions): Promise<PipelineGoldenSuiteResult>;
}
export declare function formatPipelineGoldenSuiteResult(result: PipelineGoldenSuiteResult, format: 'text' | 'json'): string;
