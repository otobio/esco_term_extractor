import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parseCsvRecords } from '../utils/csv/parse-csv.js';
import { foldWeakPunctuationLookupText, tokenizeNormalizedText } from '../utils/texts.js';
const SCHEMA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'specialization', 'specialization-schema');
const CONCEPT_RULES_FILE = 'specialization-concept-rules.csv';
const CONCEPT_ALIASES_FILE = 'specialization-concept-aliases.csv';
const ROLE_HEAD_ALIASES_FILE = 'specialization-role-head-aliases.csv';
const cachedLookupsByLocale = new Map();
export function loadSpecializationSchemaLookup(locale) {
    const cacheKey = locale?.trim().toLocaleLowerCase('en-US') ?? '';
    let cached = cachedLookupsByLocale.get(cacheKey);
    if (!cached) {
        cached = readSpecializationSchemaLookup(cacheKey);
        cachedLookupsByLocale.set(cacheKey, cached);
    }
    return cached;
}
async function readConceptAliasesCsv(locale) {
    const globalCsv = await readFile(path.join(SCHEMA_DIR, CONCEPT_ALIASES_FILE), 'utf8');
    if (!locale) {
        return globalCsv;
    }
    try {
        const localeCsv = await readFile(path.join(SCHEMA_DIR, `specialization-concept-aliases.${locale}.csv`), 'utf8');
        return `${globalCsv}\n${localeCsv}`;
    }
    catch {
        return globalCsv;
    }
}
async function readSpecializationSchemaLookup(locale) {
    const [conceptRulesCsv, conceptAliasesCsv, roleHeadAliasesCsv] = await Promise.all([
        readFile(path.join(SCHEMA_DIR, CONCEPT_RULES_FILE), 'utf8'),
        readConceptAliasesCsv(locale),
        readFile(path.join(SCHEMA_DIR, ROLE_HEAD_ALIASES_FILE), 'utf8')
    ]);
    const conceptsById = new Map();
    for (const row of parseCsvRecords(conceptRulesCsv)) {
        const conceptId = value(row.concept_id);
        const canonical = foldWeakPunctuationLookupText(value(row.canonical));
        if (!conceptId || !canonical) {
            continue;
        }
        conceptsById.set(conceptId, {
            conceptId,
            canonical,
            dimension: value(row.dimension)
        });
    }
    const mutableConceptAliases = new Map();
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
        const rule = {
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
    const roleHeadAliasesByLocalToken = new Map();
    let maxRoleHeadAliasTokenCount = 1;
    for (const row of parseCsvRecords(roleHeadAliasesCsv)) {
        const roleHead = foldWeakPunctuationLookupText(value(row.role_head));
        const alias = foldWeakPunctuationLookupText(value(row.alias));
        if (!roleHead || !alias) {
            continue;
        }
        const aliases = roleHeadAliasesByLocalToken.get(alias) ?? new Set();
        aliases.add(roleHead);
        roleHeadAliasesByLocalToken.set(alias, aliases);
        maxRoleHeadAliasTokenCount = Math.max(maxRoleHeadAliasTokenCount, tokenizeNormalizedText(alias).length);
    }
    return {
        conceptAliasesByFirstToken: freezeRuleMap(mutableConceptAliases),
        roleHeadAliasesByLocalToken: new Map([...roleHeadAliasesByLocalToken.entries()].map(([token, roleHeads]) => [token, [...roleHeads].sort()])),
        maxConceptAliasTokenCount,
        maxRoleHeadAliasTokenCount
    };
}
function freezeRuleMap(map) {
    return new Map([...map.entries()].map(([token, rules]) => [
        token,
        rules.sort((left, right) => right.aliasTokens.length - left.aliasTokens.length || right.priority - left.priority)
    ]));
}
function value(input) {
    return typeof input === 'string' ? input.trim() : '';
}
