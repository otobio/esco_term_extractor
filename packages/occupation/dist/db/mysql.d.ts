import { type Connection, type ConnectionOptions } from 'mysql2/promise';
export declare function buildConnectionOptions(overrides?: Partial<ConnectionOptions>): ConnectionOptions;
export declare function createConnection(overrides?: Partial<ConnectionOptions>): Promise<Connection>;
export declare function withConnection<T>(work: (connection: Connection) => Promise<T>): Promise<T>;
