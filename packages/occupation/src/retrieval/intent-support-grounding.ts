import { isGenericQueryToken, type PreparedQuery } from '../query/query-preparation.js';
import { foldSearchText } from '../utils/texts.js';

const SUPPORTING_ALIAS_ROLES = new Set(['locale_supporting', 'english_backbone', 'family_supporting']);
const RETRIEVAL_GENERIC_HEAD_WRAPPERS = new Set(['personnel', 'personal']);

export function supportAliasGroundingTokens(preparedQuery: PreparedQuery): Set<string> {
  const roleHeadTokens = preparedQuery.intent.roleHeadTokens.map((token) => foldSearchText(token)).filter(Boolean);

  if (roleHeadTokens.length > 0) {
    return new Set(roleHeadTokens);
  }

  const roleTokens = preparedQuery.intent.roleTokens.map((token) => foldSearchText(token)).filter(Boolean);

  if (roleTokens.length > 0) {
    return new Set(roleTokens);
  }

  return new Set(genericHeadSensitiveGroundingTokens(preparedQuery));
}

export function groundedSupportingMatchedTokens(preparedQuery: PreparedQuery, matchedTokens: string[]): string[] {
  const groundingTokens = supportAliasGroundingTokens(preparedQuery);

  if (groundingTokens.size === 0) {
    return matchedTokens;
  }

  return matchedTokens.filter((token) => groundingTokens.has(foldSearchText(token)));
}

export function hasSupportAliasGrounding(preparedQuery: PreparedQuery, matchedTokens: string[]): boolean {
  const groundingTokens = supportAliasGroundingTokens(preparedQuery);

  if (groundingTokens.size === 0) {
    return true;
  }

  return matchedTokens.some((token) => groundingTokens.has(foldSearchText(token)));
}

export function isSupportingAliasRole(aliasRole: string): boolean {
  return SUPPORTING_ALIAS_ROLES.has(aliasRole);
}

export function shouldSuppressContextOnlySupportingAlias(
  aliasRole: string,
  matchedTokens: string[],
  preparedQuery: PreparedQuery
): boolean {
  return isSupportingAliasRole(aliasRole) && matchedTokens.length > 0 && !hasSupportAliasGrounding(preparedQuery, matchedTokens);
}

export function shouldSuppressContextOnlyLexicalMatch(preparedQuery: PreparedQuery, matchedTokens: string[]): boolean {
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

function genericHeadSensitiveGroundingTokens(preparedQuery: PreparedQuery): string[] {
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

function isRetrievalGenericHeadToken(token: string, preparedQuery: PreparedQuery): boolean {
  return isGenericQueryToken(token, preparedQuery.locale) || RETRIEVAL_GENERIC_HEAD_WRAPPERS.has(token);
}
