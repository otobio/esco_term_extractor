import type { PreparedQuery } from '../query/query-preparation.js';
import type { PipelineFamilyCandidate, PipelineLeafCandidate, RankedPipelineFamily, RecoveredFamilySelectionAuthority } from './rank-family-core.js';
export type FamilyRankingScore = {
    retrieval: number;
    semantic: number;
    recovery: number;
    prior: number;
    corroboration: number;
    contradiction: number;
    structuralSupport: number;
    structuralContradiction: number;
    structuralRejected: boolean;
    roleGrounded: number;
    total: number;
    floor: number;
};
export declare function exactRoleMatchThreshold(preparedQuery: PreparedQuery): number;
export declare function rankFamilyCandidatesForRecovery(preparedQuery: PreparedQuery, sourceName: string, topFamilyLimit: number, candidateFamilies: readonly PipelineFamilyCandidate[], candidateLeavesByFamilyKey: ReadonlyMap<string, readonly PipelineLeafCandidate[]>, jobFunction?: string | null): RankedPipelineFamily[];
export declare function rankFamilyCandidatesForSelection(preparedQuery: PreparedQuery, families: readonly RankedPipelineFamily[], recoverAuthority: (family: RankedPipelineFamily, preparedQuery: PreparedQuery) => RecoveredFamilySelectionAuthority): RankedPipelineFamily[];
