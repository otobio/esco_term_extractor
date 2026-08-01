import { type OccupationSemanticBootstrapContribution } from './occupation-semantic-bootstrap.js';
export type OccupationSemanticLexiconMatchKind = 'token' | 'phrase';
export type OccupationSemanticLexiconRuleKind = 'role_head' | 'domain_modifier' | 'role_phrase' | 'generic_noise' | 'generic_phrase';
export type OccupationSemanticLexiconDecision = OccupationSemanticBootstrapContribution;
export type OccupationSemanticLexiconMatch = {
    matched: boolean;
    kind: OccupationSemanticLexiconMatchKind;
    surface: string;
    normalizedSurface: string;
    decision: OccupationSemanticLexiconDecision;
    occupationSignal: number;
    penaltySignal: number;
    netSignal: number;
    rule: {
        kind: OccupationSemanticLexiconRuleKind;
        token?: string;
        phrase?: string;
        note: string;
    } | null;
};
export type OccupationSemanticLexiconDebug = {
    tokenMatches: OccupationSemanticLexiconMatch[];
    phraseMatches: OccupationSemanticLexiconMatch[];
    retainedTokens: string[];
    droppedTokens: string[];
};
export type OccupationSemanticLexiconAnalysis = {
    locale: string;
    supportedLocale: boolean;
    surface: string;
    normalizedSurface: string;
    cleanedSurface: string;
    signalTokens: string[];
    helpTokens: string[];
    hurtTokens: string[];
    tokenCount: number;
    helpCount: number;
    hurtCount: number;
    neutralCount: number;
    occupationSignal: number;
    penaltySignal: number;
    netSignal: number;
    decision: OccupationSemanticLexiconDecision;
    debug?: OccupationSemanticLexiconDebug;
};
export type OccupationSemanticLexiconComparison = {
    locale: string;
    supportedLocale: boolean;
    leftSurface: string;
    rightSurface: string;
    left: OccupationSemanticLexiconAnalysis;
    right: OccupationSemanticLexiconAnalysis;
    sharedTokens: string[];
    score: number;
    decision: OccupationSemanticLexiconDecision;
    debug?: {
        leftOnlyTokens: string[];
        rightOnlyTokens: string[];
        sharedPhrases: string[];
    };
};
export type OccupationSemanticLexiconOptions = {
    includeAuxiliaryRules?: boolean;
    debug?: boolean;
};
export declare function analyzeOccupationSemanticSurface(surface: string, locale: string, options?: OccupationSemanticLexiconOptions): Promise<OccupationSemanticLexiconAnalysis>;
export declare function compareOccupationSemanticSurfaceAnalyses(left: OccupationSemanticLexiconAnalysis, right: OccupationSemanticLexiconAnalysis, options?: OccupationSemanticLexiconOptions): OccupationSemanticLexiconComparison;
export declare function compareOccupationSemanticSurfaces(leftSurface: string, rightSurface: string, locale: string, options?: OccupationSemanticLexiconOptions): Promise<OccupationSemanticLexiconComparison>;
export declare function cleanOccupationSemanticSurface(surface: string, locale: string, options?: OccupationSemanticLexiconOptions): Promise<string>;
