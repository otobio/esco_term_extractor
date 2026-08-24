import type { PreparedQuery } from '../query/query-preparation.js';
import type { OccupationTextHit } from '../retrieval/retrieval-engine.js';
export type AliasNgramAuditEntry = {
    canonicalLabel: string;
    alias: string;
    aliasRole: string;
    matchedTokens: string[];
    matchedRoleTokens: string[];
    matchedDomainTokens: string[];
    roleGrounded: boolean;
    contextOnly: boolean;
    queryCoverage: number;
    aliasCoverage: number;
    phraseDirection: string;
    score: number;
    suppressed: boolean;
    suppressionReason: string | null;
};
export type LexicalAdmissionAuditEntry = {
    canonicalLabel: string;
    matchedTokens: string[];
    matchedRoleTokens: string[];
    matchedDomainTokens: string[];
    roleGrounded: boolean;
    contextOnly: boolean;
    fields: string[];
    supportFields: string[];
};
export type RetrievalBoundaryDebugSnapshot = {
    aliasNgram: {
        retained: AliasNgramAuditEntry[];
        suppressed: AliasNgramAuditEntry[];
    };
    lexicalAdmissions: {
        contextOnly: LexicalAdmissionAuditEntry[];
    };
};
export declare class RetrievalBoundaryDebugCollector {
    private readonly enabled;
    private readonly limit;
    private readonly aliasNgramRetained;
    private readonly aliasNgramSuppressed;
    private readonly lexicalContextOnlyAdmissions;
    private readonly lexicalContextOnlyAdmissionKeys;
    constructor(enabled: boolean, limit?: number);
    collectAliasNgramRetained(preparedQuery: PreparedQuery, entry: Omit<AliasNgramAuditEntry, 'matchedRoleTokens' | 'matchedDomainTokens' | 'roleGrounded' | 'contextOnly' | 'suppressed' | 'suppressionReason'>): void;
    collectAliasNgramSuppressed(preparedQuery: PreparedQuery, entry: Omit<AliasNgramAuditEntry, 'matchedRoleTokens' | 'matchedDomainTokens' | 'roleGrounded' | 'contextOnly' | 'suppressed' | 'suppressionReason' | 'score'>): void;
    collectLexicalAdmission(preparedQuery: PreparedQuery, hit: OccupationTextHit): void;
    snapshot(): RetrievalBoundaryDebugSnapshot;
}
