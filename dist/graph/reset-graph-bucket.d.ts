import type { Connection } from 'mysql2/promise';
export declare function resetGraphBucket(connection: Connection, bucket: string): Promise<void>;
