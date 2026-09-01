import { DEFAULT_ESCO_SOURCE_NAME, DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import { cleanOccupationQuerySurface } from '../query/occupation-query-cleaning.js';
import { prepareQuery } from '../query/query-preparation.js';
import { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
import { foldSearchText, tokenizeNormalizedText } from '../utils/texts.js';
import { cliRankFamilyLeaves, resolveFamily, formatScoreBreakdown, formatPercent } from './rank-family-leaves-core.js';
import { resolveLeafSpecializationKindsFromTokens } from '../runtime/occupation-leaf-structure-rules.js';
import { debugComputeSpecialization } from './rank-family-leaves-core.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const runtime = await OccupationRuntimeContext.load({
        sourceName: options.sourceName,
        leafStructureRuntime: true
    });
    const families = options.families.map((familyInput) => resolveFamily(runtime.searchMetaArtifact, familyInput));
    const cleanedQuery = await cleanOccupationQuerySurface(options.query, options.locale);
    const effectiveQuery = cleanedQuery || options.query;
    const preparedQuery = await prepareQuery(effectiveQuery, options.locale, { sourceName: options.sourceName });
    const leaves = runtime.searchMetaArtifact.getLeafCoreRecordsForFamilies(families.map((family) => family.familyNodeId));
    for (const leaf of leaves) {
        console.log(`${leaf.canonicalLabel}  (${leaf.familyLabel ?? 'unknown family'})`);
    }
    const rankedLeaves = cliRankFamilyLeaves(runtime.searchMetaArtifact, runtime.leafStructureArtifact, leaves, preparedQuery, effectiveQuery, options.locale);
    const familyLabelByNodeId = new Map(leaves.map((leaf) => [leaf.graphNodeId, leaf.familyLabel ?? 'unknown family']));
    console.log(formatResult(options, families, effectiveQuery, preparedQuery, rankedLeaves.slice(0, options.limit), familyLabelByNodeId, runtime.searchMetaArtifact));
}
function formatResult(options, families, effectiveQuery, preparedQuery, leaves, familyLabelByNodeId, artifact) {
    const lines = [];
    const selectedLeaf = leaves[0] ?? null;
    lines.push(`Family leaf ranking: "${options.query}"`);
    lines.push(`families=${families.map((family) => `"${family.familyLabel}" #${family.familyNodeId}`).join(' | ')}  locale=${options.locale}  source=${options.sourceName}`);
    lines.push(`effective_query="${effectiveQuery}"`);
    lines.push(`query_tokens=${preparedQuery.foldedTokens.join(',') || 'none'}`);
    lines.push(`role_tokens=${preparedQuery.intent.roleTokens.join(',') || 'none'}`);
    lines.push(`role_modifier_tokens=${preparedQuery.intent.roleModifierTokens.join(',') || 'none'}`);
    lines.push(`domain_tokens=${preparedQuery.intent.domainTokens.join(',') || 'none'}`);
    lines.push(`role_head_tokens=${preparedQuery.intent.roleHeadTokens.join(',') || 'none'}`);
    lines.push(`role_head_requires_context=${preparedQuery.intent.roleHeadRequiresContext || 'none'}`);
    lines.push(`generic_role_head_tokens=${preparedQuery.intent.genericRoleHeadTokens.join(',') || 'none'}`);
    lines.push(`authoritative_role_tokens=${preparedQuery.intent.authoritativeRoleHeadTokens.join(',') || 'none'}`);
    lines.push(`alt_role_head_tokens=${preparedQuery.intent.altRoleHeadTokens.join(',') || 'none'}`);
    lines.push(`alt_role_modifier_tokens=${preparedQuery.intent.altRoleModifierTokens.join(',') || 'none'}`);
    lines.push(`confidence=${preparedQuery.intent.confidence || 'none'}`);
    lines.push(`credential_tokens=${preparedQuery.intent.credentialTokens.join(',') || 'none'}`);
    lines.push(`venue_tokens=${preparedQuery.intent.venueTokens.join(',') || 'none'}`);
    if (!selectedLeaf) {
        lines.push('selected_leaf=none');
        return lines.join('\n');
    }
    lines.push('');
    lines.push(`Selected leaf`);
    lines.push(`${selectedLeaf.rank}. "${selectedLeaf.canonicalLabel}" #${selectedLeaf.graphNodeId}  family="${familyLabelByNodeId.get(selectedLeaf.graphNodeId) ?? 'unknown family'}"  score=${selectedLeaf.totalScore}  closeness=${formatPercent(selectedLeaf.closeness.usefulQueryCoverage)}`);
    lines.push('');
    lines.push('Ranked leaves');
    const specializationKindsCache = new Map();
    for (const leaf of leaves) {
        lines.push(formatLeaf(leaf, familyLabelByNodeId, preparedQuery, artifact, specializationKindsCache));
    }
    return lines.join('\n');
}
function formatLeaf(leaf, familyLabelByNodeId, preparedQuery, artifact, specializationKindsCache) {
    const canonicalTokens = new Set(tokenizeNormalizedText(foldSearchText(leaf.canonicalLabel)));
    const derivedSpecializationKinds = resolveLeafSpecializationKindsFromTokens(new Map(), leaf.graphNodeId, leaf.structure, canonicalTokens);
    const familyLabel = familyLabelByNodeId.get(leaf.graphNodeId) ?? '';
    const familyTokens = new Set(tokenizeNormalizedText(foldSearchText(familyLabel)));
    const capabilityLabels = artifact.getCapabilityLabels(leaf.graphNodeId);
    const debug = debugComputeSpecialization(leaf.closeness, leaf.structure, preparedQuery, canonicalTokens, familyTokens, capabilityLabels, leaf.graphNodeId, specializationKindsCache);
    return [
        `${leaf.rank}. "${leaf.canonicalLabel}" #${leaf.graphNodeId}`,
        `family="${familyLabelByNodeId.get(leaf.graphNodeId) ?? 'unknown family'}"`,
        `score=${leaf.totalScore}`,
        `breakdown=${formatScoreBreakdown(leaf.scoreBreakdown)}`,
        `base=${leaf.structure?.baseRoleKind ?? 'unknown'}`,
        `specialization=${derivedSpecializationKinds.join('/') || 'none'}${leaf.structure?.specializationKinds.length ? '' : ' (derived)'}`,
        `penalizable=${debug.penalizableSpecializationKinds.join('/') || 'none'}`,
        `unsupported=${debug.unsupportedPenalizableSpecializationKinds
            .map((kind) => {
            const markers = debug.penalizableSpecializationLeafMarkers[kind];
            return markers?.length ? `${kind}(leaf=${markers.join(',')})` : kind;
        })
            .join('/') || 'none'}`,
        `supported=${debug.supportedSpecializationKinds
            .map((kind) => {
            const match = debug.specializationSupportMatches[kind];
            if (!match) {
                return kind;
            }
            return match.cluster
                ? `${kind}(cluster=${match.cluster},leaf=${match.leafToken},query=${match.queryToken})`
                : `${kind}(leaf=${match.leafToken},query=${match.queryToken})`;
        })
            .join('/') || 'none'}`,
        `industryContextInherentToFamily=${debug.industryContextInherentToFamily}${debug.industryContextInherentToFamilyMatch
            ? `(cluster=${debug.industryContextInherentToFamilyMatch.cluster},leaf=${debug.industryContextInherentToFamilyMatch.leafToken},family=${debug.industryContextInherentToFamilyMatch.familyToken})`
            : ''}`,
        `closeness=${formatPercent(leaf.closeness.usefulQueryCoverage)}:${leaf.closeness.matchedLabelSource}:"${leaf.closeness.matchedLabel}"`,
        `matched=${leaf.closeness.matchedUsefulTokens.join('/') || 'none'}`,
        `missing=${leaf.closeness.missingUsefulTokens.join('/') || 'none'}`,
        `extra=${leaf.closeness.extraTitleTokens.join('/') || 'none'}`
    ].join('  ');
}
function parseCliOptions(args) {
    const options = {
        families: [],
        query: '',
        locale: DEFAULT_RETRIEVAL_LOCALE,
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        limit: 12
    };
    for (const arg of args) {
        if (arg.startsWith('--family=')) {
            const familyInput = arg.slice('--family='.length).trim();
            if (familyInput) {
                options.families.push(familyInput);
            }
            continue;
        }
        if (arg.startsWith('--query=')) {
            options.query = arg.slice('--query='.length).trim();
            continue;
        }
        if (arg.startsWith('--locale=')) {
            options.locale = arg.slice('--locale='.length).trim() || DEFAULT_RETRIEVAL_LOCALE;
            continue;
        }
        if (arg === '--locale-en') {
            options.locale = 'en';
            continue;
        }
        if (arg.startsWith('--limit=')) {
            options.limit = parsePositiveInteger('limit', arg.slice('--limit='.length));
            continue;
        }
        if (arg === '--help') {
            printHelp();
            process.exit(0);
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    if (options.families.length === 0) {
        throw new Error('Missing required --family argument (pass it multiple times to rank across several families, e.g. 2 wrong + 1 right).');
    }
    if (options.families.length > 3) {
        throw new Error('Pass at most 3 --family arguments at a time.');
    }
    if (!options.query) {
        throw new Error('Missing required --query argument.');
    }
    return options;
}
function parsePositiveInteger(name, value) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
        throw new Error(`--${name} must be a positive integer.`);
    }
    return parsed;
}
function printHelp() {
    console.log('Usage: npm run rank:family-leaves -- --family="Other health professionals" --family="Fishery workers, hunters and trappers" --family="Client information workers" --query="health professional" --locale=en');
    console.log('Pass --family up to 3 times to rank leaves across several families at once (e.g. 2 wrong + 1 right), sorted together by score.');
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
