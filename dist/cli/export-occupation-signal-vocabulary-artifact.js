import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { loadOccupationSearchMetaArtifactWithDetailsRequired } from '../runtime/occupation-search-meta-artifact.js';
import { defaultOccupationSignalVocabularyAnchorCountsPath, defaultOccupationSignalVocabularyAnchorsPath, defaultOccupationSignalVocabularyManifestPath, defaultOccupationSignalVocabularyPhrasesPath, defaultOccupationSignalVocabularyTokensPath, hashTokenSequence, hashVocabularyText, sortedAnchorBuffers, sortedHashBuffer } from '../runtime/occupation-signal-vocabulary-artifact.js';
import { foldSearchText, isStopQueryToken, tokenizeNormalizedText } from '../query/query-preparation.js';
const MAX_PHRASE_TOKENS = 5;
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const searchMetaArtifact = await loadOccupationSearchMetaArtifactWithDetailsRequired(options.sourceName);
    const vocabulary = buildVocabulary(searchMetaArtifact.artifact.records);
    const manifestPath = path.resolve(options.outPath ?? defaultOccupationSignalVocabularyManifestPath(options.sourceName));
    const outputDir = path.dirname(manifestPath);
    const tokensPath = path.resolve(outputDir, path.basename(defaultOccupationSignalVocabularyTokensPath(options.sourceName)));
    const anchorsPath = path.resolve(outputDir, path.basename(defaultOccupationSignalVocabularyAnchorsPath(options.sourceName)));
    const anchorCountsPath = path.resolve(outputDir, path.basename(defaultOccupationSignalVocabularyAnchorCountsPath(options.sourceName)));
    const tokenBuffer = sortedHashBuffer(vocabulary.tokenHashes);
    const anchorBuffers = sortedAnchorBuffers(vocabulary.anchorCounts);
    const phraseFiles = Array.from(vocabulary.phraseHashesByTokenCount.entries())
        .sort(([left], [right]) => left - right)
        .map(([tokenCount, hashes]) => ({
        tokenCount,
        hashes,
        filePath: path.resolve(outputDir, path.basename(defaultOccupationSignalVocabularyPhrasesPath(options.sourceName, tokenCount)))
    }));
    await mkdir(outputDir, { recursive: true });
    await writeFile(tokensPath, tokenBuffer);
    await writeFile(anchorsPath, anchorBuffers.hashes);
    await writeFile(anchorCountsPath, anchorBuffers.counts);
    for (const phraseFile of phraseFiles) {
        await writeFile(phraseFile.filePath, sortedHashBuffer(phraseFile.hashes));
    }
    const manifest = {
        schemaVersion: 1,
        sourceName: options.sourceName,
        generatedAt: new Date().toISOString(),
        hashAlgorithm: 'fnv1a64',
        maxPhraseTokenCount: MAX_PHRASE_TOKENS,
        tokenCount: vocabulary.tokenHashes.size,
        anchorCount: anchorBuffers.count,
        tokensPath: path.relative(outputDir, tokensPath),
        anchorsPath: path.relative(outputDir, anchorsPath),
        anchorCountsPath: path.relative(outputDir, anchorCountsPath),
        phraseFiles: phraseFiles.map((phraseFile) => ({
            tokenCount: phraseFile.tokenCount,
            count: phraseFile.hashes.size,
            path: path.relative(outputDir, phraseFile.filePath)
        }))
    };
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    console.log(`Exported occupation signal vocabulary to ${manifestPath}`);
    console.log([
        `source=${manifest.sourceName}`,
        `tokens=${manifest.tokenCount}`,
        `anchors=${manifest.anchorCount}`,
        `phrases=${manifest.phraseFiles.map((file) => `${file.tokenCount}:${file.count}`).join(',')}`
    ].join('  '));
}
function buildVocabulary(records) {
    const tokenHashes = new Set();
    const phraseHashesByTokenCount = new Map();
    const anchorCounts = new Map();
    for (const record of records) {
        addText(record.canonicalLabel, tokenHashes, phraseHashesByTokenCount);
        addOccupationAnchor(record.canonicalLabel, anchorCounts);
        if (record.familyLabel) {
            addText(record.familyLabel, tokenHashes, phraseHashesByTokenCount);
        }
        if (record.groupLabel) {
            addText(record.groupLabel, tokenHashes, phraseHashesByTokenCount);
        }
        if (record.parentLabel) {
            addText(record.parentLabel, tokenHashes, phraseHashesByTokenCount);
        }
        for (const alias of record.aliases) {
            addText(alias.alias, tokenHashes, phraseHashesByTokenCount);
            addText(alias.normalizedAlias, tokenHashes, phraseHashesByTokenCount);
            addOccupationAnchor(alias.alias, anchorCounts);
        }
        for (const capability of record.capabilityLabels) {
            addText(capability.label, tokenHashes, phraseHashesByTokenCount);
            addText(capability.normalizedLabel, tokenHashes, phraseHashesByTokenCount);
        }
    }
    return {
        tokenHashes,
        phraseHashesByTokenCount,
        anchorCounts
    };
}
function addText(value, tokenHashes, phraseHashesByTokenCount) {
    if (!value) {
        return;
    }
    const tokens = tokenizeForVocabulary(value, 'unknown');
    if (tokens.length === 0) {
        return;
    }
    for (const token of tokens) {
        tokenHashes.add(hashVocabularyText(token));
    }
    for (const phrase of phraseWindows(tokens, MAX_PHRASE_TOKENS)) {
        getOrCreateSet(phraseHashesByTokenCount, phrase.length).add(hashTokenSequence(phrase));
    }
}
function addOccupationAnchor(value, anchorCounts) {
    if (!value) {
        return;
    }
    const tokens = tokenizeForVocabulary(value, 'unknown');
    const lastToken = tokens[tokens.length - 1];
    if (!lastToken || lastToken.length < 3) {
        return;
    }
    const hash = hashVocabularyText(lastToken);
    anchorCounts.set(hash, (anchorCounts.get(hash) ?? 0) + 1);
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
    return tokenizeNormalizedText(foldSearchText(value))
        .filter((token) => token.length >= 2 && !isStopQueryToken(token, locale));
}
function getOrCreateSet(map, key) {
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
        outPath: null
    };
    for (const arg of args) {
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
            continue;
        }
        if (arg.startsWith('--out=')) {
            options.outPath = arg.slice('--out='.length).trim();
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
        '[--out=artifacts/runtime/occupation-signal-vocabulary.esco_1_2_1.manifest.json]'
    ].join(' '));
}
main().catch((error) => {
    console.error('Occupation signal vocabulary export failed.');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
