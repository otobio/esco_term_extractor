import { withConnection } from '../db/mysql.js';
import { defaultEvaluationSetKey, EvaluationSetSeeder } from '../evaluation/seed-evaluation-set.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const result = await withConnection(async (connection) => {
        const seeder = new EvaluationSetSeeder(connection);
        return seeder.run({
            sourceName: options.sourceName,
            setKey: options.setKey,
            resetSet: options.resetSet
        });
    });
    const resetSummary = result.resetSet
        ? `reset deleted ${result.resetDeletedQueryCount} owned queries and ${result.resetDeletedExpectationCount} matching expectations`
        : 'no reset';
    console.log(`Evaluation seed set "${result.setKey}" completed for source "${result.sourceName}" (${resetSummary}).`);
    console.log(`Queries: ${result.queryCount} fixture rows, ${result.insertedQueryCount} inserted, ${result.reusedQueryCount} reused.`);
    console.log(`Expectations: ${result.expectationCount} fixture rows, ${result.insertedExpectationCount} inserted, ${result.reusedExpectationCount} reused.`);
}
function parseCliOptions(args) {
    const options = {};
    for (const arg of args) {
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
            continue;
        }
        if (arg.startsWith('--set-key=')) {
            options.setKey = arg.slice('--set-key='.length).trim();
            continue;
        }
        if (arg === '--reset-set') {
            options.resetSet = true;
            continue;
        }
        if (arg === '--help') {
            printHelp();
            process.exit(0);
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    return options;
}
function printHelp() {
    console.log(`Usage: node dist/cli/seed-evaluation-set.js [--source-name=esco_1_2_1] [--set-key=${defaultEvaluationSetKey()}] [--reset-set]`);
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Evaluation seed set failed.');
    console.error(message);
    process.exitCode = 1;
});
