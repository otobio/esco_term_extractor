export const CANONICAL_ALIAS_ROLE = 'canonical_label';
export const FAMILY_SUPPORTING_ALIAS_ROLE = 'family_supporting';
export const DEFAULT_SEARCH_ALIAS_ROLES = new Set(['locale_primary', 'locale_supporting', 'reviewed_crosswalk']);
export function isSearchAliasRole(aliasRole, includeFamilySupportingAliases) {
    return DEFAULT_SEARCH_ALIAS_ROLES.has(aliasRole) || (includeFamilySupportingAliases && aliasRole === FAMILY_SUPPORTING_ALIAS_ROLE);
}
export function aliasRoleScoreFactor(aliasRole) {
    if (aliasRole === CANONICAL_ALIAS_ROLE || aliasRole === 'locale_primary') {
        return 1;
    }
    if (aliasRole === 'reviewed_crosswalk') {
        return 0.96;
    }
    if (aliasRole === 'locale_supporting') {
        return 0.92;
    }
    if (aliasRole === 'family_supporting') {
        return 0.78;
    }
    return 0.7;
}
