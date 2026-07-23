const REVIEWED_LEAF_SUB_FAMILY_OVERRIDES = [
    {
        sourceName: 'esco_1_2_1',
        leafNodeId: 15902,
        leafLabel: 'web designer',
        targetSubFamilyNodeId: 14805,
        targetSubFamilyLabel: 'Web and multimedia developers',
        targetFamilyNodeId: 14802,
        targetFamilyLabel: 'Software and applications developers and analysts',
        note: 'Web design belongs in the software/web development branch rather than graphic design.'
    }
];
const REVIEWED_SUB_FAMILY_FAMILY_OVERRIDES = [
    {
        sourceName: 'esco_1_2_1',
        subFamilyNodeId: 14939,
        subFamilyLabel: 'Chefs',
        targetFamilyNodeId: 14998,
        targetFamilyLabel: 'Cooks',
        note: 'Chefs align most directly with the cooking family rather than the broad artistic/cultural associate family.'
    },
    {
        sourceName: 'esco_1_2_1',
        subFamilyNodeId: 14825,
        subFamilyLabel: 'Psychologists',
        targetFamilyNodeId: 14759,
        targetFamilyLabel: 'Other health professionals',
        note: 'Psychologists align better with health professionals than social/religious professionals.'
    }
];
const LEAF_SUB_FAMILY_OVERRIDES_BY_SOURCE_AND_LEAF = new Map(REVIEWED_LEAF_SUB_FAMILY_OVERRIDES.map((override) => [
    overrideKey(override.sourceName, override.leafNodeId),
    override
]));
const SUB_FAMILY_FAMILY_OVERRIDES_BY_SOURCE_AND_SUB_FAMILY = new Map(REVIEWED_SUB_FAMILY_FAMILY_OVERRIDES.map((override) => [
    overrideKey(override.sourceName, override.subFamilyNodeId),
    override
]));
export function reviewedLeafSubFamilyOverrides() {
    return REVIEWED_LEAF_SUB_FAMILY_OVERRIDES;
}
export function reviewedSubFamilyFamilyOverrides() {
    return REVIEWED_SUB_FAMILY_FAMILY_OVERRIDES;
}
export function taxonomySubFamilyOverrideForLeaf(sourceName, leafNodeId) {
    return LEAF_SUB_FAMILY_OVERRIDES_BY_SOURCE_AND_LEAF.get(overrideKey(sourceName, leafNodeId)) ?? null;
}
export function taxonomyFamilyOverrideForSubFamily(sourceName, subFamilyNodeId) {
    if (subFamilyNodeId === null) {
        return null;
    }
    return SUB_FAMILY_FAMILY_OVERRIDES_BY_SOURCE_AND_SUB_FAMILY.get(overrideKey(sourceName, subFamilyNodeId)) ?? null;
}
export function applyReviewedTaxonomyOverridesToFields(sourceName, fields) {
    const leafOverride = taxonomySubFamilyOverrideForLeaf(sourceName, fields.graphNodeId);
    const withLeafOverride = leafOverride
        ? {
            ...fields,
            groupNodeId: leafOverride.targetSubFamilyNodeId,
            groupLabel: leafOverride.targetSubFamilyLabel,
            parentNodeId: leafOverride.targetSubFamilyNodeId,
            parentLabel: leafOverride.targetSubFamilyLabel,
            familyNodeId: leafOverride.targetFamilyNodeId,
            familyLabel: leafOverride.targetFamilyLabel
        }
        : fields;
    const familyOverride = taxonomyFamilyOverrideForSubFamily(sourceName, withLeafOverride.groupNodeId);
    if (!familyOverride || withLeafOverride.familyNodeId === familyOverride.targetFamilyNodeId) {
        return withLeafOverride;
    }
    return {
        ...withLeafOverride,
        familyNodeId: familyOverride.targetFamilyNodeId,
        familyLabel: familyOverride.targetFamilyLabel
    };
}
export function applyReviewedTaxonomyOverrides(sourceName, record) {
    const overridden = applyReviewedTaxonomyOverridesToFields(sourceName, record);
    const ancestors = overridden.ancestors;
    if (!ancestors) {
        return overridden;
    }
    return {
        ...overridden,
        ancestors: applyOverridesToAncestors(sourceName, record.graphNodeId, overridden, ancestors)
    };
}
function applyOverridesToAncestors(sourceName, graphNodeId, fields, ancestors) {
    const leafOverride = taxonomySubFamilyOverrideForLeaf(sourceName, graphNodeId);
    const familyOverride = taxonomyFamilyOverrideForSubFamily(sourceName, fields.groupNodeId);
    let nextAncestors = ancestors;
    if (leafOverride) {
        nextAncestors = replaceAncestor(nextAncestors, {
            graphNodeId: leafOverride.targetSubFamilyNodeId,
            canonicalLabel: leafOverride.targetSubFamilyLabel,
            nodeLevel: 'group',
            distanceFromLeaf: 1,
            ancestorRole: 'parent'
        });
        nextAncestors = replaceAncestor(nextAncestors, {
            graphNodeId: leafOverride.targetSubFamilyNodeId,
            canonicalLabel: leafOverride.targetSubFamilyLabel,
            nodeLevel: 'group',
            distanceFromLeaf: 1,
            ancestorRole: 'group'
        });
    }
    if (leafOverride || familyOverride) {
        nextAncestors = replaceAncestor(nextAncestors, {
            graphNodeId: fields.familyNodeId ?? 0,
            canonicalLabel: fields.familyLabel ?? '',
            nodeLevel: 'family',
            distanceFromLeaf: familyAncestorDistance(nextAncestors),
            ancestorRole: 'family'
        });
    }
    return nextAncestors
        .filter((ancestor) => ancestor.graphNodeId > 0 && ancestor.canonicalLabel.length > 0)
        .sort(compareAncestors);
}
function replaceAncestor(ancestors, replacement) {
    return [
        ...ancestors.filter((ancestor) => ancestor.ancestorRole !== replacement.ancestorRole),
        replacement
    ];
}
function familyAncestorDistance(ancestors) {
    return ancestors.find((ancestor) => ancestor.ancestorRole === 'family')?.distanceFromLeaf ?? 2;
}
function compareAncestors(left, right) {
    return (left.distanceFromLeaf - right.distanceFromLeaf ||
        ancestorRoleRank(left.ancestorRole) - ancestorRoleRank(right.ancestorRole) ||
        left.canonicalLabel.localeCompare(right.canonicalLabel) ||
        left.graphNodeId - right.graphNodeId);
}
function ancestorRoleRank(role) {
    switch (role) {
        case 'parent':
            return 0;
        case 'family':
            return 1;
        case 'group':
            return 2;
        default:
            return 3;
    }
}
function overrideKey(sourceName, nodeId) {
    return `${sourceName}:${nodeId}`;
}
