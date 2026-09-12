// Regenerates the concept-dimension columns of family-structure-rules.tsv so every family's
// task/industry/knowledge_domain/population/work_object/product concepts are a superset of what
// its own leaves actually carry. role_heads, authority_levels, venue, channel and residual_policy
// stay hand-curated -- this script only closes the leaf-vs-rule concept coverage gap, which is
// what tests/occupation-classifier/integration/classifier-family-structure.test.ts enforces.
//
// Usage: node scripts/occupation-classifier/generate-family-structure-rules.mjs [--check] [--verbose]
//   --check   exit 1 if the file would change, without writing (for CI)
//   --verbose print a per-family diff of added concepts

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildQueryStructuralProfile } from '../../dist/src/occupation-classifier/preparation.js';
import { loadOccupationSearchMetaArtifactRequired } from '../../dist/src/runtime/occupation-search-meta-artifact.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const TSV_PATH = path.join(REPO_ROOT, 'src/occupation-classifier/family-structure/family-structure-rules.tsv');

const CONCEPT_COLUMNS = ['venue', 'channel', 'product', 'population', 'task', 'industry', 'knowledge_domain', 'work_object'];
const HEADER_COLUMNS = ['family_node_id', 'family_label', 'role_heads', 'authority_levels', ...CONCEPT_COLUMNS, 'residual_policy'];

function parsePipeList(value) {
  return value
    .split('|')
    .map((v) => v.trim())
    .filter(Boolean);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const checkOnly = args.has('--check');
  const verbose = args.has('--verbose');

  const raw = readFileSync(TSV_PATH, 'utf8');
  const lines = raw.split('\n');
  const [headerLine, ...rest] = lines;
  const trailingBlank = rest[rest.length - 1] === '' ? rest.pop() : undefined;

  if (headerLine.split('\t').join(',') !== HEADER_COLUMNS.join(',')) {
    throw new Error(`Unexpected TSV header. Expected: ${HEADER_COLUMNS.join('\t')}`);
  }

  const rows = rest.map((line) => {
    const columns = line.split('\t');
    if (columns.length !== HEADER_COLUMNS.length) {
      throw new Error(`Malformed row (expected ${HEADER_COLUMNS.length} columns, got ${columns.length}): ${line}`);
    }
    const familyNodeId = Number.parseInt(columns[0], 10);
    return {
      familyNodeId,
      familyLabel: columns[1],
      roleHeads: columns[2],
      authorityLevels: columns[3],
      concepts: new Map(CONCEPT_COLUMNS.map((dimension, offset) => [dimension, new Set(parsePipeList(columns[4 + offset]))])),
      residualPolicy: columns[12]
    };
  });
  const rowsById = new Map(rows.map((row) => [row.familyNodeId, row]));

  const searchMeta = await loadOccupationSearchMetaArtifactRequired('esco_1_2_1');
  const additions = new Map(); // familyNodeId -> dimension -> Set(new concept ids)

  for (const leaf of searchMeta.getAllCoreRecords()) {
    if (leaf.familyNodeId === null || leaf.graphNodeId === leaf.familyNodeId) {
      continue;
    }
    const row = rowsById.get(leaf.familyNodeId);
    if (!row) {
      continue;
    }
    const profile = buildQueryStructuralProfile(leaf.canonicalLabel);
    for (const concept of profile.profile.concepts) {
      const dimensionSet = row.concepts.get(concept.dimension);
      if (!dimensionSet) {
        continue;
      }
      if (!dimensionSet.has(concept.conceptId)) {
        dimensionSet.add(concept.conceptId);
        let byDimension = additions.get(leaf.familyNodeId);
        if (!byDimension) {
          byDimension = new Map();
          additions.set(leaf.familyNodeId, byDimension);
        }
        let added = byDimension.get(concept.dimension);
        if (!added) {
          added = new Set();
          byDimension.set(concept.dimension, added);
        }
        added.add(concept.conceptId);
      }
    }
  }

  const newLines = [
    headerLine,
    ...rows.map((row) => {
      const columns = [
        String(row.familyNodeId),
        row.familyLabel,
        row.roleHeads,
        row.authorityLevels,
        ...CONCEPT_COLUMNS.map((dimension) => [...row.concepts.get(dimension)].sort().join('|')),
        row.residualPolicy
      ];
      return columns.join('\t');
    })
  ];
  if (trailingBlank !== undefined) {
    newLines.push('');
  }
  const newContent = newLines.join('\n');

  const changed = newContent !== raw;
  const familiesChanged = [...additions.keys()].length;
  const conceptsAdded = [...additions.values()].reduce(
    (sum, byDimension) => sum + [...byDimension.values()].reduce((s, set) => s + set.size, 0),
    0
  );

  if (verbose) {
    for (const [familyNodeId, byDimension] of additions) {
      const row = rowsById.get(familyNodeId);
      console.log(`\n${familyNodeId} ${row.familyLabel}`);
      for (const [dimension, added] of byDimension) {
        console.log(`  + ${dimension}: ${[...added].sort().join(', ')}`);
      }
    }
  }

  console.log(`\nfamilies changed: ${familiesChanged}/${rows.length}, concepts added: ${conceptsAdded}`);

  if (checkOnly) {
    if (changed) {
      console.error('family-structure-rules.tsv is stale. Run without --check to regenerate.');
      process.exit(1);
    }
    console.log('family-structure-rules.tsv is up to date.');
    return;
  }

  if (!changed) {
    console.log('No changes needed.');
    return;
  }

  writeFileSync(TSV_PATH, newContent);
  console.log(`Wrote ${TSV_PATH}`);

  execFileSync('node', ['scripts/copy-classifier-runtime-files.mjs', '--tests'], { cwd: REPO_ROOT, stdio: 'inherit' });
  execFileSync('node', ['scripts/copy-classifier-runtime-files.mjs'], { cwd: REPO_ROOT, stdio: 'inherit' });

  const { validateFamilyStructureRules } = await import('../../dist/src/occupation-classifier/family-structure/family-structure.js');
  const validation = validateFamilyStructureRules();
  if (!validation.valid) {
    console.error('Regenerated rules failed validation:');
    for (const error of validation.errors) {
      console.error(`  ${error}`);
    }
    process.exit(1);
  }
  console.log('Regenerated rules pass validateFamilyStructureRules().');
}

await main();
