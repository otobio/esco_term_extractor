import { type Connection } from 'mysql2/promise';
export declare const DEFAULT_ESCO_SOURCE_NAME = "esco_1_2_1";
export type AuditOutputFormat = 'text' | 'json';
export type EscoSourceAuditOptions = {
    sourceName?: string;
    locales?: string[];
    sampleLimit?: number;
    collectionLimit?: number;
};
export type OccupationSummaryRow = {
    localeCode: string;
    occupationCount: number;
    aliasCount: number;
    averageAliasesPerOccupation: number;
    occupationsMissingAliases: number;
};
export type AliasBucketRow = {
    localeCode: string;
    aliasBucket: string;
    occupationCount: number;
};
export type OccupationSampleRow = {
    localeCode: string;
    preferredLabel: string;
    externalUri: string;
};
export type AliasDensitySampleRow = OccupationSampleRow & {
    aliasCount: number;
};
export type BroaderCoverageRow = {
    localeCode: string;
    occupationCount: number;
    occupationsWithBroaderField: number;
    occupationsWithBroaderRelation: number;
    occupationsWithUsableBroaderRelation: number;
    occupationsMissingBroaderField: number;
    occupationsMissingBroaderRelation: number;
    broaderFieldMatchesRelation: number;
    broaderFieldConflictsRelation: number;
    broaderFieldWithoutRelation: number;
    broaderRelationWithoutField: number;
    broaderRelationMissingParentConcept: number;
};
export type BroaderSampleRow = {
    localeCode: string;
    childLabel: string;
    parentLabel: string;
    childExternalUri: string;
    parentExternalUri: string;
};
export type MembershipDistributionRow = {
    localeCode: string;
    entityKind: string;
    collectionName: string;
    membershipType: string;
    memberCount: number;
};
export type EscoSourceAuditReport = {
    generatedAt: string;
    sourceName: string;
    locales: string[];
    sampleLimit: number;
    collectionLimit: number;
    findings: string[];
    occupationSummary: OccupationSummaryRow[];
    aliasBuckets: AliasBucketRow[];
    missingAliasSamples: OccupationSampleRow[];
    topAliasSamples: AliasDensitySampleRow[];
    broaderCoverage: BroaderCoverageRow[];
    broaderSamples: BroaderSampleRow[];
    missingBroaderSamples: OccupationSampleRow[];
    membershipDistribution: MembershipDistributionRow[];
};
export declare class EscoSourceAuditor {
    private readonly connection;
    constructor(connection: Connection);
    run(options?: EscoSourceAuditOptions): Promise<EscoSourceAuditReport>;
    private runSection;
    private resolveLocales;
    private loadOccupationSummary;
    private loadAliasBuckets;
    private loadMissingAliasSamples;
    private loadTopAliasSamples;
    private loadBroaderCoverage;
    private loadBroaderSamples;
    private loadMissingBroaderSamples;
    private loadMembershipDistribution;
}
export declare function formatAuditReport(report: EscoSourceAuditReport, format: AuditOutputFormat): string;
