import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const aggregate = JSON.parse(readFileSync(options.inputPath, 'utf8'));
  const seedProposals = buildSeedProposals(aggregate);

  mkdirSync(path.dirname(options.outPath), { recursive: true });
  writeFileSync(options.outPath, `${JSON.stringify(seedProposals, null, 2)}\n`, 'utf8');

  console.log(
    [
      `input=${options.inputPath}`,
      `out=${options.outPath}`,
      `common_role_phrase=${seedProposals.commonRolePhrases.length}`,
      `family_alias_anchor=${seedProposals.familyAliasAnchors.length}`,
      `noise_rule_complete=${seedProposals.noiseRules.complete.length}`,
      `noise_rule_incomplete=${seedProposals.noiseRules.incomplete.length}`
    ].join('  ')
  );
}

function parseCliOptions(args) {
  const options = {
    inputPath: path.join(process.cwd(), 'data', 'taxonomy-review', 'job-title-triage-proposals.ro.json'),
    outPath: path.join(process.cwd(), 'data', 'taxonomy-review', 'job-title-query-prep-seed-proposals.ro.json')
  };

  for (const arg of args) {
    if (arg.startsWith('--input=')) {
      options.inputPath = arg.slice('--input='.length).trim();
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
  console.log(
    [
      'Usage: node scripts/build-query-prep-seed-proposals.js',
      '[--input=data/taxonomy-review/job-title-triage-proposals.ro.json]',
      '[--out=data/taxonomy-review/job-title-query-prep-seed-proposals.ro.json]'
    ].join(' ')
  );
}

function buildSeedProposals(aggregate) {
  const proposals = Array.isArray(aggregate?.proposals) ? aggregate.proposals : [];

  return {
    generated_at: new Date().toISOString(),
    input_rows_reviewed: integerOrZero(aggregate?.rows_reviewed),
    input_unique_proposals: integerOrZero(aggregate?.unique_proposals),
    source_targets: {
      common_role_phrase: 'src/runtime/seeds/occupation-reviewed-common-role-phrases.json',
      family_alias_anchor: 'src/runtime/seeds/occupation-reviewed-family-alias-anchors.json',
      noise_rule: 'src/runtime/seeds/occupation-reviewed-noise-rules.json'
    },
    commonRolePhrases: proposals
      .filter((proposal) => proposal?.type === 'common_role_phrase')
      .map((proposal) => ({
        seed: {
          locale: stringOrEmpty(proposal.locale),
          surface: stringOrEmpty(proposal.surface),
          canonicalEnglish: stringOrEmpty(proposal.canonical_english),
          roleKey: stringOrEmpty(proposal.role_key) || roleKeyFromCanonical(proposal.canonical_english),
          priority: positiveIntegerOrDefault(proposal.priority, phrasePriorityFromProposal(proposal))
        },
        support: supportEnvelope(proposal)
      }))
      .filter((proposal) => isCompleteRolePhraseSeed(proposal.seed))
      .sort(compareSeedProposalSupport),
    familyAliasAnchors: proposals
      .filter((proposal) => proposal?.type === 'family_alias_anchor')
      .map((proposal) => ({
        seed: {
          locale: stringOrEmpty(proposal.locale),
          surface: stringOrEmpty(proposal.surface),
          canonicalEnglish: stringOrEmpty(proposal.canonical_english),
          roleKey: stringOrEmpty(proposal.role_key) || roleKeyFromCanonical(proposal.canonical_english),
          priority: positiveIntegerOrDefault(proposal.priority, phrasePriorityFromProposal(proposal))
        },
        support: supportEnvelope(proposal)
      }))
      .filter((proposal) => isCompleteRolePhraseSeed(proposal.seed))
      .sort(compareSeedProposalSupport),
    noiseRules: {
      complete: proposals
        .filter((proposal) => proposal?.type === 'noise_rule')
        .map((proposal) => ({
          seed: {
            locale: stringOrEmpty(proposal.locale),
            kind: stringOrEmpty(proposal.noise_rule_kind),
            matchType: stringOrEmpty(proposal.noise_match_type) || inferNoiseMatchType(proposal),
            confidence: confidenceScoreFromLabels(proposal.confidence_labels),
            terms: uniqueStrings([
              ...stringArray(proposal.query_terms_all),
              ...stringArray(proposal.query_terms_any),
              ...surfaceAsTerms(proposal.surface)
            ])
          },
          support: supportEnvelope(proposal)
        }))
        .filter((proposal) => isCompleteNoiseSeed(proposal.seed))
        .sort(compareSeedProposalSupport),
      incomplete: proposals
        .filter((proposal) => proposal?.type === 'noise_rule')
        .map((proposal) => ({
          required_fields: missingNoiseSeedFields(proposal),
          partial_seed: {
            locale: stringOrEmpty(proposal.locale),
            kind: stringOrEmpty(proposal.noise_rule_kind),
            matchType: stringOrEmpty(proposal.noise_match_type) || inferNoiseMatchType(proposal),
            confidence: confidenceScoreFromLabels(proposal.confidence_labels),
            terms: uniqueStrings([
              ...stringArray(proposal.query_terms_all),
              ...stringArray(proposal.query_terms_any),
              ...surfaceAsTerms(proposal.surface)
            ])
          },
          support: supportEnvelope(proposal)
        }))
        .filter((proposal) => proposal.required_fields.length > 0)
        .sort(compareSupportOnly)
    }
  };
}

function supportEnvelope(proposal) {
  return {
    occurrences: integerOrZero(proposal.occurrences),
    confidence_labels: uniqueStrings(stringArray(proposal.confidence_labels)),
    row_indexes: uniqueIntegers(integerArray(proposal.row_indexes)),
    rationales: uniqueStrings(stringArray(proposal.rationales)).slice(0, 8)
  };
}

function compareSeedProposalSupport(left, right) {
  return (
    right.support.occurrences - left.support.occurrences ||
    right.seed.locale.localeCompare(left.seed.locale) ||
    JSON.stringify(left.seed).localeCompare(JSON.stringify(right.seed))
  );
}

function compareSupportOnly(left, right) {
  return (
    right.support.occurrences - left.support.occurrences ||
    JSON.stringify(left.partial_seed).localeCompare(JSON.stringify(right.partial_seed))
  );
}

function isCompleteRolePhraseSeed(seed) {
  return Boolean(seed.locale && seed.surface && seed.canonicalEnglish && seed.roleKey && seed.priority > 0);
}

function isCompleteNoiseSeed(seed) {
  return Boolean(seed.locale && seed.kind && seed.matchType && seed.terms.length > 0);
}

function missingNoiseSeedFields(proposal) {
  const missing = [];

  if (!stringOrEmpty(proposal.locale)) {
    missing.push('locale');
  }
  if (!stringOrEmpty(proposal.noise_rule_kind)) {
    missing.push('noise_rule_kind');
  }
  if (!inferNoiseMatchType(proposal)) {
    missing.push('noise_match_type_or_terms');
  }
  if (
    uniqueStrings([...stringArray(proposal.query_terms_all), ...stringArray(proposal.query_terms_any), ...surfaceAsTerms(proposal.surface)])
      .length === 0
  ) {
    missing.push('terms');
  }

  return missing;
}

function inferNoiseMatchType(proposal) {
  const explicit = stringOrEmpty(proposal.noise_match_type);
  if (explicit === 'token' || explicit === 'phrase') {
    return explicit;
  }

  const terms = uniqueStrings([
    ...stringArray(proposal.query_terms_all),
    ...stringArray(proposal.query_terms_any),
    ...surfaceAsTerms(proposal.surface)
  ]);
  if (terms.length === 0) {
    return '';
  }

  return terms.some((term) => term.includes(' ')) ? 'phrase' : 'token';
}

function phrasePriorityFromProposal(proposal) {
  const occurrences = integerOrZero(proposal.occurrences);
  return Math.max(90, Math.min(99, 90 + occurrences));
}

function confidenceScoreFromLabels(labels) {
  const labelSet = new Set(stringArray(labels));
  if (labelSet.has('high')) {
    return 0.95;
  }
  if (labelSet.has('medium')) {
    return 0.85;
  }
  return 0.75;
}

function roleKeyFromCanonical(value) {
  return stringOrEmpty(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}

function surfaceAsTerms(value) {
  const surface = stringOrEmpty(value);
  return surface ? [surface] : [];
}

function stringOrEmpty(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function positiveIntegerOrDefault(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function integerOrZero(value) {
  return Number.isInteger(value) ? value : 0;
}

function stringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function integerArray(value) {
  return Array.isArray(value) ? value.filter((item) => Number.isInteger(item)) : [];
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function uniqueIntegers(values) {
  return [...new Set(values)].sort((left, right) => left - right);
}

main().catch((error) => {
  console.error('Query-prep seed proposal build failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
