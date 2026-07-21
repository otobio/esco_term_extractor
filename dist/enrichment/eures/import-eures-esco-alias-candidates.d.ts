import type { Connection } from 'mysql2/promise';
import { type SupportedQueryLocale } from '../../query/query-preparation.js';
export declare const DEFAULT_EURES_DOWNLOAD_DIR = "/private/tmp/ose-eures-esco";
export declare const DEFAULT_EURES_REPORT_DIR = "artifacts/enrichment/eures";
type SupportedEuresCountry = 'ee' | 'hu' | 'ro';
type CandidateMode = 'generate' | 'review' | 'exclude';
type EuresCountryConfig = {
    locale: Extract<SupportedQueryLocale, 'et' | 'hu' | 'ro'>;
    sourceTag: string;
    downloadUrl: string;
    filename: string;
};
export declare const EURES_COUNTRY_CONFIG: Record<SupportedEuresCountry, EuresCountryConfig>;
export type ImportEuresEscoAliasCandidatesOptions = {
    sourceName?: string;
    countries?: SupportedEuresCountry[];
    downloadDir?: string;
    reportDir?: string;
    sampleLimit?: number;
    writeArtifact?: boolean;
};
export type EuresAliasCandidate = {
    candidateMode: CandidateMode;
    reviewReason: string | null;
    alias: string;
    normalizedAlias: string;
    localeCode: 'et' | 'hu' | 'ro';
    graphNodeId: number | null;
    canonicalLabel: string | null;
    confidence: number;
    sourceTag: string;
    sourceRecordType: 'eures_mapping_label';
    mappingRelation: string;
    escoUri: string;
    escoPrefLabel: string | null;
    nationalUri: string;
    nationalPrefLabel: string;
    conflictTargets: Array<{
        graphNodeId: number;
        canonicalLabel: string;
        source: string;
    }>;
};
export type ImportEuresEscoAliasCandidatesResult = {
    sourceName: string;
    downloadDir: string;
    reportPath: string;
    countries: SupportedEuresCountry[];
    summary: {
        mappingRows: number;
        uniqueAliases: number;
        generate: number;
        review: number;
        exclude: number;
    };
    bySourceTag: Record<string, {
        locale: string;
        mappingRows: number;
        generate: number;
        review: number;
        exclude: number;
    }>;
    samples: Record<CandidateMode, EuresAliasCandidate[]>;
};
export declare function importEuresEscoAliasCandidates(connection: Connection, options?: ImportEuresEscoAliasCandidatesOptions): Promise<ImportEuresEscoAliasCandidatesResult>;
export {};
