import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

async function main() {
  const options = parseCliOptions(process.argv.slice(2));
  const rows = readJsonLines(options.inputPath);
  const aggregate = buildAggregate(rows);

  mkdirSync(path.dirname(options.outJsonPath), { recursive: true });
  writeFileSync(options.outJsonPath, `${JSON.stringify(aggregate, null, 2)}\n`, 'utf8');
  writeFileSync(options.outCsvPath, toCsv(aggregate.proposals), 'utf8');

  console.log(
    [
      `rows=${aggregate.rows_reviewed}`,
      `proposals=${aggregate.total_proposals}`,
      `unique=${aggregate.unique_proposals}`,
      `out_json=${options.outJsonPath}`,
      `out_csv=${options.outCsvPath}`
    ].join('  ')
  );
}

function parseCliOptions(args) {
  const options = {
    inputPath: path.join(process.cwd(), 'data', 'taxonomy-review', 'job-title-triage-reviewed.ro.jsonl'),
    outJsonPath: path.join(process.cwd(), 'data', 'taxonomy-review', 'job-title-triage-proposals.ro.json'),
    outCsvPath: path.join(process.cwd(), 'data', 'taxonomy-review', 'job-title-triage-proposals.ro.csv')
  };

  for (const arg of args) {
    if (arg.startsWith('--input=')) {
      options.inputPath = arg.slice('--input='.length).trim();
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
      'Usage: node scripts/aggregate-llm-job-title-triage-proposals.js',
      '[--input=data/taxonomy-review/job-title-triage-reviewed.ro.jsonl]',
      '[--out-json=data/taxonomy-review/job-title-triage-proposals.ro.json]',
      '[--out-csv=data/taxonomy-review/job-title-triage-proposals.ro.csv]'
    ].join(' ')
  );
}

function readJsonLines(filePath) {
  const contents = readFileSync(filePath, 'utf8');

  return contents
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

function buildAggregate(rows) {
  const proposalMap = new Map();
  let totalProposals = 0;

  for (const row of rows) {
    const rowIndex = integerOrNull(row.row_index);
    const artifactProposals = Array.isArray(row.artifact_proposals) ? row.artifact_proposals : [];

    for (const proposal of artifactProposals) {
      totalProposals += 1;
      const normalized = normalizeProposal(proposal);
      const key = fingerprintProposal(normalized);
      const existing = proposalMap.get(key);

      if (existing) {
        existing.occurrences += 1;
        existing.row_indexes.push(rowIndex);
        existing.confidence_labels.push(normalized.confidence);
        existing.rationales.push(normalized.rationale);
        continue;
      }

      proposalMap.set(key, {
        ...normalized,
        proposal_key: key,
        occurrences: 1,
        row_indexes: rowIndex === null ? [] : [rowIndex],
        confidence_labels: [normalized.confidence],
        rationales: [normalized.rationale]
      });
    }
  }

  const proposals = Array.from(proposalMap.values())
    .map((proposal) => ({
      ...proposal,
      row_indexes: uniqueIntegers(proposal.row_indexes),
      confidence_labels: uniqueStrings(proposal.confidence_labels),
      rationales: uniqueStrings(proposal.rationales).slice(0, 8)
    }))
    .sort(compareProposals);

  return {
    rows_reviewed: rows.length,
    total_proposals: totalProposals,
    unique_proposals: proposals.length,
    proposals
  };
}

function normalizeProposal(proposal) {
  return {
    type: stringOrEmpty(proposal.type),
    locale: stringOrEmpty(proposal.locale),
    target_family_node_id: integerOrNull(proposal.target_family_node_id),
    target_family_label: stringOrEmpty(proposal.target_family_label),
    role_heads_any: uniqueStrings(stringArray(proposal.role_heads_any)),
    query_terms_any: uniqueStrings(stringArray(proposal.query_terms_any)),
    query_terms_all: uniqueStrings(stringArray(proposal.query_terms_all)),
    surface: stringOrEmpty(proposal.surface),
    canonical_english: stringOrEmpty(proposal.canonical_english),
    rationale: stringOrEmpty(proposal.rationale),
    confidence: stringOrEmpty(proposal.confidence)
  };
}

function fingerprintProposal(proposal) {
  return [
    proposal.type,
    proposal.locale,
    proposal.target_family_node_id ?? '',
    proposal.target_family_label,
    proposal.role_heads_any.join('|'),
    proposal.query_terms_any.join('|'),
    proposal.query_terms_all.join('|'),
    proposal.surface,
    proposal.canonical_english
  ].join('\u0000');
}

function compareProposals(left, right) {
  return (
    right.occurrences - left.occurrences ||
    left.type.localeCompare(right.type) ||
    left.locale.localeCompare(right.locale) ||
    (left.target_family_node_id ?? Number.MAX_SAFE_INTEGER) - (right.target_family_node_id ?? Number.MAX_SAFE_INTEGER) ||
    left.surface.localeCompare(right.surface) ||
    left.canonical_english.localeCompare(right.canonical_english)
  );
}

function toCsv(proposals) {
  const headers = [
    'proposal_key',
    'type',
    'locale',
    'target_family_node_id',
    'target_family_label',
    'role_heads_any',
    'query_terms_any',
    'query_terms_all',
    'surface',
    'canonical_english',
    'occurrences',
    'confidence_labels',
    'row_indexes',
    'rationales'
  ];

  const lines = [headers.join(',')];

  for (const proposal of proposals) {
    lines.push(
      headers
        .map((header) =>
          escapeCsv(
            header === 'role_heads_any' || header === 'query_terms_any' || header === 'query_terms_all'
              ? proposal[header].join('|')
              : header === 'confidence_labels'
                ? proposal.confidence_labels.join('|')
                : header === 'row_indexes'
                  ? proposal.row_indexes.join('|')
                  : header === 'rationales'
                    ? proposal.rationales.join(' || ')
                    : (proposal[header] ?? '')
          )
        )
        .join(',')
    );
  }

  return `${lines.join('\n')}\n`;
}

function escapeCsv(value) {
  return `"${String(value ?? '').replace(/"/gu, '""')}"`;
}

function stringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function stringOrEmpty(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function integerOrNull(value) {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function uniqueIntegers(values) {
  return [...new Set(values.filter((value) => Number.isInteger(value)))].sort((left, right) => left - right);
}

main().catch((error) => {
  console.error('LLM job-title triage proposal aggregation failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
