import { buildQueryStructuralProfile } from '../occupation-classifier/preparation.js';
import { compareFamilyStructureToQuery } from '../occupation-classifier/family-structure/family-structure-debug.js';
import { getFamilyStructureRules, prepareFamilyStructureQuery } from '../occupation-classifier/family-structure/family-structure.js';
import { DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
function main() {
    const options = parseCliOptions(process.argv.slice(2));
    if (!options.query?.trim()) {
        throw new Error('Provide --query="...".');
    }
    const queryProfile = buildQueryStructuralProfile(options.query, options.locale);
    const preparedQuery = prepareFamilyStructureQuery(queryProfile);
    console.log(`query="${options.query}" locale=${options.locale}`);
    console.log(`role_heads=${formatList(preparedQuery.roleHeads)}`);
    console.log(`authority=${preparedQuery.authority}`);
    console.log('concepts:');
    for (const [dimension, conceptIds] of preparedQuery.conceptIdsByDimension) {
        if (conceptIds.length > 0) {
            console.log(`- ${dimension}: ${formatList(conceptIds)}`);
        }
    }
    const rules = getFamilyStructureRules().filter((rule) => options.familyNodeId === undefined || rule.familyNodeId === options.familyNodeId);
    console.log(`\nfamilies (${rules.length}):`);
    for (const rule of rules) {
        const comparison = compareFamilyStructureToQuery(rule, queryProfile);
        if (options.decisionFilter && comparison.decision !== options.decisionFilter) {
            continue;
        }
        console.log(`- [${comparison.decision}] ${rule.familyLabel} (node=${rule.familyNodeId})`);
        console.log(`    roleHeadMatched=${comparison.roleHeadMatched} matched=${formatList(comparison.matchedRoleHeads)}`);
        console.log(`    authorityContradicted=${comparison.authorityContradicted} matchedAuthorityLevels=${formatList(comparison.matchedAuthorityLevels)}`);
        if (comparison.matchedConcepts.length > 0) {
            const matched = comparison.matchedConcepts.map((match) => `${match.dimension}:${formatList(match.values)}`).join(', ');
            console.log(`    matchedConcepts=${matched}`);
        }
        if (comparison.contradictedDimensions.length > 0) {
            console.log(`    contradictedDimensions=${formatList(comparison.contradictedDimensions)}`);
        }
        if (comparison.bridgeIds.length > 0) {
            console.log(`    bridgeIds=${formatList(comparison.bridgeIds)}`);
        }
        if (comparison.reasons.length > 0) {
            console.log(`    reasons=${comparison.reasons.join(' | ')}`);
        }
    }
}
function formatList(values) {
    return values.length > 0 ? values.join(',') : 'none';
}
function parseCliOptions(args) {
    const options = {
        locale: DEFAULT_RETRIEVAL_LOCALE
    };
    for (const arg of args) {
        if (arg.startsWith('--query=')) {
            options.query = arg.slice('--query='.length).trim();
            continue;
        }
        if (arg.startsWith('--locale=')) {
            options.locale = parseLocale(arg.slice('--locale='.length));
            continue;
        }
        if (arg.startsWith('--family=')) {
            const familyNodeId = Number.parseInt(arg.slice('--family='.length), 10);
            if (!Number.isInteger(familyNodeId)) {
                throw new Error(`Invalid --family value "${arg}".`);
            }
            options.familyNodeId = familyNodeId;
            continue;
        }
        if (arg.startsWith('--decision=')) {
            options.decisionFilter = arg.slice('--decision='.length).trim();
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
function parseLocale(value) {
    const normalized = value.trim();
    if (normalized === 'en' || normalized === 'ro' || normalized === 'hu' || normalized === 'et' || normalized === 'unknown') {
        return normalized;
    }
    throw new Error(`Unsupported locale "${value}".`);
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/inspect-family-structure-query.js --query="lottery manager"',
        `  [--locale=${DEFAULT_RETRIEVAL_LOCALE}]`,
        '  [--family=14711]',
        '  [--decision=accept|partial|reject|unknown]'
    ].join(' '));
}
main();
