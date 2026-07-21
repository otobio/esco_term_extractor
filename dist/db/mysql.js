import mysql from 'mysql2/promise';
import { getDbConfig } from '../config/env.js';
export function buildConnectionOptions(overrides = {}) {
    const config = getDbConfig();
    return {
        host: config.host,
        port: config.port,
        user: config.username,
        password: config.password,
        database: config.database,
        multipleStatements: true,
        charset: 'utf8mb4',
        ...overrides
    };
}
export async function createConnection(overrides = {}) {
    return mysql.createConnection(buildConnectionOptions(overrides));
}
export async function withConnection(work) {
    const connection = await createConnection();
    try {
        return await work(connection);
    }
    finally {
        await connection.end();
    }
}
