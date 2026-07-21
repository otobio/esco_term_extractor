export type EscoPackLocation = {
    type: 'directory';
    path: string;
} | {
    type: 'zip';
    path: string;
};
export type EscoFileContents = {
    sourcePath: string;
    checksumSha256: string;
    content: string;
};
export declare function locateEscoPack(downloadsDir: string, version: string, locale: string): Promise<EscoPackLocation>;
export declare function listEscoCsvFiles(pack: EscoPackLocation): Promise<string[]>;
export declare function readEscoFile(pack: EscoPackLocation, fileName: string): Promise<EscoFileContents>;
