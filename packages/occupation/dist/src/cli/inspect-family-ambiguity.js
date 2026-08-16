import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';
import { foldSearchText, tokenizeNormalizedText } from '../utils/texts.js';
const TOKEN_WEIGHT = 1;
const PHRASE_WEIGHT = 2.5;
const ROLE_HEAD_WEIGHT = 3;
const MAX_SAMPLES_PER_FAMILY = 8;
const MAX_ALIASES_PER_LEAF = 8;
const STOP_TOKENS = new Set([
    'and',
    'the',
    'for',
    'with',
    'in',
    'of',
    'to',
    'other',
    'related',
    'not',
    'elsewhere',
    'classified',
    'workers',
    'worker',
    'professionals',
    'professional',
    'associate',
    'associates'
]);
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const artifact = await loadOccupationSearchMetaArtifactRequired(options.sourceName);
    const families = buildFamilyProfiles(artifact);
    const tokenFamilyCounts = familyCountsFor(families, (family) => family.tokenCounts);
    const phraseFamilyCounts = familyCountsFor(families, (family) => family.phraseCounts);
    const roleHeadFamilyCounts = familyCountsFor(families, (family) => family.roleHeads);
    const pairs = scoreAmbiguousPairs(families, {
        tokenFamilyCounts,
        phraseFamilyCounts,
        roleHeadFamilyCounts,
        maxTermFamilyCount: options.maxTermFamilyCount
    }).slice(0, options.limit);
    const report = {
        sourceName: options.sourceName,
        generatedAt: new Date().toISOString(),
        familyCount: families.length,
        leafCount: families.reduce((total, family) => total + family.leafCount, 0),
        pairCount: pairs.length,
        scoring: {
            maxTermFamilyCount: options.maxTermFamilyCount,
            tokenWeight: TOKEN_WEIGHT,
            phraseWeight: PHRASE_WEIGHT,
            roleHeadWeight: ROLE_HEAD_WEIGHT
        },
        pairs
    };
    await mkdir(path.dirname(options.outPath), { recursive: true });
    await writeFile(options.outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${pairs.length} ambiguous family pairs to ${options.outPath}`);
    console.log(`source=${options.sourceName} families=${report.familyCount} leaves=${report.leafCount}`);
    for (const pair of pairs.slice(0, Math.min(10, pairs.length))) {
        const shared = [
            ...pair.sharedRoleHeads.slice(0, 3).map((term) => `head:${term.term}`),
            ...pair.sharedPhrases.slice(0, 3).map((term) => `phrase:${term.term}`),
            ...pair.sharedTokens.slice(0, 3).map((term) => `token:${term.term}`)
        ].join(', ');
        console.log(`${pair.score.toFixed(3)}  ${pair.leftFamilyLabel}  <->  ${pair.rightFamilyLabel}  [${shared}]`);
    }
}
function buildFamilyProfiles(artifact) {
    const profilesByFamilyId = new Map();
    for (const record of artifact.getAllCoreRecords()) {
        if (record.familyNodeId === null || !record.familyLabel) {
            continue;
        }
        const profile = profilesByFamilyId.get(record.familyNodeId) ?? {
            familyNodeId: record.familyNodeId,
            familyLabel: record.familyLabel,
            leafCount: 0,
            sampleLabels: [],
            tokenCounts: new Map(),
            phraseCounts: new Map(),
            roleHeads: new Map()
        };
        profilesByFamilyId.set(record.familyNodeId, profile);
        profile.leafCount += 1;
        addSurface(profile, record.canonicalLabel);
        for (const alias of artifact
            .getAliases(record.graphNodeId)
            .filter((candidate) => candidate.localeCode === 'en')
            .slice(0, MAX_ALIASES_PER_LEAF)) {
            addSurface(profile, alias.normalizedAlias || alias.alias);
        }
        if (profile.sampleLabels.length < MAX_SAMPLES_PER_FAMILY && !profile.sampleLabels.includes(record.canonicalLabel)) {
            profile.sampleLabels.push(record.canonicalLabel);
        }
    }
    return Array.from(profilesByFamilyId.values()).sort((left, right) => left.familyLabel.localeCompare(right.familyLabel));
}
function addSurface(profile, label) {
    const tokens = meaningfulTokens(label);
    for (const token of tokens) {
        increment(profile.tokenCounts, token, 1);
    }
    for (const phrase of phrases(tokens, 2)) {
        increment(profile.phraseCounts, phrase, 1);
    }
    for (const phrase of phrases(tokens, 3)) {
        increment(profile.phraseCounts, phrase, 1);
    }
    const head = tokens.at(-1);
    if (head) {
        increment(profile.roleHeads, head, 1);
    }
}
function scoreAmbiguousPairs(families, context) {
    const pairs = [];
    for (let leftIndex = 0; leftIndex < families.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < families.length; rightIndex += 1) {
            const left = families[leftIndex];
            const right = families[rightIndex];
            const sharedRoleHeads = sharedWeightedTerms(left, right, (family) => family.roleHeads, context.roleHeadFamilyCounts, context.maxTermFamilyCount, ROLE_HEAD_WEIGHT);
            const sharedPhrases = sharedWeightedTerms(left, right, (family) => family.phraseCounts, context.phraseFamilyCounts, context.maxTermFamilyCount, PHRASE_WEIGHT);
            const sharedTokens = sharedWeightedTerms(left, right, (family) => family.tokenCounts, context.tokenFamilyCounts, context.maxTermFamilyCount, TOKEN_WEIGHT);
            const score = roundScore(sharedRoleHeads.reduce((total, term) => total + term.score, 0) +
                sharedPhrases.reduce((total, term) => total + term.score, 0) +
                sharedTokens.reduce((total, term) => total + term.score, 0));
            if (score <= 0) {
                continue;
            }
            pairs.push({
                leftFamilyNodeId: left.familyNodeId,
                leftFamilyLabel: left.familyLabel,
                rightFamilyNodeId: right.familyNodeId,
                rightFamilyLabel: right.familyLabel,
                score,
                sharedRoleHeads: sharedRoleHeads.slice(0, 12),
                sharedPhrases: sharedPhrases.slice(0, 12),
                sharedTokens: sharedTokens.slice(0, 12),
                leftSampleLabels: left.sampleLabels,
                rightSampleLabels: right.sampleLabels
            });
        }
    }
    return pairs.sort((left, right) => right.score - left.score ||
        left.leftFamilyLabel.localeCompare(right.leftFamilyLabel) ||
        left.rightFamilyLabel.localeCompare(right.rightFamilyLabel));
}
function sharedWeightedTerms(left, right, selector, familyCounts, maxTermFamilyCount, weight) {
    const terms = [];
    const leftTerms = selector(left);
    const rightTerms = selector(right);
    for (const [term, leftCount] of leftTerms) {
        const rightCount = rightTerms.get(term);
        if (!rightCount) {
            continue;
        }
        const familyCount = familyCounts.get(term) ?? 0;
        if (familyCount < 2 || familyCount > maxTermFamilyCount) {
            continue;
        }
        const leftFrequency = leftCount / Math.max(left.leafCount, 1);
        const rightFrequency = rightCount / Math.max(right.leafCount, 1);
        const inverseFamilyFrequency = Math.log1p(maxTermFamilyCount / familyCount);
        terms.push({
            term,
            score: roundScore(Math.sqrt(leftFrequency * rightFrequency) * inverseFamilyFrequency * weight),
            leftCount,
            rightCount,
            familyCount
        });
    }
    return terms
        .filter((term) => term.score > 0)
        .sort((leftTerm, rightTerm) => rightTerm.score - leftTerm.score || leftTerm.familyCount - rightTerm.familyCount || leftTerm.term.localeCompare(rightTerm.term));
}
function familyCountsFor(families, selector) {
    const counts = new Map();
    for (const family of families) {
        for (const term of selector(family).keys()) {
            increment(counts, term, 1);
        }
    }
    return counts;
}
function meaningfulTokens(label) {
    return tokenizeNormalizedText(foldSearchText(label))
        .filter((token) => token.length >= 3)
        .filter((token) => !STOP_TOKENS.has(token));
}
function phrases(tokens, size) {
    const output = [];
    for (let index = 0; index <= tokens.length - size; index += 1) {
        output.push(tokens.slice(index, index + size).join(' '));
    }
    return output;
}
function increment(map, key, amount) {
    map.set(key, (map.get(key) ?? 0) + amount);
}
function roundScore(value) {
    return Number(value.toFixed(6));
}
function parseCliOptions(args) {
    const options = {
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        outPath: path.join('artifacts', 'analysis', `family-ambiguity.${DEFAULT_ESCO_SOURCE_NAME}.json`),
        limit: 100,
        maxTermFamilyCount: 12
    };
    for (const arg of args) {
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
            options.outPath = path.join('artifacts', 'analysis', `family-ambiguity.${options.sourceName}.json`);
            continue;
        }
        if (arg.startsWith('--out=')) {
            options.outPath = arg.slice('--out='.length).trim();
            continue;
        }
        if (arg.startsWith('--limit=')) {
            options.limit = parsePositiveInteger(arg.slice('--limit='.length), '--limit');
            continue;
        }
        if (arg.startsWith('--max-term-family-count=')) {
            options.maxTermFamilyCount = parsePositiveInteger(arg.slice('--max-term-family-count='.length), '--max-term-family-count');
            continue;
        }
        if (arg === '--help') {
            printHelp();
            process.exit(0);
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    return options;
}
function parsePositiveInteger(value, label) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${label} must be a positive integer.`);
    }
    return parsed;
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/inspect-family-ambiguity.js',
        `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
        '[--out=artifacts/analysis/family-ambiguity.esco_1_2_1.json]',
        '[--limit=100]',
        '[--max-term-family-count=12]'
    ].join(' '));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Family ambiguity inspection failed.');
    console.error(message);
    process.exitCode = 1;
});
