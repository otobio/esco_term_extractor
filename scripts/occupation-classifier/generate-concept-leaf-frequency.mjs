// Regenerates concept-leaf-frequency.json: for every specialization concept id, how many distinct
// leaves carry it. Used at runtime to weight a matched concept by how specific it is -- a concept
// carried by 4 leaves (e.g. "networks") is much stronger evidence than one carried by 90 (e.g.
// "machine"), and this table is what lets that distinction be query-driven instead of hardcoded.
//
// Usage: node scripts/occupation-classifier/generate-concept-leaf-frequency.mjs [--check]
//   --check   exit 1 if the file would change, without writing (for CI)

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifySpecializationQuery } from '../../dist/src/occupation-classifier/specialization/specialization-dimension-mapper.js';
import { loadOccupationSearchMetaArtifactRequired } from '../../dist/src/runtime/occupation-search-meta-artifact.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '../..');
const OUTPUT_PATH = path.join(
  REPO_ROOT,
  'src/occupation-classifier/specialization/specialization-schema/concept-leaf-frequency.json'
);

async function main() {
  const checkOnly = process.argv.slice(2).includes('--check');

  const searchMeta = await loadOccupationSearchMetaArtifactRequired('esco_1_2_1');

  const counts = new Map();
  const roleHeadCounts = new Map();
  const roleHeadConceptCounts = new Map();
  const roleHeadDirectConceptCounts = new Map();
  const roleHeadCompositionCounts = new Map();
  let totalLeaves = 0;

  for (const leaf of searchMeta.getAllCoreRecords()) {
    if (leaf.familyNodeId === null || leaf.graphNodeId === leaf.familyNodeId) {
      continue;
    }
    totalLeaves += 1;
    const profile = classifySpecializationQuery(leaf.canonicalLabel);
    const seen = new Set();
    for (const concept of profile.concepts) {
      if (seen.has(concept.conceptId)) {
        continue;
      }
      seen.add(concept.conceptId);
      counts.set(concept.conceptId, (counts.get(concept.conceptId) ?? 0) + 1);
    }

    const roleHeads = new Set(profile.role_head);
    for (const combination of profile.structural_combination) {
      for (const roleHead of combination.derivedRoleHeads) {
        roleHeads.add(roleHead);
      }
    }

    for (const roleHead of roleHeads) {
      roleHeadCounts.set(roleHead, (roleHeadCounts.get(roleHead) ?? 0) + 1);
      const conceptCounts = roleHeadConceptCounts.get(roleHead) ?? new Map();
      const directConceptCounts = roleHeadDirectConceptCounts.get(roleHead) ?? new Map();
      for (const conceptId of seen) {
        conceptCounts.set(conceptId, (conceptCounts.get(conceptId) ?? 0) + 1);
      }
      const headConceptIds = new Set();
      for (const concept of profile.concepts) {
        if (conceptAttachesToRoleHead(profile.tokens, concept.start, concept.end, roleHead)) {
          directConceptCounts.set(concept.conceptId, (directConceptCounts.get(concept.conceptId) ?? 0) + 1);
          headConceptIds.add(concept.conceptId);
        }
      }
      if (seen.size > 0 && headConceptIds.size > 0) {
        const compositions = roleHeadCompositionCounts.get(roleHead) ?? new Map();
        const conceptIds = [...seen].sort();
        const signature = conceptIds.join('|');
        const existing = compositions.get(signature) ?? {
          conceptIds,
          headConceptIds: new Set(),
          leafCount: 0
        };
        existing.leafCount += 1;
        for (const conceptId of headConceptIds) {
          existing.headConceptIds.add(conceptId);
        }
        compositions.set(signature, existing);
        roleHeadCompositionCounts.set(roleHead, compositions);
      }
      roleHeadConceptCounts.set(roleHead, conceptCounts);
      roleHeadDirectConceptCounts.set(roleHead, directConceptCounts);
    }
  }

  const sortedEntries = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
  const sortedRoleHeadEntries = [...roleHeadCounts.entries()].sort(([a], [b]) => a.localeCompare(b));
  const output = {
    totalLeaves,
    leafCountByConceptId: Object.fromEntries(sortedEntries),
    roleHeadLeafFrequency: Object.fromEntries(
      sortedRoleHeadEntries.map(([roleHead, leafCount]) => [
        roleHead,
        {
          leafCount,
          leafCountByConceptId: Object.fromEntries(
            [...(roleHeadConceptCounts.get(roleHead) ?? new Map()).entries()].sort(([a], [b]) => a.localeCompare(b))
          ),
          directLeafCountByConceptId: Object.fromEntries(
            [...(roleHeadDirectConceptCounts.get(roleHead) ?? new Map()).entries()].sort(([a], [b]) => a.localeCompare(b))
          ),
          conceptCompositions: [...(roleHeadCompositionCounts.get(roleHead) ?? new Map()).values()]
            .map((composition) => ({
              conceptIds: composition.conceptIds,
              headConceptIds: [...composition.headConceptIds].sort(),
              leafCount: composition.leafCount
            }))
            .sort(
              (left, right) =>
                right.conceptIds.length - left.conceptIds.length ||
                right.leafCount - left.leafCount ||
                left.conceptIds.join('|').localeCompare(right.conceptIds.join('|'))
            )
        }
      ])
    )
  };
  const newContent = `${JSON.stringify(output, null, 2)}\n`;

  const existing = (() => {
    try {
      return readFileSync(OUTPUT_PATH, 'utf8');
    } catch {
      return null;
    }
  })();

  if (checkOnly) {
    if (existing !== newContent) {
      console.error('concept-leaf-frequency.json is stale. Run without --check to regenerate.');
      process.exit(1);
    }
    console.log(`concept-leaf-frequency.json is up to date (${sortedEntries.length} concepts, ${totalLeaves} leaves).`);
    return;
  }

  writeFileSync(OUTPUT_PATH, newContent);
  console.log(`Wrote ${sortedEntries.length} concept frequencies over ${totalLeaves} leaves to ${OUTPUT_PATH}`);
}

function conceptAttachesToRoleHead(tokens, conceptStart, conceptEnd, roleHead) {
  const normalizedTokens = tokens.map(normalizeToken);
  const roleParts = roleHead.split(/\s+/g).map(normalizeToken).filter(Boolean);
  if (roleParts.length === 0) {
    return false;
  }

  for (let start = 0; start <= normalizedTokens.length - roleParts.length; start += 1) {
    const end = start + roleParts.length - 1;
    if (!roleParts.every((part, index) => normalizedTokens[start + index] === part)) {
      continue;
    }
    if (conceptEnd + 1 === start || end + 1 === conceptStart) {
      return true;
    }
  }

  return false;
}

function normalizeToken(value) {
  return value
    .normalize('NFKD')
    .replaceAll(/\p{M}+/gu, '')
    .replaceAll(/['’`]+/g, '')
    .toLowerCase()
    .trim();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
