import { type Connection } from 'mysql2/promise';
export declare const DEFAULT_ESCO_SOURCE_NAME = "esco_1_2_1";
export type AuditOutputFormat = 'text' | 'json';
export type OccupationSearchMetaAuditOptions = {
    sourceName?: string;
    locales?: string[];
    sampleLimit?: number;
    weakEnglishBackboneThreshold?: number;
    insertReviewQueue?: boolean;
};
export type SearchMetaOverviewRow = {
    totalMetaRows: number;
    withHierarchy: number;
    withoutHierarchy: number;
    withCapabilitySupport: number;
    withoutCapabilitySupport: number;
    averageExactAliases: number;
    averageActiveAliases: number;
    averageLocaleCoverage: number;
};
export type GenericRiskRow = {
    genericRisk: string;
    occupationCount: number;
};
export type LocaleCoverageRow = {
    localeCode: string;
    occupationsWithLocaleAliases: number;
    occupationsMissingLocaleAliases: number;
    averageAliasesPerCoveredOccupation: number;
};
export type AliasSparsityRow = {
    aliasBucket: string;
    occupationCount: number;
};
export type TextQualityRow = {
    emptySearchText: number;
    emptyDenseText: number;
    shortSearchText: number;
    shortDenseText: number;
    uuidLikeSearchText: number;
    uuidLikeDenseText: number;
};
export type EnglishBackboneRow = {
    missingEnglishBackbone: number;
    weakEnglishBackbone: number;
    strongEnglishBackbone: number;
    averageEnglishBackboneStrength: number;
};
export type QualityFlagRow = {
    qualityFlag: string;
    occupationCount: number;
};
export type SearchMetaSampleRow = {
    graphNodeId: number;
    canonicalLabel: string;
    genericRisk: string;
    exactAliasCount: number;
    activeAliasCount: number;
    localeCoverageCount: number;
    englishBackboneStrength: number | null;
    qualityFlags: string;
};
export type ReviewQueueInsertResult = {
    hierarchyGapRowsInserted: number;
    crossLocaleGapRowsInserted: number;
    genericHeadRowsInserted: number;
};
export type OccupationSearchMetaAuditReport = {
    generatedAt: string;
    sourceName: string;
    locales: string[];
    sampleLimit: number;
    weakEnglishBackboneThreshold: number;
    reviewQueueInserted: boolean;
    findings: string[];
    overview: SearchMetaOverviewRow;
    genericRiskDistribution: GenericRiskRow[];
    localeCoverage: LocaleCoverageRow[];
    aliasSparsity: AliasSparsityRow[];
    textQuality: TextQualityRow;
    englishBackbone: EnglishBackboneRow;
    qualityFlags: QualityFlagRow[];
    missingHierarchySamples: SearchMetaSampleRow[];
    missingLocaleSamples: SearchMetaSampleRow[];
    highGenericRiskSamples: SearchMetaSampleRow[];
    weakEnglishBackboneSamples: SearchMetaSampleRow[];
    textQualitySamples: SearchMetaSampleRow[];
    reviewQueueInsertResult: ReviewQueueInsertResult | null;
};
export declare class OccupationSearchMetaAuditor {
    private readonly connection;
    constructor(connection: Connection);
    run(options?: OccupationSearchMetaAuditOptions): Promise<OccupationSearchMetaAuditReport>;
    private runSection;
    private resolveLocales;
    private loadOverview;
    private loadGenericRiskDistribution;
    private loadLocaleCoverage;
    private loadAliasSparsity;
    private loadTextQuality;
    private loadEnglishBackbone;
    private loadQualityFlags;
    private loadMissingHierarchySamples;
    private loadMissingLocaleSamples;
    private loadHighGenericRiskSamples;
    private loadWeakEnglishBackboneSamples;
    private loadTextQualitySamples;
    private loadSamples;
    private insertReviewQueueRows;
    private insertHierarchyGapRows;
    private insertCrossLocaleGapRows;
    private insertGenericHeadRows;
}
export declare function formatAuditReport(report: OccupationSearchMetaAuditReport, format: AuditOutputFormat): string;
