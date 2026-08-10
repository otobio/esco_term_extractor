import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = process.cwd();
const FIXTURE_INPUT = path.join(ROOT, 'data', 'taxonomy-review', 'job-title-triage-smoke-input.ro.csv');
const OUT_DIR = path.join(ROOT, 'data', 'taxonomy-review', 'smoke');

const PATHS = {
  pilotJsonl: path.join(OUT_DIR, 'job-title-triage-pilot.smoke.ro.jsonl'),
  pilotManifest: path.join(OUT_DIR, 'job-title-triage-pilot.smoke.ro.manifest.json'),
  briefTsv: path.join(OUT_DIR, 'job-title-triage-brief.smoke.ro.tsv'),
  briefColumns: path.join(OUT_DIR, 'job-title-triage-brief.smoke.columns.json'),
  briefManifest: path.join(OUT_DIR, 'job-title-triage-brief.smoke.ro.manifest.json'),
  reviewedJsonl: path.join(OUT_DIR, 'job-title-triage-reviewed.smoke.ro.jsonl'),
  proposalsJson: path.join(OUT_DIR, 'job-title-triage-proposals.smoke.ro.json'),
  proposalsCsv: path.join(OUT_DIR, 'job-title-triage-proposals.smoke.ro.csv'),
  seedCandidatesJson: path.join(OUT_DIR, 'job-title-query-prep-seed-proposals.smoke.ro.json'),
  bundleJson: path.join(OUT_DIR, 'job-title-triage-review-bundle.smoke.ro.json')
};

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  run('npm', ['run', 'build']);
  run('node', [
    'scripts/build-llm-job-title-triage-pilot.js',
    '--locale=ro',
    '--sample=2',
    '--seed=llm-job-title-triage-smoke-ro',
    `--input=${FIXTURE_INPUT}`,
    '--title-column=job_title',
    `--out=${PATHS.pilotJsonl}`,
    `--manifest=${PATHS.pilotManifest}`
  ]);
  run('node', [
    'scripts/build-llm-job-title-review-brief.js',
    `--input=${PATHS.pilotJsonl}`,
    `--out-tsv=${PATHS.briefTsv}`,
    `--out-columns=${PATHS.briefColumns}`,
    `--manifest=${PATHS.briefManifest}`
  ]);
  run('node', ['scripts/prepare-llm-job-title-review-bundle.js', '--locale=ro', `--out=${PATHS.bundleJson}`]);

  const pilotRows = readJsonLines(PATHS.pilotJsonl);
  assert.equal(pilotRows.length, 2, 'expected exactly 2 pilot rows');
  const reviewedRows = buildReviewedRows(pilotRows);
  writeJsonLines(PATHS.reviewedJsonl, reviewedRows);

  run('node', [
    'scripts/aggregate-llm-job-title-triage-proposals.js',
    `--input=${PATHS.reviewedJsonl}`,
    `--out-json=${PATHS.proposalsJson}`,
    `--out-csv=${PATHS.proposalsCsv}`
  ]);
  run('node', ['scripts/build-query-prep-seed-proposals.js', `--input=${PATHS.proposalsJson}`, `--out=${PATHS.seedCandidatesJson}`]);

  const columns = JSON.parse(readFileSync(PATHS.briefColumns, 'utf8'));
  const briefManifest = JSON.parse(readFileSync(PATHS.briefManifest, 'utf8'));
  const proposals = JSON.parse(readFileSync(PATHS.proposalsJson, 'utf8'));
  const seedCandidates = JSON.parse(readFileSync(PATHS.seedCandidatesJson, 'utf8'));

  assert.ok(Array.isArray(columns) && columns.length > 10, 'expected populated column definition file');
  assert.equal(briefManifest.rows, 2, 'expected 2-row brief manifest');
  assert.equal(proposals.rows_reviewed, 2, 'expected 2 reviewed rows in aggregate');
  assert.ok(proposals.unique_proposals >= 6, 'expected at least 6 unique proposals');
  assert.ok(
    proposals.proposals.some((proposal) => proposal.type === 'reviewed_family_signal' && proposal.target_family_node_id === 15139),
    'expected telecom installer family support proposal'
  );
  assert.ok(
    proposals.proposals.some((proposal) => proposal.type === 'reviewed_family_signal' && proposal.target_family_node_id === 15204),
    'expected assemblers family support proposal'
  );
  assert.ok(
    proposals.proposals.some((proposal) => proposal.type === 'common_role_phrase' && proposal.canonical_english === 'warehouse supervisor'),
    'expected common role phrase proposal'
  );
  assert.ok(
    proposals.proposals.some((proposal) => proposal.type === 'family_alias_anchor' && proposal.canonical_english === 'warehouse worker'),
    'expected family alias anchor proposal'
  );
  assert.ok(
    proposals.proposals.some((proposal) => proposal.type === 'noise_rule' && proposal.noise_rule_kind === 'noise_salary'),
    'expected typed noise rule proposal'
  );
  assert.ok(seedCandidates.commonRolePhrases.length >= 1, 'expected shaped common role phrase seed candidates');
  assert.ok(seedCandidates.familyAliasAnchors.length >= 1, 'expected shaped family alias seed candidates');
  assert.ok(seedCandidates.noiseRules.complete.length >= 1, 'expected shaped complete noise-rule seed candidates');

  console.log('Smoke flow OK.');
  console.log(`fixture_input=${FIXTURE_INPUT}`);
  console.log(`pilot_jsonl=${PATHS.pilotJsonl}`);
  console.log(`brief_columns=${PATHS.briefColumns}`);
  console.log(`brief_tsv=${PATHS.briefTsv}`);
  console.log(`reviewed_jsonl=${PATHS.reviewedJsonl}`);
  console.log(`proposals_json=${PATHS.proposalsJson}`);
  console.log(`proposals_csv=${PATHS.proposalsCsv}`);
  console.log(`seed_candidates_json=${PATHS.seedCandidatesJson}`);
  console.log(`bundle_json=${PATHS.bundleJson}`);
}

function buildReviewedRows(pilotRows) {
  return pilotRows.map((row) => {
    if (String(row.original_title).includes('TEHNICIAN-ALPINIST TELECOMUNICATII')) {
      return {
        row_index: row.row_index,
        title_type: 'single_role',
        pipeline_result_plausible: true,
        pipeline_failure_mode: 'missing_family_marker_support',
        role_heads: ['tehnician', 'telecomunicatii'],
        role_modifiers: ['alpinist'],
        domain_terms: [],
        noise_terms: [],
        notes:
          'Telecommunications installer family is the closest safe family; alpinist acts like a role-side modifier rather than independent domain context.',
        artifact_proposals: [
          {
            type: 'common_role_phrase',
            locale: 'ro',
            target_family_node_id: null,
            target_family_label: null,
            role_heads_any: [],
            query_terms_any: [],
            query_terms_all: [],
            surface: 'sef depozit',
            canonical_english: 'warehouse supervisor',
            role_key: 'warehouse_supervisor',
            priority: 97,
            noise_rule_kind: null,
            noise_match_type: null,
            rationale:
              'Repeated Romanian market wording should canonicalize directly to warehouse supervisor before generic head fallback.',
            confidence: 'high'
          },
          {
            type: 'family_alias_anchor',
            locale: 'ro',
            target_family_node_id: null,
            target_family_label: null,
            role_heads_any: [],
            query_terms_any: ['depozit', 'marfa'],
            query_terms_all: [],
            surface: 'depozit marfa',
            canonical_english: 'warehouse worker',
            role_key: 'warehouse_worker',
            priority: 94,
            noise_rule_kind: null,
            noise_match_type: null,
            rationale: 'Repeated warehouse-market wording should anchor warehouse worker family phrasing even when the title is broad.',
            confidence: 'medium'
          },
          {
            type: 'noise_rule',
            locale: 'ro',
            target_family_node_id: null,
            target_family_label: null,
            role_heads_any: [],
            query_terms_any: ['salariu motivant'],
            query_terms_all: [],
            surface: 'salariu motivant',
            canonical_english: null,
            role_key: null,
            priority: null,
            noise_rule_kind: 'noise_salary',
            noise_match_type: 'phrase',
            rationale: 'Repeated salary boilerplate should be removable before role parsing.',
            confidence: 'high'
          },
          {
            type: 'reviewed_family_signal',
            locale: 'ro',
            target_family_node_id: 15139,
            target_family_label: 'Electronics and telecommunications installers and repairers',
            role_heads_any: ['tehnician', 'montator', 'electrician'],
            query_terms_any: ['telecomunicatii', 'retele', 'voce'],
            query_terms_all: [],
            surface: null,
            canonical_english: null,
            role_key: null,
            priority: null,
            noise_rule_kind: null,
            noise_match_type: null,
            rationale: 'Telecom/network equipment wording should reinforce the telecom-installer family.',
            confidence: 'high'
          },
          {
            type: 'reviewed_family_penalty',
            locale: 'ro',
            target_family_node_id: 15204,
            target_family_label: 'Assemblers',
            role_heads_any: ['tehnician', 'montator', 'electrician'],
            query_terms_any: ['telecomunicatii', 'retele', 'voce'],
            query_terms_all: [],
            surface: null,
            canonical_english: null,
            role_key: null,
            priority: null,
            noise_rule_kind: null,
            noise_match_type: null,
            rationale: 'Telecom/network equipment wording should not drift to assembly-only families.',
            confidence: 'high'
          }
        ]
      };
    }

    return {
      row_index: row.row_index,
      title_type: 'single_role',
      pipeline_result_plausible: true,
      pipeline_failure_mode: 'missing_family_marker_support',
      role_heads: ['mecanic'],
      role_modifiers: ['lacatus', 'asamblare'],
      domain_terms: [],
      noise_terms: [],
      notes: 'Mechanical assembly wording should resolve to the assembly branch as the closest safe family.',
      artifact_proposals: [
        {
          type: 'reviewed_family_signal',
          locale: 'ro',
          target_family_node_id: 15204,
          target_family_label: 'Assemblers',
          role_heads_any: ['lacatus', 'mecanic', 'montator', 'electrician'],
          query_terms_any: ['asamblare', 'automatizate', 'utilaje'],
          query_terms_all: [],
          surface: null,
          canonical_english: null,
          role_key: null,
          priority: null,
          noise_rule_kind: null,
          noise_match_type: null,
          rationale: 'Assembly-heavy mechanical wording should reinforce the assemblers family.',
          confidence: 'high'
        }
      ]
    };
  });
}

function readJsonLines(filePath) {
  return readFileSync(filePath, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeJsonLines(filePath, rows) {
  writeFileSync(filePath, `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
}

function run(command, args) {
  execFileSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: process.env
  });
}

main().catch((error) => {
  console.error('LLM job-title triage smoke flow failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
