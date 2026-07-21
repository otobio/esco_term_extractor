import type { Connection } from 'mysql2/promise';
export declare const ONET_ALIAS_SOURCE_TAG = "onet_esco_bridge";
export declare const DEFAULT_ONET_DOWNLOAD_DIR = "/private/tmp/ose-onet-esco";
export declare const ONET_CROSSWALK_URL = "https://www.onetcenter.org/crosswalks/esco/ESCO_to_ONET-SOC.xlsx";
export declare const ONET_JOB_TITLES_URL = "https://www.onetcenter.org/dl_files/database/db_30_3_excel/Job%20Titles.xlsx";
export declare const ONET_REPORTED_TITLES_URL = "https://www.onetcenter.org/dl_files/database/db_30_3_excel/Sample%20of%20Reported%20Titles.xlsx";
export declare const DEFAULT_ONET_REPORT_DIR = "artifacts/enrichment/onet";
type CandidateMode = 'generate' | 'review' | 'exclude';
type SourceFileRole = 'job_title' | 'job_title_short' | 'reported_title';
export type ImportOnetEscoAliasCandidatesOptions = {
    sourceName?: string;
    downloadDir?: string;
    reportDir?: string;
    sampleLimit?: number;
    writeArtifact?: boolean;
};
export type OnetAliasCandidate = {
    candidateMode: CandidateMode;
    reviewReason: string | null;
    alias: string;
    normalizedAlias: string;
    localeCode: 'en';
    graphNodeId: number | null;
    canonicalLabel: string | null;
    confidence: number;
    sourceTag: typeof ONET_ALIAS_SOURCE_TAG;
    onetCode: string;
    onetTitle: string | null;
    escoCode: string | null;
    escoTitle: string | null;
    sourceFileRole: SourceFileRole;
    crosswalkTargetCount: number;
    targetOverlapScore: number;
    conflictTargets: Array<{
        graphNodeId: number;
        canonicalLabel: string;
        source: string;
    }>;
};
export type ImportOnetEscoAliasCandidatesResult = {
    sourceTag: typeof ONET_ALIAS_SOURCE_TAG;
    sourceName: string;
    downloadDir: string;
    reportPath: string;
    summary: {
        crosswalkRows: number;
        jobTitleRows: number;
        reportedTitleRows: number;
        rawAliases: number;
        uniqueAliases: number;
        generate: number;
        review: number;
        exclude: number;
        unmatchedCrosswalkTargets: number;
    };
    samples: Record<CandidateMode, OnetAliasCandidate[]>;
};
export declare function importOnetEscoAliasCandidates(connection: Connection, options?: ImportOnetEscoAliasCandidatesOptions): Promise<ImportOnetEscoAliasCandidatesResult>;
export {};
