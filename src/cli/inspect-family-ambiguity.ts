import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { loadOccupationSearchMetaArtifactRequired, type SearchMetaArtifactCacheEntry } from '../runtime/occupation-search-meta-artifact.js';
import { foldSearchText, tokenizeNormalizedText } from '../utils/texts.js';

type CliOptions = {
  sourceName: string;
  outPath: string;
  limit: number;
  maxTermFamilyCount: number;
};

type FamilyProfile = {
  familyNodeId: number;
  familyLabel: string;
  leafCount: number;
  sampleLabels: string[];
  tokenCounts: Map<string, number>;
  phraseCounts: Map<string, number>;
  roleHeads: Map<string, number>;
};

type WeightedTerm = {
  term: string;
  score: number;
  leftCount: number;
  rightCount: number;
  familyCount: number;
};

type AmbiguousFamilyPair = {
  leftFamilyNodeId: number;
  leftFamilyLabel: string;
  rightFamilyNodeId: number;
  rightFamilyLabel: string;
  score: number;
  sharedRoleHeads: WeightedTerm[];
  sharedPhrases: WeightedTerm[];
  sharedTokens: WeightedTerm[];
  leftSampleLabels: string[];
  rightSampleLabels: string[];
};

type AmbiguityReport = {
  sourceName: string;
  generatedAt: string;
  familyCount: number;
  leafCount: number;
  pairCount: number;
  scoring: {
    maxTermFamilyCount: number;
    tokenWeight: number;
    phraseWeight: number;
    roleHeadWeight: number;
  };
  pairs: AmbiguousFamilyPair[];
};

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

async function main(): Promise<void> {
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
  const report: AmbiguityReport = {
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

function buildFamilyProfiles(artifact: SearchMetaArtifactCacheEntry): FamilyProfile[] {
  const profilesByFamilyId = new Map<number, FamilyProfile>();

  for (const record of artifact.getAllCoreRecords()) {
    if (record.familyNodeId === null || !record.familyLabel) {
      continue;
    }

    const profile = profilesByFamilyId.get(record.familyNodeId) ?? {
      familyNodeId: record.familyNodeId,
      familyLabel: record.familyLabel,
      leafCount: 0,
      sampleLabels: [],
      tokenCounts: new Map<string, number>(),
      phraseCounts: new Map<string, number>(),
      roleHeads: new Map<string, number>()
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

function addSurface(profile: FamilyProfile, label: string): void {
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

function scoreAmbiguousPairs(
  families: FamilyProfile[],
  context: {
    tokenFamilyCounts: Map<string, number>;
    phraseFamilyCounts: Map<string, number>;
    roleHeadFamilyCounts: Map<string, number>;
    maxTermFamilyCount: number;
  }
): AmbiguousFamilyPair[] {
  const pairs: AmbiguousFamilyPair[] = [];

  for (let leftIndex = 0; leftIndex < families.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < families.length; rightIndex += 1) {
      const left = families[leftIndex] as FamilyProfile;
      const right = families[rightIndex] as FamilyProfile;
      const sharedRoleHeads = sharedWeightedTerms(
        left,
        right,
        (family) => family.roleHeads,
        context.roleHeadFamilyCounts,
        context.maxTermFamilyCount,
        ROLE_HEAD_WEIGHT
      );
      const sharedPhrases = sharedWeightedTerms(
        left,
        right,
        (family) => family.phraseCounts,
        context.phraseFamilyCounts,
        context.maxTermFamilyCount,
        PHRASE_WEIGHT
      );
      const sharedTokens = sharedWeightedTerms(
        left,
        right,
        (family) => family.tokenCounts,
        context.tokenFamilyCounts,
        context.maxTermFamilyCount,
        TOKEN_WEIGHT
      );
      const score = roundScore(
        sharedRoleHeads.reduce((total, term) => total + term.score, 0) +
          sharedPhrases.reduce((total, term) => total + term.score, 0) +
          sharedTokens.reduce((total, term) => total + term.score, 0)
      );

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

  return pairs.sort(
    (left, right) =>
      right.score - left.score ||
      left.leftFamilyLabel.localeCompare(right.leftFamilyLabel) ||
      left.rightFamilyLabel.localeCompare(right.rightFamilyLabel)
  );
}

function sharedWeightedTerms(
  left: FamilyProfile,
  right: FamilyProfile,
  selector: (family: FamilyProfile) => Map<string, number>,
  familyCounts: Map<string, number>,
  maxTermFamilyCount: number,
  weight: number
): WeightedTerm[] {
  const terms: WeightedTerm[] = [];
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
    .sort(
      (leftTerm, rightTerm) =>
        rightTerm.score - leftTerm.score || leftTerm.familyCount - rightTerm.familyCount || leftTerm.term.localeCompare(rightTerm.term)
    );
}

function familyCountsFor(families: FamilyProfile[], selector: (family: FamilyProfile) => Map<string, number>): Map<string, number> {
  const counts = new Map<string, number>();

  for (const family of families) {
    for (const term of selector(family).keys()) {
      increment(counts, term, 1);
    }
  }

  return counts;
}

function meaningfulTokens(label: string): string[] {
  return tokenizeNormalizedText(foldSearchText(label))
    .filter((token) => token.length >= 3)
    .filter((token) => !STOP_TOKENS.has(token));
}

function phrases(tokens: string[], size: number): string[] {
  const output: string[] = [];

  for (let index = 0; index <= tokens.length - size; index += 1) {
    output.push(tokens.slice(index, index + size).join(' '));
  }

  return output;
}

function increment(map: Map<string, number>, key: string, amount: number): void {
  map.set(key, (map.get(key) ?? 0) + amount);
}

function roundScore(value: number): number {
  return Number(value.toFixed(6));
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
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

function parsePositiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer.`);
  }

  return parsed;
}

function printHelp(): void {
  console.log(
    [
      'Usage: node dist/cli/inspect-family-ambiguity.js',
      `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
      '[--out=artifacts/analysis/family-ambiguity.esco_1_2_1.json]',
      '[--limit=100]',
      '[--max-term-family-count=12]'
    ].join(' ')
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Family ambiguity inspection failed.');
  console.error(message);
  process.exitCode = 1;
});
