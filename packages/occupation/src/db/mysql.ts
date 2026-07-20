import mysql, { type Connection, type ConnectionOptions } from 'mysql2/promise';
import { getDbConfig } from '../config/env.js';

export function buildConnectionOptions(overrides: Partial<ConnectionOptions> = {}): ConnectionOptions {
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

export async function createConnection(overrides: Partial<ConnectionOptions> = {}): Promise<Connection> {
  return mysql.createConnection(buildConnectionOptions(overrides));
}

export async function withConnection<T>(work: (connection: Connection) => Promise<T>): Promise<T> {
  const connection = await createConnection();

  try {
    return await work(connection);
  } finally {
    await connection.end();
  }
}
