import { createHash } from 'node:crypto';
import type { Connection, ResultSetHeader } from 'mysql2/promise';
import type { EscoConfig } from '../../config/esco.js';
import { listEscoCsvFiles, locateEscoPack, readEscoFile, type EscoPackLocation } from '../../utils/csv/read-esco-file.js';
import { parseCsvRecords } from '../../utils/csv/parse-csv.js';
import { normalizeSearchText } from '../../utils/texts.js';

type SourceRow = Record<string, string | null>;

type FileRole = 'concept' | 'relation' | 'scheme' | 'dictionary' | 'metadata';

type SourceConceptInput = {
  sourceFileId: number | null;
  localeCode: string;
  externalId?: string | null;
  externalUri: string;
  entityKind: string;
  conceptType?: string | null;
  preferredLabel?: string | null;
  description?: string | null;
  definitionText?: string | null;
  scopeNote?: string | null;
  regulatedProfessionNote?: string | null;
  broaderExternalUri?: string | null;
  broaderPreferredLabel?: string | null;
  iscoGroupCode?: string | null;
  schemeUris?: string[];
  sourcePayload?: SourceRow | null;
};

type SourceRelationInput = {
  sourceFileId: number | null;
  localeCode: string;
  relationKind: string;
  relationType?: string | null;
  parentExternalUri: string;
  childExternalUri: string;
  parentLabel?: string | null;
  childLabel?: string | null;
  parentEntityKind?: string | null;
  childEntityKind?: string | null;
  weight?: number | null;
  confidence?: number | null;
  sourcePayload?: SourceRow | null;
};

const CONCEPT_FAMILIES = new Set([
  'occupations',
  'researchOccupationsCollection',
  'skills',
  'transversalSkillsCollection',
  'researchSkillsCollection',
  'digitalSkillsCollection',
  'digCompSkillsCollection',
  'greenSkillsCollection',
  'languageSkillsCollection',
  'ISCOGroups',
  'skillGroups',
  'conceptSchemes'
]);

const RELATION_FAMILIES = new Set([
  'occupationSkillRelations',
  'skillSkillRelations',
  'broaderRelationsOccPillar',
  'broaderRelationsSkillPillar'
]);

const MEMBERSHIP_FAMILIES = new Set([
  'researchOccupationsCollection',
  'transversalSkillsCollection',
  'researchSkillsCollection',
  'digitalSkillsCollection',
  'digCompSkillsCollection',
  'greenSkillsCollection',
  'languageSkillsCollection'
]);

export class EscoSourceImporter {
  private runId = 0;

  public constructor(
    private readonly connection: Connection,
    private readonly config: EscoConfig
  ) {}

  public async run(): Promise<number> {
    this.runId = await this.insertImportRun();

    try {
      await this.connection.beginTransaction();

      for (const locale of this.config.locales) {
        const pack = await locateEscoPack(this.config.downloadsDir, this.config.version, locale);
        const fileNames = await listEscoCsvFiles(pack);

        for (const fileName of fileNames) {
          await this.importFile(locale, pack, fileName);
        }
      }

      await this.connection.commit();
      await this.markImportRun('completed', null);

      return this.runId;
    } catch (error) {
      await this.connection.rollback();
      const message = error instanceof Error ? error.message : String(error);
      await this.markImportRun('failed', message);
      throw error;
    }
  }

  private async importFile(localeCode: string, pack: EscoPackLocation, fileName: string): Promise<void> {
    const fileFamily = detectFileFamily(fileName, localeCode);
    const fileRole = detectFileRole(fileFamily);
    const fileContents = await readEscoFile(pack, fileName);
    const rows = parseCsvRecords(fileContents.content);
    const sourceFileId = await this.insertSourceFile({
      localeCode,
      fileFamily,
      fileRole,
      fileName,
      sourcePath: fileContents.sourcePath,
      checksumSha256: fileContents.checksumSha256
    });

    let rowNumber = 0;

    for (const row of rows) {
      rowNumber += 1;

      const externalUri = extractExternalUri(fileFamily, row);
      await this.insertRawRow(sourceFileId, rowNumber, buildRowKey(fileFamily, localeCode, rowNumber, row), externalUri, row);

      if (CONCEPT_FAMILIES.has(fileFamily)) {
        await this.importConceptRow(sourceFileId, localeCode, fileFamily, row);
        continue;
      }

      if (RELATION_FAMILIES.has(fileFamily)) {
        await this.importRelationRow(sourceFileId, localeCode, fileFamily, row);
      }
    }

    await this.updateSourceFileRowCount(sourceFileId, rowNumber);
  }

  private async importConceptRow(sourceFileId: number, localeCode: string, fileFamily: string, row: SourceRow): Promise<void> {
    if (fileFamily === 'conceptSchemes') {
      await this.importConceptSchemeRow(sourceFileId, localeCode, row);
      return;
    }

    const externalUri = row.conceptUri;

    if (!externalUri) {
      return;
    }

    const conceptId = await this.upsertConcept({
      sourceFileId,
      localeCode,
      externalId: row.code,
      externalUri,
      entityKind: detectEntityKind(fileFamily, row),
      conceptType: row.conceptType,
      preferredLabel: firstNonEmpty(row.preferredLabel, row.title, row.conceptLabel),
      description: row.description,
      definitionText: row.definition,
      scopeNote: row.scopeNote,
      regulatedProfessionNote: row.regulatedProfessionNote,
      broaderExternalUri: firstFromMultiValue(row.broaderConceptUri),
      broaderPreferredLabel: firstFromMultiValue(row.broaderConceptPT),
      iscoGroupCode: row.iscoGroup,
      schemeUris: splitLineSeparatedValues(row.inScheme),
      sourcePayload: row
    });

    await this.upsertAlias(conceptId, sourceFileId, localeCode, row.preferredLabel, 'preferred_label', true, row);

    for (const alias of splitAliasValues(row.altLabels)) {
      await this.upsertAlias(conceptId, sourceFileId, localeCode, alias, 'alt_label', false, row);
    }

    for (const alias of splitAliasValues(row.hiddenLabels)) {
      await this.upsertAlias(conceptId, sourceFileId, localeCode, alias, 'hidden_label', false, row);
    }

    if (MEMBERSHIP_FAMILIES.has(fileFamily)) {
      await this.insertMembership(conceptId, fileFamily, 'member');
    }
  }

  private async importConceptSchemeRow(sourceFileId: number, localeCode: string, row: SourceRow): Promise<void> {
    const externalUri = row.conceptSchemeUri;

    if (!externalUri) {
      return;
    }

    const schemeLabel = firstNonEmpty(row.preferredLabel, row.title);
    const schemeConceptId = await this.upsertConcept({
      sourceFileId,
      localeCode,
      externalUri,
      entityKind: 'concept_scheme',
      conceptType: row.conceptType ?? 'ConceptScheme',
      preferredLabel: schemeLabel,
      description: row.description,
      sourcePayload: row
    });

    await this.upsertAlias(schemeConceptId, sourceFileId, localeCode, schemeLabel, 'preferred_label', true, row);

    const collectionName = buildCollectionName(externalUri, schemeLabel);

    for (const topConceptUri of splitLineSeparatedValues(row.hasTopConcept)) {
      const memberConceptId = await this.upsertStubConcept(sourceFileId, localeCode, topConceptUri, null, null);
      await this.insertMembership(memberConceptId, collectionName, 'top_concept');
    }
  }

  private async importRelationRow(sourceFileId: number, localeCode: string, fileFamily: string, row: SourceRow): Promise<void> {
    if (fileFamily === 'occupationSkillRelations') {
      const parentExternalUri = row.occupationUri;
      const childExternalUri = row.skillUri;

      if (!parentExternalUri || !childExternalUri) {
        return;
      }

      await this.upsertStubConcept(sourceFileId, localeCode, parentExternalUri, 'Occupation', row.occupationLabel);
      await this.upsertStubConcept(sourceFileId, localeCode, childExternalUri, row.skillType, row.skillLabel);
      await this.upsertRelation({
        sourceFileId,
        localeCode,
        relationKind: 'occupation_skill',
        relationType: row.relationType,
        parentExternalUri,
        childExternalUri,
        parentLabel: row.occupationLabel,
        childLabel: row.skillLabel,
        parentEntityKind: 'occupation',
        childEntityKind: guessEntityKind(row.skillType, childExternalUri),
        sourcePayload: row
      });
      return;
    }

    if (fileFamily === 'skillSkillRelations') {
      const parentExternalUri = row.originalSkillUri;
      const childExternalUri = row.relatedSkillUri;

      if (!parentExternalUri || !childExternalUri) {
        return;
      }

      await this.upsertStubConcept(sourceFileId, localeCode, parentExternalUri, row.originalSkillType, null);
      await this.upsertStubConcept(sourceFileId, localeCode, childExternalUri, row.relatedSkillType, null);
      await this.upsertRelation({
        sourceFileId,
        localeCode,
        relationKind: 'skill_skill',
        relationType: row.relationType,
        parentExternalUri,
        childExternalUri,
        parentEntityKind: guessEntityKind(row.originalSkillType, parentExternalUri),
        childEntityKind: guessEntityKind(row.relatedSkillType, childExternalUri),
        sourcePayload: row
      });
      return;
    }

    const parentExternalUri = row.broaderUri;
    const childExternalUri = row.conceptUri;

    if (!parentExternalUri || !childExternalUri) {
      return;
    }

    await this.upsertStubConcept(sourceFileId, localeCode, parentExternalUri, row.broaderType, row.broaderLabel);
    await this.upsertStubConcept(sourceFileId, localeCode, childExternalUri, row.conceptType, row.conceptLabel);
    await this.upsertRelation({
      sourceFileId,
      localeCode,
      relationKind: fileFamily === 'broaderRelationsOccPillar' ? 'broader_occupation' : 'broader_skill',
      relationType: row.broaderType,
      parentExternalUri,
      childExternalUri,
      parentLabel: row.broaderLabel,
      childLabel: row.conceptLabel,
      parentEntityKind: guessEntityKind(row.broaderType, parentExternalUri),
      childEntityKind: guessEntityKind(row.conceptType, childExternalUri),
      sourcePayload: row
    });
  }

  private async insertImportRun(): Promise<number> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `
        INSERT INTO ose_import_runs
          (source_kind, source_name, source_version, locale_scope_json, status)
        VALUES
          (?, ?, ?, ?, 'running')
      `,
      [this.config.sourceKind, this.config.sourceName, this.config.version, JSON.stringify(this.config.locales)]
    );

    return result.insertId;
  }

  private async markImportRun(status: 'completed' | 'failed', notes: string | null): Promise<void> {
    await this.connection.execute(
      `
        UPDATE ose_import_runs
        SET status = ?, notes = ?, finished_at = UTC_TIMESTAMP()
        WHERE id = ?
      `,
      [status, clipNullable(notes, 65535), this.runId]
    );
  }

  private async insertSourceFile(input: {
    localeCode: string;
    fileFamily: string;
    fileRole: FileRole;
    fileName: string;
    sourcePath: string;
    checksumSha256: string;
  }): Promise<number> {
    const [result] = await this.connection.execute<ResultSetHeader>(
      `
        INSERT INTO ose_source_files
          (import_run_id, source_kind, source_name, locale_code, file_family, file_role, file_name, source_path, checksum_sha256)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        this.runId,
        this.config.sourceKind,
        this.config.sourceName,
        input.localeCode,
        input.fileFamily,
        input.fileRole,
        input.fileName,
        clipNullable(input.sourcePath, 1000),
        input.checksumSha256
      ]
    );

    return result.insertId;
  }

  private async updateSourceFileRowCount(sourceFileId: number, rowCount: number): Promise<void> {
    await this.connection.execute(
      `
        UPDATE ose_source_files
        SET row_count = ?
        WHERE id = ?
      `,
      [rowCount, sourceFileId]
    );
  }

  private async insertRawRow(
    sourceFileId: number,
    rowNumber: number,
    rowKey: string,
    externalUri: string | null,
    payload: SourceRow
  ): Promise<void> {
    await this.connection.execute(
      `
        INSERT INTO ose_raw_rows
          (source_file_id, source_row_number, row_key, external_uri, payload)
        VALUES
          (?, ?, ?, ?, ?)
      `,
      [sourceFileId, rowNumber, rowKey, clipNullable(externalUri, 500), JSON.stringify(payload)]
    );
  }

  private async upsertConcept(input: SourceConceptInput): Promise<number> {
    const fallbackLabel = clipNullable(input.externalId, 255) ?? deriveLabelFromUri(input.externalUri);
    const preferredLabel = clipNullable(input.preferredLabel, 500) ?? clip(fallbackLabel, 500);
    const normalizedLabel = preferredLabel ? clipNullable(normalizeText(preferredLabel), 500) : null;
    const [result] = await this.connection.execute<ResultSetHeader>(
      `
        INSERT INTO ose_source_concepts
          (
            import_run_id,
            source_file_id,
            source_kind,
            source_name,
            locale_code,
            external_id,
            external_uri,
            entity_kind,
            concept_type,
            preferred_label,
            normalized_label,
            description,
            definition_text,
            scope_note,
            regulated_profession_note,
            broader_external_uri,
            broader_preferred_label,
            isco_group_code,
            scheme_uris_json,
            source_payload
          )
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          id = LAST_INSERT_ID(id),
          import_run_id = VALUES(import_run_id),
          source_file_id = COALESCE(VALUES(source_file_id), source_file_id),
          external_id = COALESCE(VALUES(external_id), external_id),
          entity_kind = COALESCE(VALUES(entity_kind), entity_kind),
          concept_type = COALESCE(VALUES(concept_type), concept_type),
          preferred_label = COALESCE(VALUES(preferred_label), preferred_label),
          normalized_label = COALESCE(VALUES(normalized_label), normalized_label),
          description = COALESCE(VALUES(description), description),
          definition_text = COALESCE(VALUES(definition_text), definition_text),
          scope_note = COALESCE(VALUES(scope_note), scope_note),
          regulated_profession_note = COALESCE(VALUES(regulated_profession_note), regulated_profession_note),
          broader_external_uri = COALESCE(VALUES(broader_external_uri), broader_external_uri),
          broader_preferred_label = COALESCE(VALUES(broader_preferred_label), broader_preferred_label),
          isco_group_code = COALESCE(VALUES(isco_group_code), isco_group_code),
          scheme_uris_json = COALESCE(VALUES(scheme_uris_json), scheme_uris_json),
          source_payload = COALESCE(VALUES(source_payload), source_payload)
      `,
      [
        this.runId,
        input.sourceFileId,
        this.config.sourceKind,
        this.config.sourceName,
        input.localeCode,
        clipNullable(input.externalId, 255),
        clip(input.externalUri, 500),
        clip(input.entityKind, 64),
        clipNullable(input.conceptType, 128),
        preferredLabel,
        normalizedLabel,
        input.description ?? null,
        input.definitionText ?? null,
        input.scopeNote ?? null,
        input.regulatedProfessionNote ?? null,
        clipNullable(input.broaderExternalUri, 500),
        clipNullable(input.broaderPreferredLabel, 500),
        clipNullable(input.iscoGroupCode, 64),
        input.schemeUris && input.schemeUris.length > 0 ? JSON.stringify(input.schemeUris) : null,
        input.sourcePayload ? JSON.stringify(input.sourcePayload) : null
      ]
    );

    return result.insertId;
  }

  private async upsertStubConcept(
    sourceFileId: number | null,
    localeCode: string,
    externalUri: string,
    conceptType: string | null,
    preferredLabel: string | null
  ): Promise<number> {
    return this.upsertConcept({
      sourceFileId,
      localeCode,
      externalUri,
      entityKind: guessEntityKind(conceptType, externalUri),
      conceptType,
      preferredLabel
    });
  }

  private async upsertAlias(
    sourceConceptId: number,
    sourceFileId: number | null,
    localeCode: string,
    alias: string | null | undefined,
    aliasType: string,
    isPreferred: boolean,
    sourcePayload: SourceRow | null
  ): Promise<void> {
    const trimmedAlias = alias?.trim();

    if (!trimmedAlias) {
      return;
    }

    const normalizedAlias = normalizeText(trimmedAlias);

    if (!normalizedAlias) {
      return;
    }

    await this.connection.execute(
      `
        INSERT INTO ose_source_aliases
          (
            source_concept_id,
            import_run_id,
            source_file_id,
            locale_code,
            alias,
            normalized_alias,
            alias_type,
            is_preferred,
            source_payload
          )
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          import_run_id = VALUES(import_run_id),
          source_file_id = COALESCE(VALUES(source_file_id), source_file_id),
          alias = VALUES(alias),
          alias_type = CASE
            WHEN VALUES(is_preferred) = 1 THEN VALUES(alias_type)
            ELSE COALESCE(alias_type, VALUES(alias_type))
          END,
          is_preferred = GREATEST(is_preferred, VALUES(is_preferred)),
          source_payload = COALESCE(source_payload, VALUES(source_payload))
      `,
      [
        sourceConceptId,
        this.runId,
        sourceFileId,
        localeCode,
        clip(trimmedAlias, 500),
        clip(normalizedAlias, 500),
        clipNullable(aliasType, 64),
        isPreferred ? 1 : 0,
        sourcePayload ? JSON.stringify(sourcePayload) : null
      ]
    );
  }

  private async upsertRelation(input: SourceRelationInput): Promise<void> {
    await this.connection.execute(
      `
        INSERT INTO ose_source_relations
          (
            import_run_id,
            source_file_id,
            source_kind,
            source_name,
            locale_code,
            relation_kind,
            relation_type,
            parent_external_uri,
            child_external_uri,
            parent_label,
            child_label,
            parent_entity_kind,
            child_entity_kind,
            weight,
            confidence,
            source_payload
          )
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          import_run_id = VALUES(import_run_id),
          source_file_id = COALESCE(VALUES(source_file_id), source_file_id),
          relation_type = COALESCE(VALUES(relation_type), relation_type),
          parent_label = COALESCE(VALUES(parent_label), parent_label),
          child_label = COALESCE(VALUES(child_label), child_label),
          parent_entity_kind = COALESCE(VALUES(parent_entity_kind), parent_entity_kind),
          child_entity_kind = COALESCE(VALUES(child_entity_kind), child_entity_kind),
          weight = COALESCE(VALUES(weight), weight),
          confidence = COALESCE(VALUES(confidence), confidence),
          source_payload = COALESCE(VALUES(source_payload), source_payload)
      `,
      [
        this.runId,
        input.sourceFileId,
        this.config.sourceKind,
        this.config.sourceName,
        input.localeCode,
        clip(input.relationKind, 64),
        clipNullable(input.relationType, 128),
        clip(input.parentExternalUri, 500),
        clip(input.childExternalUri, 500),
        clipNullable(input.parentLabel, 500),
        clipNullable(input.childLabel, 500),
        clipNullable(input.parentEntityKind, 64),
        clipNullable(input.childEntityKind, 64),
        input.weight ?? null,
        input.confidence ?? null,
        input.sourcePayload ? JSON.stringify(input.sourcePayload) : null
      ]
    );
  }

  private async insertMembership(sourceConceptId: number, collectionName: string, membershipType: string): Promise<void> {
    await this.connection.execute(
      `
        INSERT IGNORE INTO ose_source_memberships
          (source_concept_id, collection_name, membership_type)
        VALUES
          (?, ?, ?)
      `,
      [sourceConceptId, clip(collectionName, 128), clip(membershipType, 64)]
    );
  }
}

function detectFileFamily(fileName: string, localeCode: string): string {
  const localeSuffix = `_${localeCode}.csv`;

  if (fileName.endsWith(localeSuffix)) {
    return fileName.slice(0, -localeSuffix.length);
  }

  if (fileName.endsWith('.csv')) {
    return fileName.slice(0, -4);
  }

  return fileName;
}

function detectFileRole(fileFamily: string): FileRole {
  if (CONCEPT_FAMILIES.has(fileFamily)) {
    return fileFamily === 'conceptSchemes' ? 'scheme' : 'concept';
  }

  if (RELATION_FAMILIES.has(fileFamily)) {
    return 'relation';
  }

  if (fileFamily === 'dictionary') {
    return 'dictionary';
  }

  return 'metadata';
}

function extractExternalUri(fileFamily: string, row: SourceRow): string | null {
  switch (fileFamily) {
    case 'conceptSchemes':
      return row.conceptSchemeUri;
    case 'occupationSkillRelations':
      return row.occupationUri;
    case 'skillSkillRelations':
      return row.originalSkillUri;
    default:
      return row.conceptUri;
  }
}

function detectEntityKind(fileFamily: string, row: SourceRow): string {
  switch (fileFamily) {
    case 'occupations':
    case 'researchOccupationsCollection':
      return 'occupation';
    case 'skills':
    case 'transversalSkillsCollection':
    case 'researchSkillsCollection':
    case 'digitalSkillsCollection':
    case 'digCompSkillsCollection':
    case 'greenSkillsCollection':
      return 'skill';
    case 'languageSkillsCollection':
      return 'language_skill';
    case 'ISCOGroups':
      return 'occupation_group';
    case 'skillGroups':
      return 'skill_group';
    default:
      return guessEntityKind(row.conceptType, row.conceptUri);
  }
}

function guessEntityKind(conceptType: string | null | undefined, externalUri: string | null | undefined): string {
  const loweredType = (conceptType ?? '').toLowerCase();
  const loweredUri = (externalUri ?? '').toLowerCase();

  if (loweredType.includes('occupation') || loweredUri.includes('/occupation/')) {
    return 'occupation';
  }

  if (loweredType.includes('iscogroup') || loweredUri.includes('/isco/')) {
    return 'occupation_group';
  }

  if (loweredType.includes('skillgroup') || loweredUri.includes('/isced-f/')) {
    return 'skill_group';
  }

  if (loweredType.includes('conceptscheme') || loweredUri.includes('/concept-scheme/')) {
    return 'concept_scheme';
  }

  if (loweredType.includes('knowledge') || loweredUri.includes('/skill/')) {
    return 'skill';
  }

  return 'metadata';
}

function buildRowKey(fileFamily: string, localeCode: string, rowNumber: number, row: SourceRow): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        fileFamily,
        localeCode,
        rowNumber,
        row
      })
    )
    .digest('hex');
}

function splitAliasValues(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/\r?\n|\s+\|\s+/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function splitLineSeparatedValues(value: string | null | undefined): string[] {
  if (!value) {
    return [];
  }

  return value
    .split(/\r?\n|,/g)
    .map((item) => item.trim())
    .filter(Boolean);
}

function firstFromMultiValue(value: string | null | undefined): string | null {
  return splitAliasValues(value)[0] ?? null;
}

function firstNonEmpty(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return null;
}

function normalizeText(value: string): string {
  return normalizeSearchText(value);
}

function clip(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function clipNullable(value: string | null | undefined, maxLength: number): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed ? clip(trimmed, maxLength) : null;
}

function buildCollectionName(externalUri: string, preferredLabel: string | null): string {
  if (preferredLabel) {
    return `scheme:${preferredLabel}`;
  }

  const uriTail = deriveLabelFromUri(externalUri);
  return `scheme:${uriTail}`;
}

function deriveLabelFromUri(externalUri: string): string {
  return externalUri.split('/').pop() ?? externalUri;
}
