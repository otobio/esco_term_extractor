import { readFileSync } from 'node:fs';
import path from 'node:path';
import { DEFAULT_ESCO_SOURCE_NAME } from '../dist/retrieval/occupation-candidates.js';
import { OccupationRuntimeContext } from '../dist/runtime/occupation-runtime-context.js';
import { OccupationSearchPipeline } from '../dist/search-pipeline/occupation-search-pipeline.js';

const RELEVANCE_ARTIFACT_PATH = path.join(
  process.cwd(),
  'artifacts',
  'runtime',
  `occupation-family-token-relevance.${DEFAULT_ESCO_SOURCE_NAME}.json`
);

const QUERIES = [{ query: 'Sales Personnel', locale: 'en' }];

const COMBINATION_VARIANTS = ['mean', 'min', 'max'];

async function main() {
  const relevance = JSON.parse(readFileSync(RELEVANCE_ARTIFACT_PATH, 'utf8'));
  const runtime = await OccupationRuntimeContext.load({ sourceName: DEFAULT_ESCO_SOURCE_NAME });
  const pipeline = OccupationSearchPipeline.withRuntime(runtime);

  for (const { query, locale } of QUERIES) {
    const result = await pipeline.run({ query, locale, sourceName: DEFAULT_ESCO_SOURCE_NAME, limit: 50 });
    reportExactNgramAliasTable(query, locale, result, relevance);
    reportApproximateReaggregation(query, locale, result, relevance);
  }
}

function reportExactNgramAliasTable(query, locale, result, relevance) {
  console.log(`\n=== EXACT: ngram_alias evidence before/after — query="${query}" locale=${locale} ===`);

  for (const variant of COMBINATION_VARIANTS) {
    console.log(`\n-- combination=${variant} --`);
    const rows = [];

    for (const family of result.rankedFamilies) {
      const ngramEvidence = family.evidence.filter((e) => e.channel === 'ngram_alias');

      if (ngramEvidence.length === 0) {
        continue;
      }

      for (const evidence of ngramEvidence) {
        const multiplier = shadowMultiplier(family.familyNodeId, evidence, locale, relevance, variant);
        rows.push({
          family_node_id: family.familyNodeId,
          family_label: family.familyLabel,
          alias: evidence.details.alias ?? evidence.details.normalized_alias,
          matched_tokens: (evidence.details.matched_tokens ?? []).join(','),
          before: round(evidence.score),
          multiplier: round(multiplier),
          after: round(evidence.score * multiplier)
        });
      }
    }

    rows.sort((a, b) => b.after - a.after);
    console.table(rows);
  }
}

function reportApproximateReaggregation(query, locale, result, relevance) {
  console.log(`\n=== APPROXIMATE re-aggregation (max ngram_alias only, does NOT replicate FAMILY_SCORING_POLICY) — query="${query}" ===`);

  const rows = result.rankedFamilies.map((family) => {
    const ngramEvidence = family.evidence.filter((e) => e.channel === 'ngram_alias');
    const before = ngramEvidence.length ? Math.max(...ngramEvidence.map((e) => e.score)) : 0;
    const after = ngramEvidence.length
      ? Math.max(...ngramEvidence.map((e) => e.score * shadowMultiplier(family.familyNodeId, e, locale, relevance, 'mean')))
      : 0;

    return {
      family_node_id: family.familyNodeId,
      family_label: family.familyLabel,
      family_score_unchanged: round(family.score),
      ngram_alias_before: round(before),
      ngram_alias_after: round(after),
      delta: round(after - before)
    };
  });

  rows.sort((a, b) => b.ngram_alias_after - a.ngram_alias_after);
  console.table(rows);
}

function shadowMultiplier(familyNodeId, evidenceRecord, locale, relevance, variant) {
  const matchedTokens = evidenceRecord.details.matched_tokens ?? [];

  if (matchedTokens.length === 0) {
    return 1;
  }

  const familyTokens = relevance.familiesByLocale[locale]?.find((f) => f.familyNodeId === familyNodeId)?.tokens ?? {};
  const genericity = relevance.genericityByLocale[locale] ?? {};
  // No entry for this family means its occurrences fell below the artifact's noise floor —
  // treat as "no evidence of concentration" (0), not "as relevant as the best family" (1).
  const perToken = matchedTokens.map((token) => familyTokens[token]?.relevance ?? 0);
  const maxGenericity = matchedTokens.map((token) => genericity[token]?.maxRelevance ?? 1);
  const normalized = perToken.map((value, index) => (maxGenericity[index] > 0 ? value / maxGenericity[index] : 1));

  if (variant === 'min') {
    return Math.min(...normalized);
  }

  if (variant === 'max') {
    return Math.max(...normalized);
  }

  return normalized.reduce((sum, value) => sum + value, 0) / normalized.length;
}

function round(value) {
  return Number(value.toFixed(6));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
