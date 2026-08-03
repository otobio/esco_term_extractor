import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { OccupationSearchPipeline } from '../dist/search-pipeline/occupation-search-pipeline.js';
import { DEFAULT_ESCO_SOURCE_NAME } from '../dist/retrieval/occupation-candidates.js';
import { OccupationRuntimeContext } from '../dist/runtime/occupation-runtime-context.js';
import { peelOccupationTitleNoise } from '../dist/query/occupation-noise-peeling.js';

const DEFAULT_INPUT_BY_LOCALE = {
  ro: '/Users/otobio/Downloads/ejobs_job_titles.csv',
  hu: '/Users/otobio/Downloads/profession_job_titles_01.csv'
};

const DEFAULT_TITLE_COLUMN_BY_LOCALE = {
  ro: 'job_title',
  hu: 'job_title'
};

const DEFAULT_ALLOWED_ARTIFACT_CLASSES = [
  'reviewed_family_signal',
  'reviewed_family_penalty',
  'noise_rule',
  'role_head_equivalence',
  'common_role_phrase',
  'family_alias_anchor'
];

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const sourceTitles = loadTitles(options.inputPath, options.titleColumn);
  const rangedTitles = applyRange(sourceTitles, options.offset, options.limit);
  const titles = sampleRows(rangedTitles, options.sampleSize, options.seed);
  const runtime = await OccupationRuntimeContext.load({
    sourceName: options.sourceName,
    retrievalBackend: 'binary-cache'
  });
  const pipeline = OccupationSearchPipeline.withRuntime(runtime);
  const rows = [];
  const manifest = {
    locale: options.locale,
    source_name: options.sourceName,
    sample_size: options.sampleSize,
    seed: options.seed,
    offset: options.offset,
    limit: options.limit,
    source_title_count: sourceTitles.length,
    input_path: options.inputPath,
    title_column: options.titleColumn,
    generated_from: 'real_job_titles',
    allowed_artifact_classes: DEFAULT_ALLOWED_ARTIFACT_CLASSES,
    records: 0,
    noise_only: 0,
    unresolved: 0,
    family_or_group: 0,
    leaf: 0,
    multi_span: 0
  };
  const progressInterval = 100;

  for (const [index, originalTitle] of titles.entries()) {
    const peeled = peelOccupationTitleNoise(originalTitle, options.locale);
    const peeledTitle = peeled.peeledTitle.trim();

    if (!peeledTitle) {
      manifest.records += 1;
      manifest.noise_only += 1;
      rows.push({
        row_index: index + 1,
        locale: options.locale,
        original_title: originalTitle,
        peeled_title: '',
        noise_removed: true,
        query: '',
        effective_query: '',
        decision_type: 'noise_only',
        selected_label: null,
        selected_node_id: null,
        coverage_status: 'noise_only',
        query_spans: [],
        prepared_query: null,
        coverage_signals: null,
        top_families: [],
        debug: {
          stages: [],
          attempts: []
        },
        llm_task: {
          allowed_artifact_classes: DEFAULT_ALLOWED_ARTIFACT_CLASSES,
          objective: 'Classify title structure and propose only reusable artifact candidates. Do not force a leaf decision.',
          output_schema_ref: 'data/taxonomy-review/job-title-triage-output.schema.json'
        }
      });
      continue;
    }

    const result = await pipeline.run({
      query: peeledTitle,
      locale: options.locale,
      sourceName: options.sourceName,
      limit: 20,
      topFamilyLimit: 3,
      topLeavesPerFamily: 3,
      debug: true
    });
    const record = toPilotRecord(index + 1, originalTitle, peeledTitle, result);
    rows.push(record);
    manifest.records += 1;
    manifest[
      result.decision.decisionType === 'leaf'
        ? 'leaf'
        : result.decision.decisionType === 'multi_span'
          ? 'multi_span'
          : result.decision.decisionType === 'family' || result.decision.decisionType === 'group'
            ? 'family_or_group'
            : 'unresolved'
    ] += 1;

    if ((index + 1) % progressInterval === 0) {
      console.log(
        [
          `progress=${index + 1}/${titles.length}`,
          `leaf=${manifest.leaf}`,
          `family_or_group=${manifest.family_or_group}`,
          `multi_span=${manifest.multi_span}`,
          `unresolved=${manifest.unresolved}`,
          `noise_only=${manifest.noise_only}`
        ].join('  ')
      );
    }
  }

  mkdirSync(path.dirname(options.outPath), { recursive: true });
  writeFileSync(options.outPath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  writeFileSync(options.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(
    [
      `records=${manifest.records}`,
      `leaf=${manifest.leaf}`,
      `family_or_group=${manifest.family_or_group}`,
      `multi_span=${manifest.multi_span}`,
      `unresolved=${manifest.unresolved}`,
      `noise_only=${manifest.noise_only}`,
      `out=${options.outPath}`,
      `manifest=${options.manifestPath}`
    ].join('  ')
  );
}

function parseCliOptions(args) {
  const options = {
    locale: 'ro',
    sourceName: DEFAULT_ESCO_SOURCE_NAME,
    sampleSize: 100,
    seed: 'llm-job-title-triage-pilot',
    inputPath: '',
    titleColumn: '',
    offset: 0,
    limit: null,
    outPath: '',
    manifestPath: ''
  };

  for (const arg of args) {
    if (arg.startsWith('--locale=')) {
      options.locale = arg.slice('--locale='.length).trim();
      continue;
    }

    if (arg.startsWith('--source-name=')) {
      options.sourceName = arg.slice('--source-name='.length).trim();
      continue;
    }

    if (arg.startsWith('--sample=')) {
      const value = arg.slice('--sample='.length).trim();
      options.sampleSize = value.toLowerCase() === 'all' ? 'all' : Number.parseInt(value, 10);
      continue;
    }

    if (arg.startsWith('--seed=')) {
      options.seed = arg.slice('--seed='.length).trim();
      continue;
    }

    if (arg.startsWith('--input=')) {
      options.inputPath = arg.slice('--input='.length).trim();
      continue;
    }

    if (arg.startsWith('--title-column=')) {
      options.titleColumn = arg.slice('--title-column='.length).trim();
      continue;
    }

    if (arg.startsWith('--offset=')) {
      options.offset = Number.parseInt(arg.slice('--offset='.length).trim(), 10);
      continue;
    }

    if (arg.startsWith('--limit=')) {
      options.limit = Number.parseInt(arg.slice('--limit='.length).trim(), 10);
      continue;
    }

    if (arg.startsWith('--out=')) {
      options.outPath = arg.slice('--out='.length).trim();
      continue;
    }

    if (arg.startsWith('--manifest=')) {
      options.manifestPath = arg.slice('--manifest='.length).trim();
      continue;
    }

    if (arg === '--help') {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (options.sampleSize !== 'all' && (!Number.isInteger(options.sampleSize) || options.sampleSize <= 0)) {
    throw new Error(`--sample must be a positive integer. Received "${options.sampleSize}".`);
  }

  if (!Number.isInteger(options.offset) || options.offset < 0) {
    throw new Error(`--offset must be a non-negative integer. Received "${options.offset}".`);
  }

  if (options.limit !== null && (!Number.isInteger(options.limit) || options.limit <= 0)) {
    throw new Error(`--limit must be a positive integer when provided. Received "${options.limit}".`);
  }

  options.inputPath ||= DEFAULT_INPUT_BY_LOCALE[options.locale] || DEFAULT_INPUT_BY_LOCALE.ro;
  options.titleColumn ||= DEFAULT_TITLE_COLUMN_BY_LOCALE[options.locale] || DEFAULT_TITLE_COLUMN_BY_LOCALE.ro;
  options.outPath ||= path.join(process.cwd(), 'data', 'taxonomy-review', `job-title-triage-pilot.${options.locale}.jsonl`);
  options.manifestPath ||= path.join(process.cwd(), 'data', 'taxonomy-review', `job-title-triage-pilot.${options.locale}.manifest.json`);

  return options;
}

function printHelp() {
  console.log(
    [
      'Usage: node scripts/build-llm-job-title-triage-pilot.js',
      '[--locale=ro]',
      `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
      '[--sample=100|all]',
      '[--seed=llm-job-title-triage-pilot]',
      '[--input=/path/to/job_titles.csv]',
      '[--title-column=job_title]',
      '[--offset=0]',
      '[--limit=1000]',
      '[--out=data/taxonomy-review/job-title-triage-pilot.ro.jsonl]',
      '[--manifest=data/taxonomy-review/job-title-triage-pilot.ro.manifest.json]'
    ].join(' ')
  );
}

function applyRange(rows, offset, limit) {
  const start = Math.min(offset, rows.length);

  if (limit === null) {
    return rows.slice(start);
  }

  return rows.slice(start, start + limit);
}

function loadTitles(filePath, titleColumn) {
  const sourceRows = parse(readFileSync(filePath, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  return sourceRows.map((row) => String(row[titleColumn] ?? '').trim()).filter((title) => title.length > 0);
}

function sampleRows(rows, limit, seed) {
  if (limit === 'all') {
    return Array.from(rows);
  }

  const items = Array.from(rows);

  if (items.length <= limit) {
    return items;
  }

  const random = mulberry32(hashSeed(seed));

  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }

  return items.slice(0, limit);
}

function toPilotRecord(rowIndex, originalTitle, peeledTitle, result) {
  return {
    row_index: rowIndex,
    locale: result.queryContext.locale,
    original_title: originalTitle,
    peeled_title: peeledTitle,
    noise_removed: peeledTitle !== originalTitle,
    query: peeledTitle,
    effective_query: result.queryContext.query,
    decision_type: result.decision.decisionType,
    selected_label: result.decision.selectedLabel,
    selected_node_id: result.decision.selectedNodeId,
    coverage_status: result.coverageStatus.status,
    query_spans: result.queryContext.querySpans,
    prepared_query: {
      useful_tokens: result.preparedQuery.usefulTokens,
      useful_folded_tokens: result.preparedQuery.usefulFoldedTokens,
      modifier_tokens: result.preparedQuery.modifierTokens,
      noise_tokens: result.preparedQuery.noiseTokens,
      acronym_tokens: result.preparedQuery.acronymTokens,
      common_role_phrase: result.preparedQuery.commonRolePhraseMatch
        ? {
            surface: result.preparedQuery.commonRolePhraseMatch.surface,
            canonical_english: result.preparedQuery.commonRolePhraseMatch.canonicalEnglish,
            role_key: result.preparedQuery.commonRolePhraseMatch.roleKey
          }
        : null,
      family_alias_match: result.preparedQuery.familyAliasMatch
        ? {
            surface: result.preparedQuery.familyAliasMatch.surface,
            canonical_english: result.preparedQuery.familyAliasMatch.canonicalEnglish,
            role_key: result.preparedQuery.familyAliasMatch.roleKey
          }
        : null,
      intent: {
        role_tokens: result.preparedQuery.intent.roleTokens,
        role_head_tokens: result.preparedQuery.intent.roleHeadTokens,
        domain_tokens: result.preparedQuery.intent.domainTokens,
        venue_tokens: result.preparedQuery.intent.venueTokens,
        diagnostics: result.preparedQuery.intent.diagnostics,
        confidence: result.preparedQuery.intent.confidence
      }
    },
    coverage_signals: {
      matched_useful_tokens: result.coverageStatus.signals.matchedUsefulTokens,
      missing_useful_tokens: result.coverageStatus.signals.missingUsefulTokens,
      matched_role_tokens: result.coverageStatus.signals.matchedRoleTokens,
      missing_role_tokens: result.coverageStatus.signals.missingRoleTokens,
      matched_domain_tokens: result.coverageStatus.signals.matchedDomainTokens,
      matched_label: result.coverageStatus.signals.matchedLabel,
      matched_label_source: result.coverageStatus.signals.matchedLabelSource,
      top_family_evidence_tier: result.coverageStatus.signals.topFamilyEvidenceTier
    },
    top_families: result.rankedFamilies.slice(0, 3).map((family) => ({
      rank: family.rank,
      family_node_id: family.familyNodeId,
      family_label: family.familyLabel,
      confidence: family.confidence,
      evidence_tier: family.evidenceTier,
      branch_share: family.branchShare,
      supporting_leaf_count: family.supportingLeafCount,
      evidence_summary: summarizeEvidence(family.evidence),
      reviewed_rule_ids: uniqueStrings(family.evidence.flatMap((record) => reviewedRuleIds(record))),
      matched_role_terms: uniqueStrings(family.evidence.flatMap((record) => stringArray(record.details?.matched_role_terms))),
      matched_domain_terms: uniqueStrings(family.evidence.flatMap((record) => stringArray(record.details?.matched_domain_terms))),
      matched_query_terms: uniqueStrings(family.evidence.flatMap((record) => stringArray(record.details?.matched_query_terms))),
      leaves: family.leaves.slice(0, 3).map((leaf) => ({
        rank: leaf.rank,
        graph_node_id: leaf.graphNodeId,
        canonical_label: leaf.canonicalLabel,
        confidence: leaf.confidence,
        selection_tier: leaf.selectionEvidence?.tier ?? null,
        fit_tier: leaf.familyScopedFit?.tier ?? null,
        matched_label: leaf.closeness?.matchedLabel ?? null,
        matched_label_source: leaf.closeness?.matchedLabelSource ?? null,
        evidence_summary: summarizeEvidence(leaf.evidence)
      }))
    })),
    debug: {
      stages: result.debug.stages,
      attempts: result.debug.attempts.map((attempt) => ({
        attempt: attempt.attempt,
        kind: attempt.kind,
        status: attempt.status,
        decision_type: attempt.decisionType,
        confidence: attempt.confidence,
        reason: attempt.reason
      }))
    },
    llm_task: {
      allowed_artifact_classes: DEFAULT_ALLOWED_ARTIFACT_CLASSES,
      objective: 'Classify title structure and propose only reusable artifact candidates. Do not force a leaf decision.',
      output_schema_ref: 'data/taxonomy-review/job-title-triage-output.schema.json'
    }
  };
}

function summarizeEvidence(evidence) {
  const counts = new Map();

  for (const record of evidence) {
    counts.set(record.channel, (counts.get(record.channel) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([channel, count]) => `${channel}:${count}`);
}

function reviewedRuleIds(record) {
  return record.channel === 'reviewed_family_signal' || record.channel === 'reviewed_family_penalty'
    ? [String(record.details?.rule_id ?? '')].filter(Boolean)
    : [];
}

function stringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function uniqueStrings(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function hashSeed(value) {
  const text = String(value ?? '');
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

main().catch((error) => {
  console.error('LLM job-title triage pilot build failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
