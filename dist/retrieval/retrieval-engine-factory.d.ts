import type { OccupationRetrievalEngine } from './retrieval-engine.js';
export type RetrievalBackendKind = 'opensearch' | 'runtime-cache' | 'binary-cache';
export declare function createRetrievalEngine(kind?: RetrievalBackendKind): OccupationRetrievalEngine;
export declare function configuredRetrievalBackend(): RetrievalBackendKind;
export declare function parseRetrievalBackend(value: string): RetrievalBackendKind;
