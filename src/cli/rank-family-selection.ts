import { DEFAULT_ESCO_SOURCE_NAME, DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
import {
  OccupationSearchPipeline,
  recoveredFamilySelectionAuthority,
  type RankedPipelineFamily
} from '../search-pipeline/occupation-search-pipeline.js';
import type { PreparedQuery } from '../query/query-preparation.js';
import { type RecoveredFamilySelectionAuthority } from './rank-family-core.js';

type CliOptions = {
  query: string;
  locale: string;
  sourceName: string;
  limit: number;
};

// Keep this in sync with the actual criterion order in `compareRecoveredFamilySelectionAuthority`
// (rank-family-core.ts) -- it's a display-only duplicate used to name the "decisive criterion"
// between two adjacent families, not the real comparator.
const FAMILY_SELECTION_AUTHORITY_CASCADE: Array<{
  label: string;
  higherWins: boolean;
  read: (authority: RecoveredFamilySelectionAuthority) => number;
}> = [
  { label: 'roleGrounded', higherWins: true, read: (a) => a.roleGrounded },
  { label: 'groupAgreement', higherWins: true, read: (a) => a.groupAgreement },
  { label: 'groupMismatch', higherWins: false, read: (a) => a.groupMismatch },
  { label: 'familySpecializationMismatch', higherWins: false, read: (a) => a.familySpecializationMismatch },
  { label: 'jobFunctionPrior', higherWins: true, read: (a) => a.jobFunctionPrior },
  { label: 'genericHeadPrior', higherWins: true, read: (a) => a.genericHeadPrior },
  { label: 'reviewedSignal', higherWins: true, read: (a) => a.reviewedSignal },
  { label: 'exactFamilyCanonical', higherWins: true, read: (a) => a.exactFamilyCanonical },
  { label: 'usefulExact', higherWins: true, read: (a) => a.usefulExact },
  { label: 'roleCoverage>0.5', higherWins: true, read: (a) => Number(a.roleCoverage > 0.5) },
  { label: 'profileFamilyLabelCoverage', higherWins: true, read: (a) => a.profileFamilyLabelCoverage },
  { label: 'structuralAlignment', higherWins: true, read: (a) => a.structuralAlignment },
  { label: 'supportedSpecializationLeafCount', higherWins: true, read: (a) => a.supportedSpecializationLeafCount },
  { label: 'primaryExactAliasLeafCount', higherWins: true, read: (a) => a.primaryExactAliasLeafCount },
  { label: 'exactRoleLeafCount', higherWins: true, read: (a) => a.exactRoleLeafCount },
  { label: 'bestRoleTokenMatchCount', higherWins: true, read: (a) => a.bestRoleTokenMatchCount },
  { label: 'roleHeadCoverage', higherWins: true, read: (a) => a.roleHeadCoverage },
  { label: 'bestLeafRoleCoverage', higherWins: true, read: (a) => a.bestLeafRoleCoverage },
  { label: 'capabilityRoleCoverage', higherWins: true, read: (a) => a.capabilityRoleCoverage },
  { label: 'capabilityLeafCount', higherWins: true, read: (a) => a.capabilityLeafCount },
  { label: 'partialRoleLeafCount', higherWins: true, read: (a) => a.partialRoleLeafCount },
  { label: 'roleCoverage', higherWins: true, read: (a) => a.roleCoverage },
  { label: 'profileRoleCoverage', higherWins: true, read: (a) => a.profileRoleCoverage },
  { label: 'exactAliasCount>0', higherWins: true, read: (a) => Number(a.exactAliasCount > 0) },
  { label: 'foldedAliasCount>0', higherWins: true, read: (a) => Number(a.foldedAliasCount > 0) },
  { label: 'exactAliasCount', higherWins: true, read: (a) => a.exactAliasCount },
  { label: 'confidence', higherWins: true, read: (a) => a.confidence },
  { label: 'branchShare', higherWins: true, read: (a) => a.branchShare },
  { label: 'bestLeafStructuralPreference', higherWins: true, read: (a) => a.bestLeafStructuralPreference }
];

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const runtime = await OccupationRuntimeContext.load({
    sourceName: options.sourceName,
    leafStructureRuntime: true
  });

  const result = await OccupationSearchPipeline.withRuntime(runtime).run({
    query: options.query,
    locale: options.locale,
    sourceName: options.sourceName
  });

  console.log(formatResult(options, result.preparedQuery, result.rankedFamilies.slice(0, options.limit)));
}

function formatResult(options: CliOptions, preparedQuery: PreparedQuery, families: RankedPipelineFamily[]): string {
  const lines: string[] = [];

  lines.push(`Family selection authority: "${options.query}"`);
  lines.push(`locale=${options.locale}  source=${options.sourceName}`);
  lines.push(`query_tokens=${preparedQuery.foldedTokens.join(',') || 'none'}`);
  lines.push(`role_tokens=${preparedQuery.intent.roleTokens.join(',') || 'none'}`);
  lines.push(`domain_tokens=${preparedQuery.intent.domainTokens.join(',') || 'none'}`);
  lines.push(`role_head_tokens=${preparedQuery.intent.roleHeadTokens.join(',') || 'none'}`);
  lines.push(`role_head_requires_context=${preparedQuery.intent.roleHeadRequiresContext || 'none'}`);
  lines.push(`generic_role_head_tokens=${preparedQuery.intent.genericRoleHeadTokens.join(',') || 'none'}`);
  lines.push(`authoritative_role_head_tokens=${preparedQuery.intent.authoritativeRoleHeadTokens.join(',') || 'none'}`);
  lines.push(`confidence=${preparedQuery.intent.confidence || 'none'}`);
  lines.push(`credential_tokens=${preparedQuery.intent.credentialTokens.join(',') || 'none'}`);
  lines.push(`venue_tokens=${preparedQuery.intent.venueTokens.join(',') || 'none'}`);

  if (families.length === 0) {
    lines.push('ranked_families=none');
    return lines.join('\n');
  }

  const specializationKindsCache = new Map();
  const authorityByFamilyKey = new Map(
    families.map((family) => [
      family.familyKey,
      family.selectionAuthority ?? recoveredFamilySelectionAuthority(family, preparedQuery, specializationKindsCache)
    ])
  );

  lines.push('');
  lines.push('Ranked families');

  for (const family of families) {
    lines.push(formatFamily(family, authorityByFamilyKey.get(family.familyKey)!));
  }

  lines.push('');
  lines.push('Decisive criterion between adjacent families');

  for (let index = 0; index < families.length - 1; index++) {
    const left = families[index]!;
    const right = families[index + 1]!;
    lines.push(
      `${left.rank}. "${left.familyLabel}" vs ${right.rank}. "${right.familyLabel}": ` +
        describeDecisiveCriterion(left, right, authorityByFamilyKey.get(left.familyKey)!, authorityByFamilyKey.get(right.familyKey)!)
    );
  }

  return lines.join('\n');
}

function describeDecisiveCriterion(
  left: RankedPipelineFamily,
  right: RankedPipelineFamily,
  leftAuthority: RecoveredFamilySelectionAuthority,
  rightAuthority: RecoveredFamilySelectionAuthority
): string {
  if (left.evidenceTierRank !== right.evidenceTierRank) {
    return `evidenceTierRank (${left.evidenceTierRank} vs ${right.evidenceTierRank})`;
  }

  const exactBranchShareDifference = Math.abs(leftAuthority.branchShare - rightAuthority.branchShare);
  const bothHaveExactAlias = leftAuthority.exactAliasCount > 0 && rightAuthority.exactAliasCount > 0;

  if (bothHaveExactAlias && exactBranchShareDifference > 0.2) {
    return `branchShare short-circuit (both have exact alias, |diff|=${exactBranchShareDifference.toFixed(3)} > 0.2)`;
  }

  for (const criterion of FAMILY_SELECTION_AUTHORITY_CASCADE) {
    const leftValue = criterion.read(leftAuthority);
    const rightValue = criterion.read(rightAuthority);

    if (leftValue !== rightValue) {
      const winner = criterion.higherWins ? (leftValue > rightValue ? left : right) : leftValue < rightValue ? left : right;
      return `${criterion.label} (${leftValue} vs ${rightValue}) -> "${winner.familyLabel}"`;
    }
  }

  return 'familyLabel (alphabetical fallback)';
}

function formatFamily(family: RankedPipelineFamily, authority: RecoveredFamilySelectionAuthority): string {
  return [
    `${family.rank}. "${family.familyLabel}" #${family.familyNodeId}`,
    `tier=${family.evidenceTier}(${family.evidenceTierRank})`,
    `confidence=${family.confidence.toFixed(2)}`,
    `branchShare=${authority.branchShare.toFixed(3)}`,
    '',
    `    roleGrounded=${authority.roleGrounded} groupAgreement=${authority.groupAgreement} groupMismatch=${authority.groupMismatch} familySpecializationMismatch=${authority.familySpecializationMismatch}`,
    `    jobFunctionPrior=${authority.jobFunctionPrior} genericHeadPrior=${authority.genericHeadPrior} reviewedSignal=${authority.reviewedSignal}`,
    `    exactFamilyCanonical=${authority.exactFamilyCanonical} usefulExact=${authority.usefulExact} primaryExactAliasLeafCount=${authority.primaryExactAliasLeafCount}`,
    `    exactRoleLeafCount=${authority.exactRoleLeafCount} partialRoleLeafCount=${authority.partialRoleLeafCount} bestRoleTokenMatchCount=${authority.bestRoleTokenMatchCount}`,
    `    capabilityRoleCoverage=${authority.capabilityRoleCoverage.toFixed(3)} capabilityLeafCount=${authority.capabilityLeafCount}`,
    `    exactAliasCount=${authority.exactAliasCount} foldedAliasCount=${authority.foldedAliasCount} exactEvidenceCount=${authority.exactEvidenceCount}`,
    `    roleHeadCoverage=${authority.roleHeadCoverage.toFixed(3)} roleCoverage=${authority.roleCoverage.toFixed(3)} bestLeafRoleCoverage=${authority.bestLeafRoleCoverage.toFixed(3)}`,
    `    bestLeafStructuralPreference=${authority.bestLeafStructuralPreference.toFixed(3)} structuralAlignment=${authority.structuralAlignment.toFixed(3)}`,
    `    supportedSpecializationLeafCount=${authority.supportedSpecializationLeafCount} profileRoleCoverage=${authority.profileRoleCoverage.toFixed(3)}`
  ].join('\n  ');
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    query: '',
    locale: DEFAULT_RETRIEVAL_LOCALE,
    sourceName: DEFAULT_ESCO_SOURCE_NAME,
    limit: 10
  };

  for (const arg of args) {
    if (arg.startsWith('--query=')) {
      options.query = arg.slice('--query='.length).trim();
      continue;
    }

    if (arg.startsWith('--locale=')) {
      options.locale = arg.slice('--locale='.length).trim() || DEFAULT_RETRIEVAL_LOCALE;
      continue;
    }

    if (arg === '--locale-en') {
      options.locale = 'en';
      continue;
    }

    if (arg.startsWith('--source-name=')) {
      options.sourceName = arg.slice('--source-name='.length).trim() || DEFAULT_ESCO_SOURCE_NAME;
      continue;
    }

    if (arg.startsWith('--limit=')) {
      options.limit = parsePositiveInteger('limit', arg.slice('--limit='.length));
      continue;
    }

    if (arg === '--help') {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!options.query) {
    throw new Error('Missing required --query argument.');
  }

  return options;
}

function parsePositiveInteger(name: string, value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`--${name} must be a positive integer.`);
  }

  return parsed;
}

function printHelp(): void {
  console.log('Usage: npm run rank:family-selection -- --query="Security Personnel" --locale=en');
  console.log('Runs the real pipeline (family stages only, in effect) and prints the full family selection authority breakdown per');
  console.log('ranked family, plus the decisive criterion that separates each pair of adjacent families in the final order.');
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
