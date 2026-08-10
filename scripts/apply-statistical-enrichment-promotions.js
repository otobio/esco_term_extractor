import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const report = JSON.parse(readFileSync(options.reportPath, 'utf8'));
  const thresholds = JSON.parse(readFileSync(options.thresholdsPath, 'utf8'));
  const seedPaths = buildSeedPaths(process.cwd());
  const commonRolePhrases = JSON.parse(readFileSync(seedPaths.commonRolePhrases, 'utf8'));
  const familyAliasAnchors = JSON.parse(readFileSync(seedPaths.familyAliasAnchors, 'utf8'));
  const noiseRules = JSON.parse(readFileSync(seedPaths.noiseRules, 'utf8'));
  const provenance = {
    generated_at: new Date().toISOString(),
    locale: options.locale,
    report_path: options.reportPath,
    thresholds_path: options.thresholdsPath,
    applied: [],
    skipped: []
  };

  const candidates = Array.isArray(report.candidates) ? report.candidates : [];
  const approvedTypes = new Set(stringArray(thresholds.approvedAutoPromotionTypes));

  for (const candidate of candidates) {
    if (candidate.locale !== options.locale) {
      continue;
    }
    if (candidate.auto_decision !== 'promote') {
      provenance.skipped.push(skipRecord(candidate, 'not_marked_for_auto_promotion'));
      continue;
    }
    if (!approvedTypes.has(candidate.candidate_type)) {
      provenance.skipped.push(skipRecord(candidate, 'candidate_type_not_approved'));
      continue;
    }
    if (!candidate.proposed_seed || typeof candidate.proposed_seed !== 'object') {
      provenance.skipped.push(skipRecord(candidate, 'missing_proposed_seed'));
      continue;
    }

    if (candidate.candidate_type === 'common_role_phrase') {
      const seed = normalizePhraseSeed(candidate.proposed_seed);
      if (!isCompletePhraseSeed(seed)) {
        provenance.skipped.push(skipRecord(candidate, 'incomplete_common_role_seed'));
        continue;
      }
      if (hasPhraseSeed(commonRolePhrases, seed)) {
        provenance.skipped.push(skipRecord(candidate, 'already_present_common_role'));
        continue;
      }
      commonRolePhrases.push(seed);
      provenance.applied.push(applyRecord(candidate, seedPaths.commonRolePhrases, seed));
      continue;
    }

    if (candidate.candidate_type === 'family_alias_anchor') {
      const seed = normalizePhraseSeed(candidate.proposed_seed);
      if (!isCompletePhraseSeed(seed)) {
        provenance.skipped.push(skipRecord(candidate, 'incomplete_family_alias_seed'));
        continue;
      }
      if (hasPhraseSeed(familyAliasAnchors, seed)) {
        provenance.skipped.push(skipRecord(candidate, 'already_present_family_alias'));
        continue;
      }
      familyAliasAnchors.push(seed);
      provenance.applied.push(applyRecord(candidate, seedPaths.familyAliasAnchors, seed));
      continue;
    }

    if (candidate.candidate_type === 'noise_rule') {
      const seed = normalizeNoiseSeed(candidate.proposed_seed);
      if (!isCompleteNoiseSeed(seed)) {
        provenance.skipped.push(skipRecord(candidate, 'incomplete_noise_seed'));
        continue;
      }
      if (hasNoiseSeed(noiseRules, seed)) {
        provenance.skipped.push(skipRecord(candidate, 'already_present_noise_rule'));
        continue;
      }
      noiseRules.push(seed);
      provenance.applied.push(applyRecord(candidate, seedPaths.noiseRules, seed));
    }
  }

  sortPhraseSeeds(commonRolePhrases);
  sortPhraseSeeds(familyAliasAnchors);
  sortNoiseSeeds(noiseRules);

  if (!options.dryRun) {
    writeFileSync(seedPaths.commonRolePhrases, `${JSON.stringify(commonRolePhrases, null, 2)}\n`, 'utf8');
    writeFileSync(seedPaths.familyAliasAnchors, `${JSON.stringify(familyAliasAnchors, null, 2)}\n`, 'utf8');
    writeFileSync(seedPaths.noiseRules, `${JSON.stringify(noiseRules, null, 2)}\n`, 'utf8');
  }

  mkdirSync(path.dirname(options.provenancePath), { recursive: true });
  writeFileSync(options.provenancePath, `${JSON.stringify(provenance, null, 2)}\n`, 'utf8');

  console.log(
    [
      `locale=${options.locale}`,
      `applied=${provenance.applied.length}`,
      `skipped=${provenance.skipped.length}`,
      `dry_run=${options.dryRun}`,
      `provenance=${options.provenancePath}`
    ].join('  ')
  );
}

function parseCliOptions(args) {
  const locale = readLocaleArg(args) || 'hu';
  const base = path.join(process.cwd(), 'data', 'taxonomy-review');
  const options = {
    locale,
    reportPath: path.join(base, `job-title-statistical-candidates.${locale}.json`),
    thresholdsPath: path.join(process.cwd(), 'src', 'runtime', 'seeds', 'enrichment-promotion-thresholds.json'),
    provenancePath: path.join(base, `job-title-statistical-auto-promotions.${locale}.json`),
    dryRun: false
  };

  for (const arg of args) {
    if (arg.startsWith('--locale=')) {
      options.locale = arg.slice('--locale='.length).trim();
      continue;
    }
    if (arg.startsWith('--report=')) {
      options.reportPath = arg.slice('--report='.length).trim();
      continue;
    }
    if (arg.startsWith('--thresholds=')) {
      options.thresholdsPath = arg.slice('--thresholds='.length).trim();
      continue;
    }
    if (arg.startsWith('--provenance=')) {
      options.provenancePath = arg.slice('--provenance='.length).trim();
      continue;
    }
    if (arg === '--dry-run') {
      options.dryRun = true;
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
      'Usage: node scripts/apply-statistical-enrichment-promotions.js',
      '[--locale=hu]',
      '[--report=data/taxonomy-review/job-title-statistical-candidates.hu.json]',
      '[--thresholds=src/runtime/seeds/enrichment-promotion-thresholds.json]',
      '[--provenance=data/taxonomy-review/job-title-statistical-auto-promotions.hu.json]',
      '[--dry-run]'
    ].join(' ')
  );
}

function readLocaleArg(args) {
  for (const arg of args) {
    if (arg.startsWith('--locale=')) {
      return arg.slice('--locale='.length).trim();
    }
  }
  return '';
}

function buildSeedPaths(repoRoot) {
  return {
    commonRolePhrases: path.join(repoRoot, 'src', 'runtime', 'seeds', 'occupation-reviewed-common-role-phrases.json'),
    familyAliasAnchors: path.join(repoRoot, 'src', 'runtime', 'seeds', 'occupation-reviewed-family-alias-anchors.json'),
    noiseRules: path.join(repoRoot, 'src', 'runtime', 'seeds', 'occupation-reviewed-noise-rules.json')
  };
}

function normalizePhraseSeed(seed) {
  return {
    locale: String(seed.locale || '').trim(),
    surface: String(seed.surface || '').trim(),
    canonicalEnglish: String(seed.canonicalEnglish || '').trim(),
    roleKey: String(seed.roleKey || '').trim(),
    priority: Number.isInteger(seed.priority) ? seed.priority : 91
  };
}

function normalizeNoiseSeed(seed) {
  return {
    locale: String(seed.locale || '').trim(),
    kind: String(seed.kind || '').trim(),
    matchType: String(seed.matchType || '').trim(),
    confidence: typeof seed.confidence === 'number' ? seed.confidence : 0.8,
    terms: stringArray(seed.terms)
  };
}

function isCompletePhraseSeed(seed) {
  return Boolean(seed.locale && seed.surface && seed.canonicalEnglish && seed.roleKey && seed.priority > 0);
}

function isCompleteNoiseSeed(seed) {
  return Boolean(seed.locale && seed.kind && seed.matchType && seed.terms.length > 0);
}

function hasPhraseSeed(items, seed) {
  const key = phraseKey(seed);
  return items.some((item) => phraseKey(item) === key);
}

function hasNoiseSeed(items, seed) {
  const key = noiseKey(seed);
  return items.some((item) => noiseKey(item) === key);
}

function phraseKey(seed) {
  return [seed.locale, normalizeText(seed.surface), normalizeText(seed.canonicalEnglish), seed.roleKey].join('\u0000');
}

function noiseKey(seed) {
  return [seed.locale, seed.kind, seed.matchType, stringArray(seed.terms).map(normalizeText).sort().join('|')].join('\u0000');
}

function sortPhraseSeeds(items) {
  items.sort(
    (left, right) =>
      left.locale.localeCompare(right.locale) ||
      normalizeText(left.surface).localeCompare(normalizeText(right.surface)) ||
      left.canonicalEnglish.localeCompare(right.canonicalEnglish)
  );
}

function sortNoiseSeeds(items) {
  items.sort(
    (left, right) =>
      left.locale.localeCompare(right.locale) ||
      left.kind.localeCompare(right.kind) ||
      left.matchType.localeCompare(right.matchType) ||
      left.terms.join('|').localeCompare(right.terms.join('|'))
  );
}

function applyRecord(candidate, targetPath, seed) {
  return {
    candidate_type: candidate.candidate_type,
    locale: candidate.locale,
    surface: candidate.surface,
    auto_decision_reason: candidate.auto_decision_reason,
    promotion_basis: candidate.promotion_basis,
    target_path: targetPath,
    seed,
    support_stats_snapshot: snapshotStats(candidate)
  };
}

function skipRecord(candidate, reason) {
  return {
    candidate_type: candidate.candidate_type,
    locale: candidate.locale,
    surface: candidate.surface,
    reason,
    support_stats_snapshot: snapshotStats(candidate)
  };
}

function snapshotStats(candidate) {
  return {
    title_occurrences: candidate.title_occurrences,
    distinct_title_count: candidate.distinct_title_count,
    distinct_chunk_count: candidate.distinct_chunk_count,
    coverage_per_1000: candidate.coverage_per_1000,
    top_canonical_target: candidate.top_canonical_target,
    top_target_support: candidate.top_target_support,
    top_family_id: candidate.top_family_id,
    top_family_label: candidate.top_family_label,
    top_family_support: candidate.top_family_support,
    decision_markers: Array.isArray(candidate.decision_markers) ? candidate.decision_markers : []
  };
}

function stringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

main().catch((error) => {
  console.error('Applying statistical enrichment promotions failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
