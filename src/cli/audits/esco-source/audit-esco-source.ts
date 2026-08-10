import type { Connection, RowDataPacket } from 'mysql2/promise';

export const DEFAULT_ESCO_SOURCE_NAME = 'esco_1_2_1';
const DEFAULT_SAMPLE_LIMIT = 8;
const DEFAULT_COLLECTION_LIMIT = 12;

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

type LocaleRow = RowDataPacket & {
  locale_code: string;
};

type OccupationSummaryQueryRow = RowDataPacket & {
  localeCode: string;
  occupationCount: number;
  aliasCount: number;
  averageAliasesPerOccupation: number;
  occupationsMissingAliases: number;
};

type AliasBucketQueryRow = RowDataPacket & {
  localeCode: string;
  aliasBucket: string;
  occupationCount: number;
};

type OccupationSampleQueryRow = RowDataPacket & {
  localeCode: string;
  preferredLabel: string;
  externalUri: string;
};

type AliasDensitySampleQueryRow = RowDataPacket & {
  localeCode: string;
  preferredLabel: string;
  externalUri: string;
  aliasCount: number;
};

type BroaderCoverageQueryRow = RowDataPacket & {
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

type BroaderSampleQueryRow = RowDataPacket & {
  localeCode: string;
  childLabel: string;
  parentLabel: string;
  childExternalUri: string;
  parentExternalUri: string;
};

type MembershipDistributionQueryRow = RowDataPacket & {
  localeCode: string;
  entityKind: string;
  collectionName: string;
  membershipType: string;
  memberCount: number;
};

export class EscoSourceAuditor {
  public constructor(private readonly connection: Connection) {}

  public async run(options: EscoSourceAuditOptions = {}): Promise<EscoSourceAuditReport> {
    const sourceName = normalizeSourceName(options.sourceName);
    const locales = await this.resolveLocales(sourceName, options.locales);
    const sampleLimit = normalizePositiveInteger(options.sampleLimit, DEFAULT_SAMPLE_LIMIT);
    const collectionLimit = normalizePositiveInteger(options.collectionLimit, DEFAULT_COLLECTION_LIMIT);

    const occupationSummary = await this.runSection('occupationSummary', () => this.loadOccupationSummary(sourceName, locales));
    const aliasBuckets = await this.runSection('aliasBuckets', () => this.loadAliasBuckets(sourceName, locales));
    const missingAliasSamples = await this.runSection('missingAliasSamples', () =>
      this.loadMissingAliasSamples(sourceName, locales, sampleLimit)
    );
    const topAliasSamples = await this.runSection('topAliasSamples', () => this.loadTopAliasSamples(sourceName, locales, sampleLimit));
    const broaderCoverage = await this.runSection('broaderCoverage', () => this.loadBroaderCoverage(sourceName, locales));
    const broaderSamples = await this.runSection('broaderSamples', () => this.loadBroaderSamples(sourceName, locales, sampleLimit));
    const missingBroaderSamples = await this.runSection('missingBroaderSamples', () =>
      this.loadMissingBroaderSamples(sourceName, locales, sampleLimit)
    );
    const membershipDistribution = await this.runSection('membershipDistribution', () =>
      this.loadMembershipDistribution(sourceName, locales, collectionLimit)
    );

    return {
      generatedAt: new Date().toISOString(),
      sourceName,
      locales,
      sampleLimit,
      collectionLimit,
      findings: buildFindings(occupationSummary, broaderCoverage),
      occupationSummary,
      aliasBuckets,
      missingAliasSamples,
      topAliasSamples,
      broaderCoverage,
      broaderSamples,
      missingBroaderSamples,
      membershipDistribution
    };
  }

  private async runSection<T>(sectionName: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Audit section "${sectionName}" failed: ${message}`);
    }
  }

  private async resolveLocales(sourceName: string, locales: string[] | undefined): Promise<string[]> {
    const requestedLocales = normalizeLocales(locales);

    if (requestedLocales.length > 0) {
      return requestedLocales;
    }

    const [rows] = await this.connection.query<LocaleRow[]>(
      `
        SELECT DISTINCT locale_code
        FROM ose_source_concepts
        WHERE source_name = ?
        ORDER BY locale_code
      `,
      [sourceName]
    );

    const resolvedLocales = rows.map((row) => row.locale_code);

    if (resolvedLocales.length === 0) {
      throw new Error(`No ose_source_concepts rows found for source_name="${sourceName}".`);
    }

    return resolvedLocales;
  }

  private async loadOccupationSummary(sourceName: string, locales: string[]): Promise<OccupationSummaryRow[]> {
    const outerLocaleFilter = buildLocaleFilter('c.locale_code', locales);
    const innerLocaleFilter = buildLocaleFilter('concept.locale_code', locales);
    const [rows] = await this.connection.query<OccupationSummaryQueryRow[]>(
      `
        SELECT
          stats.localeCode,
          stats.occupationCount,
          stats.aliasCount,
          stats.averageAliasesPerOccupation,
          stats.occupationsMissingAliases
        FROM (
          SELECT
            c.locale_code AS localeCode,
            COUNT(*) AS occupationCount,
            SUM(alias_stats.aliasCount) AS aliasCount,
            ROUND(AVG(alias_stats.aliasCount), 2) AS averageAliasesPerOccupation,
            SUM(CASE WHEN alias_stats.aliasCount = 0 THEN 1 ELSE 0 END) AS occupationsMissingAliases
          FROM ose_source_concepts c
          INNER JOIN (
            SELECT
              concept.id AS conceptId,
              COUNT(alias.id) AS aliasCount
            FROM ose_source_concepts concept
            LEFT JOIN ose_source_aliases alias
              ON alias.source_concept_id = concept.id
              AND alias.locale_code = concept.locale_code
            WHERE concept.source_name = ?
              AND concept.entity_kind = 'occupation'
              ${innerLocaleFilter.sql}
            GROUP BY concept.id
          ) AS alias_stats
            ON alias_stats.conceptId = c.id
          WHERE c.source_name = ?
            AND c.entity_kind = 'occupation'
            ${outerLocaleFilter.sql}
          GROUP BY c.locale_code
        ) AS stats
        ORDER BY stats.localeCode
      `,
      [sourceName, ...innerLocaleFilter.params, sourceName, ...outerLocaleFilter.params]
    );

    return rows.map((row) => ({
      localeCode: row.localeCode,
      occupationCount: toNumber(row.occupationCount),
      aliasCount: toNumber(row.aliasCount),
      averageAliasesPerOccupation: toNumber(row.averageAliasesPerOccupation),
      occupationsMissingAliases: toNumber(row.occupationsMissingAliases)
    }));
  }

  private async loadAliasBuckets(sourceName: string, locales: string[]): Promise<AliasBucketRow[]> {
    const localeFilter = buildLocaleFilter('c.locale_code', locales);
    const [rows] = await this.connection.query<AliasBucketQueryRow[]>(
      `
        SELECT
          bucketed.localeCode,
          bucketed.aliasBucket,
          COUNT(*) AS occupationCount
        FROM (
          SELECT
            c.locale_code AS localeCode,
            CASE
              WHEN COUNT(a.id) = 0 THEN '0'
              WHEN COUNT(a.id) = 1 THEN '1'
              WHEN COUNT(a.id) BETWEEN 2 AND 4 THEN '2-4'
              WHEN COUNT(a.id) BETWEEN 5 AND 9 THEN '5-9'
              ELSE '10+'
            END AS aliasBucket
          FROM ose_source_concepts c
          LEFT JOIN ose_source_aliases a
            ON a.source_concept_id = c.id
            AND a.locale_code = c.locale_code
          WHERE c.source_name = ?
            AND c.entity_kind = 'occupation'
            ${localeFilter.sql}
          GROUP BY c.id, c.locale_code
        ) AS bucketed
        GROUP BY bucketed.localeCode, bucketed.aliasBucket
        ORDER BY
          bucketed.localeCode,
          FIELD(bucketed.aliasBucket, '0', '1', '2-4', '5-9', '10+')
      `,
      [sourceName, ...localeFilter.params]
    );

    return rows.map((row) => ({
      localeCode: row.localeCode,
      aliasBucket: row.aliasBucket,
      occupationCount: toNumber(row.occupationCount)
    }));
  }

  private async loadMissingAliasSamples(sourceName: string, locales: string[], sampleLimit: number): Promise<OccupationSampleRow[]> {
    const localeFilter = buildLocaleFilter('c.locale_code', locales);
    const [rows] = await this.connection.query<OccupationSampleQueryRow[]>(
      `
        SELECT
          c.locale_code AS localeCode,
          c.preferred_label AS preferredLabel,
          c.external_uri AS externalUri
        FROM ose_source_concepts c
        LEFT JOIN ose_source_aliases a
          ON a.source_concept_id = c.id
          AND a.locale_code = c.locale_code
        WHERE c.source_name = ?
          AND c.entity_kind = 'occupation'
          ${localeFilter.sql}
        GROUP BY c.id, c.locale_code, c.preferred_label, c.external_uri
        HAVING COUNT(a.id) = 0
        ORDER BY c.locale_code, c.preferred_label, c.external_uri
        LIMIT ?
      `,
      [sourceName, ...localeFilter.params, sampleLimit]
    );

    return rows.map((row) => ({
      localeCode: row.localeCode,
      preferredLabel: row.preferredLabel,
      externalUri: row.externalUri
    }));
  }

  private async loadTopAliasSamples(sourceName: string, locales: string[], sampleLimit: number): Promise<AliasDensitySampleRow[]> {
    const localeFilter = buildLocaleFilter('c.locale_code', locales);
    const [rows] = await this.connection.query<AliasDensitySampleQueryRow[]>(
      `
        SELECT
          alias_stats.localeCode,
          alias_stats.preferredLabel,
          alias_stats.externalUri,
          alias_stats.aliasCount
        FROM (
          SELECT
            c.locale_code AS localeCode,
            c.preferred_label AS preferredLabel,
            c.external_uri AS externalUri,
            COUNT(a.id) AS aliasCount
          FROM ose_source_concepts c
          LEFT JOIN ose_source_aliases a
            ON a.source_concept_id = c.id
            AND a.locale_code = c.locale_code
          WHERE c.source_name = ?
            AND c.entity_kind = 'occupation'
            ${localeFilter.sql}
          GROUP BY c.id, c.locale_code, c.preferred_label, c.external_uri
        ) AS alias_stats
        ORDER BY alias_stats.aliasCount DESC, alias_stats.localeCode, alias_stats.preferredLabel
        LIMIT ?
      `,
      [sourceName, ...localeFilter.params, sampleLimit]
    );

    return rows.map((row) => ({
      localeCode: row.localeCode,
      preferredLabel: row.preferredLabel,
      externalUri: row.externalUri,
      aliasCount: toNumber(row.aliasCount)
    }));
  }

  private async loadBroaderCoverage(sourceName: string, locales: string[]): Promise<BroaderCoverageRow[]> {
    const localeFilter = buildLocaleFilter('c.locale_code', locales);
    const [rows] = await this.connection.query<BroaderCoverageQueryRow[]>(
      `
        SELECT
          coverage.localeCode,
          COUNT(*) AS occupationCount,
          SUM(CASE WHEN coverage.broaderFieldUri IS NOT NULL THEN 1 ELSE 0 END) AS occupationsWithBroaderField,
          SUM(CASE WHEN coverage.relationParentUri IS NOT NULL THEN 1 ELSE 0 END) AS occupationsWithBroaderRelation,
          SUM(CASE WHEN coverage.relationParentUri IS NOT NULL AND coverage.parentConceptPresent = 1 THEN 1 ELSE 0 END)
            AS occupationsWithUsableBroaderRelation,
          SUM(CASE WHEN coverage.broaderFieldUri IS NULL THEN 1 ELSE 0 END) AS occupationsMissingBroaderField,
          SUM(CASE WHEN coverage.relationParentUri IS NULL THEN 1 ELSE 0 END) AS occupationsMissingBroaderRelation,
          SUM(
            CASE
              WHEN coverage.broaderFieldUri IS NOT NULL
                AND coverage.relationParentUri IS NOT NULL
                AND coverage.broaderFieldUri = coverage.relationParentUri
              THEN 1
              ELSE 0
            END
          ) AS broaderFieldMatchesRelation,
          SUM(
            CASE
              WHEN coverage.broaderFieldUri IS NOT NULL
                AND coverage.relationParentUri IS NOT NULL
                AND coverage.broaderFieldUri <> coverage.relationParentUri
              THEN 1
              ELSE 0
            END
          ) AS broaderFieldConflictsRelation,
          SUM(
            CASE
              WHEN coverage.broaderFieldUri IS NOT NULL
                AND coverage.relationParentUri IS NULL
              THEN 1
              ELSE 0
            END
          ) AS broaderFieldWithoutRelation,
          SUM(
            CASE
              WHEN coverage.broaderFieldUri IS NULL
                AND coverage.relationParentUri IS NOT NULL
              THEN 1
              ELSE 0
            END
          ) AS broaderRelationWithoutField,
          SUM(
            CASE
              WHEN coverage.relationParentUri IS NOT NULL
                AND coverage.parentConceptPresent = 0
              THEN 1
              ELSE 0
            END
          ) AS broaderRelationMissingParentConcept
        FROM (
          SELECT
            c.id,
            c.locale_code AS localeCode,
            c.broader_external_uri AS broaderFieldUri,
            MAX(r.parent_external_uri) AS relationParentUri,
            MAX(CASE WHEN p.id IS NULL THEN 0 ELSE 1 END) AS parentConceptPresent
          FROM ose_source_concepts c
          LEFT JOIN ose_source_relations r
            ON r.source_name = c.source_name
            AND r.locale_code = c.locale_code
            AND r.relation_kind = 'broader_occupation'
            AND r.child_external_uri = c.external_uri
          LEFT JOIN ose_source_concepts p
            ON p.source_name = c.source_name
            AND p.locale_code = c.locale_code
            AND p.external_uri = r.parent_external_uri
          WHERE c.source_name = ?
            AND c.entity_kind = 'occupation'
            ${localeFilter.sql}
          GROUP BY c.id, c.locale_code, c.broader_external_uri
        ) AS coverage
        GROUP BY coverage.localeCode
        ORDER BY coverage.localeCode
      `,
      [sourceName, ...localeFilter.params]
    );

    return rows.map((row) => ({
      localeCode: row.localeCode,
      occupationCount: toNumber(row.occupationCount),
      occupationsWithBroaderField: toNumber(row.occupationsWithBroaderField),
      occupationsWithBroaderRelation: toNumber(row.occupationsWithBroaderRelation),
      occupationsWithUsableBroaderRelation: toNumber(row.occupationsWithUsableBroaderRelation),
      occupationsMissingBroaderField: toNumber(row.occupationsMissingBroaderField),
      occupationsMissingBroaderRelation: toNumber(row.occupationsMissingBroaderRelation),
      broaderFieldMatchesRelation: toNumber(row.broaderFieldMatchesRelation),
      broaderFieldConflictsRelation: toNumber(row.broaderFieldConflictsRelation),
      broaderFieldWithoutRelation: toNumber(row.broaderFieldWithoutRelation),
      broaderRelationWithoutField: toNumber(row.broaderRelationWithoutField),
      broaderRelationMissingParentConcept: toNumber(row.broaderRelationMissingParentConcept)
    }));
  }

  private async loadBroaderSamples(sourceName: string, locales: string[], sampleLimit: number): Promise<BroaderSampleRow[]> {
    const localeFilter = buildLocaleFilter('r.locale_code', locales);
    const [rows] = await this.connection.query<BroaderSampleQueryRow[]>(
      `
        SELECT
          r.locale_code AS localeCode,
          child.preferred_label AS childLabel,
          parent.preferred_label AS parentLabel,
          r.child_external_uri AS childExternalUri,
          r.parent_external_uri AS parentExternalUri
        FROM ose_source_relations r
        INNER JOIN ose_source_concepts child
          ON child.source_name = r.source_name
          AND child.locale_code = r.locale_code
          AND child.external_uri = r.child_external_uri
        INNER JOIN ose_source_concepts parent
          ON parent.source_name = r.source_name
          AND parent.locale_code = r.locale_code
          AND parent.external_uri = r.parent_external_uri
        WHERE r.source_name = ?
          AND r.relation_kind = 'broader_occupation'
          AND child.entity_kind = 'occupation'
          ${localeFilter.sql}
        ORDER BY r.locale_code, child.preferred_label, parent.preferred_label
        LIMIT ?
      `,
      [sourceName, ...localeFilter.params, sampleLimit]
    );

    return rows.map((row) => ({
      localeCode: row.localeCode,
      childLabel: row.childLabel,
      parentLabel: row.parentLabel,
      childExternalUri: row.childExternalUri,
      parentExternalUri: row.parentExternalUri
    }));
  }

  private async loadMissingBroaderSamples(sourceName: string, locales: string[], sampleLimit: number): Promise<OccupationSampleRow[]> {
    const localeFilter = buildLocaleFilter('c.locale_code', locales);
    const [rows] = await this.connection.query<OccupationSampleQueryRow[]>(
      `
        SELECT
          c.locale_code AS localeCode,
          c.preferred_label AS preferredLabel,
          c.external_uri AS externalUri
        FROM ose_source_concepts c
        LEFT JOIN ose_source_relations r
          ON r.source_name = c.source_name
          AND r.locale_code = c.locale_code
          AND r.relation_kind = 'broader_occupation'
          AND r.child_external_uri = c.external_uri
        WHERE c.source_name = ?
          AND c.entity_kind = 'occupation'
          ${localeFilter.sql}
          AND r.id IS NULL
        ORDER BY c.locale_code, c.preferred_label, c.external_uri
        LIMIT ?
      `,
      [sourceName, ...localeFilter.params, sampleLimit]
    );

    return rows.map((row) => ({
      localeCode: row.localeCode,
      preferredLabel: row.preferredLabel,
      externalUri: row.externalUri
    }));
  }

  private async loadMembershipDistribution(
    sourceName: string,
    locales: string[],
    collectionLimit: number
  ): Promise<MembershipDistributionRow[]> {
    const localeFilter = buildLocaleFilter('c.locale_code', locales);
    const [rows] = await this.connection.query<MembershipDistributionQueryRow[]>(
      `
        SELECT
          c.locale_code AS localeCode,
          c.entity_kind AS entityKind,
          m.collection_name AS collectionName,
          m.membership_type AS membershipType,
          COUNT(*) AS memberCount
        FROM ose_source_memberships m
        INNER JOIN ose_source_concepts c
          ON c.id = m.source_concept_id
        WHERE c.source_name = ?
          ${localeFilter.sql}
        GROUP BY c.locale_code, c.entity_kind, m.collection_name, m.membership_type
        ORDER BY memberCount DESC, c.locale_code, c.entity_kind, m.collection_name
        LIMIT ?
      `,
      [sourceName, ...localeFilter.params, collectionLimit]
    );

    return rows.map((row) => ({
      localeCode: row.localeCode,
      entityKind: row.entityKind,
      collectionName: row.collectionName,
      membershipType: row.membershipType,
      memberCount: toNumber(row.memberCount)
    }));
  }
}

export function formatAuditReport(report: EscoSourceAuditReport, format: AuditOutputFormat): string {
  if (format === 'json') {
    return JSON.stringify(report, null, 2);
  }

  const sections: string[] = [];
  sections.push('ESCO source audit');
  sections.push(`source_name: ${report.sourceName}`);
  sections.push(`locales: ${report.locales.join(', ')}`);
  sections.push(`generated_at: ${report.generatedAt}`);
  sections.push('');
  sections.push('Findings');
  sections.push(...report.findings.map((finding) => `- ${finding}`));
  sections.push('');
  sections.push('Occupations by locale');
  sections.push(
    formatTable(report.occupationSummary, [
      ['localeCode', 'locale'],
      ['occupationCount', 'occupations'],
      ['aliasCount', 'aliases'],
      ['averageAliasesPerOccupation', 'avg_aliases_per_occupation'],
      ['occupationsMissingAliases', 'missing_aliases']
    ])
  );
  sections.push('');
  sections.push('Alias buckets per occupation');
  sections.push(
    formatTable(report.aliasBuckets, [
      ['localeCode', 'locale'],
      ['aliasBucket', 'alias_bucket'],
      ['occupationCount', 'occupations']
    ])
  );
  sections.push('');
  sections.push('Occupations missing aliases');
  sections.push(
    formatSampleSection(
      report.missingAliasSamples,
      [
        ['localeCode', 'locale'],
        ['preferredLabel', 'preferred_label'],
        ['externalUri', 'external_uri']
      ],
      'No aliasless occupations found for the selected scope.'
    )
  );
  sections.push('');
  sections.push('Highest alias counts');
  sections.push(
    formatSampleSection(
      report.topAliasSamples,
      [
        ['localeCode', 'locale'],
        ['preferredLabel', 'preferred_label'],
        ['aliasCount', 'alias_count'],
        ['externalUri', 'external_uri']
      ],
      'No occupations found for the selected scope.'
    )
  );
  sections.push('');
  sections.push('Broader occupation coverage');
  sections.push(
    formatTable(report.broaderCoverage, [
      ['localeCode', 'locale'],
      ['occupationCount', 'occupations'],
      ['occupationsWithBroaderField', 'with_broader_field'],
      ['occupationsWithBroaderRelation', 'with_broader_relation'],
      ['occupationsWithUsableBroaderRelation', 'usable_broader_relation'],
      ['occupationsMissingBroaderField', 'missing_broader_field'],
      ['occupationsMissingBroaderRelation', 'missing_broader_relation'],
      ['broaderFieldMatchesRelation', 'field_matches_relation'],
      ['broaderFieldConflictsRelation', 'field_conflicts_relation'],
      ['broaderFieldWithoutRelation', 'field_without_relation'],
      ['broaderRelationWithoutField', 'relation_without_field'],
      ['broaderRelationMissingParentConcept', 'relation_missing_parent']
    ])
  );
  sections.push('');
  sections.push('Sample broader occupation links');
  sections.push(
    formatSampleSection(
      report.broaderSamples,
      [
        ['localeCode', 'locale'],
        ['childLabel', 'child_label'],
        ['parentLabel', 'parent_label'],
        ['childExternalUri', 'child_external_uri'],
        ['parentExternalUri', 'parent_external_uri']
      ],
      'No broader occupation links found for the selected scope.'
    )
  );
  sections.push('');
  sections.push('Occupations missing broader relations');
  sections.push(
    formatSampleSection(
      report.missingBroaderSamples,
      [
        ['localeCode', 'locale'],
        ['preferredLabel', 'preferred_label'],
        ['externalUri', 'external_uri']
      ],
      'No occupations are missing broader relations for the selected scope.'
    )
  );
  sections.push('');
  sections.push('ESCO collection / membership distribution');
  sections.push(
    formatSampleSection(
      report.membershipDistribution,
      [
        ['localeCode', 'locale'],
        ['entityKind', 'entity_kind'],
        ['collectionName', 'collection_name'],
        ['membershipType', 'membership_type'],
        ['memberCount', 'member_count']
      ],
      'No memberships found for the selected scope.'
    )
  );

  return sections.join('\n');
}

function normalizeSourceName(value: string | undefined): string {
  const sourceName = value?.trim();
  return sourceName ? sourceName : DEFAULT_ESCO_SOURCE_NAME;
}

function normalizeLocales(locales: string[] | undefined): string[] {
  if (!locales || locales.length === 0) {
    return [];
  }

  return Array.from(
    new Set(
      locales
        .flatMap((locale) => locale.split(','))
        .map((locale) => locale.trim())
        .filter(Boolean)
    )
  );
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`Expected a positive integer but received "${value}".`);
  }

  return value;
}

function buildLocaleFilter(columnName: string, locales: string[]): { sql: string; params: string[] } {
  if (locales.length === 0) {
    return { sql: '', params: [] };
  }

  const placeholders = locales.map(() => '?').join(', ');
  return {
    sql: `AND ${columnName} IN (${placeholders})`,
    params: locales
  };
}

function buildFindings(occupationSummary: OccupationSummaryRow[], broaderCoverage: BroaderCoverageRow[]): string[] {
  const findings: string[] = [];

  for (const broaderRow of broaderCoverage) {
    findings.push(
      `${broaderRow.localeCode}: broader_occupation relations resolve for ${broaderRow.occupationsWithUsableBroaderRelation}/${broaderRow.occupationCount} occupations; concept.broader_external_uri only covers ${broaderRow.occupationsWithBroaderField}/${broaderRow.occupationCount}.`
    );
  }

  for (const occupationRow of occupationSummary) {
    findings.push(
      `${occupationRow.localeCode}: ${occupationRow.averageAliasesPerOccupation.toFixed(2)} aliases per occupation on average; ${occupationRow.occupationsMissingAliases} occupations are aliasless.`
    );
  }

  return findings;
}

function formatSampleSection<T extends Record<string, unknown>>(
  rows: T[],
  columns: Array<[keyof T, string]>,
  emptyMessage: string
): string {
  if (rows.length === 0) {
    return emptyMessage;
  }

  return formatTable(rows, columns);
}

function formatTable<T extends Record<string, unknown>>(rows: T[], columns: Array<[keyof T, string]>): string {
  const values = rows.map((row) => columns.map(([key]) => stringifyTableValue(row[key])));

  const widths = columns.map(([, label], index) => {
    const cellWidths = values.map((row) => row[index].length);
    return Math.max(label.length, ...cellWidths);
  });

  const header = columns.map(([, label], index) => label.padEnd(widths[index])).join(' | ');
  const separator = widths.map((width) => '-'.repeat(width)).join('-|-');
  const body = values.map((row) => row.map((value, index) => value.padEnd(widths[index])).join(' | '));

  return [header, separator, ...body].join('\n');
}

function stringifyTableValue(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (typeof value === 'number') {
    return Number.isInteger(value) ? String(value) : value.toFixed(2);
  }

  return String(value);
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);

    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  throw new Error(`Expected numeric query value but received "${String(value)}".`);
}
