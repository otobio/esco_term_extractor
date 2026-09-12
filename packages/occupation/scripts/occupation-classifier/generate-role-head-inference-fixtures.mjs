// Snapshots known-good outputs of inferRoleHeadsFromStructuralContext for every family whose own
// concept signature (full profile, and each individual concept dimension) currently resolves back
// to that family alone with none of its own non-rank/non-generic role heads missing. This locks in
// verified-correct structural-inference behavior across real production family rules as a large
// regression suite -- see tests/occupation-classifier/unit/role-head-structural-inference-fixtures.test.ts.
//
// Usage: node scripts/occupation-classifier/generate-role-head-inference-fixtures.mjs [--check]
//   --check   exit 1 if the fixture file would change, without writing (for CI)

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getFamilyStructureRules } from '../../dist/src/occupation-classifier/family-structure/family-structure.js';
import {
  inferRoleHeadsFromStructuralContext,
  isRankRoleHead,
  VAGUE_ROLE_HEAD_TOKENS
} from '../../dist/src/occupation-classifier/role-head-groups.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const FIXTURE_PATH = path.join(REPO_ROOT, 'tests/occupation-classifier/fixtures/role-head-structural-inference-fixtures.json');
const MAX_ROLE_HEADS_FOR_CONTEXT_INFERENCE = 8;

function buildFixtures() {
  const rules = getFamilyStructureRules();
  const fixtures = [];

  for (const rule of rules) {
    if (rule.roleHeads.length === 0 || rule.roleHeads.length > MAX_ROLE_HEADS_FOR_CONTEXT_INFERENCE) {
      continue;
    }

    const expectedHeads = rule.roleHeads.filter(
      (rh) =>
        !isRankRoleHead(rh, 'pure') &&
        !isRankRoleHead(rh, 'authority') &&
        !isRankRoleHead(rh, 'non-authority') &&
        !VAGUE_ROLE_HEAD_TOKENS.has(rh)
    );
    if (expectedHeads.length === 0) {
      continue;
    }

    const nonEmptyDims = [...rule.conceptsByDimension.entries()].filter(([, ids]) => ids.length > 0);
    if (nonEmptyDims.length === 0) {
      continue;
    }

    const candidateQueries = [];
    if (nonEmptyDims.length > 1) {
      candidateQueries.push({ label: 'full', entries: nonEmptyDims });
    }
    for (const [dimension, ids] of nonEmptyDims) {
      candidateQueries.push({ label: dimension, entries: [[dimension, ids]] });
    }

    for (const { label, entries } of candidateQueries) {
      const conceptIdsByDimension = new Map(entries);
      const authority = rule.authorityLevels.includes('none') ? 'none' : rule.authorityLevels[0];

      const result = inferRoleHeadsFromStructuralContext({
        authority,
        roleHeads: [],
        conceptIdsByDimension,
        familyRules: rules
      });

      const resultFamilyIds = new Set(result.map((r) => r.familyNodeId));
      const onlyThisFamily = resultFamilyIds.size === 1 && resultFamilyIds.has(rule.familyNodeId);
      const heads = new Set(result.map((r) => r.roleHead));
      const coversAllExpected = expectedHeads.every((h) => heads.has(h));

      if (result.length > 0 && onlyThisFamily && coversAllExpected) {
        fixtures.push({
          familyNodeId: rule.familyNodeId,
          familyLabel: rule.familyLabel,
          label,
          authority,
          dimensions: entries,
          expectedRoleHeads: [...heads].sort()
        });
      }
    }
  }

  return fixtures;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const fixtures = buildFixtures();
  const nextContent = `${JSON.stringify(fixtures, null, 2)}\n`;

  if (args.has('--check')) {
    const currentContent = readFileSync(FIXTURE_PATH, 'utf8');
    if (currentContent !== nextContent) {
      console.error('role-head-structural-inference-fixtures.json is out of date. Run without --check to regenerate.');
      process.exit(1);
    }
    console.log(`role-head-structural-inference-fixtures.json is up to date (${fixtures.length} fixtures).`);
    return;
  }

  writeFileSync(FIXTURE_PATH, nextContent);
  console.log(`Wrote ${fixtures.length} fixtures to ${FIXTURE_PATH}`);
}

main();
