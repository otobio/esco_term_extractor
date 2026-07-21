import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Connection, ResultSetHeader } from 'mysql2/promise';
import {
  DEFAULT_ONET_REPORT_DIR,
  ONET_ALIAS_SOURCE_TAG,
  type OnetAliasCandidate
} from './import-onet-esco-alias-candidates.js';

export const DEFAULT_ONET_ALIAS_REPORT_PATH = path.resolve(process.cwd(), DEFAULT_ONET_REPORT_DIR, 'onet-esco-alias-candidates-report.json');

export type PromoteOnetEscoAliasCandidatesOptions = {
  reportPath?: string;
  minConfidence?: number;
  limit?: number;
  dryRun?: boolean;
};

export type PromoteOnetEscoAliasCandidatesResult = {
  reportPath: string;
  minConfidence: number;
  dryRun: boolean;
  eligible: number;
  inserted: number;
  skipped: number;
};

type CandidateReport = {
  candidates: OnetAliasCandidate[];
};

export async function promoteOnetEscoAliasCandidates(
  connection: Connection,
  options: PromoteOnetEscoAliasCandidatesOptions = {}
): Promise<PromoteOnetEscoAliasCandidatesResult> {
  const reportPath = options.reportPath?.trim() || DEFAULT_ONET_ALIAS_REPORT_PATH;
  const minConfidence = options.minConfidence ?? 0.9;
  const dryRun = options.dryRun ?? false;
  const report = await readCandidateReport(reportPath);
  const eligibleCandidates = report.candidates
    .filter((candidate) => isEligibleForPromotion(candidate, minConfidence))
    .slice(0, options.limit ?? Number.POSITIVE_INFINITY);

  if (dryRun || eligibleCandidates.length === 0) {
    return {
      reportPath,
      minConfidence,
      dryRun,
      eligible: eligibleCandidates.length,
      inserted: 0,
      skipped: 0
    };
  }

  let inserted = 0;

  await connection.beginTransaction();

  try {
    for (const candidate of eligibleCandidates) {
      const [result] = await connection.execute<ResultSetHeader>(
        `
          INSERT IGNORE INTO ose_graph_aliases (
            graph_node_id,
            locale_code,
            alias,
            normalized_alias,
            alias_type,
            alias_class,
            source_name,
            source_record_type,
            confidence,
            is_primary,
            is_active,
            is_generic_head_only,
            needs_review,
            review_note
          )
          VALUES (?, 'en', ?, ?, 'external_title', 'crosswalk', ?, ?, ?, 0, 1, 0, 0, NULL)
        `,
        [
          candidate.graphNodeId,
          candidate.alias,
          candidate.normalizedAlias,
          ONET_ALIAS_SOURCE_TAG,
          candidate.sourceFileRole,
          candidate.confidence
        ]
      );

      inserted += result.affectedRows;
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  }

  return {
    reportPath,
    minConfidence,
    dryRun,
    eligible: eligibleCandidates.length,
    inserted,
    skipped: eligibleCandidates.length - inserted
  };
}

async function readCandidateReport(reportPath: string): Promise<CandidateReport> {
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as Partial<CandidateReport>;

  if (!Array.isArray(report.candidates)) {
    throw new Error(`Candidate report does not contain a candidates array: ${reportPath}`);
  }

  return {
    candidates: report.candidates
  };
}

function isEligibleForPromotion(candidate: OnetAliasCandidate, minConfidence: number): boolean {
  return (
    candidate.candidateMode === 'generate' &&
    candidate.graphNodeId !== null &&
    candidate.confidence >= minConfidence &&
    candidate.conflictTargets.length === 0 &&
    candidate.crosswalkTargetCount === 1 &&
    candidate.reviewReason === null
  );
}
