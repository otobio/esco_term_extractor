import { isGenericQueryToken } from '../query/query-preparation.js';
import { foldSearchText } from '../utils/texts.js';
const SUPPORTING_ALIAS_ROLES = new Set(['locale_supporting', 'english_backbone', 'family_supporting']);
const RETRIEVAL_GENERIC_HEAD_WRAPPERS = new Set(['personnel', 'personal']);
export function supportAliasGroundingTokens(preparedQuery) {
    const roleHeadTokens = preparedQuery.intent.roleHeadTokens.map((token) => foldSearchText(token)).filter(Boolean);
    // Some supporting-alias roles (e.g. english_backbone) carry English text even for non-English
    // queries -- fold in altRoleHeadTokens (the safe English equivalent of roleHeadTokens, resolved
    // once at intent-build time in query-intent.ts) so a curated cross-locale synonym still grounds
    // against that English evidence instead of being suppressed as ungrounded.
    if (roleHeadTokens.length > 0) {
        return new Set([...roleHeadTokens, ...preparedQuery.intent.altRoleHeadTokens]);
    }
    const roleTokens = preparedQuery.intent.roleTokens.map((token) => foldSearchText(token)).filter(Boolean);
    if (roleTokens.length > 0) {
        return new Set(roleTokens);
    }
    return new Set(genericHeadSensitiveGroundingTokens(preparedQuery));
}
export function groundedSupportingMatchedTokens(preparedQuery, matchedTokens) {
    const groundingTokens = supportAliasGroundingTokens(preparedQuery);
    if (groundingTokens.size === 0) {
        return matchedTokens;
    }
    return matchedTokens.filter((token) => groundingTokens.has(foldSearchText(token)));
}
export function hasSupportAliasGrounding(preparedQuery, matchedTokens) {
    const groundingTokens = supportAliasGroundingTokens(preparedQuery);
    if (groundingTokens.size === 0) {
        return true;
    }
    return matchedTokens.some((token) => groundingTokens.has(foldSearchText(token)));
}
export function isSupportingAliasRole(aliasRole) {
    return SUPPORTING_ALIAS_ROLES.has(aliasRole);
}
export function shouldSuppressContextOnlySupportingAlias(aliasRole, matchedTokens, preparedQuery) {
    return isSupportingAliasRole(aliasRole) && matchedTokens.length > 0 && !hasSupportAliasGrounding(preparedQuery, matchedTokens);
}
export function shouldSuppressContextOnlyLexicalMatch(preparedQuery, matchedTokens) {
    if (matchedTokens.length === 0) {
        return false;
    }
    const roleTokens = supportAliasGroundingTokens(preparedQuery);
    if (roleTokens.size === 0) {
        return false;
    }
    const domainTokens = new Set(preparedQuery.intent.domainTokens.map((token) => foldSearchText(token)).filter(Boolean));
    const foldedMatchedTokens = matchedTokens.map((token) => foldSearchText(token)).filter(Boolean);
    const matchedRoleCount = foldedMatchedTokens.filter((token) => roleTokens.has(token)).length;
    if (matchedRoleCount > 0) {
        return false;
    }
    const matchedDomainCount = foldedMatchedTokens.filter((token) => domainTokens.has(token)).length;
    return matchedDomainCount > 0;
}
function genericHeadSensitiveGroundingTokens(preparedQuery) {
    const foldedTokens = Array.from(new Set(preparedQuery.foldedTokens.map((token) => token.trim()).filter(Boolean)));
    if (foldedTokens.length !== 2) {
        return [];
    }
    const genericTokens = foldedTokens.filter((token) => isRetrievalGenericHeadToken(token, preparedQuery));
    if (genericTokens.length !== 1) {
        return [];
    }
    return Array.from(new Set(preparedQuery.usefulFoldedRecallTokens.filter((token) => token !== genericTokens[0])));
}
function isRetrievalGenericHeadToken(token, preparedQuery) {
    return isGenericQueryToken(token, preparedQuery.locale) || RETRIEVAL_GENERIC_HEAD_WRAPPERS.has(token);
}
