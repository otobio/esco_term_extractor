import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildQueryStructuralProfile } from '../preparation.js';
import { assessFamilyStructureCompatibility, shortlistFamilyStructureMatches } from './family-structure.js';

type LeafRecord = {
  graphNodeId: number;
  canonicalLabel: string;
  familyNodeId: number | null;
};

type LeafFile = {
  records: LeafRecord[];
};

type FamilyRuleRow = {
  values: Record<string, string>;
};

export type FamilyStructureCoverageAddition = {
  familyNodeId: number;
  familyLabel: string;
  field: string;
  value: string;
  evidenceCount: number;
  familyLeafCount: number;
  evidenceRatio: number;
  reason: 'coverage_threshold' | 'true_family_acceptance' | 'true_family_viability';
};

export type FamilyStructureCoverageReview = {
  additions: FamilyStructureCoverageAddition[];
  familyCount: number;
  leafCount: number;
};

const INPUT_PATH = resolve(process.cwd(), 'data/runtime-review/occupation-leaf-structure.esco_1_2_1.json');
const RULES_PATH = resolve(process.cwd(), 'src/occupation-classifier/family-structure/family-structure-rules.tsv');
const MIN_REPEATED_EVIDENCE_COUNT = 2;
const MIN_REPEATED_EVIDENCE_RATIO = 0.05;
const MIN_SINGLE_EVIDENCE_RATIO = 0.1;
const VALUE_FIELDS = [
  'role_heads',
  'venue',
  'channel',
  'product',
  'population',
  'task',
  'industry',
  'knowledge_domain',
  'work_object'
] as const;
const CONCEPT_FIELDS = VALUE_FIELDS.filter((field) => field !== 'role_heads');

export function reviewFamilyStructureCoverage(): FamilyStructureCoverageReview {
  const leafFile = JSON.parse(readFileSync(INPUT_PATH, 'utf8')) as LeafFile;
  const table = readFamilyRuleTable();
  const rowsByFamilyId = new Map(table.rows.map((row) => [Number(row.values.family_node_id), row]));
  const familyLeafCounts = new Map<number, number>();
  const evidenceCounts = new Map<string, number>();
  const requiredEvidenceKeys = new Set<string>();

  let leafCount = 0;
  for (const leaf of leafFile.records) {
    if (leaf.familyNodeId === null || leaf.graphNodeId === leaf.familyNodeId || !rowsByFamilyId.has(leaf.familyNodeId)) {
      continue;
    }

    leafCount += 1;
    familyLeafCounts.set(leaf.familyNodeId, (familyLeafCounts.get(leaf.familyNodeId) ?? 0) + 1);

    const profile = buildQueryStructuralProfile(leaf.canonicalLabel, 'en');
    for (const roleHead of new Set(profile.profile.role_head)) {
      incrementEvidence(evidenceCounts, leaf.familyNodeId, 'role_heads', roleHead);
    }
    for (const concept of profile.profile.concepts) {
      if (isConceptField(concept.dimension)) {
        incrementEvidence(evidenceCounts, leaf.familyNodeId, concept.dimension, concept.conceptId);
      }
    }

    if (assessFamilyStructureCompatibility(leaf.familyNodeId, profile).decision === 'reject') {
      const row = rowsByFamilyId.get(leaf.familyNodeId);
      if (row) {
        collectRequiredTrueFamilyEvidence(requiredEvidenceKeys, row, leaf.familyNodeId, profile);
      }
    }

    const shortlist = shortlistFamilyStructureMatches(profile);
    const trueFamilyAccepted = shortlist.accepted.some(
      (assessment) => assessment.familyNodeId === leaf.familyNodeId && assessment.decision === 'accept'
    );
    const wrongFamilyAccepted = shortlist.accepted.some(
      (assessment) => assessment.familyNodeId !== leaf.familyNodeId && assessment.decision === 'accept'
    );
    if (wrongFamilyAccepted && !trueFamilyAccepted) {
      collectRequiredTrueFamilyAcceptanceEvidence(requiredEvidenceKeys, leaf.familyNodeId, profile);
    }
  }

  const additions: FamilyStructureCoverageAddition[] = [];
  for (const row of table.rows) {
    const familyNodeId = Number(row.values.family_node_id);
    const familyLabel = row.values.family_label ?? '';
    const familyLeafCount = familyLeafCounts.get(familyNodeId) ?? 0;

    if (familyLeafCount === 0) {
      continue;
    }

    for (const field of VALUE_FIELDS) {
      const existingValues = parsePipeList(row.values[field] ?? '');
      for (const [key, evidenceCount] of evidenceCounts) {
        const evidence = parseEvidenceKey(key);
        if (!evidence || evidence.familyNodeId !== familyNodeId || evidence.field !== field || existingValues.has(evidence.value)) {
          continue;
        }

        const evidenceRatio = evidenceCount / familyLeafCount;
        const evidenceKey = formatEvidenceKey(familyNodeId, field, evidence.value);
        const required = requiredReason(requiredEvidenceKeys, evidenceKey);
        if (!required && !isStrongEnough(evidenceCount, evidenceRatio)) {
          continue;
        }

        additions.push({
          familyNodeId,
          familyLabel,
          field,
          value: evidence.value,
          evidenceCount,
          familyLeafCount,
          evidenceRatio,
          reason: required ?? 'coverage_threshold'
        });
      }
    }
  }

  additions.sort(compareAdditions);
  return { additions, familyCount: table.rows.length, leafCount };
}

export function applyFamilyStructureCoverageReview(): FamilyStructureCoverageReview {
  const review = reviewFamilyStructureCoverage();
  if (review.additions.length === 0) {
    return review;
  }

  const table = readFamilyRuleTable();
  const rowsByFamilyId = new Map(table.rows.map((row) => [Number(row.values.family_node_id), row]));

  for (const addition of review.additions) {
    const row = rowsByFamilyId.get(addition.familyNodeId);
    if (!row) {
      continue;
    }
    const values = parsePipeList(row.values[addition.field] ?? '');
    values.add(addition.value);
    row.values[addition.field] = [...values].sort().join('|');
  }

  writeFileSync(RULES_PATH, serializeFamilyRuleTable(table.header, table.rows));
  return review;
}

function readFamilyRuleTable(): { header: string[]; rows: FamilyRuleRow[] } {
  const lines = readFileSync(RULES_PATH, 'utf8').trimEnd().split('\n');
  const header = (lines[0] ?? '').split('\t');
  const rows = lines.slice(1).map((line) => {
    const columns = line.split('\t');
    const values = Object.fromEntries(header.map((name, index) => [name, columns[index] ?? '']));
    return { values };
  });
  return { header, rows };
}

function serializeFamilyRuleTable(header: string[], rows: FamilyRuleRow[]): string {
  const lines = [header.join('\t')];
  for (const row of rows) {
    lines.push(header.map((name) => row.values[name] ?? '').join('\t'));
  }
  return `${lines.join('\n')}\n`;
}

function incrementEvidence(evidenceCounts: Map<string, number>, familyNodeId: number, field: string, value: string): void {
  if (!value) {
    return;
  }
  const key = formatEvidenceKey(familyNodeId, field, value);
  evidenceCounts.set(key, (evidenceCounts.get(key) ?? 0) + 1);
}

function collectRequiredTrueFamilyEvidence(
  requiredEvidenceKeys: Set<string>,
  row: FamilyRuleRow,
  familyNodeId: number,
  profile: ReturnType<typeof buildQueryStructuralProfile>
): void {
  const existingRoleHeads = parsePipeList(row.values.role_heads ?? '');
  for (const roleHead of new Set(profile.profile.role_head)) {
    if (!existingRoleHeads.has(roleHead)) {
      requiredEvidenceKeys.add(formatRequiredEvidenceKey(familyNodeId, 'role_heads', roleHead, 'true_family_viability'));
    }
  }

  for (const field of CONCEPT_FIELDS) {
    const existingValues = parsePipeList(row.values[field] ?? '');
    if (existingValues.size === 0) {
      continue;
    }
    for (const concept of profile.profile.concepts) {
      if (concept.dimension === field && !existingValues.has(concept.conceptId)) {
        requiredEvidenceKeys.add(formatRequiredEvidenceKey(familyNodeId, field, concept.conceptId, 'true_family_viability'));
      }
    }
  }
}

function collectRequiredTrueFamilyAcceptanceEvidence(
  requiredEvidenceKeys: Set<string>,
  familyNodeId: number,
  profile: ReturnType<typeof buildQueryStructuralProfile>
): void {
  for (const roleHead of new Set(profile.profile.role_head)) {
    requiredEvidenceKeys.add(formatRequiredEvidenceKey(familyNodeId, 'role_heads', roleHead, 'true_family_acceptance'));
  }

  for (const concept of profile.profile.concepts) {
    if (isConceptField(concept.dimension)) {
      requiredEvidenceKeys.add(formatRequiredEvidenceKey(familyNodeId, concept.dimension, concept.conceptId, 'true_family_acceptance'));
    }
  }
}

function formatEvidenceKey(familyNodeId: number, field: string, value: string): string {
  return `${familyNodeId}\t${field}\t${value}`;
}

function formatRequiredEvidenceKey(
  familyNodeId: number,
  field: string,
  value: string,
  reason: FamilyStructureCoverageAddition['reason']
): string {
  return `${formatEvidenceKey(familyNodeId, field, value)}\t${reason}`;
}

function requiredReason(
  requiredEvidenceKeys: Set<string>,
  evidenceKey: string
): Extract<FamilyStructureCoverageAddition['reason'], 'true_family_acceptance' | 'true_family_viability'> | null {
  if (requiredEvidenceKeys.has(`${evidenceKey}\ttrue_family_acceptance`)) {
    return 'true_family_acceptance';
  }
  if (requiredEvidenceKeys.has(`${evidenceKey}\ttrue_family_viability`)) {
    return 'true_family_viability';
  }
  return null;
}

function parseEvidenceKey(key: string): { familyNodeId: number; field: string; value: string } | null {
  const [familyNodeIdText, field, value] = key.split('\t');
  const familyNodeId = Number(familyNodeIdText);
  if (!Number.isFinite(familyNodeId) || !field || !value) {
    return null;
  }
  return { familyNodeId, field, value };
}

function parsePipeList(value: string): Set<string> {
  return new Set(value.split('|').map((part) => part.trim()).filter(Boolean));
}

function isStrongEnough(evidenceCount: number, evidenceRatio: number): boolean {
  return (
    (evidenceCount >= MIN_REPEATED_EVIDENCE_COUNT && evidenceRatio >= MIN_REPEATED_EVIDENCE_RATIO) ||
    evidenceRatio >= MIN_SINGLE_EVIDENCE_RATIO
  );
}

function isConceptField(value: string): value is (typeof CONCEPT_FIELDS)[number] {
  return CONCEPT_FIELDS.includes(value as (typeof CONCEPT_FIELDS)[number]);
}

function compareAdditions(left: FamilyStructureCoverageAddition, right: FamilyStructureCoverageAddition): number {
  return (
    left.familyNodeId - right.familyNodeId ||
    left.field.localeCompare(right.field) ||
    left.value.localeCompare(right.value) ||
    left.reason.localeCompare(right.reason)
  );
}

function isCli(): boolean {
  return process.argv[1]?.endsWith('review-family-structure-coverage.ts') === true;
}

if (isCli()) {
  const apply = process.argv.includes('--apply');
  const review = apply ? applyFamilyStructureCoverageReview() : reviewFamilyStructureCoverage();
  const verb = apply ? 'Applied' : 'Found';
  console.log(`${verb} ${review.additions.length} family-structure coverage additions across ${review.familyCount} families and ${review.leafCount} leaves.`);
  for (const addition of review.additions) {
    console.log(
      [
        addition.familyNodeId,
        addition.familyLabel,
        addition.field,
        addition.value,
        `${addition.evidenceCount}/${addition.familyLeafCount}`,
        addition.evidenceRatio.toFixed(3),
        addition.reason
      ].join('\t')
    );
  }
}
