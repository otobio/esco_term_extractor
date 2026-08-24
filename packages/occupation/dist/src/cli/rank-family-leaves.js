import { DEFAULT_ESCO_SOURCE_NAME, DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import { cleanOccupationQuerySurface } from '../query/occupation-query-cleaning.js';
import { prepareQuery, preparedQueryRoleFolded, preparedQueryRoleFoldedTokens, preparedQueryRoleNormalized, preparedQueryRoleUsefulFoldedRecallTokens } from '../query/query-preparation.js';
import { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
import { preparedQuerySupportsSpecializationKind } from '../runtime/occupation-leaf-structure-rules.js';
import { TokenLeafClosenessRanker } from '../search-pipeline/ranking/leaf-closeness-ranker.js';
import { foldSearchText, tokenizeNormalizedText } from '../utils/texts.js';
const LEAF_CLOSENESS_RANKER = new TokenLeafClosenessRanker();
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const runtime = await OccupationRuntimeContext.load({
        sourceName: options.sourceName,
        leafStructureRuntime: true
    });
    const family = resolveFamily(runtime.searchMetaArtifact, options.family);
    const cleanedQuery = await cleanOccupationQuerySurface(options.query, options.locale);
    const effectiveQuery = cleanedQuery || options.query;
    const preparedQuery = await prepareQuery(effectiveQuery, options.locale, { sourceName: options.sourceName });
    //const familyScopedQuery = prepareFamilyScopedQueryFromPrepared(preparedQuery);
    const leaves = runtime.searchMetaArtifact.getLeafCoreRecordsForFamilies([family.familyNodeId]);
    for (const leaf of leaves) {
        console.log(leaf.canonicalLabel);
    }
    console.log('=======');
    const rankedLeaves = leaves
        .map((leaf) => rankLeaf(runtime.searchMetaArtifact, runtime.leafStructureArtifact, leaf, preparedQuery, options.locale))
        .sort(compareRankedLeaves)
        .map((leaf, index) => ({ ...leaf, rank: index + 1 }));
    console.log(formatResult(options, family, effectiveQuery, preparedQuery, rankedLeaves.slice(0, options.limit)));
}
function rankLeaf(artifact, leafStructureArtifact, leaf, preparedQuery, locale) {
    const aliases = localeAliasLabels(artifact.getAliases(leaf.graphNodeId), locale);
    const closeness = LEAF_CLOSENESS_RANKER.rank({
        query: {
            locale: preparedQuery.locale,
            normalized: preparedQueryRoleNormalized(preparedQuery),
            folded: preparedQueryRoleFolded(preparedQuery),
            foldedTokens: preparedQueryRoleFoldedTokens(preparedQuery),
            usefulFoldedRecallTokens: preparedQueryRoleUsefulFoldedRecallTokens(preparedQuery)
        },
        canonicalLabel: leaf.canonicalLabel
    });
    const structure = leafStructureArtifact?.getRecord(leaf.graphNodeId) ?? null;
    const comparisonTier = leafComparisonTier(closeness, aliases, structure, preparedQuery);
    const extraTokenPenalty = 0; //unsupportedExtraTokenCount(closeness);
    return {
        rank: 0,
        graphNodeId: leaf.graphNodeId,
        canonicalLabel: leaf.canonicalLabel,
        aliases,
        comparisonTier,
        structure,
        extraTokenPenalty,
        closeness
    };
}
function leafComparisonTier(closeness, aliases, structure, preparedQuery) {
    if (leafHasExactMatch(closeness, aliases, preparedQuery)) {
        return 'exact_match';
    }
    if (leafHasUsefulExactLabel(closeness)) {
        return 'useful_exact';
    }
    if (leafHasExactSpecializedMatch(closeness, structure, preparedQuery)) {
        return 'exact_specialized_leaf';
    }
    // if (leafHasBaseMatch(closeness, structure)) {
    //   return 'base_leaf';
    // }
    return 'rest';
}
function leafHasExactMatch(closeness, aliases, preparedQuery) {
    if (closeness.exactNormalizedLabel || closeness.exactFoldedLabel) {
        console.log('exact match', 'of leaf ->', closeness.matchedLabel);
        return true;
    }
    const exactAlias = aliases.find((alias) => alias === preparedQuery.normalized);
    if (exactAlias !== undefined) {
        console.log('exact alias:', exactAlias, 'of leaf ->', closeness.matchedLabel);
        return true;
    }
    const foldedAlias = aliases.find((alias) => foldSearchText(alias) === preparedQuery.folded);
    if (foldedAlias !== undefined) {
        console.log('hmm exact folded alias:', foldedAlias);
        return true;
    }
    return false;
}
function leafHasUsefulExactLabel(closeness) {
    if (closeness.exactNormalizedLabel || closeness.exactFoldedLabel) {
        return false;
    }
    if (closeness.usefulQueryCoverage < 1 || closeness.missingUsefulTokens.length > 0) {
        return false;
    }
    return closeness.extraTitleTokens.length > 0 && closeness.extraGenericModifierCount === closeness.extraTitleTokens.length;
}
function leafHasExactSpecializedMatch(closeness, structure, preparedQuery) {
    if (closeness.usefulQueryCoverage < 1 || closeness.missingUsefulTokens.length > 0) {
        return false;
    }
    if (!structure || structure.specializationKinds.length === 0) {
        return false;
    }
    return structure.specializationKinds.some((kind) => preparedQuerySupportsSpecializationKind(preparedQuery, kind));
}
function leafHasBaseMatch(closeness, structure) {
    if (closeness.usefulQueryCoverage <= 0) {
        return false;
    }
    return structure?.baseRoleKind === 'generic_base_role';
}
function compareRankedLeaves(left, right) {
    return (leafComparisonTierRank(left.comparisonTier) - leafComparisonTierRank(right.comparisonTier) ||
        right.closeness.usefulQueryCoverage - left.closeness.usefulQueryCoverage ||
        left.extraTokenPenalty - right.extraTokenPenalty ||
        right.closeness.score - left.closeness.score ||
        left.closeness.titleExtraTokenRatio - right.closeness.titleExtraTokenRatio ||
        canonicalTokenCount(left.canonicalLabel) - canonicalTokenCount(right.canonicalLabel) ||
        left.canonicalLabel.localeCompare(right.canonicalLabel));
}
function unsupportedExtraTokenCount(closeness) {
    console.log(closeness, closeness.extraTitleTokens.length, closeness.extraGenericModifierCount);
    return Math.max(0, closeness.extraTitleTokens.length - closeness.extraGenericModifierCount);
}
function leafComparisonTierRank(tier) {
    if (tier === 'exact_match')
        return 1;
    if (tier === 'useful_exact')
        return 2;
    if (tier === 'exact_specialized_leaf')
        return 3;
    if (tier === 'base_leaf')
        return 4;
    return 5;
}
function resolveFamily(artifact, familyInput) {
    const parsedFamilyId = Number.parseInt(familyInput, 10);
    if (Number.isInteger(parsedFamilyId) && String(parsedFamilyId) === familyInput.trim()) {
        const matchingRecord = artifact.getLeafCoreRecordsForFamilies([parsedFamilyId])[0] ?? null;
        if (!matchingRecord?.familyLabel) {
            throw new Error(`No runtime leaves found for family id ${parsedFamilyId}.`);
        }
        return {
            familyNodeId: parsedFamilyId,
            familyLabel: matchingRecord.familyLabel
        };
    }
    const foldedFamilyInput = foldSearchText(familyInput);
    const familyById = new Map();
    for (const record of artifact.getAllCoreRecords()) {
        if (record.familyNodeId === null || record.familyLabel === null) {
            continue;
        }
        familyById.set(record.familyNodeId, record.familyLabel);
    }
    const matches = Array.from(familyById.entries())
        .filter(([, label]) => foldSearchText(label) === foldedFamilyInput)
        .sort((left, right) => left[1].localeCompare(right[1]) || left[0] - right[0]);
    if (matches.length === 0) {
        throw new Error(`No family matched "${familyInput}". Pass the family id or the exact family label.`);
    }
    const [familyNodeId, familyLabel] = matches[0];
    return { familyNodeId, familyLabel };
}
function localeAliasLabels(aliases, locale) {
    return uniqueStrings(aliases.filter((alias) => alias.localeCode === locale).flatMap((alias) => [alias.alias, alias.normalizedAlias]));
}
function formatResult(options, family, effectiveQuery, preparedQuery, leaves) {
    const lines = [];
    const selectedLeaf = leaves[0] ?? null;
    lines.push(`Family leaf ranking: "${options.query}"`);
    lines.push(`family="${family.familyLabel}" #${family.familyNodeId}  locale=${options.locale}  source=${options.sourceName}`);
    lines.push(`effective_query="${effectiveQuery}"`);
    lines.push(`query_tokens=${preparedQuery.foldedTokens.join(',') || 'none'}`);
    lines.push(`role_tokens=${preparedQuery.intent.roleTokens.join(',') || 'none'}`);
    lines.push(`domain_tokens=${preparedQuery.intent.domainTokens.join(',') || 'none'}`);
    if (!selectedLeaf) {
        lines.push('selected_leaf=none');
        return lines.join('\n');
    }
    lines.push('');
    lines.push(`Selected leaf`);
    lines.push(`${selectedLeaf.rank}. "${selectedLeaf.canonicalLabel}" #${selectedLeaf.graphNodeId}  tier=${selectedLeaf.comparisonTier}  closeness=${formatPercent(selectedLeaf.closeness.usefulQueryCoverage)}`);
    lines.push('');
    lines.push('Ranked leaves');
    for (const leaf of leaves) {
        lines.push(formatLeaf(leaf));
    }
    return lines.join('\n');
}
function formatLeaf(leaf) {
    return [
        `${leaf.rank}. "${leaf.canonicalLabel}" #${leaf.graphNodeId}`,
        `tier=${leaf.comparisonTier}`,
        `base=${leaf.structure?.baseRoleKind ?? 'unknown'}`,
        `specialization=${leaf.structure?.specializationKinds.join('/') || 'none'}`,
        `extra_penalty=${leaf.extraTokenPenalty}`,
        `closeness=${formatPercent(leaf.closeness.usefulQueryCoverage)}:${leaf.closeness.matchedLabelSource}:"${leaf.closeness.matchedLabel}"`,
        `matched=${leaf.closeness.matchedUsefulTokens.join('/') || 'none'}`,
        `missing=${leaf.closeness.missingUsefulTokens.join('/') || 'none'}`,
        `extra=${leaf.closeness.extraTitleTokens.join('/') || 'none'}`
    ].join('  ');
}
function parseCliOptions(args) {
    const options = {
        family: '',
        query: '',
        locale: DEFAULT_RETRIEVAL_LOCALE,
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        limit: 12
    };
    for (const arg of args) {
        if (arg.startsWith('--family=')) {
            options.family = arg.slice('--family='.length).trim();
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
    if (!options.family) {
        throw new Error('Missing required --family argument.');
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
    console.log('Usage: npm run rank:family-leaves -- --family="Other health professionals" --query="health professional" --locale=en');
}
function canonicalTokenCount(value) {
    return tokenizeNormalizedText(foldSearchText(value)).length;
}
function uniqueStrings(values) {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).sort((left, right) => left.localeCompare(right));
}
function formatPercent(value) {
    return `${Math.round(value * 100)}%`;
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
