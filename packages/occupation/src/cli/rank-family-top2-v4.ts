import { DEFAULT_ESCO_SOURCE_NAME, DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import { cleanOccupationQuerySurface } from '../query/occupation-query-cleaning.js';
import { prepareQuery } from '../query/query-preparation.js';
import { loadOccupationFamilyProfileArtifactRequired } from '../runtime/occupation-family-profile-artifact.js';
import { loadOccupationFamilyTokenRelevanceArtifactRequired } from '../runtime/occupation-family-token-relevance-artifact.js';
import { loadOccupationLeafStructureArtifactRequired } from '../runtime/occupation-leaf-structure-artifact.js';
import { loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';
import {
  rankFamilyTop2V4,
  type FamilyTop2V4ClassifierQuery,
  type FamilyTop2V4FamilyHit,
  type FamilyTop2V4Result
} from './rank-family-top2-v4-core.js';

type OutputFormat = 'text' | 'json';

type CliOptions = {
  query: string;
  locale: string;
  sourceName: string;
  limit: number;
  format: OutputFormat;
};

async function main(): Promise<void> {
  const options = parseCliOptions(process.argv.slice(2));
  const cleanedQuery = await cleanOccupationQuerySurface(options.query, options.locale);
  const effectiveQuery = cleanedQuery || options.query;
  const preparedQuery = await prepareQuery(effectiveQuery, options.locale, { sourceName: options.sourceName });
  const [familyProfileArtifact, familyTokenRelevanceArtifact, searchMetaArtifact, leafStructureArtifact] = await Promise.all([
    loadOccupationFamilyProfileArtifactRequired(options.sourceName),
    Promise.resolve(loadOccupationFamilyTokenRelevanceArtifactRequired(options.sourceName)),
    loadOccupationSearchMetaArtifactRequired(options.sourceName),
    loadOccupationLeafStructureArtifactRequired(options.sourceName)
  ]);

  const query: FamilyTop2V4ClassifierQuery = {
    preparedQuery,
    rawQuery: options.query,
    effectiveQuery,
    locale: options.locale,
    sourceName: options.sourceName
  };

  const result = rankFamilyTop2V4({
    familyProfileArtifact,
    searchMetaArtifact,
    leafStructureArtifact,
    familyTokenRelevanceArtifact,
    query,
    limit: options.limit
  });

  console.log(formatResult(result, options.format));
}

function formatResult(result: FamilyTop2V4Result, format: OutputFormat): string {
  if (format === 'json') {
    return JSON.stringify(result, null, 2);
  }

  const lines: string[] = [];
  const preparedQuery = result.query.preparedQuery;

  lines.push(`Family top-2 classifier v4: "${result.query.rawQuery}"`);
  lines.push(`locale=${result.query.locale}  source_name=${result.query.sourceName}  mode=specificity_direction`);
  lines.push(`cleaned_query="${result.query.effectiveQuery}"`);
  lines.push(`query_vector=${result.queryVector.map((term) => `${term.kind}:${term.token}`).join(',') || 'none'}`);
  lines.push(`query_specificity=${result.querySpecificity.toFixed(3)}`);
  lines.push(`role_tokens=${preparedQuery.intent.roleTokens.join(',') || 'none'}`);
  lines.push(`role_head_tokens=${preparedQuery.intent.authoritativeRoleHeadTokens.join(',') || 'none'}`);
  lines.push(`domain_tokens=${preparedQuery.intent.domainTokens.join(',') || 'none'}`);

  if (result.rankedFamilies.length === 0) {
    lines.push('ranked_families=none');
    return lines.join('\n');
  }

  lines.push('');

  for (const family of result.rankedFamilies) {
    lines.push(formatFamilyHit(family));
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function formatFamilyHit(family: FamilyTop2V4FamilyHit): string {
  return [
    `${family.rank}. "${family.familyLabel}" #${family.familyNodeId} score=${family.score.toFixed(3)} base=${family.baseCosine.toFixed(3)} hierarchy=${family.hierarchyCosine.toFixed(3)} alignment=${family.specificityAlignment.toFixed(3)} dir=${family.specificityDirection} gap=${family.specificityGap.toFixed(3)}`,
    `   query_specificity=${family.querySpecificity.toFixed(3)} family_specificity=${family.familySpecificity.toFixed(3)} family_broadness=${family.familyBroadness.toFixed(3)}`,
    `   exact_family_label_phrase=${family.exactFamilyLabelPhrase}`,
    `   useful_family_label_phrase=${family.usefulFamilyLabelPhrase}`,
    `   hierarchy_exact_phrase=${family.hierarchyExactPhrase}`,
    `   hierarchy_useful_phrase=${family.hierarchyUsefulPhrase}`,
    `   generic_risk=${family.genericRisk} has_hierarchy=${family.hasHierarchy} has_capability_support=${family.hasCapabilitySupport}`,
    `   specificity leaf_count=${family.specificityStats.leafCount} specialization_leaf_count=${family.specificityStats.specializationLeafCount} generic_base_leaf_count=${family.specificityStats.genericBaseLeafCount} authority_leaf_count=${family.specificityStats.authorityLeafCount} specialized_base_leaf_count=${family.specificityStats.specializedBaseLeafCount} unique_specialization_kind_count=${family.specificityStats.uniqueSpecializationKindCount} hierarchy_depth=${family.specificityStats.hierarchyDepth} sibling_count=${family.specificityStats.siblingCount}`,
    `   matched_terms=${family.matchedTerms.join(',') || 'none'}`,
    `   missing_terms=${family.missingTerms.join(',') || 'none'}`,
    `   matched_role_terms=${family.matchedRoleTerms.join(',') || 'none'}`,
    `   matched_domain_terms=${family.matchedDomainTerms.join(',') || 'none'}`,
    `   matched_sources=${family.matchedSources.join(',') || 'none'}`,
    `   matched_hierarchy_labels=${family.matchedHierarchyLabels.join(',') || 'none'}`,
    `   matched_sibling_labels=${family.matchedSiblingLabels.join(',') || 'none'}`,
    `   matching_leaf_count=${family.matchingLeafCount} profile_leaf_count=${family.profileLeafCount}`,
    `   breakdown base=${family.scoreBreakdown.baseVector.toFixed(3)} hierarchy=${family.scoreBreakdown.hierarchyVector.toFixed(3)} alignment=${family.scoreBreakdown.specificityAlignment.toFixed(3)} specificity_penalty=${family.scoreBreakdown.specificityPenalty.toFixed(3)} phrase=${family.scoreBreakdown.phrase.toFixed(3)} coverage=${family.scoreBreakdown.coverage.toFixed(3)} role_coverage=${family.scoreBreakdown.roleCoverage.toFixed(3)} domain_coverage=${family.scoreBreakdown.domainCoverage.toFixed(3)} base_bonus=${family.scoreBreakdown.baseFamilyBonus.toFixed(3)} specialized_bonus=${family.scoreBreakdown.specializedFamilyBonus.toFixed(3)} query_specificity=${family.scoreBreakdown.querySpecificity.toFixed(3)} family_specificity=${family.scoreBreakdown.familySpecificity.toFixed(3)}`
  ].join('\n');
}

function parseCliOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    query: '',
    locale: DEFAULT_RETRIEVAL_LOCALE,
    sourceName: DEFAULT_ESCO_SOURCE_NAME,
    limit: 2,
    format: 'text'
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

    if (arg.startsWith('--format=')) {
      options.format = parseFormat(arg.slice('--format='.length));
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

function parsePositiveInteger(label: string, value: string): number {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${label}: ${value}`);
  }

  return parsed;
}

function parseFormat(value: string): OutputFormat {
  if (value === 'json' || value === 'text') {
    return value;
  }

  throw new Error(`Invalid format: ${value}`);
}

function printHelp(): void {
  console.log(
    [
      'Usage: node dist/cli/rank-family-top2-v4.js',
      '--query="software developer"',
      `[--locale=${DEFAULT_RETRIEVAL_LOCALE}]`,
      `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
      '[--limit=2]',
      '[--format=text|json]'
    ].join(' ')
  );
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Family top-2 classifier v4 failed.');
  console.error(message);
  process.exitCode = 1;
});
