import type { Connection } from 'mysql2/promise';
import type { EscoConfig } from '../../config/esco.js';
export declare class EscoSourceImporter {
    private readonly connection;
    private readonly config;
    private runId;
    constructor(connection: Connection, config: EscoConfig);
    run(): Promise<number>;
    private importFile;
    private importConceptRow;
    private importConceptSchemeRow;
    private importRelationRow;
    private insertImportRun;
    private markImportRun;
    private insertSourceFile;
    private updateSourceFileRowCount;
    private insertRawRow;
    private upsertConcept;
    private upsertStubConcept;
    private upsertAlias;
    private upsertRelation;
    private insertMembership;
}
