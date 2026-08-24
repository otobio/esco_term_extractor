import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { cleanOccupationQuerySurface } from '../query/occupation-query-cleaning.js';
import { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
import { foldSearchText } from '../utils/texts.js';
import { ALL_PIPELINE_GOLDEN_CASES, type GoldenCase } from '../search-pipeline/golden-suite.js';
import { prepareQuery } from '../query/query-preparation.js';
import { cliRankFamilyLeaves, resolveFamily, formatScoreBreakdown } from './rank-family-leaves-core.js';

type CliOptions = {
  sourceName: string;
  showPasses: boolean;
  siblingFamilyCount: number;
};

type EvalResult = {
  caseKey: string;
  suite: string;
  query: string;
  locale: string;
  expectedFamily: string;
  expectedLeaf: string;
  actualLeaf: string | null;
  actualFamily: string | null;
  actualScore: number | null;
  actualBreakdown: string | null;
  siblingFamilyLabels: string[];
  passed: boolean;
  error: string | null;
};

// No real "sibling family" relation is exposed by the runtime artifact (families aren't linked to
// a parent group here), so this picks the N families nearest the expected family by graph node id
// as a deterministic stand-in -- good enough to check whether the correct family also wins against
// plausible distractors, not a claim that these are taxonomically related families.
function pickSiblingFamilies(
  artifact: EvalRuntime['searchMetaArtifact'],
  expectedFamilyNodeId: number,
  count: number
): Array<{ familyNodeId: number; familyLabel: string }> {
  if (count <= 0) {
    return [];
  }

  const familyById = new Map<number, string>();

  for (const record of artifact.getAllCoreRecords()) {
    if (record.familyNodeId === null || record.familyLabel === null) {
      continue;
    }

    familyById.set(record.familyNodeId, record.familyLabel);
  }

  const otherFamilyIds = Array.from(familyById.keys())
    .filter((familyNodeId) => familyNodeId !== expectedFamilyNodeId)
    .sort((left, right) => Math.abs(left - expectedFamilyNodeId) - Math.abs(right - expectedFamilyNodeId) || left - right);

  return otherFamilyIds.slice(0, count).map((familyNodeId) => ({ familyNodeId, familyLabel: familyById.get(familyNodeId)! }));
}

type EvalRuntime = OccupationRuntimeContext;

function usableGoldenCases(): GoldenCase[] {
  const LOCALE_ORDER = ['en', 'ro', 'hu', 'et'];
  return ALL_PIPELINE_GOLDEN_CASES.filter(
    (goldenCase) =>
      goldenCase.expectation.decisionType === 'leaf' &&
      Boolean(goldenCase.expectation.selectedLabel) &&
      Boolean(goldenCase.expectation.topFamilyLabel)
  ).sort((a, b) => LOCALE_ORDER.indexOf(a.locale) - LOCALE_ORDER.indexOf(b.locale));
}

async function evaluateCase(
  runtime: OccupationRuntimeContext,
  sourceName: string,
  goldenCase: GoldenCase,
  siblingFamilyCount: number
): Promise<EvalResult> {
  const expectedFamily = goldenCase.expectation.topFamilyLabel!;
  const expectedLeaf = goldenCase.expectation.selectedLabel!;

  const base: Omit<
    EvalResult,
    'actualLeaf' | 'actualFamily' | 'actualScore' | 'actualBreakdown' | 'siblingFamilyLabels' | 'passed' | 'error'
  > = {
    caseKey: goldenCase.caseKey,
    suite: goldenCase.suite ?? 'stable',
    query: goldenCase.query,
    locale: goldenCase.locale,
    expectedFamily,
    expectedLeaf
  };

  try {
    const family = resolveFamily(runtime.searchMetaArtifact, expectedFamily);
    const siblingFamilies = pickSiblingFamilies(runtime.searchMetaArtifact, family.familyNodeId, siblingFamilyCount);
    const cleanedQuery = await cleanOccupationQuerySurface(goldenCase.query, goldenCase.locale);
    const effectiveQuery = cleanedQuery || goldenCase.query;
    const preparedQuery = await prepareQuery(effectiveQuery, goldenCase.locale, { sourceName });
    const leaves = runtime.searchMetaArtifact.getLeafCoreRecordsForFamilies([
      family.familyNodeId,
      ...siblingFamilies.map((sibling) => sibling.familyNodeId)
    ]);

    const rankedLeaves = cliRankFamilyLeaves(
      runtime.searchMetaArtifact,
      runtime.leafStructureArtifact,
      leaves,
      preparedQuery,
      effectiveQuery,
      goldenCase.locale
    );

    const topLeaf = rankedLeaves[0] ?? null;
    const topLeafRecord = topLeaf ? (leaves.find((leaf) => leaf.graphNodeId === topLeaf.graphNodeId) ?? null) : null;
    const passed = topLeaf !== null && foldSearchText(topLeaf.canonicalLabel) === foldSearchText(expectedLeaf);

    return {
      ...base,
      actualLeaf: topLeaf?.canonicalLabel ?? null,
      actualFamily: topLeafRecord?.familyLabel ?? null,
      actualScore: topLeaf?.totalScore ?? null,
      actualBreakdown: topLeaf ? formatScoreBreakdown(topLeaf.scoreBreakdown) : null,
      siblingFamilyLabels: siblingFamilies.map((sibling) => sibling.familyLabel),
      passed,
      error: null
    };
  } catch (error) {
    return {
      ...base,
      actualLeaf: null,
      actualFamily: null,
      actualScore: null,
      actualBreakdown: null,
      siblingFamilyLabels: [],
      passed: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const runtime = await OccupationRuntimeContext.load({
    sourceName: options.sourceName,
    leafStructureRuntime: true
  });

  const cases = usableGoldenCases();
  const results: EvalResult[] = [];

  for (const goldenCase of cases) {
    results.push(await evaluateCase(runtime, options.sourceName, goldenCase, options.siblingFamilyCount));
  }

  printReport(results, options);
}

function printReport(results: EvalResult[], options: CliOptions): void {
  for (const result of results) {
    if (result.passed && !options.showPasses) {
      continue;
    }

    const status = result.passed ? 'PASS' : 'FAIL';
    const lines = [
      `[${status}] ${result.caseKey} (${result.suite})  query="${result.query}"  locale=${result.locale}`,
      `  family="${result.expectedFamily}"  expected="${result.expectedLeaf}"`
    ];

    if (result.siblingFamilyLabels.length > 0) {
      lines.push(`  sibling_families=${result.siblingFamilyLabels.join(' | ')}`);
    }

    if (result.error) {
      lines.push(`  error=${result.error}`);
    } else {
      const familyNote = result.siblingFamilyLabels.length > 0 ? `  actual_family="${result.actualFamily ?? 'none'}"` : '';
      lines.push(
        `  actual="${result.actualLeaf ?? 'none'}"${familyNote}  score=${result.actualScore ?? 'n/a'}  breakdown=${result.actualBreakdown ?? 'none'}`
      );
    }

    console.log(lines.join('\n'));
  }

  const total = results.length;
  const passed = results.filter((result) => result.passed).length;
  const stableResults = results.filter((result) => result.suite === 'stable');
  const developingResults = results.filter((result) => result.suite === 'developing');

  console.log('');
  console.log('===== summary =====');
  console.log(`overall: ${passed}/${total} passed`);
  console.log(`stable: ${stableResults.filter((result) => result.passed).length}/${stableResults.length} passed`);
  console.log(`developing: ${developingResults.filter((result) => result.passed).length}/${developingResults.length} passed`);
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    sourceName: DEFAULT_ESCO_SOURCE_NAME,
    showPasses: false,
    siblingFamilyCount: 0
  };

  for (const arg of args) {
    if (arg.startsWith('--source=')) {
      options.sourceName = arg.slice('--source='.length).trim() || DEFAULT_ESCO_SOURCE_NAME;
      continue;
    }

    if (arg === '--show-passes') {
      options.showPasses = true;
      continue;
    }

    if (arg.startsWith('--with-sibling-families=')) {
      options.siblingFamilyCount = parseNonNegativeInteger('with-sibling-families', arg.slice('--with-sibling-families='.length));
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

function parseNonNegativeInteger(name: string, value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`--${name} must be a non-negative integer.`);
  }

  return parsed;
}

function printHelp(): void {
  console.log('Usage: npm run rank:family-leaves:eval -- [--show-passes] [--source=esco_1_2_1] [--with-sibling-families=2]');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
