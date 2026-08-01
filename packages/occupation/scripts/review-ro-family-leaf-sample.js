import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { OccupationSearchPipeline } from '../dist/search-pipeline/occupation-search-pipeline.js';
import { DEFAULT_ESCO_SOURCE_NAME } from '../dist/retrieval/occupation-candidates.js';
import { OccupationRuntimeContext } from '../dist/runtime/occupation-runtime-context.js';
import { peelOccupationTitleNoise } from '../dist/query/occupation-noise-peeling.js';

const INPUT_PATH = '/Users/otobio/Downloads/ejobs_job_titles.csv';
const OUTPUT_DIR = path.join(process.cwd(), 'data', 'taxonomy-review');
const OUTPUT_PATH = path.join(OUTPUT_DIR, 'ro-family-leaf-sample.csv');
const SAMPLE_SIZE = 100;
const SAMPLE_SEED = 'ro-family-leaf-sample';

const CSV_HEADERS = [
  'row_index',
  'original_title',
  'peeled_title',
  'noise_removed',
  'query',
  'effective_query',
  'decision_type',
  'selected_label',
  'selected_node_id',
  'confidence',
  'coverage_status',
  'top_family_label',
  'top_family_id',
  'top_family_confidence',
  'top_leaf_label',
  'top_leaf_id',
  'top_leaf_confidence',
  'query_spans',
  'matched_role_tokens',
  'missing_role_tokens',
  'matched_useful_tokens',
  'missing_useful_tokens',
  'error'
];

async function main() {
  const titles = sampleRows(loadTitles(INPUT_PATH), SAMPLE_SIZE, SAMPLE_SEED);
  const runtime = await OccupationRuntimeContext.load({
    sourceName: DEFAULT_ESCO_SOURCE_NAME
  });
  const pipeline = OccupationSearchPipeline.withRuntime(runtime);
  const rows = [];
  const summary = {
    total: 0,
    leaf: 0,
    family: 0,
    group: 0,
    multiSpan: 0,
    unresolved: 0,
    noiseOnly: 0
  };

  for (const [index, originalTitle] of titles.entries()) {
    const peeled = peelOccupationTitleNoise(originalTitle, 'ro');
    const peeledTitle = peeled.peeledTitle.trim();

    if (!peeledTitle) {
      summary.total += 1;
      summary.noiseOnly += 1;
      rows.push({
        row_index: String(index + 1),
        original_title: originalTitle,
        peeled_title: '',
        noise_removed: 'yes',
        query: '',
        effective_query: '',
        decision_type: 'noise_only',
        selected_label: '',
        selected_node_id: '',
        confidence: '',
        coverage_status: 'noise_only',
        top_family_label: '',
        top_family_id: '',
        top_family_confidence: '',
        top_leaf_label: '',
        top_leaf_id: '',
        top_leaf_confidence: '',
        query_spans: '',
        matched_role_tokens: '',
        missing_role_tokens: '',
        matched_useful_tokens: '',
        missing_useful_tokens: '',
        error: ''
      });
      continue;
    }

    const query = peeledTitle;

    try {
      const result = await pipeline.run({
        query,
        locale: 'ro',
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        limit: 20
      });

      summary.total += 1;
      summary[result.decision.decisionType === 'leaf' ? 'leaf' : result.decision.decisionType === 'family' ? 'family' : result.decision.decisionType === 'group' ? 'group' : result.decision.decisionType === 'multi_span' ? 'multiSpan' : 'unresolved'] += 1;

      const topFamily = result.rankedFamilies[0] ?? null;
      const topLeaf = result.rankedLeaves[0] ?? topFamily?.leaves[0] ?? null;

      rows.push({
        row_index: String(index + 1),
        original_title: originalTitle,
        peeled_title: peeledTitle,
        noise_removed: peeledTitle === originalTitle ? 'no' : 'yes',
        query,
        effective_query: result.queryContext.query,
        decision_type: result.decision.decisionType,
        selected_label: result.decision.selectedLabel ?? '',
        selected_node_id: result.decision.selectedNodeId ?? '',
        confidence: formatPercent(result.decision.confidence),
        coverage_status: result.coverageStatus.status,
        top_family_label: topFamily?.familyLabel ?? '',
        top_family_id: topFamily?.familyNodeId ?? '',
        top_family_confidence: topFamily ? formatPercent(topFamily.confidence) : '',
        top_leaf_label: topLeaf?.canonicalLabel ?? '',
        top_leaf_id: topLeaf?.graphNodeId ?? '',
        top_leaf_confidence: topLeaf ? formatPercent(topLeaf.confidence) : '',
        query_spans: result.queryContext.querySpans.join('|'),
        matched_role_tokens: result.coverageStatus.signals.matchedRoleTokens.join('|'),
        missing_role_tokens: result.coverageStatus.signals.missingRoleTokens.join('|'),
        matched_useful_tokens: result.coverageStatus.signals.matchedUsefulTokens.join('|'),
        missing_useful_tokens: result.coverageStatus.signals.missingUsefulTokens.join('|'),
        error: ''
      });
    } catch (error) {
      summary.total += 1;
      summary.unresolved += 1;
      rows.push({
        row_index: String(index + 1),
        original_title: originalTitle,
        peeled_title: peeledTitle,
        noise_removed: peeledTitle === originalTitle ? 'no' : 'yes',
        query,
        effective_query: '',
        decision_type: '',
        selected_label: '',
        selected_node_id: '',
        confidence: '',
        coverage_status: '',
        top_family_label: '',
        top_family_id: '',
        top_family_confidence: '',
        top_leaf_label: '',
        top_leaf_id: '',
        top_leaf_confidence: '',
        query_spans: '',
        matched_role_tokens: '',
        missing_role_tokens: '',
        matched_useful_tokens: '',
        missing_useful_tokens: '',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  writeFileSync(OUTPUT_PATH, toCsv(rows), 'utf8');

  console.log(
    [
      `sample=${summary.total}`,
      `leaf=${summary.leaf}`,
      `family=${summary.family}`,
      `group=${summary.group}`,
      `multi_span=${summary.multiSpan}`,
      `noise_only=${summary.noiseOnly}`,
      `unresolved=${summary.unresolved}`,
      `rows_out=${OUTPUT_PATH}`
    ].join('  ')
  );

  for (const row of rows.slice(0, 10)) {
    console.log(
      [
        `title=${row.original_title}`,
        `peeled=${row.peeled_title}`,
        `query=${row.query}`,
        `effective_query=${row.effective_query || '-'}`,
        `decision=${row.decision_type || 'error'}`,
        `family=${row.top_family_label || '-'}`,
        `leaf=${row.top_leaf_label || '-'}`,
        `confidence=${row.confidence || '-'}`,
        `coverage=${row.coverage_status || '-'}`,
        `error=${row.error || '-'}`,
      ].join('  ')
    );
  }
}

function loadTitles(filePath) {
  const sourceRows = parse(readFileSync(filePath, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  return sourceRows
    .map((row) => String(row.job_title ?? '').trim())
    .filter((title) => title.length > 0);
}

function sampleRows(rows, limit, seed) {
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

function formatPercent(value) {
  return String(Math.round(value * 100));
}

function escapeCsv(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`;
}

function toCsv(rows) {
  return `${[CSV_HEADERS.join(','), ...rows.map((row) => CSV_HEADERS.map((header) => escapeCsv(row[header])).join(','))].join('\n')}\n`;
}

main().catch((error) => {
  console.error('RO family-leaf sample review failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
