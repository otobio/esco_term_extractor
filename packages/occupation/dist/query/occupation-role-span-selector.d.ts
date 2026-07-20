export type OccupationRoleSpanCandidate = {
    text: string;
    foldedText: string;
    startToken: number;
    endToken: number;
    tokenCount: number;
    knownTokenCount: number;
    tokenCoverage: number;
    longestPhraseLength: number;
    exactPhraseKnown: boolean;
    maxAnchorCount: number;
    codeTokenCount: number;
    genericTokenCount: number;
    score: number;
    evidence: string[];
};
export type OccupationRoleSpanSelection = {
    originalQuery: string;
    cleanedQuery: string;
    roleQuery: string;
    contextQuery: string;
    selectedSpan: OccupationRoleSpanCandidate | null;
    candidates: OccupationRoleSpanCandidate[];
};
export type SelectOccupationRoleSpanOptions = {
    sourceName: string;
    locale: string;
    originalQuery: string;
    querySpans: string[];
};
export declare function selectOccupationRoleSpan(options: SelectOccupationRoleSpanOptions): Promise<OccupationRoleSpanSelection>;
