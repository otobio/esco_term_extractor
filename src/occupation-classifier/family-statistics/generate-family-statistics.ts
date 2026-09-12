import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildQueryStructuralProfile } from '../preparation.js';
import { getFamilyStructureRules } from '../family-structure/family-structure.js';

type LeafRecord = {
  graphNodeId: number;
  canonicalLabel: string;
  familyNodeId: number | null;
};

type LeafFile = {
  sourceName: string;
  count: number;
  records: LeafRecord[];
};

const ALPHA = 0.25;
const MIN_LIFT_TO_STORE = 0.05;
const INPUT_PATH = resolve(process.cwd(), 'data/runtime-review/occupation-leaf-structure.esco_1_2_1.json');
const OUTPUT_PATH = resolve(process.cwd(), 'src/occupation-classifier/family-statistics/family-statistics.json');

const leafFile = JSON.parse(readFileSync(INPUT_PATH, 'utf8')) as LeafFile;
const knownFamilyIds = new Set(getFamilyStructureRules().map((rule) => rule.familyNodeId));
const familyLeafCounts = new Map<number, number>();
const featureCounts = new Map<string, number>();
const featureFamilyCounts = new Map<string, Map<number, number>>();

let totalLeaves = 0;

for (const leaf of leafFile.records) {
  if (leaf.familyNodeId === null || leaf.graphNodeId === leaf.familyNodeId || !knownFamilyIds.has(leaf.familyNodeId)) {
    continue;
  }

  totalLeaves += 1;
  familyLeafCounts.set(leaf.familyNodeId, (familyLeafCounts.get(leaf.familyNodeId) ?? 0) + 1);

  const profile = buildQueryStructuralProfile(leaf.canonicalLabel, 'en');
  const features = featuresForProfile(profile);

  for (const feature of features) {
    featureCounts.set(feature, (featureCounts.get(feature) ?? 0) + 1);
    const countsByFamily = featureFamilyCounts.get(feature) ?? new Map<number, number>();
    countsByFamily.set(leaf.familyNodeId, (countsByFamily.get(leaf.familyNodeId) ?? 0) + 1);
    featureFamilyCounts.set(feature, countsByFamily);
  }
}

const familyCount = knownFamilyIds.size;
const features: Record<string, Record<string, number>> = {};

for (const [feature, totalFeatureCount] of [...featureCounts.entries()].sort(([left], [right]) => left.localeCompare(right))) {
  const liftByFamily: Record<string, number> = {};
  for (const familyNodeId of [...knownFamilyIds].sort((left, right) => left - right)) {
    const familyLeafCount = familyLeafCounts.get(familyNodeId) ?? 0;
    const prior = familyLeafCount / totalLeaves;
    const familyFeatureCount = featureFamilyCounts.get(feature)?.get(familyNodeId) ?? 0;
    const conditional = (familyFeatureCount + ALPHA) / (totalFeatureCount + ALPHA * familyCount);
    const lift = Math.log(conditional / prior);

    if (familyFeatureCount > 0 && lift >= MIN_LIFT_TO_STORE) {
      liftByFamily[String(familyNodeId)] = round(lift);
    }
  }

  if (Object.keys(liftByFamily).length > 0) {
    features[feature] = liftByFamily;
  }
}

const artifact = {
  generatedFrom: INPUT_PATH,
  sourceName: leafFile.sourceName,
  totalLeaves,
  familyCount,
  alpha: ALPHA,
  familyLeafCounts: sortRecord(Object.fromEntries([...familyLeafCounts.entries()].map(([id, count]) => [String(id), count]))),
  features
};

writeFileSync(OUTPUT_PATH, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(`Wrote family statistics for ${totalLeaves} leaves to ${OUTPUT_PATH}`);

function featuresForProfile(profile: ReturnType<typeof buildQueryStructuralProfile>): string[] {
  const features = new Set<string>();
  const roleHeads = [...new Set(profile.profile.role_head)].sort();
  const concepts = profile.profile.concepts
    .map((concept) => ({ dimension: concept.dimension, conceptId: concept.conceptId }))
    .sort((left, right) => `${left.dimension}:${left.conceptId}`.localeCompare(`${right.dimension}:${right.conceptId}`));

  for (const roleHead of roleHeads) {
    features.add(`role:${roleHead}`);
  }

  for (const concept of concepts) {
    features.add(`concept:${concept.dimension}:${concept.conceptId}`);
  }

  for (const roleHead of roleHeads) {
    for (const concept of concepts) {
      features.add(`pair:${roleHead}|${concept.dimension}:${concept.conceptId}`);
    }
  }

  return [...features];
}

function sortRecord(record: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => Number(left) - Number(right)));
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
