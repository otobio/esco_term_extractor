import type { RowDataPacket } from 'mysql2/promise';
import { withConnection } from '../db/mysql.js';

type CountRow = RowDataPacket & {
  oseTableCount: number;
};

async function main(): Promise<void> {
  const result = await withConnection(async (connection) => {
    await connection.query('SELECT 1');

    const [rows] = await connection.query<CountRow[]>(
      `
        SELECT COUNT(*) AS oseTableCount
        FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name LIKE 'ose\\_%'
      `
    );

    return rows[0]?.oseTableCount ?? 0;
  });

  console.log(`Database connection OK. Found ${result} ose_* tables.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error('Database check failed.');
  console.error(message);
  console.error(
    'Confirm MySQL is running. By default this CLI uses 127.0.0.1:3306, database occupation_search_engine, user root/root; override with .env if needed.'
  );
  process.exitCode = 1;
});
