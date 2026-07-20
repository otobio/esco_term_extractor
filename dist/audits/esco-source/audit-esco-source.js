export const DEFAULT_ESCO_SOURCE_NAME = 'esco_1_2_1';
const DEFAULT_SAMPLE_LIMIT = 8;
const DEFAULT_COLLECTION_LIMIT = 12;
export class EscoSourceAuditor {
    connection;
    constructor(connection) {
        this.connection = connection;
    }
    async run(options = {}) {
        const sourceName = normalizeSourceName(options.sourceName);
        const locales = await this.resolveLocales(sourceName, options.locales);
        const sampleLimit = normalizePositiveInteger(options.sampleLimit, DEFAULT_SAMPLE_LIMIT);
        const collectionLimit = normalizePositiveInteger(options.collectionLimit, DEFAULT_COLLECTION_LIMIT);
        const occupationSummary = await this.runSection('occupationSummary', () => this.loadOccupationSummary(sourceName, locales));
        const aliasBuckets = await this.runSection('aliasBuckets', () => this.loadAliasBuckets(sourceName, locales));
        const missingAliasSamples = await this.runSection('missingAliasSamples', () => this.loadMissingAliasSamples(sourceName, locales, sampleLimit));
        const topAliasSamples = await this.runSection('topAliasSamples', () => this.loadTopAliasSamples(sourceName, locales, sampleLimit));
        const broaderCoverage = await this.runSection('broaderCoverage', () => this.loadBroaderCoverage(sourceName, locales));
        const broaderSamples = await this.runSection('broaderSamples', () => this.loadBroaderSamples(sourceName, locales, sampleLimit));
        const missingBroaderSamples = await this.runSection('missingBroaderSamples', () => this.loadMissingBroaderSamples(sourceName, locales, sampleLimit));
        const membershipDistribution = await this.runSection('membershipDistribution', () => this.loadMembershipDistribution(sourceName, locales, collectionLimit));
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
    async runSection(sectionName, work) {
        try {
            return await work();
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            throw new Error(`Audit section "${sectionName}" failed: ${message}`);
        }
    }
    async resolveLocales(sourceName, locales) {
        const requestedLocales = normalizeLocales(locales);
        if (requestedLocales.length > 0) {
            return requestedLocales;
        }
        const [rows] = await this.connection.query(`
        SELECT DISTINCT locale_code
        FROM ose_source_concepts
        WHERE source_name = ?
        ORDER BY locale_code
      `, [sourceName]);
        const resolvedLocales = rows.map((row) => row.locale_code);
        if (resolvedLocales.length === 0) {
            throw new Error(`No ose_source_concepts rows found for source_name="${sourceName}".`);
        }
        return resolvedLocales;
    }
    async loadOccupationSummary(sourceName, locales) {
        const outerLocaleFilter = buildLocaleFilter('c.locale_code', locales);
        const innerLocaleFilter = buildLocaleFilter('concept.locale_code', locales);
        const [rows] = await this.connection.query(`
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
      `, [sourceName, ...innerLocaleFilter.params, sourceName, ...outerLocaleFilter.params]);
        return rows.map((row) => ({
            localeCode: row.localeCode,
            occupationCount: toNumber(row.occupationCount),
            aliasCount: toNumber(row.aliasCount),
            averageAliasesPerOccupation: toNumber(row.averageAliasesPerOccupation),
            occupationsMissingAliases: toNumber(row.occupationsMissingAliases)
        }));
    }
    async loadAliasBuckets(sourceName, locales) {
        const localeFilter = buildLocaleFilter('c.locale_code', locales);
        const [rows] = await this.connection.query(`
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
      `, [sourceName, ...localeFilter.params]);
        return rows.map((row) => ({
            localeCode: row.localeCode,
            aliasBucket: row.aliasBucket,
            occupationCount: toNumber(row.occupationCount)
        }));
    }
    async loadMissingAliasSamples(sourceName, locales, sampleLimit) {
        const localeFilter = buildLocaleFilter('c.locale_code', locales);
        const [rows] = await this.connection.query(`
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
      `, [sourceName, ...localeFilter.params, sampleLimit]);
        return rows.map((row) => ({
            localeCode: row.localeCode,
            preferredLabel: row.preferredLabel,
            externalUri: row.externalUri
        }));
    }
    async loadTopAliasSamples(sourceName, locales, sampleLimit) {
        const localeFilter = buildLocaleFilter('c.locale_code', locales);
        const [rows] = await this.connection.query(`
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
      `, [sourceName, ...localeFilter.params, sampleLimit]);
        return rows.map((row) => ({
            localeCode: row.localeCode,
            preferredLabel: row.preferredLabel,
            externalUri: row.externalUri,
            aliasCount: toNumber(row.aliasCount)
        }));
    }
    async loadBroaderCoverage(sourceName, locales) {
        const localeFilter = buildLocaleFilter('c.locale_code', locales);
        const [rows] = await this.connection.query(`
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
      `, [sourceName, ...localeFilter.params]);
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
    async loadBroaderSamples(sourceName, locales, sampleLimit) {
        const localeFilter = buildLocaleFilter('r.locale_code', locales);
        const [rows] = await this.connection.query(`
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
      `, [sourceName, ...localeFilter.params, sampleLimit]);
        return rows.map((row) => ({
            localeCode: row.localeCode,
            childLabel: row.childLabel,
            parentLabel: row.parentLabel,
            childExternalUri: row.childExternalUri,
            parentExternalUri: row.parentExternalUri
        }));
    }
    async loadMissingBroaderSamples(sourceName, locales, sampleLimit) {
        const localeFilter = buildLocaleFilter('c.locale_code', locales);
        const [rows] = await this.connection.query(`
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
      `, [sourceName, ...localeFilter.params, sampleLimit]);
        return rows.map((row) => ({
            localeCode: row.localeCode,
            preferredLabel: row.preferredLabel,
            externalUri: row.externalUri
        }));
    }
    async loadMembershipDistribution(sourceName, locales, collectionLimit) {
        const localeFilter = buildLocaleFilter('c.locale_code', locales);
        const [rows] = await this.connection.query(`
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
      `, [sourceName, ...localeFilter.params, collectionLimit]);
        return rows.map((row) => ({
            localeCode: row.localeCode,
            entityKind: row.entityKind,
            collectionName: row.collectionName,
            membershipType: row.membershipType,
            memberCount: toNumber(row.memberCount)
        }));
    }
}
export function formatAuditReport(report, format) {
    if (format === 'json') {
        return JSON.stringify(report, null, 2);
    }
    const sections = [];
    sections.push('ESCO source audit');
    sections.push(`source_name: ${report.sourceName}`);
    sections.push(`locales: ${report.locales.join(', ')}`);
    sections.push(`generated_at: ${report.generatedAt}`);
    sections.push('');
    sections.push('Findings');
    sections.push(...report.findings.map((finding) => `- ${finding}`));
    sections.push('');
    sections.push('Occupations by locale');
    sections.push(formatTable(report.occupationSummary, [
        ['localeCode', 'locale'],
        ['occupationCount', 'occupations'],
        ['aliasCount', 'aliases'],
        ['averageAliasesPerOccupation', 'avg_aliases_per_occupation'],
        ['occupationsMissingAliases', 'missing_aliases']
    ]));
    sections.push('');
    sections.push('Alias buckets per occupation');
    sections.push(formatTable(report.aliasBuckets, [
        ['localeCode', 'locale'],
        ['aliasBucket', 'alias_bucket'],
        ['occupationCount', 'occupations']
    ]));
    sections.push('');
    sections.push('Occupations missing aliases');
    sections.push(formatSampleSection(report.missingAliasSamples, [
        ['localeCode', 'locale'],
        ['preferredLabel', 'preferred_label'],
        ['externalUri', 'external_uri']
    ], 'No aliasless occupations found for the selected scope.'));
    sections.push('');
    sections.push('Highest alias counts');
    sections.push(formatSampleSection(report.topAliasSamples, [
        ['localeCode', 'locale'],
        ['preferredLabel', 'preferred_label'],
        ['aliasCount', 'alias_count'],
        ['externalUri', 'external_uri']
    ], 'No occupations found for the selected scope.'));
    sections.push('');
    sections.push('Broader occupation coverage');
    sections.push(formatTable(report.broaderCoverage, [
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
    ]));
    sections.push('');
    sections.push('Sample broader occupation links');
    sections.push(formatSampleSection(report.broaderSamples, [
        ['localeCode', 'locale'],
        ['childLabel', 'child_label'],
        ['parentLabel', 'parent_label'],
        ['childExternalUri', 'child_external_uri'],
        ['parentExternalUri', 'parent_external_uri']
    ], 'No broader occupation links found for the selected scope.'));
    sections.push('');
    sections.push('Occupations missing broader relations');
    sections.push(formatSampleSection(report.missingBroaderSamples, [
        ['localeCode', 'locale'],
        ['preferredLabel', 'preferred_label'],
        ['externalUri', 'external_uri']
    ], 'No occupations are missing broader relations for the selected scope.'));
    sections.push('');
    sections.push('ESCO collection / membership distribution');
    sections.push(formatSampleSection(report.membershipDistribution, [
        ['localeCode', 'locale'],
        ['entityKind', 'entity_kind'],
        ['collectionName', 'collection_name'],
        ['membershipType', 'membership_type'],
        ['memberCount', 'member_count']
    ], 'No memberships found for the selected scope.'));
    return sections.join('\n');
}
function normalizeSourceName(value) {
    const sourceName = value?.trim();
    return sourceName ? sourceName : DEFAULT_ESCO_SOURCE_NAME;
}
function normalizeLocales(locales) {
    if (!locales || locales.length === 0) {
        return [];
    }
    return Array.from(new Set(locales
        .flatMap((locale) => locale.split(','))
        .map((locale) => locale.trim())
        .filter(Boolean)));
}
function normalizePositiveInteger(value, fallback) {
    if (value === undefined) {
        return fallback;
    }
    if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Expected a positive integer but received "${value}".`);
    }
    return value;
}
function buildLocaleFilter(columnName, locales) {
    if (locales.length === 0) {
        return { sql: '', params: [] };
    }
    const placeholders = locales.map(() => '?').join(', ');
    return {
        sql: `AND ${columnName} IN (${placeholders})`,
        params: locales
    };
}
function buildFindings(occupationSummary, broaderCoverage) {
    const findings = [];
    for (const broaderRow of broaderCoverage) {
        findings.push(`${broaderRow.localeCode}: broader_occupation relations resolve for ${broaderRow.occupationsWithUsableBroaderRelation}/${broaderRow.occupationCount} occupations; concept.broader_external_uri only covers ${broaderRow.occupationsWithBroaderField}/${broaderRow.occupationCount}.`);
    }
    for (const occupationRow of occupationSummary) {
        findings.push(`${occupationRow.localeCode}: ${occupationRow.averageAliasesPerOccupation.toFixed(2)} aliases per occupation on average; ${occupationRow.occupationsMissingAliases} occupations are aliasless.`);
    }
    return findings;
}
function formatSampleSection(rows, columns, emptyMessage) {
    if (rows.length === 0) {
        return emptyMessage;
    }
    return formatTable(rows, columns);
}
function formatTable(rows, columns) {
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
function stringifyTableValue(value) {
    if (value === null || value === undefined) {
        return '';
    }
    if (typeof value === 'number') {
        return Number.isInteger(value) ? String(value) : value.toFixed(2);
    }
    return String(value);
}
function toNumber(value) {
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
