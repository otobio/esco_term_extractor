import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { aliasRoleScoreFactor, CANONICAL_ALIAS_ROLE, isSearchAliasRole } from '../query/alias-role-policy.js';
import { defaultOccupationFamilyTokenRelevanceArtifactPath } from '../query/occupation-family-token-relevance.js';
import { foldSearchText, tokenizeNormalizedText } from '../query/query-preparation.js';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';
import { roundScore } from '../utils/operators.js';
const KNOWN_LOCALES = ['en', 'ro', 'hu', 'et'];
const LOW_CONFIDENCE_LOCALES = new Set(['hu', 'et']);
const MIN_FAMILY_TOKEN_OCCURRENCES = 2;
const MAX_TOKENS_PER_FAMILY = 500;
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const searchMetaArtifact = await loadOccupationSearchMetaArtifactRequired(options.sourceName);
    const artifact = buildOccupationFamilyTokenRelevanceArtifact(searchMetaArtifact.getAllRecordsWithDetails(), options.sourceName);
    const outPath = path.resolve(options.outPath);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    const familyCount = artifact.familiesByLocale.en?.length ?? 0;
    console.log(`Exported family-token relevance for ${familyCount} families across locales=${artifact.locales.join(',')} to ${outPath}`);
    console.log(`source=${options.sourceName} total_families=${artifact.totalFamilies}`);
}
function parseCliOptions(args) {
    const options = {
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        outPath: defaultOccupationFamilyTokenRelevanceArtifactPath(DEFAULT_ESCO_SOURCE_NAME)
    };
    let outPathExplicit = false;
    for (const arg of args) {
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
            continue;
        }
        if (arg.startsWith('--out=')) {
            options.outPath = arg.slice('--out='.length).trim();
            outPathExplicit = true;
            continue;
        }
        if (arg === '--help') {
            printHelp();
            process.exit(0);
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    if (!outPathExplicit) {
        options.outPath = defaultOccupationFamilyTokenRelevanceArtifactPath(options.sourceName);
    }
    return options;
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/export-occupation-family-token-relevance-artifact.js',
        `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
        `[--out=${defaultOccupationFamilyTokenRelevanceArtifactPath(DEFAULT_ESCO_SOURCE_NAME)}]`
    ].join(' '));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Occupation family-token relevance artifact export failed.');
    console.error(message);
    process.exitCode = 1;
});
function buildOccupationFamilyTokenRelevanceArtifact(records, sourceName) {
    const totalFamilies = new Set(records.map((record) => record.familyNodeId).filter((id) => id !== null)).size;
    const familiesByLocale = {};
    const genericityByLocale = {};
    for (const locale of KNOWN_LOCALES) {
        const { families, genericity } = buildLocaleFamilies(records, locale, totalFamilies);
        familiesByLocale[locale] = families;
        genericityByLocale[locale] = genericity;
    }
    return {
        schemaVersion: 1,
        sourceName,
        generatedAt: new Date().toISOString(),
        totalFamilies,
        locales: KNOWN_LOCALES,
        lowConfidenceLocales: KNOWN_LOCALES.filter((locale) => LOW_CONFIDENCE_LOCALES.has(locale)),
        familiesByLocale,
        genericityByLocale
    };
}
function buildLocaleFamilies(records, locale, totalFamilies) {
    const accumulatorsByFamily = new Map();
    for (const record of records) {
        if (record.familyNodeId === null || !record.familyLabel) {
            continue;
        }
        const accumulator = familyAccumulator(accumulatorsByFamily, record.familyNodeId, record.familyLabel);
        accumulator.leafCount += 1;
        if (locale === 'en') {
            addTokenOccurrences(accumulator, record.canonicalLabel, aliasRoleScoreFactor(CANONICAL_ALIAS_ROLE));
        }
        for (const alias of record.aliases) {
            if (alias.localeCode !== locale || !isSearchAliasRole(alias.aliasRole, true)) {
                continue;
            }
            const text = alias.normalizedAlias.trim() || alias.alias.trim();
            addTokenOccurrences(accumulator, text, aliasRoleScoreFactor(alias.aliasRole));
        }
    }
    const documentFrequency = new Map();
    for (const accumulator of accumulatorsByFamily.values()) {
        for (const [token, matchCount] of accumulator.tokenMatchCounts) {
            if (matchCount >= MIN_FAMILY_TOKEN_OCCURRENCES) {
                documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
            }
        }
    }
    const genericity = {};
    const families = Array.from(accumulatorsByFamily.values())
        .map((accumulator) => {
        const totalTokenOccurrences = sumOccurrences(accumulator.tokenOccurrences);
        const rankedTokens = Array.from(accumulator.tokenOccurrences.entries())
            .filter(([token]) => (accumulator.tokenMatchCounts.get(token) ?? 0) >= MIN_FAMILY_TOKEN_OCCURRENCES)
            .sort(([, left], [, right]) => right - left)
            .slice(0, MAX_TOKENS_PER_FAMILY);
        const tokens = {};
        for (const [token, occurrences] of rankedTokens) {
            const tfRatio = totalTokenOccurrences > 0 ? occurrences / totalTokenOccurrences : 0;
            const df = documentFrequency.get(token) ?? 0;
            const idf = Math.log(1 + (totalFamilies + 1) / (df + 1));
            const relevance = tfRatio * idf;
            tokens[token] = {
                occurrences: roundScore(occurrences),
                tfRatio: roundScore(tfRatio),
                documentFrequency: df,
                relevance: roundScore(relevance)
            };
            const existingGenericity = genericity[token];
            if (!existingGenericity || relevance > existingGenericity.maxRelevance) {
                genericity[token] = {
                    documentFrequency: df,
                    maxRelevance: roundScore(relevance),
                    maxRelevanceFamilyNodeId: accumulator.familyNodeId
                };
            }
            else {
                existingGenericity.documentFrequency = df;
            }
        }
        return {
            familyNodeId: accumulator.familyNodeId,
            familyLabel: accumulator.familyLabel,
            leafCount: accumulator.leafCount,
            totalTokenOccurrences: roundScore(totalTokenOccurrences),
            tokens
        };
    })
        .sort((left, right) => left.familyNodeId - right.familyNodeId);
    return { families, genericity };
}
function familyAccumulator(accumulatorsByFamily, familyNodeId, familyLabel) {
    let accumulator = accumulatorsByFamily.get(familyNodeId);
    if (!accumulator) {
        accumulator = { familyNodeId, familyLabel, leafCount: 0, tokenOccurrences: new Map(), tokenMatchCounts: new Map() };
        accumulatorsByFamily.set(familyNodeId, accumulator);
    }
    return accumulator;
}
function addTokenOccurrences(accumulator, text, weight) {
    const tokens = tokenizeNormalizedText(foldSearchText(text));
    for (const token of tokens) {
        accumulator.tokenOccurrences.set(token, (accumulator.tokenOccurrences.get(token) ?? 0) + weight);
        accumulator.tokenMatchCounts.set(token, (accumulator.tokenMatchCounts.get(token) ?? 0) + 1);
    }
}
function sumOccurrences(tokenOccurrences) {
    let total = 0;
    for (const occurrences of tokenOccurrences.values()) {
        total += occurrences;
    }
    return total;
}
