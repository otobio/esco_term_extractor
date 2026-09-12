import { classifySpecializationQuery } from '../occupation-classifier/specialization/specialization-dimension-mapper.js';
import { explainSpecializationClassification } from '../occupation-classifier/specialization/specialization-explain.js';
import { specializationGate } from '../occupation-classifier/specialization/specialization-gate.js';
import { DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
function main() {
    const options = parseCliOptions(process.argv.slice(2));
    if (!options.query?.trim()) {
        throw new Error('Provide --query="...".');
    }
    const result = classifySpecializationQuery(options.query, { locale: options.locale });
    const leaf = options.leaf ? classifySpecializationQuery(options.leaf, { locale: options.locale }) : result;
    const gate = specializationGate(result, leaf, { locale: options.locale });
    if (options.format === 'json') {
        console.log(JSON.stringify({ ...result, queryWeights: gate.queryWeights }, null, 2));
        return;
    }
    console.log(`query="${options.query}" locale=${options.locale}`);
    console.log(`tokens=${formatList(result.tokens)}`);
    console.log(`role_head=${formatList(result.role_head)}`);
    console.log(`roleModes=${formatList(result.roleModes)}`);
    const explain = explainSpecializationClassification(result);
    console.log('\nconcepts:');
    for (const concept of result.concepts) {
        console.log(`- ${concept.dimension}: ${concept.conceptId} (matched "${concept.canonicalTokens.join(' ')}")`);
    }
    if (gate.queryWeights.concepts.length > 0) {
        console.log('\nquery weights:');
        for (const weight of gate.queryWeights.concepts) {
            console.log(`- ${weight.dimension}: ${weight.conceptId} weight=${weight.weight} values=${formatList(weight.values)}`);
        }
    }
    if (explain.structuralCombinations.length > 0) {
        console.log('\nstructural combinations:');
        for (const combination of explain.structuralCombinations) {
            const concepts = combination.concepts.map((concept) => `concept.${concept.dimension}=${concept.conceptId}`).join(' ');
            console.log(`- ${combination.id}: ${concepts} roleHeads=${formatList(combination.roleHeads)} derivedRoleHeads=${formatList(combination.derivedRoleHeads)}`);
        }
    }
    console.log('\ndimensions (literal / concept / available):');
    for (const dimension of Object.keys(result.literal)) {
        const literal = result[dimension];
        const concept = result.concept[dimension];
        const available = result.available[dimension];
        if (literal.length === 0 && concept.length === 0 && available.length === 0) {
            continue;
        }
        const conceptIds = result.concepts.filter((match) => match.dimension === dimension).map((match) => match.conceptId);
        console.log(`- ${dimension}: concept_id=${formatList(conceptIds)} literal=${formatList(literal)} concept=${formatList(concept)} available=${formatList(available)}`);
    }
    if (result.unresolved.length > 0) {
        console.log(`\nunresolved=${formatList(result.unresolved)}`);
    }
    console.log("Contradiction Decision: " + gate.decision);
}
function formatList(values) {
    return values.length > 0 ? values.join(',') : 'none';
}
function parseCliOptions(args) {
    const options = {
        locale: DEFAULT_RETRIEVAL_LOCALE,
        format: 'text'
    };
    for (const arg of args) {
        if (arg.startsWith('--query=')) {
            options.query = arg.slice('--query='.length).trim();
            continue;
        }
        if (arg.startsWith('--leaf=')) {
            options.leaf = arg.slice('--leaf='.length).trim();
            continue;
        }
        if (arg.startsWith('--locale=')) {
            options.locale = parseLocale(arg.slice('--locale='.length));
            continue;
        }
        if (arg.startsWith('--format=')) {
            options.format = parseFormat(arg.slice('--format='.length));
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
function parseFormat(value) {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'text' || normalized === 'json') {
        return normalized;
    }
    throw new Error(`Unsupported format "${value}". Use --format=text or --format=json.`);
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/inspect-family-structure-query.js --query="lottery manager"',
        `  [--locale=${DEFAULT_RETRIEVAL_LOCALE}]`,
        '  [--format=text|json]'
    ].join(' '));
}
main();
