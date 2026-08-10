import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const thresholds = JSON.parse(readFileSync(options.thresholdsPath, 'utf8'));
  const seedState = loadSeedState(options.repoRoot);
  const manifest = JSON.parse(readFileSync(options.manifestPath, 'utf8'));
  const rows = readJsonLines(options.pilotPath);
  const chunkRanges = buildChunkRanges(manifest);
  const phraseCandidates = buildPhraseCandidates(rows, chunkRanges, manifest, thresholds, seedState, options.locale);
  const noiseCandidates = buildNoiseCandidates(options.noiseCsvPath, manifest, thresholds, seedState, options.locale);
  const candidates = [...phraseCandidates, ...noiseCandidates].sort(compareCandidates);

  const report = {
    generated_at: new Date().toISOString(),
    locale: options.locale,
    source_pilot_path: options.pilotPath,
    source_manifest_path: options.manifestPath,
    source_noise_csv_path: options.noiseCsvPath,
    source_title_count: numberOrZero(manifest.source_title_count) || rows.length,
    reviewed_row_count: rows.length,
    thresholds_path: options.thresholdsPath,
    summary: summarizeCandidates(candidates),
    candidates
  };

  mkdirSync(path.dirname(options.outJsonPath), { recursive: true });
  writeFileSync(options.outJsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  writeFileSync(options.outCsvPath, toCsv(candidates), 'utf8');

  console.log(
    [
      `locale=${options.locale}`,
      `rows=${rows.length}`,
      `candidates=${candidates.length}`,
      `promote=${report.summary.promote}`,
      `review=${report.summary.review}`,
      `reject=${report.summary.reject}`,
      `out_json=${options.outJsonPath}`,
      `out_csv=${options.outCsvPath}`
    ].join('  ')
  );
}

function parseCliOptions(args) {
  const locale = readLocaleArg(args) || 'hu';
  const base = path.join(process.cwd(), 'data', 'taxonomy-review');
  const options = {
    repoRoot: process.cwd(),
    locale,
    pilotPath: path.join(base, `job-title-triage-pilot.${locale}.jsonl`),
    manifestPath: path.join(base, `job-title-triage-pilot.${locale}.manifest.json`),
    noiseCsvPath: path.join(base, `job-title-noise-patterns.${locale}.csv`),
    thresholdsPath: path.join(process.cwd(), 'src', 'runtime', 'seeds', 'enrichment-promotion-thresholds.json'),
    outJsonPath: path.join(base, `job-title-statistical-candidates.${locale}.json`),
    outCsvPath: path.join(base, `job-title-statistical-candidates.${locale}.csv`)
  };

  for (const arg of args) {
    if (arg.startsWith('--locale=')) {
      options.locale = arg.slice('--locale='.length).trim();
      continue;
    }
    if (arg.startsWith('--pilot=')) {
      options.pilotPath = arg.slice('--pilot='.length).trim();
      continue;
    }
    if (arg.startsWith('--manifest=')) {
      options.manifestPath = arg.slice('--manifest='.length).trim();
      continue;
    }
    if (arg.startsWith('--noise-csv=')) {
      options.noiseCsvPath = arg.slice('--noise-csv='.length).trim();
      continue;
    }
    if (arg.startsWith('--thresholds=')) {
      options.thresholdsPath = arg.slice('--thresholds='.length).trim();
      continue;
    }
    if (arg.startsWith('--out-json=')) {
      options.outJsonPath = arg.slice('--out-json='.length).trim();
      continue;
    }
    if (arg.startsWith('--out-csv=')) {
      options.outCsvPath = arg.slice('--out-csv='.length).trim();
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
      'Usage: node scripts/build-statistical-enrichment-candidates.js',
      '[--locale=hu]',
      '[--pilot=data/taxonomy-review/job-title-triage-pilot.hu.jsonl]',
      '[--manifest=data/taxonomy-review/job-title-triage-pilot.hu.manifest.json]',
      '[--noise-csv=data/taxonomy-review/job-title-noise-patterns.hu.csv]',
      '[--thresholds=src/runtime/seeds/enrichment-promotion-thresholds.json]',
      '[--out-json=data/taxonomy-review/job-title-statistical-candidates.hu.json]',
      '[--out-csv=data/taxonomy-review/job-title-statistical-candidates.hu.csv]'
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

function loadSeedState(repoRoot) {
  const commonRolePhrases = JSON.parse(
    readFileSync(path.join(repoRoot, 'src', 'runtime', 'seeds', 'occupation-reviewed-common-role-phrases.json'), 'utf8')
  );
  const familyAliasAnchors = JSON.parse(
    readFileSync(path.join(repoRoot, 'src', 'runtime', 'seeds', 'occupation-reviewed-family-alias-anchors.json'), 'utf8')
  );
  const noiseRules = JSON.parse(
    readFileSync(path.join(repoRoot, 'src', 'runtime', 'seeds', 'occupation-reviewed-noise-rules.json'), 'utf8')
  );

  return {
    commonRolePhrases,
    familyAliasAnchors,
    noiseRules: new Set(noiseRules.map((entry) => noiseSeedKey(entry.locale, entry.kind, entry.matchType, entry.terms)))
  };
}

function readJsonLines(filePath) {
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSON at line ${index + 1} in ${filePath}: ${String(error)}`);
      }
    });
}

function buildChunkRanges(manifest) {
  const chunks = Array.isArray(manifest?.chunks) ? manifest.chunks : [];
  if (chunks.length === 0) {
    return [{ start: 1, end: Number.MAX_SAFE_INTEGER, index: 1 }];
  }

  const ranges = [];
  let cursor = 1;
  for (const [index, chunk] of chunks.entries()) {
    const records = numberOrZero(chunk.records);
    if (records <= 0) {
      continue;
    }
    ranges.push({ start: cursor, end: cursor + records - 1, index: index + 1 });
    cursor += records;
  }
  return ranges.length > 0 ? ranges : [{ start: 1, end: Number.MAX_SAFE_INTEGER, index: 1 }];
}

function buildPhraseCandidates(rows, chunkRanges, manifest, thresholds, seedState, locale) {
  const occurrenceMap = new Map();
  const sourceTitleCount = numberOrZero(manifest.source_title_count) || rows.length;

  rows.forEach((row, index) => {
    const phrase = extractPhraseSurface(row);
    if (!phrase) {
      return;
    }

    const normalizedSurface = normalizeText(phrase);
    const tokens = tokenizeSurface(phrase);
    const foldedTokens = tokens.map((token) => normalizeText(token));
    const singleTokenFlag = tokens.length <= 1;
    const broadWrapperTokenCount = foldedTokens.filter((token) => wrapperTokenSet(thresholds, locale).has(token)).length;
    const broadWrapperFlag = broadWrapperTokenCount > 0;
    const blockedSurfaceSubstring = blockedSubstrings(thresholds, locale).find((fragment) => normalizedSurface.includes(fragment)) || '';
    const matchedRoleTokens = stringArray(row?.coverage_signals?.matched_role_tokens).map(normalizeText);
    const roleTokens = stringArray(row?.prepared_query?.intent?.role_tokens).map(normalizeText);
    const topFamily = topFamilyEntry(row);
    const targetLabel = topTargetLabel(row, topFamily);
    const candidateKey = `${locale}\u0000${normalizedSurface}`;
    const candidate =
      occurrenceMap.get(candidateKey) ||
      createPhraseCandidate({
        locale,
        surface: phrase,
        normalizedSurface,
        tokens,
        sourceTitleCount,
        seedState,
        blockedSurfaceSubstring,
        broadWrapperFlag,
        singleTokenFlag
      });

    candidate.titleOccurrences += 1;
    candidate.distinctTitles.add(normalizeText(String(row?.original_title ?? phrase)));
    candidate.distinctChunks.add(chunkIndexForRow(index + 1, chunkRanges));
    candidate.rowIndexes.push(numberOrZero(row?.row_index));
    candidate.sourceKinds.add(phraseSourceKind(row));
    candidate.roleCoverageNumerator += coverageRatio(matchedRoleTokens, roleTokens);
    candidate.existingRuntimeMatchCount += row?.prepared_query?.common_role_phrase || row?.prepared_query?.family_alias_match ? 1 : 0;

    const familyKey = familyKeyFromTopFamily(topFamily);
    if (familyKey) {
      candidate.familyCounts.set(familyKey, (candidate.familyCounts.get(familyKey) || 0) + 1);
    }
    if (targetLabel) {
      candidate.targetCounts.set(targetLabel, (candidate.targetCounts.get(targetLabel) || 0) + 1);
    }

    occurrenceMap.set(candidateKey, candidate);
  });

  return Array.from(occurrenceMap.values())
    .map((candidate) => finalizePhraseCandidate(candidate, thresholds, locale))
    .filter(Boolean);
}

function extractPhraseSurface(row) {
  if (!row || row.decision_type === 'noise_only' || row.decision_type === 'multi_span') {
    return '';
  }

  if (row?.prepared_query?.common_role_phrase?.surface || row?.prepared_query?.family_alias_match?.surface) {
    return '';
  }

  const spans = stringArray(row?.query_spans);
  if (spans.length !== 1) {
    return '';
  }

  const surface = String(row?.effective_query || '').trim();
  if (!surface) {
    return '';
  }

  return collapseWhitespace(surface);
}

function createPhraseCandidate({
  locale,
  surface,
  normalizedSurface,
  tokens,
  sourceTitleCount,
  seedState,
  blockedSurfaceSubstring,
  broadWrapperFlag,
  singleTokenFlag
}) {
  return {
    candidateType: 'phrase_candidate',
    locale,
    surface,
    normalizedSurface,
    tokenCount: tokens.length,
    sourceTitleCount,
    titleOccurrences: 0,
    distinctTitles: new Set(),
    distinctChunks: new Set(),
    rowIndexes: [],
    sourceKinds: new Set(),
    roleCoverageNumerator: 0,
    existingRuntimeMatchCount: 0,
    familyCounts: new Map(),
    targetCounts: new Map(),
    blockedSurfaceSubstring,
    broadWrapperFlag,
    singleTokenFlag,
    seedState
  };
}

function finalizePhraseCandidate(candidate, thresholds, locale) {
  const topTarget = topCountEntry(candidate.targetCounts);
  const topFamily = topCountEntry(candidate.familyCounts);
  const titleOccurrences = candidate.titleOccurrences;
  if (titleOccurrences <= 0) {
    return null;
  }

  const topTargetSupport = ratio(topTarget?.count, titleOccurrences);
  const topFamilySupport = ratio(topFamily?.count, titleOccurrences);
  const distinctTitleCount = candidate.distinctTitles.size;
  const distinctChunkCount = candidate.distinctChunks.size;
  const coveragePer1000 = per1000(titleOccurrences, candidate.sourceTitleCount);
  const avgRoleCoverage = candidate.roleCoverageNumerator / titleOccurrences;
  const canonicalEnglish = topTarget?.value || '';
  const roleKey = roleKeyFromCanonical(canonicalEnglish);
  const noiseOverlapScore = candidate.broadWrapperFlag ? Math.min(1, 0.35 + candidate.tokenCount * 0.05) : 0;
  const alreadyPresentCommonRole = hasPhraseSeed(
    candidate.seedState.commonRolePhrases,
    candidate.locale,
    candidate.surface,
    canonicalEnglish,
    roleKey
  );
  const alreadyPresentFamilyAlias = hasPhraseSeed(
    candidate.seedState.familyAliasAnchors,
    candidate.locale,
    candidate.surface,
    canonicalEnglish,
    roleKey
  );
  const phraseThresholds = mergedThresholds(thresholds, locale, 'common_role_phrase');
  const familyThresholds = mergedThresholds(thresholds, locale, 'family_alias_anchor');
  const markers = [];

  if (titleOccurrences >= phraseThresholds.minOccurrences) {
    markers.push('frequency_strong');
  } else if (titleOccurrences >= phraseThresholds.reviewMinOccurrences) {
    markers.push('frequency_medium');
  }
  if (distinctChunkCount >= 2) {
    markers.push('cross_chunk_repeated');
  }
  if (topFamilySupport >= phraseThresholds.minTopFamilySupport) {
    markers.push('low_family_entropy');
  }
  if (topTargetSupport >= phraseThresholds.minTopTargetSupport) {
    markers.push('low_target_entropy');
  }
  if (candidate.singleTokenFlag) {
    markers.push('single_token_blocked');
  }
  if (candidate.blockedSurfaceSubstring) {
    markers.push('blocked_surface_substring');
  }
  if (candidate.broadWrapperFlag) {
    markers.push('broad_wrapper_blocked');
  }
  if (noiseOverlapScore > phraseThresholds.maxNoiseOverlapScore) {
    markers.push('noise_overlap_blocked');
  }
  if (avgRoleCoverage < 0.4) {
    markers.push('low_role_coverage_blocked');
  }
  if (candidate.existingRuntimeMatchCount > 0) {
    markers.push('already_runtime_anchored');
  }

  const commonEligible =
    !candidate.singleTokenFlag &&
    !candidate.blockedSurfaceSubstring &&
    !candidate.broadWrapperFlag &&
    titleOccurrences >= phraseThresholds.minOccurrences &&
    distinctTitleCount >= phraseThresholds.minDistinctTitles &&
    distinctChunkCount >= phraseThresholds.minDistinctChunks &&
    coveragePer1000 >= phraseThresholds.minCoveragePer1000 &&
    topTargetSupport >= phraseThresholds.minTopTargetSupport &&
    topFamilySupport >= phraseThresholds.minTopFamilySupport &&
    noiseOverlapScore <= phraseThresholds.maxNoiseOverlapScore &&
    avgRoleCoverage >= 0.55 &&
    !candidate.existingRuntimeMatchCount;

  const familyEligible =
    !candidate.singleTokenFlag &&
    !candidate.blockedSurfaceSubstring &&
    !candidate.broadWrapperFlag &&
    titleOccurrences >= familyThresholds.minOccurrences &&
    distinctTitleCount >= familyThresholds.minDistinctTitles &&
    distinctChunkCount >= familyThresholds.minDistinctChunks &&
    coveragePer1000 >= familyThresholds.minCoveragePer1000 &&
    topFamilySupport >= familyThresholds.minTopFamilySupport &&
    topTargetSupport <= familyThresholds.maxTopTargetSupport &&
    noiseOverlapScore <= familyThresholds.maxNoiseOverlapScore &&
    !candidate.existingRuntimeMatchCount;

  let candidateType = 'common_role_phrase';
  let autoDecision = 'reject';
  let autoDecisionReason = 'below statistical thresholds';

  if (commonEligible) {
    candidateType = 'common_role_phrase';
    autoDecision = 'promote';
    autoDecisionReason = 'meets common-role statistical thresholds';
  } else if (familyEligible) {
    candidateType = 'family_alias_anchor';
    autoDecision = 'promote';
    autoDecisionReason = 'meets family-anchor statistical thresholds';
  } else if (
    !candidate.singleTokenFlag &&
    !candidate.blockedSurfaceSubstring &&
    !candidate.broadWrapperFlag &&
    titleOccurrences >= phraseThresholds.reviewMinOccurrences &&
    topFamilySupport >= phraseThresholds.reviewMinTopFamilySupport &&
    avgRoleCoverage >= 0.4
  ) {
    candidateType = topTargetSupport >= phraseThresholds.reviewMinTopTargetSupport ? 'common_role_phrase' : 'family_alias_anchor';
    autoDecision = 'review';
    autoDecisionReason = 'repeated phrase candidate needs operator review';
  }

  const priorityThresholds = mergedThresholds(thresholds, locale, candidateType);
  const proposedSeed =
    candidateType === 'common_role_phrase' || candidateType === 'family_alias_anchor'
      ? {
          locale,
          surface: candidate.surface,
          canonicalEnglish,
          roleKey,
          priority: computePriority(titleOccurrences, priorityThresholds.priorityBase, priorityThresholds.priorityCap)
        }
      : null;

  return {
    candidate_type: candidateType,
    locale,
    surface: candidate.surface,
    normalized_surface: candidate.normalizedSurface,
    token_count: candidate.tokenCount,
    source_kind: Array.from(candidate.sourceKinds).sort().join('|'),
    title_occurrences: titleOccurrences,
    distinct_title_count: distinctTitleCount,
    distinct_chunk_count: distinctChunkCount,
    source_corpus_size: candidate.sourceTitleCount,
    coverage_per_1000: roundNumber(coveragePer1000),
    top_canonical_target: canonicalEnglish,
    top_target_support: roundNumber(topTargetSupport),
    top_family_id: topFamily ? Number.parseInt(String(topFamily.value).split('#')[0], 10) || null : null,
    top_family_label: topFamily ? String(topFamily.value).split('#').slice(1).join('#') : '',
    top_family_support: roundNumber(topFamilySupport),
    average_role_coverage: roundNumber(avgRoleCoverage),
    noise_overlap_score: roundNumber(noiseOverlapScore),
    single_token_flag: candidate.singleTokenFlag,
    blocked_surface_substring: candidate.blockedSurfaceSubstring,
    existing_runtime_match_count: candidate.existingRuntimeMatchCount,
    auto_decision: autoDecision,
    auto_decision_reason: autoDecisionReason,
    promotion_basis: autoDecision === 'promote' ? 'statistics_only' : autoDecision === 'review' ? 'statistics_plus_operator' : 'none',
    decision_markers: markers,
    already_present_in_seed: alreadyPresentCommonRole || alreadyPresentFamilyAlias,
    proposed_seed: proposedSeed,
    row_indexes: uniqueIntegers(candidate.rowIndexes).slice(0, 25)
  };
}

function buildNoiseCandidates(noiseCsvPath, manifest, thresholds, seedState, locale) {
  const text = readFileSync(noiseCsvPath, 'utf8');
  const rows = parse(text, { columns: true, skip_empty_lines: true, trim: true });
  const sourceTitleCount = numberOrZero(manifest.source_title_count) || 0;
  const noiseThresholds = mergedThresholds(thresholds, locale, 'noise_rule');

  return rows
    .filter((row) => String(row.locale).trim() === locale)
    .map((row) => {
      const occurrences = numberOrZero(row.title_count);
      const confidence = numberOrZero(row.confidence);
      const kind = String(row.kind || '').trim();
      const matchType = toNoiseMatchType(row.match_type);
      const terms = [String(row.surface || '').trim()].filter(Boolean);
      const coveragePer1000 = per1000(occurrences, sourceTitleCount || occurrences);
      const existingSeedMatch = seedState.noiseRules.has(noiseSeedKey(locale, kind, matchType, terms));
      const approvedKinds = new Set(stringArray(thresholds.noiseKindsApprovedForAutoPromotion));
      const reviewOnlyKinds = new Set(stringArray(thresholds.noiseKindsReviewOnly));
      const markers = [];

      if (occurrences >= noiseThresholds.minOccurrences) {
        markers.push('frequency_strong');
      } else if (occurrences >= noiseThresholds.reviewMinOccurrences) {
        markers.push('frequency_medium');
      }
      if (approvedKinds.has(kind)) {
        markers.push('approved_noise_kind');
      }
      if (reviewOnlyKinds.has(kind)) {
        markers.push('review_only_noise_kind');
      }

      let autoDecision = 'reject';
      let autoDecisionReason = 'below noise thresholds';
      if (
        approvedKinds.has(kind) &&
        occurrences >= noiseThresholds.minOccurrences &&
        coveragePer1000 >= noiseThresholds.minCoveragePer1000 &&
        confidence >= noiseThresholds.minConfidence &&
        !existingSeedMatch
      ) {
        autoDecision = 'promote';
        autoDecisionReason = 'meets noise statistical thresholds';
      } else if (
        !reviewOnlyKinds.has(kind) &&
        occurrences >= noiseThresholds.reviewMinOccurrences &&
        confidence >= noiseThresholds.reviewMinConfidence
      ) {
        autoDecision = 'review';
        autoDecisionReason = 'repeated noise candidate needs operator review';
      }

      return {
        candidate_type: 'noise_rule',
        locale,
        surface: String(row.surface || '').trim(),
        normalized_surface: normalizeText(String(row.normalized_surface || row.surface || '')),
        token_count: tokenizeSurface(String(row.surface || '')).length,
        source_kind: 'noise_pattern_extract',
        title_occurrences: occurrences,
        distinct_title_count: occurrences,
        distinct_chunk_count: 1,
        source_corpus_size: sourceTitleCount || occurrences,
        coverage_per_1000: roundNumber(coveragePer1000),
        top_canonical_target: '',
        top_target_support: 0,
        top_family_id: null,
        top_family_label: '',
        top_family_support: 0,
        average_role_coverage: 0,
        noise_overlap_score: 0,
        single_token_flag: false,
        blocked_surface_substring: '',
        existing_runtime_match_count: 0,
        auto_decision: autoDecision,
        auto_decision_reason: autoDecisionReason,
        promotion_basis: autoDecision === 'promote' ? 'statistics_only' : autoDecision === 'review' ? 'statistics_plus_operator' : 'none',
        decision_markers: markers,
        already_present_in_seed: existingSeedMatch,
        proposed_seed: {
          locale,
          kind,
          matchType,
          confidence: roundNumber(Math.max(0.75, Math.min(0.99, confidence))),
          terms
        },
        row_indexes: []
      };
    })
    .sort(compareCandidates);
}

function topFamilyEntry(row) {
  const family = Array.isArray(row?.top_families) && row.top_families.length > 0 ? row.top_families[0] : null;
  if (!family) {
    return null;
  }
  return {
    familyNodeId: numberOrNull(family.family_node_id),
    familyLabel: String(family.family_label || '').trim(),
    topLeafLabel: Array.isArray(family.leaves) && family.leaves.length > 0 ? String(family.leaves[0]?.canonical_label || '').trim() : ''
  };
}

function topTargetLabel(row, topFamily) {
  if (typeof row?.selected_label === 'string' && row.selected_label.trim()) {
    return row.selected_label.trim();
  }
  const matchedLabel = String(row?.coverage_signals?.matched_label || '').trim();
  if (matchedLabel) {
    return matchedLabel;
  }
  return topFamily?.topLeafLabel || '';
}

function phraseSourceKind(row) {
  if (row?.prepared_query?.common_role_phrase) {
    return 'existing_common_role_phrase';
  }
  if (row?.prepared_query?.family_alias_match) {
    return 'existing_family_alias_anchor';
  }
  return 'effective_query_phrase';
}

function familyKeyFromTopFamily(topFamily) {
  if (!topFamily?.familyNodeId || !topFamily?.familyLabel) {
    return '';
  }
  return `${topFamily.familyNodeId}#${topFamily.familyLabel}`;
}

function chunkIndexForRow(rowNumber, ranges) {
  const match = ranges.find((range) => rowNumber >= range.start && rowNumber <= range.end);
  return match?.index || 1;
}

function coverageRatio(matchedRoleTokens, roleTokens) {
  const roleSet = new Set(roleTokens.filter(Boolean));
  if (roleSet.size === 0) {
    return 0;
  }
  const matched = matchedRoleTokens.filter((token) => roleSet.has(token)).length;
  return matched / roleSet.size;
}

function mergedThresholds(thresholds, locale, type) {
  return {
    ...(thresholds.defaults?.[type] || {}),
    ...(thresholds.localeOverrides?.[locale]?.[type] || {})
  };
}

function wrapperTokenSet(thresholds, locale) {
  return new Set(
    [...stringArray(thresholds.broadWrapperTokens?.all), ...stringArray(thresholds.broadWrapperTokens?.[locale])].map(normalizeText)
  );
}

function blockedSubstrings(thresholds, locale) {
  return [...stringArray(thresholds.blockedSurfaceSubstrings?.all), ...stringArray(thresholds.blockedSurfaceSubstrings?.[locale])].map(
    normalizeText
  );
}

function phraseSeedKey(locale, surface, canonicalEnglish, roleKey) {
  return [String(locale || '').trim(), normalizeText(surface), normalizeText(canonicalEnglish), String(roleKey || '').trim()].join(
    '\u0000'
  );
}

function hasPhraseSeed(items, locale, surface, canonicalEnglish, roleKey) {
  const key = phraseSeedKey(locale, surface, canonicalEnglish, roleKey);
  return items.some((entry) => phraseSeedKey(entry.locale, entry.surface, entry.canonicalEnglish, entry.roleKey) === key);
}

function noiseSeedKey(locale, kind, matchType, terms) {
  return [
    String(locale || '').trim(),
    String(kind || '').trim(),
    String(matchType || '').trim(),
    stringArray(terms).map(normalizeText).sort().join('|')
  ].join('\u0000');
}

function summarizeCandidates(candidates) {
  return candidates.reduce(
    (summary, candidate) => {
      summary[candidate.auto_decision] += 1;
      summary.by_type[candidate.candidate_type] = (summary.by_type[candidate.candidate_type] || 0) + 1;
      return summary;
    },
    { promote: 0, review: 0, reject: 0, by_type: {} }
  );
}

function toCsv(candidates) {
  const headers = [
    'candidate_type',
    'locale',
    'surface',
    'normalized_surface',
    'token_count',
    'source_kind',
    'title_occurrences',
    'distinct_title_count',
    'distinct_chunk_count',
    'source_corpus_size',
    'coverage_per_1000',
    'top_canonical_target',
    'top_target_support',
    'top_family_id',
    'top_family_label',
    'top_family_support',
    'average_role_coverage',
    'noise_overlap_score',
    'single_token_flag',
    'auto_decision',
    'auto_decision_reason',
    'promotion_basis',
    'decision_markers',
    'already_present_in_seed'
  ];
  const lines = [headers.join(',')];
  for (const candidate of candidates) {
    lines.push(
      headers
        .map((header) => {
          const value = header === 'decision_markers' ? candidate.decision_markers.join('|') : (candidate[header] ?? '');
          return `"${String(value).replace(/"/gu, '""')}"`;
        })
        .join(',')
    );
  }
  return `${lines.join('\n')}\n`;
}

function compareCandidates(left, right) {
  return (
    rankDecision(left.auto_decision) - rankDecision(right.auto_decision) ||
    right.title_occurrences - left.title_occurrences ||
    right.top_family_support - left.top_family_support ||
    right.top_target_support - left.top_target_support ||
    left.surface.localeCompare(right.surface)
  );
}

function rankDecision(decision) {
  return decision === 'promote' ? 0 : decision === 'review' ? 1 : 2;
}

function topCountEntry(map) {
  let bestValue = '';
  let bestCount = 0;
  for (const [value, count] of map.entries()) {
    if (count > bestCount || (count === bestCount && value.localeCompare(bestValue) < 0)) {
      bestValue = value;
      bestCount = count;
    }
  }
  return bestCount > 0 ? { value: bestValue, count: bestCount } : null;
}

function computePriority(occurrences, base, cap) {
  const safeBase = numberOrZero(base) || 90;
  const safeCap = numberOrZero(cap) || 99;
  return Math.max(safeBase, Math.min(safeCap, safeBase + occurrences));
}

function per1000(count, total) {
  if (!total) {
    return 0;
  }
  return (count / total) * 1000;
}

function ratio(count, total) {
  if (!total) {
    return 0;
  }
  return count / total;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function collapseWhitespace(value) {
  return String(value || '')
    .replace(/\s+/gu, ' ')
    .trim();
}

function tokenizeSurface(value) {
  return collapseWhitespace(value)
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function toNoiseMatchType(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  if (normalized === 'token' || normalized === 'phrase') {
    return normalized;
  }
  return normalized.includes('chunk') ? 'phrase' : 'phrase';
}

function roleKeyFromCanonical(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '_')
    .replace(/^_+|_+$/gu, '');
}

function roundNumber(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
}

function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : Number.parseFloat(String(value || '0')) || 0;
}

function numberOrNull(value) {
  const numeric = Number.parseInt(String(value || ''), 10);
  return Number.isInteger(numeric) ? numeric : null;
}

function stringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function uniqueIntegers(values) {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))].sort((left, right) => left - right);
}

main().catch((error) => {
  console.error('Statistical enrichment candidate mining failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
