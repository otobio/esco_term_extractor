import { withConnection } from '../db/mysql.js';
import { readSqlFile } from '../utils/read-sql-file.js';
async function main() {
    const schemaSql = await readSqlFile('sql/schema.sql');
    await withConnection(async (connection) => {
        await connection.query(schemaSql);
    });
    console.log('Schema applied successfully from sql/schema.sql');
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Failed to apply schema: ${message}`);
    process.exitCode = 1;
});
