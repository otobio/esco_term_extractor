import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { foldSearchText } from '../utils/texts.js';
import {
  loadEscoRelatedTermsArtifactRequired,
  lookupObjectRelatedTerms,
  lookupVerbRelatedTerms,
  type EscoRelatedTermDirection as EscoRelatedTermBinaryDirection,
  type EscoRelatedTermBinaryRecord
} from '../runtime/esco-related-terms-artifact.js';

export type EscoRelatedTermDirection = 'forward' | 'reverse';

export type EscoRelatedVerb = {
  queryVerb: string;
  relatedVerb: string;
  relationshipType: string;
  direction: EscoRelatedTermDirection;
  evidenceCount: number;
  sourceLabelExamples: string[];
  relatedLabelExamples: string[];
};

export type EscoRelatedObject = {
  queryObject: string;
  relatedObject: string;
  relationshipType: string;
  direction: EscoRelatedTermDirection;
  evidenceCount: number;
  sourceLabelExamples: string[];
  relatedLabelExamples: string[];
};

export type GiveVerbSynonymOptions = {
  sourceName?: string;
  locale?: string;
  limit?: number;
};

export type GiveObjectRelatedOptions = {
  sourceName?: string;
  locale?: string;
  limit?: number;
};

type RelatedTermInputRow = {
  source_term: string;
  related_term: string;
  relationship_type: string;
  evidence_count: number;
  direction: EscoRelatedTermDirection;
  source_skill_ids_json: string;
  related_skill_ids_json: string;
  source_skill_uris_json: string;
  related_skill_uris_json: string;
  source_label_examples_json: string;
  related_label_examples_json: string;
};

type RelatedTermRecord = {
  queryTerm: string;
  relatedTerm: string;
  relationshipType: string;
  direction: EscoRelatedTermDirection;
  evidenceCount: number;
  sourceLabelExamples: string[];
  relatedLabelExamples: string[];
};

type RelatedObjectRecord = {
  queryTerm: string;
  relatedTerm: string;
  relationshipType: string;
  direction: EscoRelatedTermDirection;
  evidenceCount: number;
  sourceLabelExamples: string[];
  relatedLabelExamples: string[];
};

const DEFAULT_RESULT_LIMIT = 25;

export async function giveVerbSynonym(verb: string, options: GiveVerbSynonymOptions = {}): Promise<EscoRelatedVerb[]> {
  const queryVerb = normalizeTermInput(verb);

  if (!queryVerb) {
    throw new Error('giveVerbSynonym requires a non-empty verb.');
  }

  const sourceName = options.sourceName?.trim() || DEFAULT_ESCO_SOURCE_NAME;
  const locale = options.locale?.trim() || 'en';
  const limit = normalizeLimit(options.limit);
  const artifact = await loadEscoRelatedTermsArtifactRequired(sourceName, locale);
  return lookupVerbRelatedTerms(artifact, queryVerb, limit).map((row) => toVerbResult(queryVerb, row));
}

export async function giveObjectRelated(object: string, options: GiveObjectRelatedOptions = {}): Promise<EscoRelatedObject[]> {
  const queryObject = normalizeTermInput(object);

  if (!queryObject) {
    throw new Error('giveObjectRelated requires a non-empty object.');
  }

  const sourceName = options.sourceName?.trim() || DEFAULT_ESCO_SOURCE_NAME;
  const locale = options.locale?.trim() || 'en';
  const limit = normalizeLimit(options.limit);
  const artifact = await loadEscoRelatedTermsArtifactRequired(sourceName, locale);
  return lookupObjectRelatedTerms(artifact, queryObject, limit).map((row) => toObjectResult(queryObject, row));
}

export function mergeVerbRelatedRows(queryVerb: string, rows: RelatedTermInputRow[]): EscoRelatedVerb[] {
  return mergeRelatedRows(queryVerb, rows).map((row) => ({
    queryVerb,
    relatedVerb: row.relatedTerm,
    relationshipType: row.relationshipType,
    direction: row.direction,
    evidenceCount: row.evidenceCount,
    sourceLabelExamples: row.sourceLabelExamples,
    relatedLabelExamples: row.relatedLabelExamples
  }));
}

export function mergeObjectRelatedRows(queryObject: string, rows: RelatedTermInputRow[]): EscoRelatedObject[] {
  return mergeRelatedRows(queryObject, rows).map((row) => ({
    queryObject,
    relatedObject: row.relatedTerm,
    relationshipType: row.relationshipType,
    direction: row.direction,
    evidenceCount: row.evidenceCount,
    sourceLabelExamples: row.sourceLabelExamples,
    relatedLabelExamples: row.relatedLabelExamples
  }));
}

function mergeRelatedRows(queryTerm: string, rows: RelatedTermInputRow[]): RelatedTermRecord[] {
  const byKey = new Map<string, RelatedTermRecord>();

  for (const row of rows) {
    const querySideIsSource = row.source_term === queryTerm;
    const querySideIsRelated = row.related_term === queryTerm;

    if (!querySideIsSource && !querySideIsRelated) {
      continue;
    }

    const relatedTerm = querySideIsSource ? row.related_term : row.source_term;
    const sourceLabelExamples = parseStringArray(querySideIsSource ? row.source_label_examples_json : row.related_label_examples_json);
    const relatedLabelExamples = parseStringArray(querySideIsSource ? row.related_label_examples_json : row.source_label_examples_json);
    const key = `${row.relationship_type}\u0000${relatedTerm}`;
    const current = byKey.get(key);

    const next: RelatedTermRecord = {
      queryTerm,
      relatedTerm,
      relationshipType: row.relationship_type,
      direction: row.direction,
      evidenceCount: Number(row.evidence_count) || 0,
      sourceLabelExamples,
      relatedLabelExamples
    };

    if (!current) {
      byKey.set(key, next);
      continue;
    }

    const merged: RelatedTermRecord = {
      queryTerm,
      relatedTerm: current.relatedTerm,
      relationshipType: current.relationshipType,
      direction: current.direction === 'forward' ? 'forward' : next.direction,
      evidenceCount: Math.max(current.evidenceCount, next.evidenceCount),
      sourceLabelExamples: mergeUniqueStrings(current.sourceLabelExamples, next.sourceLabelExamples),
      relatedLabelExamples: mergeUniqueStrings(current.relatedLabelExamples, next.relatedLabelExamples)
    };

    byKey.set(key, merged);
  }

  return [...byKey.values()].sort(
    (left, right) =>
      right.evidenceCount - left.evidenceCount ||
      left.relationshipType.localeCompare(right.relationshipType) ||
      left.relatedTerm.localeCompare(right.relatedTerm) ||
      left.direction.localeCompare(right.direction)
  );
}

function toVerbResult(queryVerb: string, row: EscoRelatedTermBinaryRecord): EscoRelatedVerb {
  return {
    queryVerb,
    relatedVerb: row.relatedTerm,
    relationshipType: row.relationshipType,
    direction: row.direction as EscoRelatedTermBinaryDirection,
    evidenceCount: row.evidenceCount,
    sourceLabelExamples: row.sourceLabelExamples,
    relatedLabelExamples: row.relatedLabelExamples
  };
}

function toObjectResult(queryObject: string, row: EscoRelatedTermBinaryRecord): EscoRelatedObject {
  return {
    queryObject,
    relatedObject: row.relatedTerm,
    relationshipType: row.relationshipType,
    direction: row.direction as EscoRelatedTermBinaryDirection,
    evidenceCount: row.evidenceCount,
    sourceLabelExamples: row.sourceLabelExamples,
    relatedLabelExamples: row.relatedLabelExamples
  };
}

function parseStringArray(value: string | string[] | unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }

  if (typeof value !== 'string') {
    return [];
  }

  const parsed: unknown = JSON.parse(value);

  if (!Array.isArray(parsed)) {
    return [];
  }

  return parsed.filter((item): item is string => typeof item === 'string');
}

function mergeUniqueStrings(left: string[], right: string[]): string[] {
  return [...new Set([...left, ...right])].sort((a, b) => a.localeCompare(b));
}

function normalizeTermInput(value: string): string {
  return foldSearchText(value).trim();
}

function normalizeLimit(value: number | undefined): number {
  if (!Number.isInteger(value) || !value || value < 1) {
    return DEFAULT_RESULT_LIMIT;
  }

  return value;
}
