import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const rows = readJsonLines(options.inputPath);
  const briefRows = rows.map(toBriefRow);
  const columnDefinitions = reviewColumnDefinitions();
  const tsvText = buildTsv(briefRows, columnDefinitions);
  const manifest = buildManifest(rows, briefRows, options.inputPath);

  mkdirSync(path.dirname(options.outTsvPath), { recursive: true });
  writeFileSync(options.outTsvPath, tsvText, 'utf8');
  writeFileSync(options.outColumnsPath, `${JSON.stringify(columnDefinitions, null, 2)}\n`, 'utf8');
  writeFileSync(options.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  console.log(
    [
      `rows=${manifest.rows}`,
      `input_bytes=${manifest.input_bytes}`,
      `columnar_tsv_bytes=${manifest.columnar_tsv_bytes}`,
      `out_tsv=${options.outTsvPath}`,
      `out_columns=${options.outColumnsPath}`,
      `manifest=${options.manifestPath}`
    ].join('  ')
  );
}

function parseCliOptions(args) {
  const options = {
    inputPath: path.join(process.cwd(), 'data', 'taxonomy-review', 'job-title-triage-pilot.ro.jsonl'),
    outTsvPath: path.join(process.cwd(), 'data', 'taxonomy-review', 'job-title-triage-brief.ro.tsv'),
    outColumnsPath: path.join(process.cwd(), 'data', 'taxonomy-review', 'job-title-triage-brief.columns.json'),
    manifestPath: path.join(process.cwd(), 'data', 'taxonomy-review', 'job-title-triage-brief.ro.manifest.json')
  };

  for (const arg of args) {
    if (arg.startsWith('--input=')) {
      options.inputPath = arg.slice('--input='.length).trim();
      continue;
    }

    if (arg.startsWith('--out-tsv=')) {
      options.outTsvPath = arg.slice('--out-tsv='.length).trim();
      continue;
    }

    if (arg.startsWith('--out-columns=')) {
      options.outColumnsPath = arg.slice('--out-columns='.length).trim();
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

  return options;
}

function printHelp() {
  console.log(
    [
      'Usage: node scripts/build-llm-job-title-review-brief.js',
      '[--input=data/taxonomy-review/job-title-triage-pilot.ro.jsonl]',
      '[--out-tsv=data/taxonomy-review/job-title-triage-brief.ro.tsv]',
      '[--out-columns=data/taxonomy-review/job-title-triage-brief.columns.json]',
      '[--manifest=data/taxonomy-review/job-title-triage-brief.ro.manifest.json]'
    ].join(' ')
  );
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
        throw new Error(`Invalid JSONL at line ${index + 1} in ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
}

function toBriefRow(row) {
  const topFamilies = Array.isArray(row.top_families) ? row.top_families.slice(0, 2) : [];

  return {
    row_index: row.row_index,
    locale: row.locale,
    title: row.original_title,
    peeled_title: row.peeled_title,
    noise_removed: Boolean(row.noise_removed),
    effective_query: row.effective_query,
    decision_type: row.decision_type,
    selected_label: row.selected_label,
    coverage_status: row.coverage_status,
    query_spans: arrayOfStrings(row.query_spans),
    intent: {
      role_tokens: arrayOfStrings(row.prepared_query?.intent?.role_tokens),
      role_head_tokens: arrayOfStrings(row.prepared_query?.intent?.role_head_tokens),
      domain_tokens: arrayOfStrings(row.prepared_query?.intent?.domain_tokens),
      venue_tokens: arrayOfStrings(row.prepared_query?.intent?.venue_tokens),
      confidence: numberOrNull(row.prepared_query?.intent?.confidence)
    },
    modifier_tokens: arrayOfStrings(row.prepared_query?.modifier_tokens),
    peeled_noise_tokens: arrayOfStrings(row.prepared_query?.noise_tokens),
    matched_role_tokens: arrayOfStrings(row.coverage_signals?.matched_role_tokens),
    missing_role_tokens: arrayOfStrings(row.coverage_signals?.missing_role_tokens),
    matched_useful_tokens: arrayOfStrings(row.coverage_signals?.matched_useful_tokens),
    missing_useful_tokens: arrayOfStrings(row.coverage_signals?.missing_useful_tokens),
    top_families: topFamilies.map((family) => ({
      rank: family.rank,
      family_node_id: family.family_node_id,
      family_label: family.family_label,
      confidence: numberOrNull(family.confidence),
      evidence_tier: family.evidence_tier,
      reviewed_rule_ids: arrayOfStrings(family.reviewed_rule_ids),
      matched_role_terms: arrayOfStrings(family.matched_role_terms),
      matched_domain_terms: arrayOfStrings(family.matched_domain_terms),
      matched_query_terms: arrayOfStrings(family.matched_query_terms),
      evidence_summary: arrayOfStrings(family.evidence_summary),
      top_leaves: Array.isArray(family.leaves)
        ? family.leaves.slice(0, 2).map((leaf) => ({
            canonical_label: leaf.canonical_label,
            confidence: numberOrNull(leaf.confidence),
            selection_tier: leaf.selection_tier,
            fit_tier: leaf.fit_tier,
            matched_label: leaf.matched_label,
            evidence_summary: arrayOfStrings(leaf.evidence_summary)
          }))
        : []
    })),
    phrase_hints: {
      common_role_phrase: row.prepared_query?.common_role_phrase ?? null,
      family_alias_match: row.prepared_query?.family_alias_match ?? null
    },
    allowed_artifact_classes: arrayOfStrings(row.llm_task?.allowed_artifact_classes),
    output_schema_ref: stringOrNull(row.llm_task?.output_schema_ref)
  };
}

function buildManifest(fullRows, briefRows, inputPath) {
  const inputText = readFileSync(inputPath, 'utf8');
  const columnDefinitions = reviewColumnDefinitions();
  const tsvText = buildTsv(briefRows, columnDefinitions);

  return {
    rows: fullRows.length,
    input_path: inputPath,
    input_bytes: Buffer.byteLength(inputText, 'utf8'),
    columnar_tsv_bytes: Buffer.byteLength(tsvText, 'utf8'),
    token_saving_hint:
      'Use the column definitions once, then review the TSV rows in batches. Open the full pilot JSONL only as a last resort.',
    included_fields: [
      'row_index',
      'title',
      'peeled_title',
      'noise_removed',
      'effective_query',
      'decision_type',
      'selected_label',
      'coverage_status',
      'query_spans',
      'intent.role_tokens',
      'intent.role_head_tokens',
      'intent.domain_tokens',
      'modifier_tokens',
      'peeled_noise_tokens',
      'matched_role_tokens',
      'missing_role_tokens',
      'matched_useful_tokens',
      'missing_useful_tokens',
      'top_families',
      'phrase_hints',
      'allowed_artifact_classes',
      'output_schema_ref'
    ]
  };
}

function reviewColumnDefinitions() {
  return [
    { key: 'ri', label: 'row_index', description: 'Stable row number in this pilot batch.' },
    { key: 'loc', label: 'locale', description: 'Query locale.' },
    { key: 't', label: 'title', description: 'Original raw job title.' },
    { key: 'pt', label: 'peeled_title', description: 'Title after deterministic noise peeling.' },
    { key: 'nr', label: 'noise_removed', description: 'Whether deterministic peeling changed the original title.' },
    { key: 'eq', label: 'effective_query', description: 'Effective query the pipeline actually searched.' },
    { key: 'dec', label: 'decision_type', description: 'Pipeline decision type: leaf, family, group, multi_span, unresolved, noise_only.' },
    { key: 'sel', label: 'selected_label', description: 'Selected family/leaf label when available.' },
    {
      key: 'cov',
      label: 'coverage_status',
      description: 'Coverage outcome such as exact_canonical_match, closest_available_match, likely_dictionary_gap.'
    },
    { key: 'sp', label: 'query_spans', description: 'Query spans preserved by query preparation. `|` separated.' },
    { key: 'rt', label: 'intent_role_tokens', description: 'Role tokens inferred by query intent separation. `|` separated.' },
    { key: 'rh', label: 'intent_role_head_tokens', description: 'Role-head tokens inferred by query intent separation. `|` separated.' },
    { key: 'dt', label: 'intent_domain_tokens', description: 'Domain/context tokens inferred by query intent separation. `|` separated.' },
    {
      key: 'mt',
      label: 'modifier_tokens',
      description: 'Safe job-level modifiers removed before retrieval, such as seniority or credential wrappers.'
    },
    {
      key: 'nt',
      label: 'peeled_noise_tokens',
      description: 'Noise tokens removed or identified by deterministic preprocessing. Useful when proposing `noise_rule`.'
    },
    { key: 'mr', label: 'matched_role_tokens', description: 'Role tokens covered by the selected result.' },
    { key: 'xr', label: 'missing_role_tokens', description: 'Role tokens still missing from the selected result.' },
    { key: 'mu', label: 'matched_useful_tokens', description: 'Useful tokens matched by the selected result.' },
    { key: 'xu', label: 'missing_useful_tokens', description: 'Useful tokens not matched by the selected result.' },
    { key: 'crp', label: 'common_role_phrase', description: 'Curated/common role phrase canonicalization if one fired.' },
    { key: 'fam', label: 'family_alias_match', description: 'Curated family alias canonicalization if one fired.' },
    { key: 'f1', label: 'top_family_1', description: 'Best ranked family as `label #id`.' },
    { key: 'f1c', label: 'top_family_1_confidence', description: 'Confidence of top family 1.' },
    { key: 'f1t', label: 'top_family_1_tier', description: 'Evidence tier of top family 1.' },
    { key: 'f1r', label: 'top_family_1_rules', description: 'Reviewed rule ids that fired on top family 1.' },
    { key: 'f1q', label: 'top_family_1_matched_query_terms', description: 'Matched query terms recorded on top family 1.' },
    { key: 'f1l', label: 'top_family_1_top_leaves', description: 'Top leaves under family 1 as `label (confidence)`.' },
    { key: 'f2', label: 'top_family_2', description: 'Second ranked family as `label #id`.' },
    { key: 'f2c', label: 'top_family_2_confidence', description: 'Confidence of top family 2.' },
    { key: 'f2t', label: 'top_family_2_tier', description: 'Evidence tier of top family 2.' },
    { key: 'f2r', label: 'top_family_2_rules', description: 'Reviewed rule ids that fired on top family 2.' },
    { key: 'f2q', label: 'top_family_2_matched_query_terms', description: 'Matched query terms recorded on top family 2.' },
    { key: 'f2l', label: 'top_family_2_top_leaves', description: 'Top leaves under family 2 as `label (confidence)`.' },
    { key: 'aa', label: 'allowed_artifact_classes', description: 'Artifact classes the LLM is allowed to propose.' },
    { key: 'schema', label: 'output_schema_ref', description: 'Schema path the reviewed LLM output must follow.' }
  ];
}

function buildTsv(rows, columns) {
  const headers = columns.map((column) => column.key);
  const lines = [headers.join('\t')];

  for (const row of rows) {
    const family1 = row.top_families[0] ?? null;
    const family2 = row.top_families[1] ?? null;
    const record = {
      ri: row.row_index,
      loc: row.locale,
      t: row.title,
      pt: row.peeled_title,
      nr: row.noise_removed ? 'yes' : 'no',
      eq: row.effective_query,
      dec: row.decision_type,
      sel: row.selected_label ?? '',
      cov: row.coverage_status,
      sp: row.query_spans.join(' | '),
      rt: row.intent.role_tokens.join(' | '),
      rh: row.intent.role_head_tokens.join(' | '),
      dt: row.intent.domain_tokens.join(' | '),
      mt: row.modifier_tokens.join(' | '),
      nt: row.peeled_noise_tokens.join(' | '),
      mr: row.matched_role_tokens.join(' | '),
      xr: row.missing_role_tokens.join(' | '),
      mu: row.matched_useful_tokens.join(' | '),
      xu: row.missing_useful_tokens.join(' | '),
      crp: row.phrase_hints.common_role_phrase
        ? `${row.phrase_hints.common_role_phrase.surface} -> ${row.phrase_hints.common_role_phrase.canonical_english}`
        : '',
      fam: row.phrase_hints.family_alias_match
        ? `${row.phrase_hints.family_alias_match.surface} -> ${row.phrase_hints.family_alias_match.canonical_english}`
        : '',
      f1: family1 ? `${family1.family_label} #${family1.family_node_id}` : '',
      f1c: formatPercent(family1?.confidence),
      f1t: family1?.evidence_tier ?? '',
      f1r: family1 ? family1.reviewed_rule_ids.join(' | ') : '',
      f1q: family1 ? family1.matched_query_terms.join(' | ') : '',
      f1l: family1 ? family1.top_leaves.map((leaf) => `${leaf.canonical_label} (${formatPercent(leaf.confidence)})`).join(' | ') : '',
      f2: family2 ? `${family2.family_label} #${family2.family_node_id}` : '',
      f2c: formatPercent(family2?.confidence),
      f2t: family2?.evidence_tier ?? '',
      f2r: family2 ? family2.reviewed_rule_ids.join(' | ') : '',
      f2q: family2 ? family2.matched_query_terms.join(' | ') : '',
      f2l: family2 ? family2.top_leaves.map((leaf) => `${leaf.canonical_label} (${formatPercent(leaf.confidence)})`).join(' | ') : '',
      aa: row.allowed_artifact_classes.join(' | '),
      schema: row.output_schema_ref ?? ''
    };

    lines.push(headers.map((header) => escapeTsv(record[header] ?? '')).join('\t'));
  }

  return `${lines.join('\n')}\n`;
}

function arrayOfStrings(value) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function stringOrNull(value) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function numberOrNull(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function formatPercent(value) {
  return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : '-';
}

function escapeTsv(value) {
  return String(value ?? '')
    .replace(/\t/gu, ' ')
    .replace(/\r?\n/gu, ' ');
}

main().catch((error) => {
  console.error('LLM job-title triage brief build failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
