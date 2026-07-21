export declare function readOptionalEnv(key: string): string | undefined;
export declare function readOptionalPort(value: string | undefined, fallback: number): number;
export type DbConfig = {
    host: string;
    port: number;
    database: string;
    username: string;
    password: string;
};
export declare function getDbConfig(): DbConfig;
