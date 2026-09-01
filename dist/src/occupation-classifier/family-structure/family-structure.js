import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { occupationFamilies } from '../../api/occupation-family-taxonomy.js';
import { LEAF_LEVEL_KINDS } from '../../runtime/occupation-leaf-structure-rules.js';
import { parseCsvRecords } from '../../utils/csv/parse-csv.js';
import { foldSearchText } from '../../utils/texts.js';
import { leafAuthorityLevelKindsContradict } from '../candidates.js';
import { buildQueryStructuralProfile } from '../preparation.js';
import { selectPrimaryRoleHead } from '../role-head-groups.js';
const FAMILY_STRUCTURE_SCHEMA_FILE = 'family-structure-rules.tsv';
const FAMILY_STRUCTURE_BRIDGES_FILE = 'family-structure-bridges.tsv';
const ROLE_HEADS_FILE = '../specialization/specialization-schema/specialization-role-heads.csv';
const BRIDGE_DIMENSIONS = [
    'channel',
    'industry',
    'knowledge_domain',
    'population',
    'product',
    'task',
    'venue',
    'work_object'
];
const DATA_DIMENSIONS = [
    'venue',
    'channel',
    'product',
    'population',
    'task',
    'industry',
    'knowledge_domain',
    'work_object'
];
const FAMILY_DIMENSION_EMPTY = new Set(['population']);
const CORE_CONTEXT_DIMENSIONS = new Set([
    'venue',
    'channel',
    'task',
    'industry',
    'product',
    'knowledge_domain',
    'work_object'
]);
const QUERY_ROLE_HEAD_EMPTY = new Set(['boss', 'leader', 'professional', 'personnel', 'staff']);
const BROAD_CONTEXT_ONLY_CONCEPT_IDS = new Set(['machine_work_object', 'manufacturing', 'process', 'processing', 'production']);
const FAMILY_CONTEXT_NEUTRAL_CONCEPT_IDS = new Set(['banking', 'team_industry']);
let cachedRules = null;
let cachedRulesById = null;
let cachedBridgeRules = null;
let cachedKnownRoleHeads = null;
let cachedKnownConceptIds = null;
let cachedRoleHeadFamilyCounts = null;
export function getFamilyStructureRules() {
    cachedRules ??= readFamilyStructureRules();
    return cachedRules;
}
export function getFamilyStructureRule(familyNodeId) {
    cachedRulesById ??= new Map(getFamilyStructureRules().map((rule) => [rule.familyNodeId, rule]));
    return cachedRulesById.get(familyNodeId);
}
// A role head that names only one family (e.g. "farmer") can never be mistaken for another family,
// so a bare match on it is safe to accept without domain evidence. A role head shared across several
// families (e.g. "chief", "officer", "manager") tells us nothing about which family is meant on its
// own -- accepting it without requiring matching domain/context concepts lets whichever unrelated
// family happens to be checked first win the query. This is computed from the rules themselves
// (rather than a hand-maintained list) so newly added role heads are covered automatically.
function isRoleHeadAmbiguousAcrossFamilies(roleHead) {
    if (!cachedRoleHeadFamilyCounts) {
        const counts = new Map();
        for (const rule of getFamilyStructureRules()) {
            for (const ruleRoleHead of rule.roleHeads) {
                counts.set(ruleRoleHead, (counts.get(ruleRoleHead) ?? 0) + 1);
            }
        }
        cachedRoleHeadFamilyCounts = counts;
    }
    return (cachedRoleHeadFamilyCounts.get(roleHead) ?? 0) > 1;
}
export function requireFamilyStructureRule(familyNodeId) {
    const rule = getFamilyStructureRule(familyNodeId);
    if (!rule) {
        throw new Error(`Missing classifier family structure rule for family id ${familyNodeId}.`);
    }
    return rule;
}
export function validateFamilyStructureRules() {
    const errors = [];
    const rules = getFamilyStructureRules();
    const taxonomyIds = new Set(occupationFamilies.map((family) => family.id));
    const seenIds = new Set();
    const levelKinds = new Set(LEAF_LEVEL_KINDS);
    const bridgeIds = new Set();
    for (const rule of rules) {
        if (!taxonomyIds.has(rule.familyNodeId)) {
            errors.push(`Family ${rule.familyNodeId} (${rule.familyLabel}) is not in occupationFamilies.`);
        }
        if (seenIds.has(rule.familyNodeId)) {
            errors.push(`Family ${rule.familyNodeId} appears more than once.`);
        }
        seenIds.add(rule.familyNodeId);
        if (rule.roleHeads.length === 0) {
            errors.push(`Family ${rule.familyNodeId} (${rule.familyLabel}) has no reusable role-head signal.`);
        }
        for (const roleHead of rule.roleHeads) {
            if (!knownRoleHeads().has(roleHead)) {
                errors.push(`Family ${rule.familyNodeId} (${rule.familyLabel}) uses unknown role head "${roleHead}".`);
            }
        }
        if (hasDuplicateValues(rule.roleHeads)) {
            errors.push(`Family ${rule.familyNodeId} (${rule.familyLabel}) has duplicate role heads.`);
        }
        for (const authority of rule.authorityLevels) {
            if (!levelKinds.has(authority)) {
                errors.push(`Family ${rule.familyNodeId} (${rule.familyLabel}) uses unknown authority level "${authority}".`);
            }
        }
        if (hasDuplicateValues(rule.authorityLevels)) {
            errors.push(`Family ${rule.familyNodeId} (${rule.familyLabel}) has duplicate authority levels.`);
        }
        if (!['specific', 'residual_when_no_specific_family', 'dictionary_gap_only'].includes(rule.residualPolicy)) {
            errors.push(`Family ${rule.familyNodeId} (${rule.familyLabel}) uses unknown residual policy "${rule.residualPolicy}".`);
        }
        for (const [dimension, conceptIds] of rule.conceptsByDimension) {
            for (const conceptId of conceptIds) {
                if (!knownConceptIds().has(conceptId)) {
                    errors.push(`Family ${rule.familyNodeId} (${rule.familyLabel}) uses unknown ${dimension} concept "${conceptId}".`);
                }
            }
            if (hasDuplicateValues(conceptIds)) {
                errors.push(`Family ${rule.familyNodeId} (${rule.familyLabel}) has duplicate ${dimension} concepts.`);
            }
        }
    }
    for (const family of occupationFamilies) {
        if (!seenIds.has(family.id)) {
            errors.push(`Family ${family.id} (${family.label}) has no classifier family structure rule.`);
        }
    }
    for (const bridgeRule of getFamilyStructureBridgeRules()) {
        if (!bridgeRule.bridgeId) {
            errors.push('A classifier family structure bridge has an empty bridge id.');
        }
        if (bridgeIds.has(bridgeRule.bridgeId)) {
            errors.push(`Classifier family structure bridge ${bridgeRule.bridgeId} appears more than once.`);
        }
        bridgeIds.add(bridgeRule.bridgeId);
        if (bridgeRule.queryRoleHeads.length === 0) {
            errors.push(`Classifier family structure bridge ${bridgeRule.bridgeId} has no query role heads.`);
        }
        if (bridgeRule.familyRoleHeads.length === 0) {
            errors.push(`Classifier family structure bridge ${bridgeRule.bridgeId} has no family role heads.`);
        }
        if (bridgeRule.requiresAnyDimension.length === 0) {
            errors.push(`Classifier family structure bridge ${bridgeRule.bridgeId} has no required dimension.`);
        }
        if (hasDuplicateValues(bridgeRule.queryRoleHeads)) {
            errors.push(`Classifier family structure bridge ${bridgeRule.bridgeId} has duplicate query role heads.`);
        }
        if (hasDuplicateValues(bridgeRule.familyRoleHeads)) {
            errors.push(`Classifier family structure bridge ${bridgeRule.bridgeId} has duplicate family role heads.`);
        }
        if (hasDuplicateValues(bridgeRule.requiresAnyDimension)) {
            errors.push(`Classifier family structure bridge ${bridgeRule.bridgeId} has duplicate required dimensions.`);
        }
        for (const roleHead of [...bridgeRule.queryRoleHeads, ...bridgeRule.familyRoleHeads]) {
            if (!knownRoleHeads().has(roleHead)) {
                errors.push(`Classifier family structure bridge ${bridgeRule.bridgeId} uses unknown role head "${roleHead}".`);
            }
        }
    }
    return {
        valid: errors.length === 0,
        errors
    };
}
export function assertValidFamilyStructureRules() {
    const result = validateFamilyStructureRules();
    if (!result.valid) {
        throw new Error(`Invalid classifier family structure rules:\n${result.errors.join('\n')}`);
    }
}
export function prepareFamilyStructureQuery(query) {
    const queryProfile = typeof query === 'string' ? buildQueryStructuralProfile(query) : query;
    return {
        roleHeads: getFamilyStructureQueryRoleHeads(queryProfile),
        authority: queryProfile.authority,
        conceptIdsByDimension: queryConceptIdsByDimension(queryProfile)
    };
}
export function gateFamilyStructureForQuery(family, query) {
    const rule = typeof family === 'number' ? requireFamilyStructureRule(family) : family;
    const preparedQuery = isPreparedFamilyStructureQuery(query) ? query : prepareFamilyStructureQuery(query);
    const queryRoleHeads = preparedQuery.roleHeads;
    const roleHeadMatched = intersect(queryRoleHeads, rule.roleHeads).length > 0;
    // A query role head that's just the authority word itself (e.g. "chief" resolved from a rank word
    // like Romanian "sef", with no other, more specific role head alongside it) adds no information
    // beyond what the authority comparison already captures. Treating it as a hard literal-role-head
    // mismatch when the family spells the same rank concept differently (e.g. Cooks' "head" for "head
    // chef") would reject a family the query is otherwise authority-compatible with -- so it's treated
    // as unknown, same as no role head at all, letting authority/concept evidence decide instead.
    const roleHeadIsBareAuthorityDuplicate = queryRoleHeads.length === 1 && queryRoleHeads[0] === preparedQuery.authority;
    const roleHeadUnknown = queryRoleHeads.length === 0 || roleHeadIsBareAuthorityDuplicate;
    const roleHeadsFullyCovered = queryRoleHeads.length <= 1 || queryRoleHeads.every((roleHead) => rule.roleHeads.includes(roleHead));
    const bridgeMatched = !roleHeadMatched && !roleHeadUnknown && findFamilyStructureRoleBridges(queryRoleHeads, preparedQuery, rule).length > 0;
    const authorityComparison = compareFamilyStructureAuthority(preparedQuery.authority, rule.authorityLevels);
    const conceptComparison = compareFamilyStructureConceptDimensions(preparedQuery, rule);
    const authorityRejected = authorityComparison.contradicted &&
        !(preparedQuery.authority !== 'none' && queryRoleHeads.includes(preparedQuery.authority) && rule.roleHeads.includes(preparedQuery.authority));
    const hardConceptRejected = (roleHeadMatched || bridgeMatched) && conceptComparison.contradictedDimensions.length > 0;
    const rejected = authorityRejected || hardConceptRejected || (!roleHeadMatched && !roleHeadUnknown && !bridgeMatched);
    const hasConceptSupport = conceptComparison.matchedConcepts.length > 0;
    // A query that supplies no concept evidence in any dimension (a bare "nurse" or "cook") can never
    // produce a matched concept -- there's nothing on the query side to match. Requiring matched-concept
    // support from a query that gave none would make every ambiguous role head unacceptable on its own,
    // no matter how information-free the query was. Only a query that DOES supply some concept evidence
    // needs that evidence to actually land a match.
    const queryHasAnyConceptEvidence = DATA_DIMENSIONS.some((dimension) => (preparedQuery.conceptIdsByDimension.get(dimension) ?? []).length > 0);
    const hasSpecificConceptSupport = !queryHasAnyConceptEvidence ||
        conceptComparison.matchedConcepts.some((match) => match.values.some((conceptId) => !BROAD_CONTEXT_ONLY_CONCEPT_IDS.has(conceptId)));
    const hasCoreContextSupport = !queryHasAnyConceptEvidence || conceptComparison.matchedConcepts.some((match) => CORE_CONTEXT_DIMENSIONS.has(match.dimension));
    const hasTaskCoverage = coversQueriedDimensionConcepts(preparedQuery, conceptComparison.matchedConcepts, 'task');
    const hasKnowledgeDomainCoverage = coversQueriedKnowledgeDomain(preparedQuery, conceptComparison.matchedConcepts);
    const roleMatchNeedsContext = roleHeadMatched && queryRoleHeads.length > 0 && queryRoleHeads.some((roleHead) => isRoleHeadAmbiguousAcrossFamilies(roleHead));
    const specificFamily = rule.residualPolicy === 'specific';
    const decision = rejected
        ? 'reject'
        : (bridgeMatched && specificFamily) ||
            (roleHeadMatched &&
                specificFamily &&
                roleHeadsFullyCovered &&
                (!roleMatchNeedsContext ||
                    (hasCoreContextSupport &&
                        hasSpecificConceptSupport &&
                        hasTaskCoverage &&
                        hasKnowledgeDomainCoverage)))
            ? 'accept'
            : hasConceptSupport || authorityComparison.matched
                ? 'partial'
                : 'unknown';
    return {
        familyNodeId: rule.familyNodeId,
        decision
    };
}
export function shortlistFamilyStructureMatches(query) {
    const preparedQuery = prepareFamilyStructureQuery(query);
    const comparisons = getFamilyStructureRules().map((rule) => gateFamilyStructureForQuery(rule, preparedQuery));
    return {
        accepted: comparisons.filter((comparison) => comparison.decision === 'accept' || comparison.decision === 'partial'),
        rejected: comparisons.filter((comparison) => comparison.decision === 'reject'),
        unknown: comparisons.filter((comparison) => comparison.decision === 'unknown')
    };
}
function readFamilyStructureRules() {
    return readTabSeparatedRows(FAMILY_STRUCTURE_SCHEMA_FILE, true).map((columns, index) => {
        if (columns.length !== 13) {
            throw new Error(`Invalid classifier family structure row ${index + 2}: expected 13 columns, got ${columns.length}.`);
        }
        const familyNodeId = Number.parseInt(columns[0] ?? '', 10);
        if (!Number.isInteger(familyNodeId) || familyNodeId <= 0) {
            throw new Error(`Invalid classifier family structure row ${index + 2}: invalid family id.`);
        }
        return {
            familyNodeId,
            familyLabel: columns[1] ?? '',
            roleHeads: parsePipeList(columns[2] ?? '').map(foldSearchText),
            authorityLevels: parsePipeList(columns[3] ?? ''),
            conceptsByDimension: new Map(DATA_DIMENSIONS.map((dimension, offset) => [dimension, parsePipeList(columns[4 + offset] ?? '')])),
            residualPolicy: (columns[12] ?? 'specific')
        };
    });
}
export function compareFamilyStructureAuthority(queryAuthority, familyAuthorities) {
    const matchedLevels = familyAuthorities.filter((authority) => !leafAuthorityLevelKindsContradict(queryAuthority, authority));
    const matched = matchedLevels.length > 0;
    return {
        matched,
        contradicted: !matched,
        matchedLevels: queryAuthority === 'none' ? [] : [queryAuthority]
    };
}
export function compareFamilyStructureConceptDimensions(query, rule) {
    const queryConceptIds = isPreparedFamilyStructureQuery(query) ? query.conceptIdsByDimension : queryConceptIdsByDimension(query);
    const matchedConcepts = [];
    const contradictedDimensions = [];
    const unknownDimensions = [];
    for (const dimension of DATA_DIMENSIONS) {
        const queryValues = queryConceptIds.get(dimension) ?? [];
        if (queryValues.length === 0) {
            continue;
        }
        const familyValues = rule.conceptsByDimension.get(dimension) ?? [];
        if (familyValues.length === 0 || FAMILY_DIMENSION_EMPTY.has(dimension)) {
            unknownDimensions.push(dimension);
            continue;
        }
        const matched = intersect(queryValues, familyValues);
        if (matched.length > 0) {
            matchedConcepts.push({ dimension, values: matched });
        }
        else if (dimension === 'venue' || dimension === 'channel' || dimension === 'industry') {
            unknownDimensions.push(dimension);
        }
        else {
            contradictedDimensions.push(dimension);
        }
    }
    return { matchedConcepts, contradictedDimensions, unknownDimensions };
}
function coversQueriedKnowledgeDomain(query, matchedConcepts) {
    const queryValues = query.conceptIdsByDimension.get('knowledge_domain') ?? [];
    if (queryValues.length === 0) {
        return true;
    }
    return matchedConcepts.some((match) => match.dimension === 'knowledge_domain' && match.values.length > 0);
}
function coversQueriedDimensionConcepts(query, matchedConcepts, dimension) {
    const queryValues = (query.conceptIdsByDimension.get(dimension) ?? []).filter((conceptId) => !FAMILY_CONTEXT_NEUTRAL_CONCEPT_IDS.has(conceptId));
    if (queryValues.length === 0) {
        return true;
    }
    const matchedValues = new Set(matchedConcepts.find((match) => match.dimension === dimension)?.values ?? []);
    return queryValues.every((conceptId) => matchedValues.has(conceptId));
}
export function findFamilyStructureRoleBridges(queryRoleHeads, query, rule) {
    const queryConceptIds = isPreparedFamilyStructureQuery(query) ? query.conceptIdsByDimension : queryConceptIdsByDimension(query);
    const bridges = [];
    for (const bridgeRule of getFamilyStructureBridgeRules()) {
        const queryRoleMatched = intersect(queryRoleHeads, bridgeRule.queryRoleHeads).length > 0;
        if (!queryRoleMatched) {
            continue;
        }
        const familyRoleMatched = intersect(rule.roleHeads, bridgeRule.familyRoleHeads).length > 0;
        if (!familyRoleMatched) {
            continue;
        }
        if (!queryRoleHeads.every((roleHead) => bridgeRule.queryRoleHeads.includes(roleHead) || rule.roleHeads.includes(roleHead))) {
            continue;
        }
        const concreteDimensionMatched = bridgeRule.requiresAnyDimension.some((dimension) => {
            const queryValues = queryConceptIds.get(dimension) ?? [];
            const familyValues = rule.conceptsByDimension.get(dimension) ?? [];
            return queryValues.length > 0 && intersect(queryValues, familyValues).length > 0;
        });
        if (concreteDimensionMatched) {
            bridges.push(bridgeRule.bridgeId);
        }
    }
    return bridges;
}
function queryConceptIdsByDimension(queryProfile) {
    const values = new Map();
    for (const concept of queryProfile.profile.concepts) {
        const dimensionValues = values.get(concept.dimension) ?? [];
        dimensionValues.push(concept.conceptId);
        values.set(concept.dimension, dimensionValues);
    }
    return new Map([...values.entries()].map(([dimension, conceptIds]) => [dimension, uniqueSorted(conceptIds)]));
}
export function getFamilyStructureQueryRoleHeads(queryProfile) {
    const roleHeads = uniqueSorted(queryProfile.profile.role_head.map(foldSearchText).filter((roleHead) => !QUERY_ROLE_HEAD_EMPTY.has(roleHead)));
    const primaryRoleHead = selectPrimaryRoleHead(roleHeads);
    return primaryRoleHead ? [primaryRoleHead] : [];
}
function isPreparedFamilyStructureQuery(query) {
    return typeof query === 'object' && query !== null && 'conceptIdsByDimension' in query;
}
function getFamilyStructureBridgeRules() {
    cachedBridgeRules ??= readFamilyStructureBridgeRules();
    return cachedBridgeRules;
}
function readFamilyStructureBridgeRules() {
    return readTabSeparatedRows(FAMILY_STRUCTURE_BRIDGES_FILE, true).map((columns, index) => {
        if (columns.length !== 4) {
            throw new Error(`Invalid classifier family structure bridge row ${index + 2}: expected 4 columns, got ${columns.length}.`);
        }
        const requiresAnyDimension = parseList(columns[3] ?? '');
        for (const dimension of requiresAnyDimension) {
            if (!BRIDGE_DIMENSIONS.includes(dimension)) {
                throw new Error(`Invalid classifier family structure bridge row ${index + 2}: unknown dimension "${dimension}".`);
            }
        }
        return {
            bridgeId: foldSearchText(columns[0] ?? ''),
            queryRoleHeads: uniqueSorted(parseList(columns[1] ?? '').map(foldSearchText)),
            familyRoleHeads: uniqueSorted(parseList(columns[2] ?? '').map(foldSearchText)),
            requiresAnyDimension
        };
    });
}
function knownRoleHeads() {
    cachedKnownRoleHeads ??= new Set(parseCsvRecords(readSchemaCsv(ROLE_HEADS_FILE))
        .map((row) => foldSearchText(value(row.role_head)))
        .filter(Boolean));
    return cachedKnownRoleHeads;
}
function knownConceptIds() {
    cachedKnownConceptIds ??= new Set(parseCsvRecords(readSchemaCsv('../specialization/specialization-schema/specialization-concept-rules.csv'))
        .map((row) => value(row.concept_id))
        .filter(Boolean));
    return cachedKnownConceptIds;
}
function readTabSeparatedRows(relativePath, hasHeader) {
    const localPath = join(dirname(fileURLToPath(import.meta.url)), relativePath);
    const sourcePath = resolve(process.cwd(), 'src/occupation-classifier/family-structure', relativePath);
    const path = existsSync(localPath) ? localPath : sourcePath;
    const rows = readFileSync(path, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => line.split('\t').map((value) => value.trim()));
    return hasHeader ? rows.slice(1) : rows;
}
function parseList(value) {
    return value
        .split(',')
        .map((item) => foldSearchText(item))
        .filter(Boolean);
}
function parsePipeList(value) {
    return value
        .split('|')
        .map((item) => foldSearchText(item))
        .filter(Boolean);
}
function readSchemaCsv(relativePath) {
    const localPath = join(dirname(fileURLToPath(import.meta.url)), relativePath);
    const sourcePath = resolve(process.cwd(), 'src/occupation-classifier/family-structure', relativePath);
    const path = existsSync(localPath) ? localPath : sourcePath;
    return readFileSync(path, 'utf8');
}
function value(input) {
    return typeof input === 'string' ? input.trim() : '';
}
function intersect(left, right) {
    const rightSet = new Set(right);
    return uniqueSorted(left.filter((value) => rightSet.has(value)));
}
function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort();
}
function hasDuplicateValues(values) {
    return new Set(values).size !== values.length;
}
