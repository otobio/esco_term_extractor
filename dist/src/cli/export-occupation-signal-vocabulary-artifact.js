import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';
import { defaultOccupationSignalVocabularyAnchorCountsPath, defaultOccupationSignalVocabularyAnchorsPath, defaultOccupationSignalVocabularyEnglishTokenBitsPath, defaultOccupationSignalVocabularyManifestPath, defaultOccupationSignalVocabularyPhrasesPath, defaultOccupationSignalVocabularyTokensPath, buildBitSetBuffer, hashTokenSequence, hashVocabularyText, sortedHashBufferFromSortedValues, sortedHashValues, sortedHashBuffer, sortedAnchorBuffers } from '../runtime/occupation-signal-vocabulary-artifact.js';
import { isStopQueryToken } from '../query/query-preparation.js';
import { foldSearchText, tokenizeNormalizedText } from '../utils/texts.js';
import { BUILTIN_INTENT_VOCABULARY } from '../query/query-intent.js';
import { defaultRuntimeReviewJsonPath, runtimeReviewArtifactBaseName, writeRuntimeReviewJson } from '../runtime/runtime-review-artifacts.js';
const MAX_PHRASE_TOKENS = 5;
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const searchMetaArtifact = await loadOccupationSearchMetaArtifactRequired(options.sourceName);
    const vocabulary = buildVocabulary(searchMetaArtifact.getAllRecordsWithDetails());
    const manifestPath = path.resolve(options.outPath ?? defaultOccupationSignalVocabularyManifestPath(options.sourceName));
    const reviewJsonPath = options.reviewJsonOutPath ? path.resolve(options.reviewJsonOutPath) : null;
    const outputDir = path.dirname(manifestPath);
    const tokensPath = path.resolve(outputDir, path.basename(defaultOccupationSignalVocabularyTokensPath(options.sourceName)));
    const englishTokenBitsPath = path.resolve(outputDir, path.basename(defaultOccupationSignalVocabularyEnglishTokenBitsPath(options.sourceName)));
    const anchorsPath = path.resolve(outputDir, path.basename(defaultOccupationSignalVocabularyAnchorsPath(options.sourceName)));
    const anchorCountsPath = path.resolve(outputDir, path.basename(defaultOccupationSignalVocabularyAnchorCountsPath(options.sourceName)));
    const sortedTokenHashes = sortedHashValues(vocabulary.tokenHashes);
    const tokenBuffer = sortedHashBufferFromSortedValues(sortedTokenHashes);
    const englishTokenBits = buildBitSetBuffer(sortedTokenHashes, vocabulary.englishTokenHashes);
    const anchorBuffers = sortedAnchorBuffers(vocabulary.anchorHashes);
    const phraseFiles = Array.from(vocabulary.phraseHashesByTokenCount.entries())
        .sort(([left], [right]) => left - right)
        .map(([tokenCount, hashes]) => ({
        tokenCount,
        hashes,
        filePath: path.resolve(outputDir, path.basename(defaultOccupationSignalVocabularyPhrasesPath(options.sourceName, tokenCount)))
    }));
    await mkdir(outputDir, { recursive: true });
    await writeFile(tokensPath, tokenBuffer);
    await writeFile(englishTokenBitsPath, englishTokenBits);
    await writeFile(anchorsPath, anchorBuffers.hashes);
    await writeFile(anchorCountsPath, anchorBuffers.counts);
    for (const phraseFile of phraseFiles) {
        await writeFile(phraseFile.filePath, sortedHashBuffer(phraseFile.hashes));
    }
    const manifest = {
        schemaVersion: 2,
        sourceName: options.sourceName,
        generatedAt: new Date().toISOString(),
        hashAlgorithm: 'fnv1a64',
        maxPhraseTokenCount: MAX_PHRASE_TOKENS,
        tokenCount: vocabulary.tokenHashes.size,
        englishTokenCount: vocabulary.englishTokenHashes.size,
        anchorCount: anchorBuffers.count,
        tokensPath: path.relative(outputDir, tokensPath),
        englishTokenBitsPath: path.relative(outputDir, englishTokenBitsPath),
        anchorsPath: path.relative(outputDir, anchorsPath),
        anchorCountsPath: path.relative(outputDir, anchorCountsPath),
        phraseFiles: phraseFiles.map((phraseFile) => ({
            tokenCount: phraseFile.tokenCount,
            count: phraseFile.hashes.size,
            path: path.relative(outputDir, phraseFile.filePath)
        }))
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    if (reviewJsonPath) {
        await writeRuntimeReviewJson(reviewJsonPath, {
            sourceName: options.sourceName,
            tokens: [...vocabulary.tokens].sort(),
            anchors: [...vocabulary.anchorCounts.entries()]
                .map(([token, count]) => ({ token, count }))
                .sort((left, right) => right.count - left.count || left.token.localeCompare(right.token)),
            phrasesByTokenCount: Object.fromEntries([...vocabulary.phrasesByTokenCount.entries()]
                .sort(([left], [right]) => left - right)
                .map(([tokenCount, phrases]) => [String(tokenCount), [...phrases].sort()]))
        });
    }
    console.log(`Exported occupation signal vocabulary to ${manifestPath}`);
    if (reviewJsonPath) {
        console.log(`review_json=${reviewJsonPath}`);
    }
    console.log([
        `source=${manifest.sourceName}`,
        `tokens=${manifest.tokenCount}`,
        `english=${manifest.englishTokenCount}`,
        `anchors=${manifest.anchorCount}`,
        `phrases=${manifest.phraseFiles.map((file) => `${file.tokenCount}:${file.count}`).join(',')}`
    ].join('  '));
}
function buildVocabulary(records) {
    const tokens = new Set();
    const phrasesByTokenCount = new Map();
    const anchorCounts = new Map();
    const tokenHashes = new Set();
    const englishTokenHashes = new Set();
    const phraseHashesByTokenCount = new Map();
    const anchorHashes = new Map();
    for (const record of records) {
        addText(record.canonicalLabel, tokens, tokenHashes, phrasesByTokenCount, phraseHashesByTokenCount, englishTokenHashes);
        addOccupationAnchor(record.canonicalLabel, anchorCounts, anchorHashes);
        if (record.familyLabel) {
            addText(record.familyLabel, tokens, tokenHashes, phrasesByTokenCount, phraseHashesByTokenCount, englishTokenHashes);
        }
        if (record.groupLabel) {
            addText(record.groupLabel, tokens, tokenHashes, phrasesByTokenCount, phraseHashesByTokenCount, englishTokenHashes);
        }
        if (record.parentLabel) {
            addText(record.parentLabel, tokens, tokenHashes, phrasesByTokenCount, phraseHashesByTokenCount, englishTokenHashes);
        }
        for (const alias of record.aliases) {
            addText(alias.alias, tokens, tokenHashes, phrasesByTokenCount, phraseHashesByTokenCount, alias.localeCode === 'en' ? englishTokenHashes : null);
            addText(alias.normalizedAlias, tokens, tokenHashes, phrasesByTokenCount, phraseHashesByTokenCount, alias.localeCode === 'en' ? englishTokenHashes : null);
            addOccupationAnchor(alias.alias, anchorCounts, anchorHashes);
        }
        for (const capability of record.capabilityLabels) {
            addText(capability.label, tokens, tokenHashes, phrasesByTokenCount, phraseHashesByTokenCount);
            addText(capability.normalizedLabel, tokens, tokenHashes, phrasesByTokenCount, phraseHashesByTokenCount);
        }
    }
    addEnglishIntentVocabularyTerms(tokens, tokenHashes, englishTokenHashes, phrasesByTokenCount, phraseHashesByTokenCount);
    return {
        tokens,
        phrasesByTokenCount,
        anchorCounts,
        tokenHashes,
        englishTokenHashes,
        phraseHashesByTokenCount,
        anchorHashes
    };
}
function addEnglishIntentVocabularyTerms(tokens, tokenHashes, englishTokenHashes, phrasesByTokenCount, phraseHashesByTokenCount) {
    const englishProfile = BUILTIN_INTENT_VOCABULARY.resolveLocaleProfile?.('en') ?? BUILTIN_INTENT_VOCABULARY.localeProfiles.find((p) => p.localeCode === 'en');
    if (!englishProfile) {
        return;
    }
    for (const value of englishIntentVocabularyValues(englishProfile)) {
        addText(value, tokens, tokenHashes, phrasesByTokenCount, phraseHashesByTokenCount, englishTokenHashes);
    }
}
function englishIntentVocabularyValues(profile) {
    return [
        ...profile.roleHeadTerms,
        ...profile.roleModifierTerms,
        ...profile.domainModifierTerms,
        ...profile.credentialModifierTerms,
        ...profile.ambiguousModifierTerms,
        ...profile.rolePhrases,
        ...profile.domainPhrases
    ];
}
function addText(value, tokensOut, tokenHashes, phrasesOut, phraseHashesByTokenCount, englishTokenHashes = null) {
    if (!value) {
        return;
    }
    const tokens = tokenizeForVocabulary(value, 'unknown');
    if (tokens.length === 0) {
        return;
    }
    for (const token of tokens) {
        tokensOut.add(token);
        const hash = hashVocabularyText(token);
        tokenHashes.add(hash);
        if (englishTokenHashes) {
            englishTokenHashes.add(hash);
        }
    }
    for (const phrase of phraseWindows(tokens, MAX_PHRASE_TOKENS)) {
        getOrCreatePhraseSet(phrasesOut, phrase.length).add(phrase.join(' '));
        getOrCreateSet(phraseHashesByTokenCount, phrase.length).add(hashTokenSequence(phrase));
    }
}
function addOccupationAnchor(value, anchorCounts, anchorHashes) {
    if (!value) {
        return;
    }
    const tokens = tokenizeForVocabulary(value, 'unknown');
    const lastToken = tokens[tokens.length - 1];
    if (!lastToken || lastToken.length < 3) {
        return;
    }
    const hash = hashVocabularyText(lastToken);
    anchorCounts.set(lastToken, (anchorCounts.get(lastToken) ?? 0) + 1);
    anchorHashes.set(hash, (anchorHashes.get(hash) ?? 0) + 1);
}
function phraseWindows(tokens, maxWindow) {
    const phrases = [];
    const boundedMaxWindow = Math.min(tokens.length, maxWindow);
    for (let windowSize = 2; windowSize <= boundedMaxWindow; windowSize += 1) {
        for (let start = 0; start <= tokens.length - windowSize; start += 1) {
            phrases.push(tokens.slice(start, start + windowSize));
        }
    }
    return phrases;
}
function tokenizeForVocabulary(value, locale) {
    return tokenizeNormalizedText(foldSearchText(value)).filter((token) => token.length >= 2 && !isStopQueryToken(token, locale));
}
function getOrCreateSet(map, key) {
    let existing = map.get(key);
    if (!existing) {
        existing = new Set();
        map.set(key, existing);
    }
    return existing;
}
function getOrCreatePhraseSet(map, key) {
    let existing = map.get(key);
    if (!existing) {
        existing = new Set();
        map.set(key, existing);
    }
    return existing;
}
function parseCliOptions(args) {
    const options = {
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        outPath: null,
        reviewJsonOutPath: defaultRuntimeReviewJsonPath(runtimeReviewArtifactBaseName('occupation-signal-vocabulary', DEFAULT_ESCO_SOURCE_NAME))
    };
    for (const arg of args) {
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
            options.reviewJsonOutPath = defaultRuntimeReviewJsonPath(runtimeReviewArtifactBaseName('occupation-signal-vocabulary', options.sourceName));
            continue;
        }
        if (arg.startsWith('--out=')) {
            options.outPath = arg.slice('--out='.length).trim();
            continue;
        }
        if (arg.startsWith('--review-json-out=')) {
            options.reviewJsonOutPath = arg.slice('--review-json-out='.length).trim();
            continue;
        }
        if (arg === '--no-review-json') {
            options.reviewJsonOutPath = null;
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
function printHelp() {
    console.log([
        'Usage: node dist/cli/export-occupation-signal-vocabulary-artifact.js',
        `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
        '[--out=artifacts/runtime/occupation-signal-vocabulary.esco_1_2_1.manifest.json]',
        '[--review-json-out=data/runtime-review/occupation-signal-vocabulary.esco_1_2_1.json]',
        '[--no-review-json]'
    ].join(' '));
}
main().catch((error) => {
    console.error('Occupation signal vocabulary export failed.');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
