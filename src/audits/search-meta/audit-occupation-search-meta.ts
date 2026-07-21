import { type Connection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise';

export const DEFAULT_ESCO_SOURCE_NAME = 'esco_1_2_1';
const DEFAULT_SAMPLE_LIMIT = 10;
const DEFAULT_WEAK_ENGLISH_BACKBONE_THRESHOLD = 0.5;
const MIN_USEFUL_TEXT_LENGTH = 40;

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

type LocaleRow = RowDataPacket & {
  locale_code: string;
};

type SearchMetaOverviewQueryRow = RowDataPacket & {
  totalMetaRows: number;
  withHierarchy: number;
  withoutHierarchy: number;
  withCapabilitySupport: number;
  withoutCapabilitySupport: number;
  averageExactAliases: number;
  averageActiveAliases: number;
  averageLocaleCoverage: number;
};

type GenericRiskQueryRow = RowDataPacket & {
  genericRisk: string;
  occupationCount: number;
};

type LocaleCoverageQueryRow = RowDataPacket & {
  localeCode: string;
  occupationsWithLocaleAliases: number;
  occupationsMissingLocaleAliases: number;
  averageAliasesPerCoveredOccupation: number;
};

type AliasSparsityQueryRow = RowDataPacket & {
  aliasBucket: string;
  occupationCount: number;
};

type TextQualityQueryRow = RowDataPacket & {
  emptySearchText: number;
  emptyDenseText: number;
  shortSearchText: number;
  shortDenseText: number;
  uuidLikeSearchText: number;
  uuidLikeDenseText: number;
};

type EnglishBackboneQueryRow = RowDataPacket & {
  missingEnglishBackbone: number;
  weakEnglishBackbone: number;
  strongEnglishBackbone: number;
  averageEnglishBackboneStrength: number;
};

type QualityFlagQueryRow = RowDataPacket & {
  qualityFlag: string;
  occupationCount: number;
};

type SearchMetaSampleQueryRow = RowDataPacket & {
  graphNodeId: number;
  canonicalLabel: string;
  genericRisk: string;
  exactAliasCount: number;
  activeAliasCount: number;
  localeCoverageCount: number;
  englishBackboneStrength: number | null;
  qualityFlags: string | null;
};

export class OccupationSearchMetaAuditor {
  public constructor(private readonly connection: Connection) {}

  public async run(options: OccupationSearchMetaAuditOptions = {}): Promise<OccupationSearchMetaAuditReport> {
    const sourceName = normalizeSourceName(options.sourceName);
    const locales = await this.resolveLocales(sourceName, options.locales);
    const sampleLimit = normalizePositiveInteger(options.sampleLimit, DEFAULT_SAMPLE_LIMIT);
    const weakEnglishBackboneThreshold = normalizeThreshold(
      options.weakEnglishBackboneThreshold,
      DEFAULT_WEAK_ENGLISH_BACKBONE_THRESHOLD
    );

    const overview = await this.runSection('overview', () => this.loadOverview(sourceName));
    const genericRiskDistribution = await this.runSection('genericRiskDistribution', () =>
      this.loadGenericRiskDistribution(sourceName)
    );
    const localeCoverage = await this.runSection('localeCoverage', () =>
      this.loadLocaleCoverage(sourceName, locales)
    );
    const aliasSparsity = await this.runSection('aliasSparsity', () => this.loadAliasSparsity(sourceName));
    const textQuality = await this.runSection('textQuality', () => this.loadTextQuality(sourceName));
    const englishBackbone = await this.runSection('englishBackbone', () =>
      this.loadEnglishBackbone(sourceName, weakEnglishBackboneThreshold)
    );
    const qualityFlags = await this.runSection('qualityFlags', () => this.loadQualityFlags(sourceName));
    const missingHierarchySamples = await this.runSection('missingHierarchySamples', () =>
      this.loadMissingHierarchySamples(sourceName, sampleLimit)
    );
    const missingLocaleSamples = await this.runSection('missingLocaleSamples', () =>
      this.loadMissingLocaleSamples(sourceName, locales.length, sampleLimit)
    );
    const highGenericRiskSamples = await this.runSection('highGenericRiskSamples', () =>
      this.loadHighGenericRiskSamples(sourceName, sampleLimit)
    );
    const weakEnglishBackboneSamples = await this.runSection('weakEnglishBackboneSamples', () =>
      this.loadWeakEnglishBackboneSamples(sourceName, weakEnglishBackboneThreshold, sampleLimit)
    );
    const textQualitySamples = await this.runSection('textQualitySamples', () =>
      this.loadTextQualitySamples(sourceName, sampleLimit)
    );
    const reviewQueueInsertResult = options.insertReviewQueue
      ? await this.runSection('reviewQueueInsertResult', () =>
          this.insertReviewQueueRows(sourceName, locales.length, weakEnglishBackboneThreshold)
        )
      : null;

    return {
      generatedAt: new Date().toISOString(),
      sourceName,
      locales,
      sampleLimit,
      weakEnglishBackboneThreshold,
      reviewQueueInserted: options.insertReviewQueue === true,
      findings: buildFindings(
        overview,
        localeCoverage,
        textQuality,
        englishBackbone,
        genericRiskDistribution,
        reviewQueueInsertResult
      ),
      overview,
      genericRiskDistribution,
      localeCoverage,
      aliasSparsity,
      textQuality,
      englishBackbone,
      qualityFlags,
      missingHierarchySamples,
      missingLocaleSamples,
      highGenericRiskSamples,
      weakEnglishBackboneSamples,
      textQualitySamples,
      reviewQueueInsertResult
    };
  }

  private async runSection<T>(sectionName: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Search meta audit section "${sectionName}" failed: ${message}`);
    }
  }

  private async resolveLocales(sourceName: string, locales: string[] | undefined): Promise<string[]> {
    const requestedLocales = normalizeLocales(locales);

    if (requestedLocales.length > 0) {
      return requestedLocales;
    }

    const [rows] = await this.connection.query<LocaleRow[]>(
      `
        SELECT DISTINCT alias.locale_code
        FROM ose_graph_aliases alias
        INNER JOIN ose_graph_nodes node
          ON node.id = alias.graph_node_id
        WHERE alias.source_name = ?
          AND alias.is_active = 1
          AND node.bucket = 'occupation'
          AND node.node_level = 'occupation'
        ORDER BY alias.locale_code
      `,
      [sourceName]
    );

    const resolvedLocales = rows.map((row) => row.locale_code).filter(Boolean);

    if (resolvedLocales.length === 0) {
      throw new Error(`No active graph alias locales found for source_name="${sourceName}".`);
    }

    return resolvedLocales;
  }

  private async loadOverview(sourceName: string): Promise<SearchMetaOverviewRow> {
    const [rows] = await this.connection.query<SearchMetaOverviewQueryRow[]>(
      `
        SELECT
          COUNT(*) AS totalMetaRows,
          SUM(CASE WHEN meta.has_hierarchy = 1 THEN 1 ELSE 0 END) AS withHierarchy,
          SUM(CASE WHEN meta.has_hierarchy = 0 THEN 1 ELSE 0 END) AS withoutHierarchy,
          SUM(CASE WHEN meta.has_capability_support = 1 THEN 1 ELSE 0 END) AS withCapabilitySupport,
          SUM(CASE WHEN meta.has_capability_support = 0 THEN 1 ELSE 0 END) AS withoutCapabilitySupport,
          ROUND(AVG(meta.exact_alias_count), 2) AS averageExactAliases,
          ROUND(AVG(meta.active_alias_count), 2) AS averageActiveAliases,
          ROUND(AVG(meta.locale_coverage_count), 2) AS averageLocaleCoverage
        FROM ose_search_meta meta
        WHERE ${sourceExistsSql()}
      `,
      [sourceName]
    );

    const row = rows[0];
    return {
      totalMetaRows: toNumber(row.totalMetaRows),
      withHierarchy: toNumber(row.withHierarchy),
      withoutHierarchy: toNumber(row.withoutHierarchy),
      withCapabilitySupport: toNumber(row.withCapabilitySupport),
      withoutCapabilitySupport: toNumber(row.withoutCapabilitySupport),
      averageExactAliases: toNumber(row.averageExactAliases),
      averageActiveAliases: toNumber(row.averageActiveAliases),
      averageLocaleCoverage: toNumber(row.averageLocaleCoverage)
    };
  }

  private async loadGenericRiskDistribution(sourceName: string): Promise<GenericRiskRow[]> {
    const [rows] = await this.connection.query<GenericRiskQueryRow[]>(
      `
        SELECT meta.generic_risk AS genericRisk, COUNT(*) AS occupationCount
        FROM ose_search_meta meta
        WHERE ${sourceExistsSql()}
        GROUP BY meta.generic_risk
        ORDER BY FIELD(meta.generic_risk, 'low', 'medium', 'high')
      `,
      [sourceName]
    );

    return rows.map((row) => ({
      genericRisk: row.genericRisk,
      occupationCount: toNumber(row.occupationCount)
    }));
  }

  private async loadLocaleCoverage(sourceName: string, locales: string[]): Promise<LocaleCoverageRow[]> {
    const rows: LocaleCoverageRow[] = [];

    for (const locale of locales) {
      const [result] = await this.connection.query<LocaleCoverageQueryRow[]>(
        `
          SELECT
            ? AS localeCode,
            SUM(CASE WHEN locale_alias.aliasCount > 0 THEN 1 ELSE 0 END) AS occupationsWithLocaleAliases,
            SUM(CASE WHEN locale_alias.aliasCount = 0 THEN 1 ELSE 0 END) AS occupationsMissingLocaleAliases,
            ROUND(AVG(NULLIF(locale_alias.aliasCount, 0)), 2) AS averageAliasesPerCoveredOccupation
          FROM (
            SELECT
              meta.id,
              COUNT(alias.id) AS aliasCount
            FROM ose_search_meta meta
            LEFT JOIN ose_search_meta_aliases alias
              ON alias.search_meta_id = meta.id
              AND alias.locale_code = ?
              AND alias.alias_role IN ('locale_primary', 'locale_supporting')
            WHERE ${sourceExistsSql()}
            GROUP BY meta.id
          ) AS locale_alias
        `,
        [locale, locale, sourceName]
      );

      const row = result[0];
      rows.push({
        localeCode: locale,
        occupationsWithLocaleAliases: toNumber(row.occupationsWithLocaleAliases),
        occupationsMissingLocaleAliases: toNumber(row.occupationsMissingLocaleAliases),
        averageAliasesPerCoveredOccupation: toNumber(row.averageAliasesPerCoveredOccupation)
      });
    }

    return rows;
  }

  private async loadAliasSparsity(sourceName: string): Promise<AliasSparsityRow[]> {
    const [rows] = await this.connection.query<AliasSparsityQueryRow[]>(
      `
        SELECT
          CASE
            WHEN meta.exact_alias_count = 0 THEN '0'
            WHEN meta.exact_alias_count = 1 THEN '1'
            WHEN meta.exact_alias_count BETWEEN 2 AND 4 THEN '2-4'
            WHEN meta.exact_alias_count BETWEEN 5 AND 9 THEN '5-9'
            ELSE '10+'
          END AS aliasBucket,
          COUNT(*) AS occupationCount
        FROM ose_search_meta meta
        WHERE ${sourceExistsSql()}
        GROUP BY aliasBucket
        ORDER BY FIELD(aliasBucket, '0', '1', '2-4', '5-9', '10+')
      `,
      [sourceName]
    );

    return rows.map((row) => ({
      aliasBucket: row.aliasBucket,
      occupationCount: toNumber(row.occupationCount)
    }));
  }

  private async loadTextQuality(sourceName: string): Promise<TextQualityRow> {
    const [rows] = await this.connection.query<TextQualityQueryRow[]>(
      `
        SELECT
          SUM(CASE WHEN meta.search_text IS NULL OR TRIM(meta.search_text) = '' THEN 1 ELSE 0 END) AS emptySearchText,
          SUM(CASE WHEN meta.dense_text IS NULL OR TRIM(meta.dense_text) = '' THEN 1 ELSE 0 END) AS emptyDenseText,
          SUM(CASE WHEN CHAR_LENGTH(TRIM(COALESCE(meta.search_text, ''))) < ? THEN 1 ELSE 0 END) AS shortSearchText,
          SUM(CASE WHEN CHAR_LENGTH(TRIM(COALESCE(meta.dense_text, ''))) < ? THEN 1 ELSE 0 END) AS shortDenseText,
          SUM(CASE WHEN COALESCE(meta.search_text, '') REGEXP '[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}' THEN 1 ELSE 0 END) AS uuidLikeSearchText,
          SUM(CASE WHEN COALESCE(meta.dense_text, '') REGEXP '[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}' THEN 1 ELSE 0 END) AS uuidLikeDenseText
        FROM ose_search_meta meta
        WHERE ${sourceExistsSql()}
      `,
      [MIN_USEFUL_TEXT_LENGTH, MIN_USEFUL_TEXT_LENGTH, sourceName]
    );

    const row = rows[0];
    return {
      emptySearchText: toNumber(row.emptySearchText),
      emptyDenseText: toNumber(row.emptyDenseText),
      shortSearchText: toNumber(row.shortSearchText),
      shortDenseText: toNumber(row.shortDenseText),
      uuidLikeSearchText: toNumber(row.uuidLikeSearchText),
      uuidLikeDenseText: toNumber(row.uuidLikeDenseText)
    };
  }

  private async loadEnglishBackbone(sourceName: string, threshold: number): Promise<EnglishBackboneRow> {
    const [rows] = await this.connection.query<EnglishBackboneQueryRow[]>(
      `
        SELECT
          SUM(CASE WHEN meta.english_backbone_strength IS NULL THEN 1 ELSE 0 END) AS missingEnglishBackbone,
          SUM(CASE WHEN meta.english_backbone_strength IS NOT NULL AND meta.english_backbone_strength < ? THEN 1 ELSE 0 END) AS weakEnglishBackbone,
          SUM(CASE WHEN meta.english_backbone_strength IS NOT NULL AND meta.english_backbone_strength >= ? THEN 1 ELSE 0 END) AS strongEnglishBackbone,
          ROUND(AVG(meta.english_backbone_strength), 4) AS averageEnglishBackboneStrength
        FROM ose_search_meta meta
        WHERE ${sourceExistsSql()}
      `,
      [threshold, threshold, sourceName]
    );

    const row = rows[0];
    return {
      missingEnglishBackbone: toNumber(row.missingEnglishBackbone),
      weakEnglishBackbone: toNumber(row.weakEnglishBackbone),
      strongEnglishBackbone: toNumber(row.strongEnglishBackbone),
      averageEnglishBackboneStrength: toNumber(row.averageEnglishBackboneStrength)
    };
  }

  private async loadQualityFlags(sourceName: string): Promise<QualityFlagRow[]> {
    const [rows] = await this.connection.query<QualityFlagQueryRow[]>(
      `
        SELECT flags.qualityFlag, COUNT(*) AS occupationCount
        FROM (
          SELECT
            meta.id,
            JSON_UNQUOTE(flag.value) AS qualityFlag
          FROM ose_search_meta meta
          JOIN JSON_TABLE(
            COALESCE(meta.quality_flags_json, JSON_ARRAY()),
            '$[*]' COLUMNS (value JSON PATH '$')
          ) AS flag
          WHERE ${sourceExistsSql()}
        ) AS flags
        GROUP BY flags.qualityFlag
        ORDER BY occupationCount DESC, flags.qualityFlag
      `,
      [sourceName]
    );

    return rows.map((row) => ({
      qualityFlag: row.qualityFlag,
      occupationCount: toNumber(row.occupationCount)
    }));
  }

  private async loadMissingHierarchySamples(sourceName: string, sampleLimit: number): Promise<SearchMetaSampleRow[]> {
    return this.loadSamples(
      sourceName,
      `
        meta.has_hierarchy = 0
        OR meta.parent_node_id IS NULL
        OR meta.family_node_id IS NULL
        OR meta.group_node_id IS NULL
      `,
      'meta.has_hierarchy ASC, meta.locale_coverage_count ASC, node.canonical_label',
      [sampleLimit]
    );
  }

  private async loadMissingLocaleSamples(
    sourceName: string,
    expectedLocaleCount: number,
    sampleLimit: number
  ): Promise<SearchMetaSampleRow[]> {
    return this.loadSamples(
      sourceName,
      'meta.locale_coverage_count < ?',
      'meta.locale_coverage_count ASC, meta.exact_alias_count ASC, node.canonical_label',
      [expectedLocaleCount, sampleLimit]
    );
  }

  private async loadHighGenericRiskSamples(sourceName: string, sampleLimit: number): Promise<SearchMetaSampleRow[]> {
    return this.loadSamples(
      sourceName,
      "meta.generic_risk = 'high'",
      'meta.exact_alias_count ASC, meta.active_alias_count DESC, node.canonical_label',
      [sampleLimit]
    );
  }

  private async loadWeakEnglishBackboneSamples(
    sourceName: string,
    threshold: number,
    sampleLimit: number
  ): Promise<SearchMetaSampleRow[]> {
    return this.loadSamples(
      sourceName,
      '(meta.english_backbone_strength IS NULL OR meta.english_backbone_strength < ?)',
      'meta.english_backbone_strength IS NULL DESC, meta.english_backbone_strength ASC, node.canonical_label',
      [threshold, sampleLimit]
    );
  }

  private async loadTextQualitySamples(sourceName: string, sampleLimit: number): Promise<SearchMetaSampleRow[]> {
    return this.loadSamples(
      sourceName,
      `
        meta.search_text IS NULL
        OR TRIM(meta.search_text) = ''
        OR meta.dense_text IS NULL
        OR TRIM(meta.dense_text) = ''
        OR CHAR_LENGTH(TRIM(COALESCE(meta.search_text, ''))) < ${MIN_USEFUL_TEXT_LENGTH}
        OR CHAR_LENGTH(TRIM(COALESCE(meta.dense_text, ''))) < ${MIN_USEFUL_TEXT_LENGTH}
        OR COALESCE(meta.search_text, '') REGEXP '[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}'
        OR COALESCE(meta.dense_text, '') REGEXP '[[:xdigit:]]{8}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{4}-[[:xdigit:]]{12}'
      `,
      'node.canonical_label',
      [sampleLimit]
    );
  }

  private async loadSamples(
    sourceName: string,
    predicateSql: string,
    orderBySql: string,
    params: unknown[]
  ): Promise<SearchMetaSampleRow[]> {
    const [rows] = await this.connection.query<SearchMetaSampleQueryRow[]>(
      `
        SELECT
          meta.graph_node_id AS graphNodeId,
          node.canonical_label AS canonicalLabel,
          meta.generic_risk AS genericRisk,
          meta.exact_alias_count AS exactAliasCount,
          meta.active_alias_count AS activeAliasCount,
          meta.locale_coverage_count AS localeCoverageCount,
          meta.english_backbone_strength AS englishBackboneStrength,
          CAST(meta.quality_flags_json AS CHAR) AS qualityFlags
        FROM ose_search_meta meta
        INNER JOIN ose_graph_nodes node
          ON node.id = meta.graph_node_id
        WHERE ${sourceExistsSql()}
          AND (${predicateSql})
        ORDER BY ${orderBySql}
        LIMIT ?
      `,
      [sourceName, ...params]
    );

    return rows.map(mapSampleRow);
  }

  private async insertReviewQueueRows(
    sourceName: string,
    expectedLocaleCount: number,
    weakEnglishBackboneThreshold: number
  ): Promise<ReviewQueueInsertResult> {
    await this.connection.beginTransaction();

    try {
      const hierarchyGapRowsInserted = await this.insertHierarchyGapRows(sourceName);
      const crossLocaleGapRowsInserted = await this.insertCrossLocaleGapRows(sourceName, expectedLocaleCount);
      const genericHeadRowsInserted = await this.insertGenericHeadRows(sourceName, weakEnglishBackboneThreshold);

      await this.connection.commit();

      return {
        hierarchyGapRowsInserted,
        crossLocaleGapRowsInserted,
        genericHeadRowsInserted
      };
    } catch (error) {
      await this.connection.rollback();
      throw error;
    }
  }

  private async insertHierarchyGapRows(sourceName: string): Promise<number> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `
        INSERT INTO ose_manual_review_queue (
          review_type,
          subject_text,
          normalized_subject_text,
          graph_node_id,
          payload_json
        )
        SELECT
          'hierarchy_gap',
          node.canonical_label,
          node.normalized_label,
          meta.graph_node_id,
          JSON_OBJECT(
            'source_name', ?,
            'issue', 'search_meta_hierarchy_gap',
            'has_hierarchy', meta.has_hierarchy,
            'parent_node_id', meta.parent_node_id,
            'family_node_id', meta.family_node_id,
            'group_node_id', meta.group_node_id
          )
        FROM ose_search_meta meta
        INNER JOIN ose_graph_nodes node
          ON node.id = meta.graph_node_id
        WHERE ${sourceExistsSql()}
          AND (
            meta.has_hierarchy = 0
            OR meta.parent_node_id IS NULL
            OR meta.family_node_id IS NULL
            OR meta.group_node_id IS NULL
          )
          AND NOT EXISTS (
            SELECT 1
            FROM ose_manual_review_queue review
            WHERE review.review_type = 'hierarchy_gap'
              AND review.graph_node_id = meta.graph_node_id
              AND review.review_status = 'pending'
          )
      `,
      [sourceName, sourceName]
    );

    return result.affectedRows;
  }

  private async insertCrossLocaleGapRows(sourceName: string, expectedLocaleCount: number): Promise<number> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `
        INSERT INTO ose_manual_review_queue (
          review_type,
          subject_text,
          normalized_subject_text,
          graph_node_id,
          payload_json
        )
        SELECT
          'cross_locale_gap',
          node.canonical_label,
          node.normalized_label,
          meta.graph_node_id,
          JSON_OBJECT(
            'source_name', ?,
            'issue', 'search_meta_locale_coverage_gap',
            'expected_locale_count', ?,
            'locale_coverage_count', meta.locale_coverage_count
          )
        FROM ose_search_meta meta
        INNER JOIN ose_graph_nodes node
          ON node.id = meta.graph_node_id
        WHERE ${sourceExistsSql()}
          AND meta.locale_coverage_count < ?
          AND NOT EXISTS (
            SELECT 1
            FROM ose_manual_review_queue review
            WHERE review.review_type = 'cross_locale_gap'
              AND review.graph_node_id = meta.graph_node_id
              AND review.review_status = 'pending'
          )
      `,
      [sourceName, expectedLocaleCount, sourceName, expectedLocaleCount]
    );

    return result.affectedRows;
  }

  private async insertGenericHeadRows(sourceName: string, weakEnglishBackboneThreshold: number): Promise<number> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `
        INSERT INTO ose_manual_review_queue (
          review_type,
          subject_text,
          normalized_subject_text,
          graph_node_id,
          payload_json
        )
        SELECT
          'generic_head',
          node.canonical_label,
          node.normalized_label,
          meta.graph_node_id,
          JSON_OBJECT(
            'source_name', ?,
            'issue', 'search_meta_high_generic_risk',
            'generic_risk', meta.generic_risk,
            'exact_alias_count', meta.exact_alias_count,
            'active_alias_count', meta.active_alias_count,
            'english_backbone_strength', meta.english_backbone_strength,
            'weak_english_backbone_threshold', ?
          )
        FROM ose_search_meta meta
        INNER JOIN ose_graph_nodes node
          ON node.id = meta.graph_node_id
        WHERE ${sourceExistsSql()}
          AND meta.generic_risk = 'high'
          AND NOT EXISTS (
            SELECT 1
            FROM ose_manual_review_queue review
            WHERE review.review_type = 'generic_head'
              AND review.graph_node_id = meta.graph_node_id
              AND review.review_status = 'pending'
          )
      `,
      [sourceName, weakEnglishBackboneThreshold, sourceName]
    );

    return result.affectedRows;
  }
}

export function formatAuditReport(report: OccupationSearchMetaAuditReport, format: AuditOutputFormat): string {
  if (format === 'json') {
    return JSON.stringify(report, null, 2);
  }

  const sections: string[] = [];
  sections.push('Occupation search meta audit');
  sections.push(`source_name: ${report.sourceName}`);
  sections.push(`locales: ${report.locales.join(', ')}`);
  sections.push(`generated_at: ${report.generatedAt}`);
  sections.push(`weak_english_backbone_threshold: ${report.weakEnglishBackboneThreshold}`);
  sections.push(`review_queue_inserted: ${report.reviewQueueInserted ? 'yes' : 'no'}`);
  sections.push('');
  sections.push('Findings');
  sections.push(...report.findings.map((finding) => `- ${finding}`));
  sections.push('');
  sections.push('Overview');
  sections.push(formatTable([report.overview], [
    ['totalMetaRows', 'meta_rows'],
    ['withHierarchy', 'with_hierarchy'],
    ['withoutHierarchy', 'without_hierarchy'],
    ['withCapabilitySupport', 'with_capability'],
    ['withoutCapabilitySupport', 'without_capability'],
    ['averageExactAliases', 'avg_exact_aliases'],
    ['averageActiveAliases', 'avg_active_aliases'],
    ['averageLocaleCoverage', 'avg_locale_coverage']
  ]));
  sections.push('');
  sections.push('Generic risk distribution');
  sections.push(formatTable(report.genericRiskDistribution, [
    ['genericRisk', 'generic_risk'],
    ['occupationCount', 'occupations']
  ]));
  sections.push('');
  sections.push('Locale coverage');
  sections.push(formatTable(report.localeCoverage, [
    ['localeCode', 'locale'],
    ['occupationsWithLocaleAliases', 'with_aliases'],
    ['occupationsMissingLocaleAliases', 'missing_aliases'],
    ['averageAliasesPerCoveredOccupation', 'avg_aliases_if_covered']
  ]));
  sections.push('');
  sections.push('Alias sparsity');
  sections.push(formatTable(report.aliasSparsity, [
    ['aliasBucket', 'exact_alias_bucket'],
    ['occupationCount', 'occupations']
  ]));
  sections.push('');
  sections.push('Text quality');
  sections.push(formatTable([report.textQuality], [
    ['emptySearchText', 'empty_search'],
    ['emptyDenseText', 'empty_dense'],
    ['shortSearchText', 'short_search'],
    ['shortDenseText', 'short_dense'],
    ['uuidLikeSearchText', 'uuid_like_search'],
    ['uuidLikeDenseText', 'uuid_like_dense']
  ]));
  sections.push('');
  sections.push('English backbone');
  sections.push(formatTable([report.englishBackbone], [
    ['missingEnglishBackbone', 'missing'],
    ['weakEnglishBackbone', 'weak'],
    ['strongEnglishBackbone', 'strong'],
    ['averageEnglishBackboneStrength', 'avg_strength']
  ]));
  sections.push('');
  sections.push('Quality flags');
  sections.push(formatSampleSection(report.qualityFlags, [
    ['qualityFlag', 'quality_flag'],
    ['occupationCount', 'occupations']
  ], 'No quality flags found for the selected scope.'));
  sections.push('');
  sections.push('Missing hierarchy samples');
  sections.push(formatSampleSection(report.missingHierarchySamples, sampleColumns(), 'No hierarchy gaps found.'));
  sections.push('');
  sections.push('Missing locale coverage samples');
  sections.push(formatSampleSection(report.missingLocaleSamples, sampleColumns(), 'No locale coverage gaps found.'));
  sections.push('');
  sections.push('High generic risk samples');
  sections.push(formatSampleSection(report.highGenericRiskSamples, sampleColumns(), 'No high generic risk rows found.'));
  sections.push('');
  sections.push('Weak English backbone samples');
  sections.push(formatSampleSection(report.weakEnglishBackboneSamples, sampleColumns(), 'No weak English backbone rows found.'));
  sections.push('');
  sections.push('Text quality samples');
  sections.push(formatSampleSection(report.textQualitySamples, sampleColumns(), 'No text quality samples found.'));

  if (report.reviewQueueInsertResult) {
    sections.push('');
    sections.push('Review queue inserts');
    sections.push(formatTable([report.reviewQueueInsertResult], [
      ['hierarchyGapRowsInserted', 'hierarchy_gap'],
      ['crossLocaleGapRowsInserted', 'cross_locale_gap'],
      ['genericHeadRowsInserted', 'generic_head']
    ]));
  }

  return sections.join('\n');
}

function sourceExistsSql(): string {
  return `
    EXISTS (
      SELECT 1
      FROM ose_graph_node_sources node_source
      WHERE node_source.graph_node_id = meta.graph_node_id
        AND node_source.source_name = ?
    )
  `;
}

function buildFindings(
  overview: SearchMetaOverviewRow,
  localeCoverage: LocaleCoverageRow[],
  textQuality: TextQualityRow,
  englishBackbone: EnglishBackboneRow,
  genericRiskDistribution: GenericRiskRow[],
  reviewQueueInsertResult: ReviewQueueInsertResult | null
): string[] {
  const findings = [
    `${overview.totalMetaRows} search meta rows audited; ${overview.withoutHierarchy} lack hierarchy and ${overview.withoutCapabilitySupport} lack capability support.`,
    `${textQuality.emptySearchText} empty search_text rows, ${textQuality.emptyDenseText} empty dense_text rows, ${textQuality.uuidLikeSearchText} UUID-like search_text rows, ${textQuality.uuidLikeDenseText} UUID-like dense_text rows.`,
    `${englishBackbone.missingEnglishBackbone} rows have no English backbone strength and ${englishBackbone.weakEnglishBackbone} are below the configured weak threshold.`
  ];

  const highGenericRisk = genericRiskDistribution.find((row) => row.genericRisk === 'high')?.occupationCount ?? 0;
  findings.push(`${highGenericRisk} occupations are marked high generic risk.`);

  for (const localeRow of localeCoverage) {
    findings.push(
      `${localeRow.localeCode}: ${localeRow.occupationsWithLocaleAliases}/${overview.totalMetaRows} occupations have local aliases; ${localeRow.occupationsMissingLocaleAliases} are missing local alias coverage.`
    );
  }

  if (reviewQueueInsertResult) {
    const totalInserted =
      reviewQueueInsertResult.hierarchyGapRowsInserted +
      reviewQueueInsertResult.crossLocaleGapRowsInserted +
      reviewQueueInsertResult.genericHeadRowsInserted;
    findings.push(`${totalInserted} pending manual review rows inserted for obvious audit findings.`);
  }

  return findings;
}

function mapSampleRow(row: SearchMetaSampleQueryRow): SearchMetaSampleRow {
  return {
    graphNodeId: toNumber(row.graphNodeId),
    canonicalLabel: row.canonicalLabel,
    genericRisk: row.genericRisk,
    exactAliasCount: toNumber(row.exactAliasCount),
    activeAliasCount: toNumber(row.activeAliasCount),
    localeCoverageCount: toNumber(row.localeCoverageCount),
    englishBackboneStrength: row.englishBackboneStrength === null ? null : toNumber(row.englishBackboneStrength),
    qualityFlags: row.qualityFlags ?? '[]'
  };
}

function sampleColumns(): Array<[keyof SearchMetaSampleRow, string]> {
  return [
    ['graphNodeId', 'node_id'],
    ['canonicalLabel', 'canonical_label'],
    ['genericRisk', 'generic_risk'],
    ['exactAliasCount', 'exact_aliases'],
    ['activeAliasCount', 'active_aliases'],
    ['localeCoverageCount', 'locale_coverage'],
    ['englishBackboneStrength', 'english_strength'],
    ['qualityFlags', 'quality_flags']
  ];
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

function normalizeThreshold(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Expected a threshold between 0 and 1 but received "${value}".`);
  }

  return value;
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

  if (value === null || value === undefined) {
    return 0;
  }

  throw new Error(`Expected numeric query value but received "${String(value)}".`);
}
