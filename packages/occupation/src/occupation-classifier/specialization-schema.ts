import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseCsvRecords } from '../utils/csv/parse-csv.js';
import { foldWeakPunctuationLookupText, tokenizeNormalizedText } from '../utils/texts.js';

export type SpecializationConceptRule = {
  conceptId: string;
  canonical: string;
};

export type SpecializationConceptAliasRule = {
  conceptId: string;
  alias: string;
  weakFoldedAlias: string;
  aliasTokens: readonly string[];
  priority: number;
  concept: SpecializationConceptRule;
};

export type SpecializationSchemaLookup = {
  conceptAliasesByFirstToken: ReadonlyMap<string, readonly SpecializationConceptAliasRule[]>;
  roleHeadAliasesByLocalToken: ReadonlyMap<string, readonly string[]>;
  maxConceptAliasTokenCount: number;
  maxRoleHeadAliasTokenCount: number;
};

const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'specialization', 'specialization-schema');
const CONCEPT_RULES_FILE = 'specialization-concept-rules.csv';
const CONCEPT_ALIASES_FILE = 'specialization-concept-aliases.csv';
const ROLE_HEAD_ALIASES_FILE = 'specialization-role-head-aliases.csv';

const cachedLookupsByLocale = new Map<string, Promise<SpecializationSchemaLookup>>();

export function loadSpecializationSchemaLookup(locale?: string): Promise<SpecializationSchemaLookup> {
  const cacheKey = locale?.trim().toLocaleLowerCase('en-US') ?? '';
  let cached = cachedLookupsByLocale.get(cacheKey);

  if (!cached) {
    cached = readSpecializationSchemaLookup(cacheKey);
    cachedLookupsByLocale.set(cacheKey, cached);
  }

  return cached;
}

async function readConceptAliasesCsv(locale: string): Promise<string> {
  const globalCsv = await readFile(path.join(SCHEMA_DIR, CONCEPT_ALIASES_FILE), 'utf8');

  if (!locale) {
    return globalCsv;
  }

  try {
    const localeCsv = await readFile(path.join(SCHEMA_DIR, `specialization-concept-aliases.${locale}.csv`), 'utf8');
    return `${globalCsv}\n${localeCsv}`;
  } catch {
    return globalCsv;
  }
}

async function readSpecializationSchemaLookup(locale: string): Promise<SpecializationSchemaLookup> {
  const [conceptRulesCsv, conceptAliasesCsv, roleHeadAliasesCsv] = await Promise.all([
    readFile(path.join(SCHEMA_DIR, CONCEPT_RULES_FILE), 'utf8'),
    readConceptAliasesCsv(locale),
    readFile(path.join(SCHEMA_DIR, ROLE_HEAD_ALIASES_FILE), 'utf8')
  ]);
  const conceptsById = new Map<string, SpecializationConceptRule>();

  for (const row of parseCsvRecords(conceptRulesCsv)) {
    const conceptId = value(row.concept_id);
    const canonical = foldWeakPunctuationLookupText(value(row.canonical));

    if (!conceptId || !canonical) {
      continue;
    }

    conceptsById.set(conceptId, {
      conceptId,
      canonical
    });
  }

  const mutableConceptAliases = new Map<string, SpecializationConceptAliasRule[]>();
  let maxConceptAliasTokenCount = 1;

  for (const row of parseCsvRecords(conceptAliasesCsv)) {
    const concept = conceptsById.get(value(row.concept_id));
    const weakFoldedAlias = foldWeakPunctuationLookupText(value(row.alias));

    if (!concept || !weakFoldedAlias) {
      continue;
    }

    const aliasTokens = tokenizeNormalizedText(weakFoldedAlias);

    if (aliasTokens.length === 0) {
      continue;
    }

    const rule: SpecializationConceptAliasRule = {
      conceptId: concept.conceptId,
      alias: value(row.alias),
      weakFoldedAlias,
      aliasTokens,
      priority: Number.parseInt(value(row.priority), 10) || 0,
      concept
    };
    const firstTokenRules = mutableConceptAliases.get(aliasTokens[0]) ?? [];
    firstTokenRules.push(rule);
    mutableConceptAliases.set(aliasTokens[0], firstTokenRules);
    maxConceptAliasTokenCount = Math.max(maxConceptAliasTokenCount, aliasTokens.length);
  }

  const roleHeadAliasesByLocalToken = new Map<string, Set<string>>();
  let maxRoleHeadAliasTokenCount = 1;

  for (const row of parseCsvRecords(roleHeadAliasesCsv)) {
    const roleHead = foldWeakPunctuationLookupText(value(row.role_head));
    const alias = foldWeakPunctuationLookupText(value(row.alias));

    if (!roleHead || !alias) {
      continue;
    }

    const aliases = roleHeadAliasesByLocalToken.get(alias) ?? new Set<string>();
    aliases.add(roleHead);
    roleHeadAliasesByLocalToken.set(alias, aliases);
    maxRoleHeadAliasTokenCount = Math.max(maxRoleHeadAliasTokenCount, tokenizeNormalizedText(alias).length);
  }

  return {
    conceptAliasesByFirstToken: freezeRuleMap(mutableConceptAliases),
    roleHeadAliasesByLocalToken: new Map(
      [...roleHeadAliasesByLocalToken.entries()].map(([token, roleHeads]) => [token, [...roleHeads].sort()])
    ),
    maxConceptAliasTokenCount,
    maxRoleHeadAliasTokenCount
  };
}

function freezeRuleMap(map: Map<string, SpecializationConceptAliasRule[]>): ReadonlyMap<string, readonly SpecializationConceptAliasRule[]> {
  return new Map(
    [...map.entries()].map(([token, rules]) => [
      token,
      rules.sort((left, right) => right.aliasTokens.length - left.aliasTokens.length || right.priority - left.priority)
    ])
  );
}

function value(input: string | null | undefined): string {
  return typeof input === 'string' ? input.trim() : '';
}
