import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { foldSearchText, tokenizeNormalizedText } from '../query/query-preparation.js';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';
const DEFAULT_LIMIT = 5;
const DEFAULT_MIN_GAP = 0.18;
const DEFAULT_PRECISION = 'high';
const DEFAULT_MAX_PER_CURRENT_SUB_FAMILY = 1;
const DEFAULT_MAX_PER_PAIR = 1;
const MAX_ALIASES_PER_LEAF = 12;
const MAX_CAPABILITIES_PER_LEAF = 8;
const MAX_PROFILE_SAMPLES = 8;
const MAX_EVIDENCE_TERMS = 10;
const MIN_SUGGESTED_FIT = 0.16;
const HIGH_PRECISION_MAX_CURRENT_FIT = 0.25;
const HIGH_PRECISION_MIN_SUGGESTED_FIT = 0.3;
const SURFACE_WEIGHTS = {
    canonical: 4,
    alias: 2.5,
    capability: 0.6,
    hierarchy: 3,
    domain: 0.25
};
const MATCH_WEIGHTS = {
    head: 4,
    phrase: 2.25,
    token: 1
};
const STOP_TOKENS = new Set([
    'and',
    'the',
    'for',
    'with',
    'without',
    'in',
    'of',
    'to',
    'by',
    'on',
    'at',
    'other',
    'related',
    'not',
    'elsewhere',
    'classified',
    'workers',
    'worker',
    'professionals',
    'professional',
    'associate',
    'associates',
    'operators',
    'operator',
    'technicians',
    'technician',
    'clerks',
    'clerk',
    'managers',
    'manager',
    'specialists',
    'specialist',
    'craft',
    'trades'
]);
const OCCUPATION_HEAD_SUFFIXES = [
    'accountant',
    'analyst',
    'architect',
    'auditor',
    'chef',
    'clerk',
    'consultant',
    'cook',
    'designer',
    'developer',
    'driver',
    'editor',
    'electrician',
    'engineer',
    'journalist',
    'librarian',
    'manager',
    'mechanic',
    'nurse',
    'operator',
    'photographer',
    'psychologist',
    'secretary',
    'supervisor',
    'teacher',
    'technician'
];
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const artifact = await loadOccupationSearchMetaArtifactRequired(options.sourceName);
    const leafProfiles = buildLeafProfiles(artifact);
    const subFamilies = buildSubFamilyProfiles(leafProfiles);
    const termStats = buildTermStats(subFamilies);
    const rows = diverseRows(suspiciousPlacements(leafProfiles, subFamilies, termStats, options), options);
    const csv = rowsToCsv(rows);
    await mkdir(path.dirname(options.outPath), { recursive: true });
    await writeFile(options.outPath, csv, 'utf8');
    console.log(`Wrote ${rows.length} suspicious taxonomy placement candidates to ${options.outPath}`);
    console.log(`source=${options.sourceName} leaves=${leafProfiles.length} sub_families=${subFamilies.length}`);
    for (const row of rows.slice(0, Math.min(10, rows.length))) {
        console.log([
            `#${row.rank}`,
            `score=${row.suspicion_score}`,
            `${row.leaf_label} (${row.leaf_node_id})`,
            `${row.current_sub_family} -> ${row.suggested_sub_family}`,
            `gap=${row.fit_gap}`,
            `terms=${row.suggested_evidence_terms}`
        ].join('  '));
    }
}
function buildLeafProfiles(artifact) {
    const profiles = [];
    for (const record of artifact.getAllCoreRecords()) {
        if (record.familyNodeId === null || record.groupNodeId === null || !record.familyLabel || !record.groupLabel) {
            continue;
        }
        const vector = emptyVector();
        addOccupationSurface(vector, record.canonicalLabel, SURFACE_WEIGHTS.canonical);
        const canonicalHeads = canonicalOccupationHeads(record.canonicalLabel);
        for (const alias of artifact
            .getAliases(record.graphNodeId)
            .filter((candidate) => candidate.localeCode === 'en')
            .slice(0, MAX_ALIASES_PER_LEAF)) {
            addOccupationSurface(vector, alias.normalizedAlias || alias.alias, SURFACE_WEIGHTS.alias);
        }
        for (const capability of artifact.getCapabilityLabels(record.graphNodeId).slice(0, MAX_CAPABILITIES_PER_LEAF)) {
            addSurface(vector, capability.normalizedLabel || capability.label, SURFACE_WEIGHTS.capability, false);
        }
        if (vectorWeight(vector) > 0) {
            profiles.push({ record, vector, canonicalHeads });
        }
    }
    return profiles.sort((left, right) => left.record.canonicalLabel.localeCompare(right.record.canonicalLabel));
}
function buildSubFamilyProfiles(leafProfiles) {
    const bySubFamilyId = new Map();
    for (const leafProfile of leafProfiles) {
        const { record } = leafProfile;
        if (record.groupNodeId === null || record.familyNodeId === null || !record.groupLabel || !record.familyLabel) {
            continue;
        }
        let profile = bySubFamilyId.get(record.groupNodeId);
        if (!profile) {
            profile = {
                subFamilyNodeId: record.groupNodeId,
                subFamilyLabel: record.groupLabel,
                familyNodeId: record.familyNodeId,
                familyLabel: record.familyLabel,
                leafCount: 0,
                leafNodeIds: new Set(),
                samples: [],
                vector: emptyVector(),
                labelTokens: new Set([...meaningfulTokens(record.groupLabel), ...meaningfulTokens(record.familyLabel)])
            };
            addSurface(profile.vector, record.groupLabel, SURFACE_WEIGHTS.hierarchy);
            addSurface(profile.vector, record.familyLabel, SURFACE_WEIGHTS.hierarchy * 0.75);
            bySubFamilyId.set(record.groupNodeId, profile);
        }
        profile.leafCount += 1;
        profile.leafNodeIds.add(record.graphNodeId);
        mergeVector(profile.vector, leafProfile.vector, 1);
        if (profile.samples.length < MAX_PROFILE_SAMPLES && !profile.samples.includes(record.canonicalLabel)) {
            profile.samples.push(record.canonicalLabel);
        }
    }
    return Array.from(bySubFamilyId.values()).sort((left, right) => left.subFamilyLabel.localeCompare(right.subFamilyLabel));
}
function suspiciousPlacements(leafProfiles, subFamilies, termStats, options) {
    const subFamilyById = new Map(subFamilies.map((profile) => [profile.subFamilyNodeId, profile]));
    const rows = [];
    for (const leaf of leafProfiles) {
        const currentGroupId = leaf.record.groupNodeId;
        if (currentGroupId === null) {
            continue;
        }
        const current = subFamilyById.get(currentGroupId);
        if (!current) {
            continue;
        }
        const currentFit = scoreFit(leaf.vector, current.vector, termStats, leaf.vector);
        const bestAlternative = bestAlternativeFit(leaf, current, subFamilies, termStats);
        if (!bestAlternative) {
            continue;
        }
        const gap = bestAlternative.fit.score - currentFit.score;
        if (gap < options.minGap || bestAlternative.fit.score < MIN_SUGGESTED_FIT) {
            continue;
        }
        const headConflict = hasHeadConflict(leaf.vector, currentFit, bestAlternative.fit);
        const familyChange = current.familyNodeId !== bestAlternative.profile.familyNodeId;
        if (options.precision === 'high' &&
            !isHighPrecisionCandidate(leaf, current, bestAlternative.profile, currentFit, bestAlternative.fit, gap, headConflict, familyChange)) {
            continue;
        }
        const suspicionScore = roundScore(gap * 100 + (headConflict ? 12 : 0) + (familyChange ? 6 : 0));
        const suggestedTerms = bestAlternative.fit.matchedTerms.slice(0, MAX_EVIDENCE_TERMS);
        const currentTerms = currentFit.matchedTerms.slice(0, MAX_EVIDENCE_TERMS);
        rows.push({
            rank: 0,
            suspicion_score: suspicionScore.toFixed(3),
            leaf_node_id: leaf.record.graphNodeId,
            leaf_label: leaf.record.canonicalLabel,
            current_sub_family_id: current.subFamilyNodeId,
            current_sub_family: current.subFamilyLabel,
            current_family_id: current.familyNodeId,
            current_family: current.familyLabel,
            suggested_sub_family_id: bestAlternative.profile.subFamilyNodeId,
            suggested_sub_family: bestAlternative.profile.subFamilyLabel,
            suggested_family_id: bestAlternative.profile.familyNodeId,
            suggested_family: bestAlternative.profile.familyLabel,
            current_fit: currentFit.score.toFixed(4),
            suggested_fit: bestAlternative.fit.score.toFixed(4),
            fit_gap: gap.toFixed(4),
            head_conflict: headConflict ? 'yes' : 'no',
            family_change: familyChange ? 'yes' : 'no',
            current_evidence_terms: formatMatches(currentTerms),
            suggested_evidence_terms: formatMatches(suggestedTerms),
            suggested_samples: bestAlternative.profile.samples.join(' | '),
            reason: reasonFor(leaf, current, bestAlternative.profile, gap, headConflict, familyChange, suggestedTerms),
            review_action: '',
            reviewed_target_sub_family_id: '',
            review_note: ''
        });
    }
    return rows
        .sort((left, right) => Number.parseFloat(right.suspicion_score) - Number.parseFloat(left.suspicion_score) ||
        Number.parseFloat(right.fit_gap) - Number.parseFloat(left.fit_gap) ||
        left.leaf_label.localeCompare(right.leaf_label))
        .map((row, index) => ({ ...row, rank: index + 1 }));
}
function diverseRows(rows, options) {
    const selected = [];
    const currentCounts = new Map();
    const pairCounts = new Map();
    for (const row of rows) {
        const currentCount = currentCounts.get(row.current_sub_family_id) ?? 0;
        const pairKey = `${row.current_sub_family_id}->${row.suggested_sub_family_id}`;
        const pairCount = pairCounts.get(pairKey) ?? 0;
        if (currentCount >= options.maxPerCurrentSubFamily || pairCount >= options.maxPerPair) {
            continue;
        }
        selected.push(row);
        currentCounts.set(row.current_sub_family_id, currentCount + 1);
        pairCounts.set(pairKey, pairCount + 1);
        if (selected.length >= options.limit) {
            break;
        }
    }
    return selected.map((row, index) => ({ ...row, rank: index + 1 }));
}
function isHighPrecisionCandidate(leaf, current, suggested, currentFit, suggestedFit, gap, headConflict, familyChange) {
    if (!familyChange || !headConflict) {
        return false;
    }
    if (currentFit.score > HIGH_PRECISION_MAX_CURRENT_FIT || suggestedFit.score < HIGH_PRECISION_MIN_SUGGESTED_FIT) {
        return false;
    }
    if (gap < DEFAULT_MIN_GAP) {
        return false;
    }
    return hasDistinctSuggestedLabelHead(leaf, current, suggested);
}
function hasDistinctSuggestedLabelHead(leaf, current, suggested) {
    for (const head of leaf.canonicalHeads) {
        if (suggested.labelTokens.has(head) && !current.labelTokens.has(head)) {
            return true;
        }
    }
    return false;
}
function bestAlternativeFit(leaf, current, subFamilies, termStats) {
    let best = null;
    for (const profile of subFamilies) {
        if (profile.subFamilyNodeId === current.subFamilyNodeId) {
            continue;
        }
        const fit = scoreFit(leaf.vector, profile.vector, termStats);
        if (!best || fit.score > best.fit.score) {
            best = { profile, fit };
        }
    }
    return best;
}
function scoreFit(leafVector, profileVector, termStats, excludeVector) {
    const matches = [];
    let matched = 0;
    let possible = 0;
    matched += scoreTermMap('head', leafVector.heads, profileVector.heads, termStats.heads, excludeVector?.heads, MATCH_WEIGHTS.head, matches);
    possible += possibleWeight(leafVector.heads, termStats.heads, MATCH_WEIGHTS.head);
    matched += scoreTermMap('phrase', leafVector.phrases, profileVector.phrases, termStats.phrases, excludeVector?.phrases, MATCH_WEIGHTS.phrase, matches);
    possible += possibleWeight(leafVector.phrases, termStats.phrases, MATCH_WEIGHTS.phrase);
    matched += scoreTermMap('token', leafVector.tokens, profileVector.tokens, termStats.tokens, excludeVector?.tokens, MATCH_WEIGHTS.token, matches);
    possible += possibleWeight(leafVector.tokens, termStats.tokens, MATCH_WEIGHTS.token);
    return {
        score: possible > 0 ? roundScore(matched / possible) : 0,
        matchedTerms: matches.sort((left, right) => right.score - left.score || left.term.localeCompare(right.term))
    };
}
function scoreTermMap(kind, leafTerms, profileTerms, docFreqs, excludeTerms, kindWeight, matches) {
    let score = 0;
    for (const [term, leafWeight] of leafTerms) {
        const profileWeight = Math.max((profileTerms.get(term) ?? 0) - (excludeTerms?.get(term) ?? 0), 0);
        if (profileWeight <= 0) {
            continue;
        }
        const contribution = weightedTermScore(term, leafWeight, docFreqs, kindWeight);
        score += contribution;
        matches.push({ kind, term, score: roundScore(contribution) });
    }
    return score;
}
function possibleWeight(terms, docFreqs, kindWeight) {
    let score = 0;
    for (const [term, weight] of terms) {
        score += weightedTermScore(term, weight, docFreqs, kindWeight);
    }
    return score;
}
function weightedTermScore(term, weight, docFreqs, kindWeight) {
    const docFreq = docFreqs.get(term) ?? 1;
    const inverseFamilyFrequency = 1 / Math.sqrt(docFreq);
    return weight * kindWeight * inverseFamilyFrequency;
}
function buildTermStats(subFamilies) {
    return {
        tokens: documentFrequency(subFamilies, (profile) => profile.vector.tokens),
        phrases: documentFrequency(subFamilies, (profile) => profile.vector.phrases),
        heads: documentFrequency(subFamilies, (profile) => profile.vector.heads)
    };
}
function documentFrequency(subFamilies, termsForProfile) {
    const counts = new Map();
    for (const profile of subFamilies) {
        for (const term of termsForProfile(profile).keys()) {
            increment(counts, term, 1);
        }
    }
    return counts;
}
function hasHeadConflict(leafVector, currentFit, suggestedFit) {
    const leafHeads = new Set(leafVector.heads.keys());
    const currentHeads = new Set(currentFit.matchedTerms.filter((match) => match.kind === 'head').map((match) => match.term));
    const suggestedHeads = new Set(suggestedFit.matchedTerms.filter((match) => match.kind === 'head').map((match) => match.term));
    return [...leafHeads].some((head) => !currentHeads.has(head) && suggestedHeads.has(head));
}
function reasonFor(leaf, current, suggested, gap, headConflict, familyChange, suggestedTerms) {
    const reasons = [
        `suggested sub-family fits leaf terms ${gap.toFixed(3)} better than current leave-one-out profile`,
        `suggested evidence: ${formatMatches(suggestedTerms.slice(0, 5)) || 'none'}`
    ];
    if (headConflict) {
        reasons.push('occupation head matches suggested profile but not current profile');
    }
    if (familyChange) {
        reasons.push(`move would change family from ${current.familyNodeId} to ${suggested.familyNodeId}`);
    }
    return `${leaf.record.canonicalLabel}: ${reasons.join('; ')}`;
}
function addOccupationSurface(vector, value, weight) {
    const { role, domain } = splitOccupationSurface(value);
    addSurface(vector, role, weight);
    if (domain) {
        addSurface(vector, domain, weight * SURFACE_WEIGHTS.domain, false);
    }
}
function canonicalOccupationHeads(value) {
    const { role } = splitOccupationSurface(value);
    const tokens = tokenizeNormalizedText(foldSearchText(role)).filter((token) => token.length > 1);
    const head = tokens.at(-1);
    const heads = new Set();
    if (head) {
        heads.add(head);
        for (const suffix of OCCUPATION_HEAD_SUFFIXES) {
            if (head !== suffix && head.length > suffix.length + 2 && head.endsWith(suffix)) {
                heads.add(suffix);
            }
            if (head.length > suffix.length && head.endsWith(`${suffix}s`)) {
                heads.add(suffix);
            }
        }
    }
    return heads;
}
function splitOccupationSurface(value) {
    const normalized = value.trim();
    const match = /\s+in\s+/iu.exec(normalized);
    if (!match || match.index <= 0) {
        return {
            role: normalized,
            domain: null
        };
    }
    return {
        role: normalized.slice(0, match.index).trim(),
        domain: normalized.slice(match.index + match[0].length).trim() || null
    };
}
function addSurface(vector, value, weight, includeHead = true) {
    const tokens = meaningfulTokens(value);
    if (tokens.length === 0) {
        return;
    }
    for (const token of tokens) {
        increment(vector.tokens, token, weight);
    }
    for (const phrase of phrases(tokens, 2)) {
        increment(vector.phrases, phrase, weight);
    }
    for (const phrase of phrases(tokens, 3)) {
        increment(vector.phrases, phrase, weight * 1.25);
    }
    const head = includeHead ? tokens.at(-1) : undefined;
    if (head) {
        increment(vector.heads, head, weight);
    }
}
function meaningfulTokens(value) {
    const tokens = [];
    for (const token of tokenizeNormalizedText(foldSearchText(value))) {
        if (token.length <= 1 || STOP_TOKENS.has(token)) {
            continue;
        }
        tokens.push(token);
        for (const suffix of OCCUPATION_HEAD_SUFFIXES) {
            if (token !== suffix && token.length > suffix.length + 2 && token.endsWith(suffix)) {
                tokens.push(suffix);
            }
            if (token.length > suffix.length && token.endsWith(`${suffix}s`)) {
                tokens.push(suffix);
            }
        }
    }
    return [...new Set(tokens)];
}
function phrases(tokens, width) {
    const values = [];
    for (let index = 0; index <= tokens.length - width; index += 1) {
        values.push(tokens.slice(index, index + width).join(' '));
    }
    return values;
}
function emptyVector() {
    return {
        tokens: new Map(),
        phrases: new Map(),
        heads: new Map()
    };
}
function mergeVector(target, source, scale) {
    mergeTermMap(target.tokens, source.tokens, scale);
    mergeTermMap(target.phrases, source.phrases, scale);
    mergeTermMap(target.heads, source.heads, scale);
}
function mergeTermMap(target, source, scale) {
    for (const [term, weight] of source) {
        increment(target, term, weight * scale);
    }
}
function vectorWeight(vector) {
    return sumWeights(vector.tokens) + sumWeights(vector.phrases) + sumWeights(vector.heads);
}
function sumWeights(values) {
    let total = 0;
    for (const weight of values.values()) {
        total += weight;
    }
    return total;
}
function increment(map, key, amount) {
    map.set(key, (map.get(key) ?? 0) + amount);
}
function formatMatches(matches) {
    return matches.map((match) => `${match.kind}:${match.term}`).join(' | ');
}
function rowsToCsv(rows) {
    const headers = [
        'rank',
        'suspicion_score',
        'leaf_node_id',
        'leaf_label',
        'current_sub_family_id',
        'current_sub_family',
        'current_family_id',
        'current_family',
        'suggested_sub_family_id',
        'suggested_sub_family',
        'suggested_family_id',
        'suggested_family',
        'current_fit',
        'suggested_fit',
        'fit_gap',
        'head_conflict',
        'family_change',
        'current_evidence_terms',
        'suggested_evidence_terms',
        'suggested_samples',
        'reason',
        'review_action',
        'reviewed_target_sub_family_id',
        'review_note'
    ];
    return `${[headers.join(','), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(','))].join('\n')}\n`;
}
function csvEscape(value) {
    const text = String(value);
    return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}
function parseCliOptions(args) {
    const options = {
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        outPath: path.join('data', 'taxonomy-review', `esco-leaf-placement-suspicious.${DEFAULT_ESCO_SOURCE_NAME}.csv`),
        limit: DEFAULT_LIMIT,
        minGap: DEFAULT_MIN_GAP,
        precision: DEFAULT_PRECISION,
        maxPerCurrentSubFamily: DEFAULT_MAX_PER_CURRENT_SUB_FAMILY,
        maxPerPair: DEFAULT_MAX_PER_PAIR
    };
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (arg === '--help' || arg === '-h') {
            printHelp();
            process.exit(0);
        }
        if (arg.startsWith('--source-name=')) {
            options.sourceName = requiredValue(arg, '--source-name=');
            options.outPath = path.join('data', 'taxonomy-review', `esco-leaf-placement-suspicious.${options.sourceName}.csv`);
            continue;
        }
        if (arg.startsWith('--out=')) {
            options.outPath = requiredValue(arg, '--out=');
            continue;
        }
        if (arg.startsWith('--limit=')) {
            options.limit = positiveInteger(requiredValue(arg, '--limit='), '--limit');
            continue;
        }
        if (arg.startsWith('--min-gap=')) {
            options.minGap = nonNegativeNumber(requiredValue(arg, '--min-gap='), '--min-gap');
            continue;
        }
        if (arg.startsWith('--precision=')) {
            options.precision = parsePrecision(requiredValue(arg, '--precision='));
            continue;
        }
        if (arg.startsWith('--max-per-current-sub-family=')) {
            options.maxPerCurrentSubFamily = positiveInteger(requiredValue(arg, '--max-per-current-sub-family='), '--max-per-current-sub-family');
            continue;
        }
        if (arg.startsWith('--max-per-pair=')) {
            options.maxPerPair = positiveInteger(requiredValue(arg, '--max-per-pair='), '--max-per-pair');
            continue;
        }
        throw new Error(`Unknown argument "${arg}". Run with --help for usage.`);
    }
    return options;
}
function requiredValue(arg, prefix) {
    const value = arg.slice(prefix.length).trim();
    if (!value) {
        throw new Error(`${prefix.slice(0, -1)} requires a value.`);
    }
    return value;
}
function positiveInteger(value, label) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`${label} must be a positive integer. Received "${value}".`);
    }
    return parsed;
}
function nonNegativeNumber(value, label) {
    const parsed = Number.parseFloat(value);
    if (!Number.isFinite(parsed) || parsed < 0) {
        throw new Error(`${label} must be a non-negative number. Received "${value}".`);
    }
    return parsed;
}
function parsePrecision(value) {
    if (value === 'high' || value === 'broad') {
        return value;
    }
    throw new Error(`--precision must be "high" or "broad". Received "${value}".`);
}
function roundScore(value) {
    const rounded = Number(value.toFixed(6));
    return Object.is(rounded, -0) ? 0 : rounded;
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/inspect-taxonomy-placements.js',
        `  [--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
        `  [--out=data/taxonomy-review/esco-leaf-placement-suspicious.${DEFAULT_ESCO_SOURCE_NAME}.csv]`,
        `  [--limit=${DEFAULT_LIMIT}]`,
        `  [--min-gap=${DEFAULT_MIN_GAP}]`,
        `  [--precision=${DEFAULT_PRECISION}|broad]`,
        `  [--max-per-current-sub-family=${DEFAULT_MAX_PER_CURRENT_SUB_FAMILY}]`,
        `  [--max-per-pair=${DEFAULT_MAX_PER_PAIR}]`,
        '',
        'Writes a review CSV of leaf occupations whose own labels/aliases fit another sub-family better than their current leave-one-out sub-family profile.',
        'High precision mode keeps only family-changing candidates with a distinct target occupation-head anchor. Broad mode is exploratory.',
        'This command is offline-only and does not mutate taxonomy overrides or runtime artifacts.'
    ].join('\n'));
}
main().catch((error) => {
    console.error('Taxonomy placement inspection failed.');
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
