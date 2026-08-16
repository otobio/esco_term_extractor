import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { withConnection } from '../db/mysql.js';
import { foldSearchText, tokenizeNormalizedText } from '../utils/texts.js';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { buildOccupationLeafStructureBinaryFiles, defaultOccupationLeafStructureManifestPath } from '../runtime/occupation-leaf-structure-artifact.js';
import { detectLeafAuthorityKind, detectLeafSpecializationKinds, LEAF_STRUCTURE_AUTHORITY_ORDER } from '../runtime/occupation-leaf-structure-rules.js';
import { defaultRuntimeReviewJsonPath, runtimeReviewArtifactBaseName, writeRuntimeReviewJson } from '../runtime/runtime-review-artifacts.js';
const SEEDED_FAMILY_CONFIGS = [
    family(14842, 'Physical and engineering science technicians', ['technician', 'drafter', 'draftsperson', 'surveyor', 'inspector'], ['engineering', 'science', 'physical', 'metrology', 'quality', 'process']),
    family(14727, 'Engineering professionals (excluding electrotechnology)', ['engineer'], ['engineering', 'civil', 'mechanical', 'industrial', 'chemical', 'materials', 'environmental']),
    family(14908, 'Business services agents', ['agent', 'broker', 'representative', 'officer', 'negotiator'], ['business', 'service', 'services', 'commercial', 'customs', 'freight', 'property', 'travel']),
    family(14802, 'Software and applications developers and analysts', ['developer', 'analyst', 'programmer', 'architect', 'tester', 'administrator'], ['software', 'application', 'applications', 'web', 'systems', 'system', 'data']),
    family(14796, 'Sales, marketing and public relations professionals', ['specialist', 'consultant', 'officer', 'executive', 'planner', 'buyer', 'copywriter', 'manager'], ['sales', 'marketing', 'advertising', 'public', 'relations', 'communications', 'brand', 'media']),
    family(14739, 'Architects, planners, surveyors and designers', ['architect', 'planner', 'surveyor', 'designer', 'artist', 'animator', 'modeller', 'publisher'], ['urban', 'landscape', 'graphic', 'digital', 'fashion', 'industrial', 'media', 'design']),
    family(14735, 'Electrotechnology engineers', ['engineer', 'analyst', 'designer', 'expert'], ['electrical', 'electronics', 'electronic', 'electromechanical', 'telecommunications', 'telecom', 'power', 'microelectronics']),
    family(15135, 'Electrical equipment installers and repairers', ['installer', 'repairer', 'mechanic', 'technician'], ['electrical', 'equipment', 'electromechanical', 'power', 'industrial']),
    family(14808, 'Database and network professionals', ['administrator', 'architect', 'analyst', 'engineer', 'developer', 'specialist'], ['database', 'network', 'security', 'systems', 'system', 'infrastructure', 'cloud']),
    family(15139, 'Electronics and telecommunications installers and repairers', ['installer', 'repairer', 'technician', 'mechanic'], ['electronics', 'electronic', 'telecommunications', 'telecom', 'network', 'broadcast']),
    family(14942, 'Information and communications technology operations and user support technicians', ['technician', 'administrator', 'operator', 'specialist'], ['information', 'communications', 'technology', 'ict', 'helpdesk', 'support', 'user', 'systems', 'system'])
];
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const configByFamilyId = new Map(SEEDED_FAMILY_CONFIGS.map((family) => [family.familyNodeId, family]));
    const rows = await withConnection(async (connection) => {
        const [result] = await connection.query(`
        SELECT
          meta.graph_node_id,
          node.canonical_label,
          meta.family_node_id,
          family.canonical_label AS family_label,
          meta.group_node_id,
          group_node.canonical_label AS group_label,
          meta.parent_node_id,
          parent_node.canonical_label AS parent_label,
          meta.metadata_json
        FROM ose_search_meta meta
        INNER JOIN ose_graph_nodes node
          ON node.id = meta.graph_node_id
        INNER JOIN ose_graph_nodes family
          ON family.id = meta.family_node_id
        LEFT JOIN ose_graph_nodes group_node
          ON group_node.id = meta.group_node_id
        LEFT JOIN ose_graph_nodes parent_node
          ON parent_node.id = meta.parent_node_id
        WHERE node.node_level = 'occupation'
          AND EXISTS (
            SELECT 1
            FROM ose_graph_node_sources node_source
            WHERE node_source.graph_node_id = meta.graph_node_id
              AND node_source.source_name = ?
          )
        ORDER BY meta.family_node_id, node.canonical_label
      `, [options.sourceName]);
        return result;
    });
    const records = rows.map((row) => classifyRow(row, configByFamilyId.get(row.family_node_id ?? -1) ?? null));
    const manifestPath = path.resolve(options.outPath);
    const prefix = path.basename(manifestPath, '.manifest.json');
    const binary = buildOccupationLeafStructureBinaryFiles(records, prefix);
    const manifest = {
        schemaVersion: 2,
        sourceName: options.sourceName,
        generatedAt: new Date().toISOString(),
        count: records.length,
        stringCount: binary.stringCount,
        familyPostingKeyCount: binary.familyPostingKeyCount,
        familyPostingCount: binary.familyPostingCount,
        files: binary.manifestFiles
    };
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await Promise.all(Array.from(binary.buffers.entries()).map(([fileName, buffer]) => writeFile(path.resolve(path.dirname(manifestPath), fileName), buffer)));
    if (options.reviewJsonOutPath) {
        await writeRuntimeReviewJson(path.resolve(options.reviewJsonOutPath), {
            generatedAt: manifest.generatedAt,
            sourceName: options.sourceName,
            seededFamilies: SEEDED_FAMILY_CONFIGS.map(({ familyNodeId, familyLabel }) => ({ familyNodeId, familyLabel })),
            classificationScope: 'all_occupation_leaves',
            count: records.length,
            records
        });
    }
    console.log(`Exported ${records.length} occupation leaf-structure records to ${manifestPath}`);
    console.log(`seeded_families=${SEEDED_FAMILY_CONFIGS.length} source=${options.sourceName}`);
}
function family(familyNodeId, familyLabel, headTokens, anchorTokens) {
    return {
        familyNodeId,
        familyLabel,
        headTokens: new Set(headTokens),
        anchorTokens: new Set(anchorTokens)
    };
}
function classifyRow(row, familyConfig) {
    const tokens = tokenizeNormalizedText(foldSearchText(row.canonical_label));
    const tokenSet = new Set(tokens);
    const authorityKind = detectLeafAuthorityKind(tokens);
    const specializationKinds = detectLeafSpecializationKinds(tokenSet);
    const metadata = parseMetadata(row.metadata_json);
    const nonAuthorityTokens = tokens.filter((token) => !LEAF_STRUCTURE_AUTHORITY_ORDER.some((entry) => entry.token === token));
    const headToken = detectHeadToken(nonAuthorityTokens, familyConfig);
    const remainingTokens = nonAuthorityTokens.filter((token) => token !== headToken && !(familyConfig?.anchorTokens.has(token) ?? false) && !isStructuralModifier(token));
    const headPreservingSpecialization = headToken !== null && remainingTokens.length > 0;
    const baseRoleKind = authorityKind === 'none' && remainingTokens.length === 0 ? 'generic_base_role' : 'specialized_base_role';
    return {
        graphNodeId: row.graph_node_id,
        canonicalLabel: row.canonical_label,
        familyNodeId: row.family_node_id,
        groupNodeId: row.group_node_id,
        parentNodeId: row.parent_node_id,
        baseRoleKind,
        authorityKind,
        specializationKinds,
        headPreservingSpecialization,
        broadAliasRisk: aliasRisk(metadata.aliasStats.activeCount, metadata.aliasStats.englishCount),
        capabilityDominanceRisk: capabilityRisk(metadata.capabilityStats.usefulCount, metadata.aliasStats.activeCount)
    };
}
function detectHeadToken(tokens, familyConfig) {
    if (familyConfig) {
        for (let index = tokens.length - 1; index >= 0; index -= 1) {
            const token = tokens[index] ?? '';
            if (familyConfig.headTokens.has(token)) {
                return token;
            }
        }
    }
    return tokens[tokens.length - 1] ?? null;
}
function aliasRisk(activeAliasCount, englishAliasCount) {
    if (activeAliasCount >= 250 || englishAliasCount >= 220) {
        return 'high';
    }
    if (activeAliasCount >= 140 || englishAliasCount >= 120) {
        return 'medium';
    }
    return 'low';
}
function capabilityRisk(usefulCapabilityCount, activeAliasCount) {
    if (usefulCapabilityCount >= 20 && activeAliasCount <= 90) {
        return 'high';
    }
    if (usefulCapabilityCount >= 14 && activeAliasCount <= 140) {
        return 'medium';
    }
    return 'low';
}
function parseMetadata(value) {
    const parsed = typeof value === 'string' ? JSON.parse(value) : (value ?? {});
    const aliasStats = record(parsed.alias_stats);
    const capabilityStats = record(parsed.capability_stats);
    return {
        aliasStats: {
            activeCount: integer(aliasStats.active_count),
            englishCount: integer(aliasStats.english_count)
        },
        capabilityStats: {
            usefulCount: integer(capabilityStats.useful_count)
        }
    };
}
function record(value) {
    return value && typeof value === 'object' ? value : {};
}
function integer(value) {
    return Number.isInteger(value) ? Number(value) : 0;
}
function isStructuralModifier(token) {
    return token === 'and' || token === 'for' || token === 'of' || token === 'public' || token === 'relations';
}
function parseCliOptions(args) {
    const options = {
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        outPath: '',
        reviewJsonOutPath: ''
    };
    let explicitOut = false;
    let explicitReviewOut = false;
    for (const arg of args) {
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
            continue;
        }
        if (arg.startsWith('--out=')) {
            options.outPath = arg.slice('--out='.length).trim();
            explicitOut = true;
            continue;
        }
        if (arg.startsWith('--review-json-out=')) {
            options.reviewJsonOutPath = arg.slice('--review-json-out='.length).trim();
            explicitReviewOut = true;
            continue;
        }
        if (arg === '--no-review-json') {
            options.reviewJsonOutPath = null;
            explicitReviewOut = true;
            continue;
        }
        if (arg === '--help') {
            printHelp();
            process.exit(0);
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    if (!explicitOut) {
        options.outPath = defaultOccupationLeafStructureManifestPath(options.sourceName);
    }
    if (!explicitReviewOut) {
        options.reviewJsonOutPath = defaultRuntimeReviewJsonPath(runtimeReviewArtifactBaseName(`occupation-leaf-structure.${options.sourceName}`));
    }
    return options;
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/export-occupation-leaf-structure-artifact.js',
        `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
        `[--out=${defaultOccupationLeafStructureManifestPath(DEFAULT_ESCO_SOURCE_NAME)}]`,
        '[--review-json-out=data/runtime-review/occupation-leaf-structure.esco_1_2_1.json]',
        '[--no-review-json]'
    ].join(' '));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Occupation leaf-structure artifact export failed.');
    console.error(message);
    process.exitCode = 1;
});
