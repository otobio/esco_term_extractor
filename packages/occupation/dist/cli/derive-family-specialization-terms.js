import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { foldSearchText, tokenizeNormalizedText } from '../utils/texts.js';
// Derives, per family, which vocabulary words actually distinguish it from its closest sibling
// families (families sharing the same immediate broader-family ancestor in the ESCO graph) --
// instead of the single hand-curated specializationTerms entry in occupation-family-taxonomy.ts,
// which only exists for 1 of 126 families and can't express that a word (e.g. "machine") is a real
// specialization signal in one family but generic noise in another. This is an analysis dump only --
// it does not wire into runtime scoring. Review the output before deciding what (if anything) to use.
const SOURCE_JSONL = path.resolve(process.cwd(), 'data/runtime-review/occupation-search-meta.esco_1_2_1.jsonl');
const OUTPUT_JSON = path.resolve(process.cwd(), 'data/runtime-review/occupation-family-specialization-terms.esco_1_2_1.json');
// Generic role/connector words that recur across almost every family regardless of specialization --
// excluded so they can't slip through as a "specialization term" just because a small sibling cluster
// happens not to share them.
const STOPWORDS = new Set([
    'and',
    'or',
    'of',
    'the',
    'for',
    'other',
    'related',
    'general',
    'in',
    'to',
    'a',
    'an',
    'manager',
    'managers',
    'specialist',
    'specialists',
    'specialised',
    'specialized',
    'officer',
    'officers',
    'assistant',
    'assistants',
    'worker',
    'workers',
    'professional',
    'professionals',
    'technician',
    'technicians',
    'engineer',
    'engineers',
    'supervisor',
    'supervisors',
    'clerk',
    'clerks',
    'agent',
    'agents',
    'operator',
    'operators',
    'administrator',
    'administrators',
    'associate',
    'associates',
    'representative',
    'representatives',
    'consultant',
    'consultants',
    'advisor',
    'advisors',
    'director',
    'directors',
    'coordinator',
    'coordinators',
    'analyst',
    'analysts',
    'practitioner',
    'practitioners',
    'expert',
    'experts',
    'chief',
    'lead',
    'senior',
    'junior',
    'trainee',
    'apprentice',
    'head'
]);
// Loose singular/plural match so a family's own label tokens (e.g. "waiters") also suppress the
// singular leaf-level form (e.g. "waiter") -- both are the family's base identity, not a specialization.
function stemToken(token) {
    return token.endsWith('es') ? token.slice(0, -2) : token.endsWith('s') ? token.slice(0, -1) : token;
}
// Catches suffix drift a plain stem miss (e.g. "nursing" vs "nurse", "waiters" vs "waitress") --
// still the family's own base identity, not a specialization, whenever one shares a long enough
// prefix with the other.
const IDENTITY_PREFIX_MIN_LENGTH = 4;
function sharesIdentityPrefix(token, labelToken) {
    const maxLength = Math.min(token.length, labelToken.length);
    let commonPrefixLength = 0;
    while (commonPrefixLength < maxLength && token[commonPrefixLength] === labelToken[commonPrefixLength]) {
        commonPrefixLength += 1;
    }
    return commonPrefixLength >= IDENTITY_PREFIX_MIN_LENGTH;
}
const MIN_LEAF_COUNT_FOR_TERM = 2;
const MIN_FAMILY_DOC_FREQ = 0.15;
const MAX_SIBLING_DOC_FREQ = 0.02;
async function main() {
    const families = new Map();
    const rl = createInterface({ input: createReadStream(SOURCE_JSONL, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of rl) {
        if (!line.trim()) {
            continue;
        }
        const record = JSON.parse(line);
        let family = families.get(record.familyNodeId);
        if (!family) {
            const broader = closestBroaderFamily(record.ancestors);
            family = {
                familyNodeId: record.familyNodeId,
                familyLabel: record.familyLabel,
                broaderFamilyNodeId: broader?.graphNodeId ?? null,
                broaderFamilyLabel: broader?.canonicalLabel ?? null,
                leafCount: 0,
                tokenLeafCounts: new Map()
            };
            families.set(record.familyNodeId, family);
        }
        family.leafCount += 1;
        const tokens = new Set(tokenizeNormalizedText(foldSearchText(record.canonicalLabel)));
        for (const token of tokens) {
            if (token.length < 3 || STOPWORDS.has(token)) {
                continue;
            }
            family.tokenLeafCounts.set(token, (family.tokenLeafCounts.get(token) ?? 0) + 1);
        }
    }
    const familyList = Array.from(families.values());
    const siblingsByBroader = new Map();
    for (const family of familyList) {
        if (family.broaderFamilyNodeId === null) {
            continue;
        }
        const group = siblingsByBroader.get(family.broaderFamilyNodeId) ?? [];
        group.push(family);
        siblingsByBroader.set(family.broaderFamilyNodeId, group);
    }
    const output = familyList
        .map((family) => {
        const cluster = family.broaderFamilyNodeId !== null ? (siblingsByBroader.get(family.broaderFamilyNodeId) ?? []) : [];
        const siblings = cluster.filter((sibling) => sibling.familyNodeId !== family.familyNodeId);
        if (siblings.length === 0) {
            return {
                familyNodeId: family.familyNodeId,
                familyLabel: family.familyLabel,
                broaderFamilyLabel: family.broaderFamilyLabel,
                leafCount: family.leafCount,
                siblingFamilyLabels: [],
                specializationTerms: [],
                skippedReason: 'no sibling family found under the same broader-family ancestor'
            };
        }
        const familyLabelTokens = tokenizeNormalizedText(foldSearchText(family.familyLabel));
        const familyLabelStems = new Set(familyLabelTokens.map((token) => stemToken(token)));
        const terms = [];
        for (const [token, leafCount] of family.tokenLeafCounts) {
            if (leafCount < MIN_LEAF_COUNT_FOR_TERM) {
                continue;
            }
            if (familyLabelStems.has(stemToken(token)) || familyLabelTokens.some((labelToken) => sharesIdentityPrefix(token, labelToken))) {
                continue;
            }
            const familyDocFreq = leafCount / family.leafCount;
            if (familyDocFreq < MIN_FAMILY_DOC_FREQ) {
                continue;
            }
            const siblingMaxDocFreq = Math.max(0, ...siblings.map((sibling) => (sibling.tokenLeafCounts.get(token) ?? 0) / sibling.leafCount));
            if (siblingMaxDocFreq > MAX_SIBLING_DOC_FREQ) {
                continue;
            }
            terms.push({ token, familyDocFreq: round(familyDocFreq), leafCount, siblingMaxDocFreq: round(siblingMaxDocFreq) });
        }
        terms.sort((a, b) => b.familyDocFreq - a.familyDocFreq);
        return {
            familyNodeId: family.familyNodeId,
            familyLabel: family.familyLabel,
            broaderFamilyLabel: family.broaderFamilyLabel,
            leafCount: family.leafCount,
            siblingFamilyLabels: siblings.map((sibling) => sibling.familyLabel),
            specializationTerms: terms
        };
    })
        .sort((a, b) => b.specializationTerms.length - a.specializationTerms.length);
    await mkdir(path.dirname(OUTPUT_JSON), { recursive: true });
    await writeFile(OUTPUT_JSON, JSON.stringify(output, null, 2), 'utf8');
    const withTerms = output.filter((entry) => entry.specializationTerms.length > 0).length;
    const noSiblings = output.filter((entry) => entry.siblingFamilyLabels.length === 0).length;
    console.log(`Wrote ${output.length} families to ${OUTPUT_JSON}`);
    console.log(`${withTerms} families produced at least one candidate specialization term.`);
    console.log(`${noSiblings} families have no sibling family under the same broader-family ancestor.`);
}
function closestBroaderFamily(ancestors) {
    return ancestors
        .filter((ancestor) => ancestor.ancestorRole === 'broader' && ancestor.nodeLevel === 'family')
        .sort((a, b) => a.distanceFromLeaf - b.distanceFromLeaf)[0];
}
function round(value) {
    return Math.round(value * 1000) / 1000;
}
main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
});
