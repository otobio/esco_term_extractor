import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsvRecords } from '../utils/csv/parse-csv.js';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { loadOccupationSearchMetaArtifactRequired, type RuntimeSearchMetaRecord } from '../runtime/occupation-search-meta-artifact.js';
import {
  defaultOccupationSignalVocabularyAnchorCountsPath,
  defaultOccupationSignalVocabularyAnchorsPath,
  defaultOccupationSignalVocabularyLocaleMaskPath,
  defaultOccupationSignalVocabularyManifestPath,
  defaultOccupationSignalVocabularyPhrasesPath,
  defaultOccupationSignalVocabularyTokensPath,
  buildLocaleMaskBuffer,
  localeBitOrdinal,
  hashTokenSequence,
  hashVocabularyText,
  sortedHashBufferFromSortedValues,
  sortedHashValues,
  sortedHashBuffer,
  sortedAnchorBuffers,
  VOCABULARY_LOCALES,
  type OccupationSignalVocabularyManifest,
  type VocabularyLocaleCode
} from '../runtime/occupation-signal-vocabulary-artifact.js';
import { isStopQueryToken, type SupportedQueryLocale } from '../query/query-preparation.js';
import { commonRolePhraseEntries } from '../query/common-role-phrase-atlas.js';
import { foldSearchText, tokenizeNormalizedText } from '../utils/texts.js';
import { BUILTIN_INTENT_VOCABULARY, type OccupationIntentVocabularyLocale } from '../query/query-intent.js';
import {
  defaultRuntimeReviewJsonPath,
  runtimeReviewArtifactBaseName,
  writeRuntimeReviewJson
} from '../runtime/runtime-review-artifacts.js';

const SKILL_CAPABILITY_VOCABULARY_MAX_TOKENS = 3;

type CliOptions = {
  sourceName: string;
  outPath: string | null;
  reviewJsonOutPath: string | null;
};

const MAX_PHRASE_TOKENS = 5;

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const searchMetaArtifact = await loadOccupationSearchMetaArtifactRequired(options.sourceName);
  const vocabulary = await buildVocabulary(searchMetaArtifact.getAllRecordsWithDetails());
  const manifestPath = path.resolve(options.outPath ?? defaultOccupationSignalVocabularyManifestPath(options.sourceName));
  const reviewJsonPath = options.reviewJsonOutPath ? path.resolve(options.reviewJsonOutPath) : null;
  const outputDir = path.dirname(manifestPath);
  const tokensPath = path.resolve(outputDir, path.basename(defaultOccupationSignalVocabularyTokensPath(options.sourceName)));
  const localeMaskPath = path.resolve(outputDir, path.basename(defaultOccupationSignalVocabularyLocaleMaskPath(options.sourceName)));
  const anchorsPath = path.resolve(outputDir, path.basename(defaultOccupationSignalVocabularyAnchorsPath(options.sourceName)));
  const anchorCountsPath = path.resolve(outputDir, path.basename(defaultOccupationSignalVocabularyAnchorCountsPath(options.sourceName)));
  const sortedTokenHashes = sortedHashValues(vocabulary.tokenHashes);
  const tokenBuffer = sortedHashBufferFromSortedValues(sortedTokenHashes);
  const localeMaskBuffer = buildLocaleMaskBuffer(sortedTokenHashes, VOCABULARY_LOCALES, vocabulary.localeMaskByHash);
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
  await writeFile(localeMaskPath, localeMaskBuffer);
  await writeFile(anchorsPath, anchorBuffers.hashes);
  await writeFile(anchorCountsPath, anchorBuffers.counts);

  for (const phraseFile of phraseFiles) {
    await writeFile(phraseFile.filePath, sortedHashBuffer(phraseFile.hashes));
  }

  const manifest = {
    schemaVersion: 3,
    sourceName: options.sourceName,
    generatedAt: new Date().toISOString(),
    hashAlgorithm: 'fnv1a64',
    maxPhraseTokenCount: MAX_PHRASE_TOKENS,
    tokenCount: vocabulary.tokenHashes.size,
    anchorCount: anchorBuffers.count,
    locales: [...VOCABULARY_LOCALES],
    tokensPath: path.relative(outputDir, tokensPath),
    localeMaskPath: path.relative(outputDir, localeMaskPath),
    anchorsPath: path.relative(outputDir, anchorsPath),
    anchorCountsPath: path.relative(outputDir, anchorCountsPath),
    phraseFiles: phraseFiles.map((phraseFile) => ({
      tokenCount: phraseFile.tokenCount,
      count: phraseFile.hashes.size,
      path: path.relative(outputDir, phraseFile.filePath)
    }))
  } satisfies OccupationSignalVocabularyManifest;

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  if (reviewJsonPath) {
    await writeRuntimeReviewJson(reviewJsonPath, {
      sourceName: options.sourceName,
      tokens: [...vocabulary.tokens].sort(),
      anchors: [...vocabulary.anchorCounts.entries()]
        .map(([token, count]) => ({ token, count }))
        .sort((left, right) => right.count - left.count || left.token.localeCompare(right.token)),
      phrasesByTokenCount: Object.fromEntries(
        [...vocabulary.phrasesByTokenCount.entries()]
          .sort(([left], [right]) => left - right)
          .map(([tokenCount, phrases]) => [String(tokenCount), [...phrases].sort()])
      )
    });
  }

  console.log(`Exported occupation signal vocabulary to ${manifestPath}`);
  if (reviewJsonPath) {
    console.log(`review_json=${reviewJsonPath}`);
  }
  console.log(
    [
      `source=${manifest.sourceName}`,
      `tokens=${manifest.tokenCount}`,
      `locales=${manifest.locales.join(',')}`,
      `anchors=${manifest.anchorCount}`,
      `phrases=${manifest.phraseFiles.map((file) => `${file.tokenCount}:${file.count}`).join(',')}`
    ].join('  ')
  );
}

async function buildVocabulary(records: RuntimeSearchMetaRecord[]): Promise<{
  tokens: Set<string>;
  phrasesByTokenCount: Map<number, Set<string>>;
  anchorCounts: Map<string, number>;
  tokenHashes: Set<bigint>;
  localeMaskByHash: Map<bigint, number>;
  phraseHashesByTokenCount: Map<number, Set<bigint>>;
  anchorHashes: Map<bigint, number>;
}> {
  const tokens = new Set<string>();
  const phrasesByTokenCount = new Map<number, Set<string>>();
  const anchorCounts = new Map<string, number>();
  const tokenHashes = new Set<bigint>();
  const localeMaskByHash = new Map<bigint, number>();
  const phraseHashesByTokenCount = new Map<number, Set<bigint>>();
  const anchorHashes = new Map<bigint, number>();

  // ESCO's canonical/family/group/parent labels are English-only structural taxonomy text.
  const structuralLocale: VocabularyLocaleCode = 'en';

  for (const record of records) {
    addText(record.canonicalLabel, tokens, tokenHashes, phrasesByTokenCount, phraseHashesByTokenCount, localeMaskByHash, structuralLocale);
    addOccupationAnchor(record.canonicalLabel, anchorCounts, anchorHashes);

    if (record.familyLabel) {
      addText(record.familyLabel, tokens, tokenHashes, phrasesByTokenCount, phraseHashesByTokenCount, localeMaskByHash, structuralLocale);
    }

    if (record.groupLabel) {
      addText(record.groupLabel, tokens, tokenHashes, phrasesByTokenCount, phraseHashesByTokenCount, localeMaskByHash, structuralLocale);
    }

    if (record.parentLabel) {
      addText(record.parentLabel, tokens, tokenHashes, phrasesByTokenCount, phraseHashesByTokenCount, localeMaskByHash, structuralLocale);
    }

    for (const alias of record.aliases) {
      const aliasLocale = asVocabularyLocale(alias.localeCode);
      addText(alias.alias, tokens, tokenHashes, phrasesByTokenCount, phraseHashesByTokenCount, localeMaskByHash, aliasLocale);
      addText(alias.normalizedAlias, tokens, tokenHashes, phrasesByTokenCount, phraseHashesByTokenCount, localeMaskByHash, aliasLocale);
      addOccupationAnchor(alias.alias, anchorCounts, anchorHashes);
    }

    for (const capability of record.capabilityLabels) {
      if (
        capability.capabilityType === 'skill' &&
        tokenizeForVocabulary(capability.normalizedLabel, 'unknown').length > SKILL_CAPABILITY_VOCABULARY_MAX_TOKENS
      ) {
        continue;
      }

      const capabilityLocale = asVocabularyLocale(capability.localeCode);
      addText(capability.label, tokens, tokenHashes, phrasesByTokenCount, phraseHashesByTokenCount, localeMaskByHash, capabilityLocale);
      addText(
        capability.normalizedLabel,
        tokens,
        tokenHashes,
        phrasesByTokenCount,
        phraseHashesByTokenCount,
        localeMaskByHash,
        capabilityLocale
      );
    }
  }

  addEnglishIntentVocabularyTerms(tokens, tokenHashes, localeMaskByHash, phrasesByTokenCount, phraseHashesByTokenCount);
  addCommonRolePhraseAtlasVocabularyTerms(tokens, tokenHashes, localeMaskByHash, phrasesByTokenCount, phraseHashesByTokenCount);
  await addSpecializationSchemaVocabularyTerms(tokens, tokenHashes, localeMaskByHash, phrasesByTokenCount, phraseHashesByTokenCount);

  return {
    tokens,
    phrasesByTokenCount,
    anchorCounts,
    tokenHashes,
    localeMaskByHash,
    phraseHashesByTokenCount,
    anchorHashes
  };
}

function asVocabularyLocale(localeCode: string | null | undefined): VocabularyLocaleCode | null {
  return VOCABULARY_LOCALES.includes(localeCode as VocabularyLocaleCode) ? (localeCode as VocabularyLocaleCode) : null;
}

function addEnglishIntentVocabularyTerms(
  tokens: Set<string>,
  tokenHashes: Set<bigint>,
  localeMaskByHash: Map<bigint, number>,
  phrasesByTokenCount: Map<number, Set<string>>,
  phraseHashesByTokenCount: Map<number, Set<bigint>>
): void {
  const englishProfile =
    BUILTIN_INTENT_VOCABULARY.resolveLocaleProfile?.('en') ?? BUILTIN_INTENT_VOCABULARY.localeProfiles.find((p) => p.localeCode === 'en');

  if (!englishProfile) {
    return;
  }

  for (const value of englishIntentVocabularyValues(englishProfile)) {
    addText(value, tokens, tokenHashes, phrasesByTokenCount, phraseHashesByTokenCount, localeMaskByHash, 'en');
  }
}

// Curated common-role-phrase-atlas surfaces are literal query text matched at retrieval time, but they
// live outside the ESCO alias corpus this vocabulary is otherwise built from. Any word in a surface that
// never appears in a real ESCO alias stays OOV, so the OOV cleaner's compound-splitter or spelling-rescue
// paths can mangle it before it ever reaches the atlas matcher (e.g. HU "munkatárs" silently splitting
// into "munka" + "társ", corrupting "raktári munkatárs" en route). Registering every atlas surface word
// against its own locale closes that gap for the whole atlas at once, not just one curated phrase.
function addCommonRolePhraseAtlasVocabularyTerms(
  tokens: Set<string>,
  tokenHashes: Set<bigint>,
  localeMaskByHash: Map<bigint, number>,
  phrasesByTokenCount: Map<number, Set<string>>,
  phraseHashesByTokenCount: Map<number, Set<bigint>>
): void {
  for (const locale of VOCABULARY_LOCALES) {
    for (const entry of commonRolePhraseEntries(locale)) {
      addText(entry.surface, tokens, tokenHashes, phrasesByTokenCount, phraseHashesByTokenCount, localeMaskByHash, locale);
    }
  }
}

const SPECIALIZATION_SCHEMA_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'occupation-classifier',
  'specialization',
  'specialization-schema'
);

// The specialization schema (role_head/concept dictionary) is curated independently of the ESCO alias
// corpus this vocabulary is otherwise built from: a role_head or concept surface only needs to appear
// in these CSVs to be usable by the classifier's translation/concept-matching layer, not in an ESCO
// alias. Any such surface word that never happens to also appear in an ESCO alias stays OOV, so the OOV
// cleaner's compound-splitter or spelling-rescue paths can mangle it before it ever reaches the
// role_head/concept matcher (the same class of bug fixed for the common-role-phrase-atlas above).
// Registering every curated role_head, role_head alias, concept canonical, and concept alias here closes
// that gap so the dictionary's coverage is never silently undermined by OOV cleaning.
async function addSpecializationSchemaVocabularyTerms(
  tokens: Set<string>,
  tokenHashes: Set<bigint>,
  localeMaskByHash: Map<bigint, number>,
  phrasesByTokenCount: Map<number, Set<string>>,
  phraseHashesByTokenCount: Map<number, Set<bigint>>
): Promise<void> {
  const add = (value: string | null | undefined, locale: VocabularyLocaleCode | null): void =>
    addText(value, tokens, tokenHashes, phrasesByTokenCount, phraseHashesByTokenCount, localeMaskByHash, locale);

  const readCsv = async (fileName: string): Promise<Array<Record<string, string | null>>> => {
    try {
      return parseCsvRecords(await readFile(path.join(SPECIALIZATION_SCHEMA_DIR, fileName), 'utf8'));
    } catch {
      return [];
    }
  };

  for (const row of await readCsv('specialization-role-heads.csv')) {
    add(row.role_head, 'en');
  }

  // role_head/alias pairs here mix American-English variants with RO/HU aliases and carry no locale
  // column, so they're registered locale-free (locale=null): token presence is what OOV cleaning checks
  // (see resolveKnownToken in occupation-signal-oov-cleaner.ts), and that check ignores the locale mask.
  for (const row of await readCsv('specialization-role-head-aliases.csv')) {
    add(row.role_head, null);
    add(row.alias, null);
  }

  for (const row of await readCsv('specialization-concept-rules.csv')) {
    add(row.canonical, 'en');
  }

  for (const row of await readCsv('concepts-without-aliases.csv')) {
    add(row.canonical, 'en');
  }

  // Unlike the role/concept canonical files, this global alias file is not English-only -- it mixes in
  // untagged loanword/foreign aliases (e.g. Romanian "vanzari" as an alias for "business") alongside the
  // English ones. Tagging it 'en' would corrupt isEnglishQuery's locale-detection heuristic in lang.ts,
  // making it treat a Romanian query containing "vanzari" as English. Registered locale-free instead.
  for (const row of await readCsv('specialization-concept-aliases.csv')) {
    add(row.alias, null);
  }

  for (const row of await readCsv('specialization-concept-aliases.hu.csv')) {
    add(row.alias, 'hu');
  }

  for (const row of await readCsv('specialization-concept-aliases.ro.csv')) {
    add(row.alias, 'ro');
  }
}

function englishIntentVocabularyValues(profile: OccupationIntentVocabularyLocale): string[] {
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

function addText(
  value: string | null | undefined,
  tokensOut: Set<string>,
  tokenHashes: Set<bigint>,
  phrasesOut: Map<number, Set<string>>,
  phraseHashesByTokenCount: Map<number, Set<bigint>>,
  localeMaskByHash: Map<bigint, number>,
  locale: VocabularyLocaleCode | null = null
): void {
  if (!value) {
    return;
  }

  const tokens = tokenizeForVocabulary(value, 'unknown');

  if (tokens.length === 0) {
    return;
  }

  const localeBit = locale ? localeBitOrdinal(VOCABULARY_LOCALES, locale) : -1;

  for (const token of tokens) {
    tokensOut.add(token);
    const hash = hashVocabularyText(token);
    tokenHashes.add(hash);

    if (localeBit >= 0) {
      localeMaskByHash.set(hash, (localeMaskByHash.get(hash) ?? 0) | (1 << localeBit));
    }
  }

  for (const phrase of phraseWindows(tokens, MAX_PHRASE_TOKENS)) {
    getOrCreatePhraseSet(phrasesOut, phrase.length).add(phrase.join(' '));
    getOrCreateSet(phraseHashesByTokenCount, phrase.length).add(hashTokenSequence(phrase));
  }
}

function addOccupationAnchor(value: string | null | undefined, anchorCounts: Map<string, number>, anchorHashes: Map<bigint, number>): void {
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

function phraseWindows(tokens: string[], maxWindow: number): string[][] {
  const phrases: string[][] = [];
  const boundedMaxWindow = Math.min(tokens.length, maxWindow);

  for (let windowSize = 2; windowSize <= boundedMaxWindow; windowSize += 1) {
    for (let start = 0; start <= tokens.length - windowSize; start += 1) {
      phrases.push(tokens.slice(start, start + windowSize));
    }
  }

  return phrases;
}

function tokenizeForVocabulary(value: string, locale: SupportedQueryLocale): string[] {
  return tokenizeNormalizedText(foldSearchText(value)).filter((token) => token.length >= 2 && !isStopQueryToken(token, locale));
}

function getOrCreateSet(map: Map<number, Set<bigint>>, key: number): Set<bigint> {
  let existing = map.get(key);

  if (!existing) {
    existing = new Set<bigint>();
    map.set(key, existing);
  }

  return existing;
}

function getOrCreatePhraseSet(map: Map<number, Set<string>>, key: number): Set<string> {
  let existing = map.get(key);

  if (!existing) {
    existing = new Set<string>();
    map.set(key, existing);
  }

  return existing;
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    sourceName: DEFAULT_ESCO_SOURCE_NAME,
    outPath: null,
    reviewJsonOutPath: defaultRuntimeReviewJsonPath(runtimeReviewArtifactBaseName('occupation-signal-vocabulary', DEFAULT_ESCO_SOURCE_NAME))
  };

  for (const arg of args) {
    if (arg.startsWith('--source-name=')) {
      options.sourceName = arg.slice('--source-name='.length).trim();
      options.reviewJsonOutPath = defaultRuntimeReviewJsonPath(
        runtimeReviewArtifactBaseName('occupation-signal-vocabulary', options.sourceName)
      );
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

function printHelp(): void {
  console.log(
    [
      'Usage: node dist/cli/export-occupation-signal-vocabulary-artifact.js',
      `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
      '[--out=artifacts/runtime/occupation-signal-vocabulary.esco_1_2_1.manifest.json]',
      '[--review-json-out=data/runtime-review/occupation-signal-vocabulary.esco_1_2_1.json]',
      '[--no-review-json]'
    ].join(' ')
  );
}

main().catch((error) => {
  console.error('Occupation signal vocabulary export failed.');
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
