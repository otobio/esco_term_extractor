import { OccupationLeafStructureArtifactManifest, OccupationLeafStructureRecord } from './occupation-leaf-structure-contract.js';
import { type BinaryStringTable, type FileBackedUint32Rows, type FixedTable } from '../utils/binary-table.js';
export type OccupationLeafStructureArtifact = {
    manifestPath: string;
    artifactPath: string;
    manifest: OccupationLeafStructureArtifactManifest;
    strings: BinaryStringTable;
    recordRows: FixedTable;
    familyPostings: FixedTable;
    familyPostingRows: Uint32Array | FileBackedUint32Rows;
    getRecord(graphNodeId: number): OccupationLeafStructureRecord | null;
    getRecordsForFamily(familyNodeId: number): OccupationLeafStructureRecord[];
    getAllRecords(): OccupationLeafStructureRecord[];
};
export declare function defaultOccupationLeafStructureManifestPath(sourceName: string): string;
export declare function loadOccupationLeafStructureArtifactIfAvailable(sourceName: string): Promise<OccupationLeafStructureArtifact | null>;
export declare function loadOccupationLeafStructureArtifactRequired(sourceName: string): Promise<OccupationLeafStructureArtifact>;
export declare function buildOccupationLeafStructureBinaryFiles(records: OccupationLeafStructureRecord[], prefix: string): {
    manifestFiles: OccupationLeafStructureArtifactManifest['files'];
    buffers: Map<string, Buffer>;
    stringCount: number;
    familyPostingKeyCount: number;
    familyPostingCount: number;
};
