import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { foldWeakPunctuationLookupText } from '../utils/texts.js';
import { loadOccupationSearchMetaArtifactWithDetailsRequired } from '../runtime/occupation-search-meta-artifact.js';
import authoringSeedsJson from '../runtime/seeds/occupation-reviewed-alias-seeds.authoring.json' with { type: 'json' };
const ALIAS_ROLES = ['locale_primary', 'locale_supporting', 'reviewed_crosswalk', 'family_supporting', 'english_backbone'];
// Mirrors the dominant weight convention observed in curated ESCO alias data per role (see
// data/runtime-review/occupation-alias-ngrams.*.family.jsonl).
const DEFAULT_ALIAS_ROLE_WEIGHT = {
    locale_primary: 1,
    locale_supporting: 0.8,
    reviewed_crosswalk: 0.82,
    family_supporting: 0.7,
    english_backbone: 0.7
};
const resolvedPath = path.resolve(process.cwd(), 'src/runtime/seeds/occupation-reviewed-alias-seeds.json');
async function main() {
    const authoringSeeds = Array.isArray(authoringSeedsJson) ? authoringSeedsJson : [];
    const sourceNames = [...new Set(authoringSeeds.map((seed) => seed.sourceName))];
    const labelIndexBySource = new Map();
    for (const sourceName of sourceNames) {
        const artifact = await loadOccupationSearchMetaArtifactWithDetailsRequired(sourceName);
        const labelIndex = new Map();
        for (const record of artifact.getAllRecordsWithDetails()) {
            const key = foldWeakPunctuationLookupText(record.canonicalLabel);
            const matches = labelIndex.get(key) ?? [];
            matches.push({ graphNodeId: record.graphNodeId, canonicalLabel: record.canonicalLabel });
            labelIndex.set(key, matches);
        }
        labelIndexBySource.set(sourceName, labelIndex);
    }
    const errors = [];
    const resolvedSeeds = [];
    for (const seed of authoringSeeds) {
        const labelIndex = labelIndexBySource.get(seed.sourceName);
        const matches = labelIndex?.get(foldWeakPunctuationLookupText(seed.canonicalLabel)) ?? [];
        if (matches.length === 0) {
            errors.push(`No leaf found for sourceName="${seed.sourceName}" canonicalLabel="${seed.canonicalLabel}" (locale=${seed.locale}, alias="${seed.alias}")`);
            continue;
        }
        if (matches.length > 1) {
            errors.push(`Ambiguous canonicalLabel="${seed.canonicalLabel}" for sourceName="${seed.sourceName}" matches ${matches.length} leaves (graphNodeIds: ${matches.map((m) => m.graphNodeId).join(', ')}) -- disambiguate by editing the authoring entry`);
            continue;
        }
        const [match] = matches;
        resolvedSeeds.push({
            sourceName: seed.sourceName,
            leafNodeId: match.graphNodeId,
            leafLabel: match.canonicalLabel,
            locale: seed.locale,
            alias: seed.alias,
            aliasRole: seed.aliasRole,
            weight: DEFAULT_ALIAS_ROLE_WEIGHT[seed.aliasRole],
            ...(seed.note !== undefined ? { note: seed.note } : {})
        });
    }
    if (errors.length > 0) {
        for (const error of errors) {
            console.error(`error: ${error}`);
        }
        process.exitCode = 1;
        return;
    }
    await writeFile(resolvedPath, `${JSON.stringify(resolvedSeeds, null, 2)}\n`, 'utf8');
    console.log(`Resolved ${resolvedSeeds.length} alias seed(s) -> ${resolvedPath}`);
}
main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
