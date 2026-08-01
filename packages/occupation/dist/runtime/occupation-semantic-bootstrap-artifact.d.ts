import type { OccupationSemanticBootstrapThresholds } from '../query/occupation-semantic-bootstrap.js';
export type OccupationSemanticBootstrapKind = 'role_head' | 'domain_modifier' | 'generic_noise' | 'role_phrase' | 'generic_phrase';
export type OccupationSemanticBootstrapTokenRule = {
    token: string;
    kind: OccupationSemanticBootstrapKind;
    occupationSignal: number;
    penaltySignal: number;
    note: string;
};
export type OccupationSemanticBootstrapPhraseRule = {
    phrase: string;
    kind: OccupationSemanticBootstrapKind;
    occupationSignal: number;
    penaltySignal: number;
    note: string;
};
export type OccupationSemanticBootstrapArtifact = {
    schemaVersion: 1;
    locale: string;
    headRule: string;
    thresholds: OccupationSemanticBootstrapThresholds;
    tokenRules: OccupationSemanticBootstrapTokenRule[];
    phraseRules: OccupationSemanticBootstrapPhraseRule[];
};
export type OccupationSemanticBootstrapArtifactCacheEntry = {
    manifestPath: string;
    artifact: OccupationSemanticBootstrapArtifact;
};
export declare function defaultOccupationSemanticBootstrapManifestPath(locale: string): string;
export declare function loadOccupationSemanticBootstrapArtifactIfAvailable(locale: string): Promise<OccupationSemanticBootstrapArtifactCacheEntry | null>;
export declare function loadOccupationSemanticBootstrapArtifactRequired(locale: string): Promise<OccupationSemanticBootstrapArtifactCacheEntry>;
