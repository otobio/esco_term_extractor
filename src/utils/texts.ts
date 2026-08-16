export function normalizeSearchSurfaceText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ');
}

export function normalizeSearchText(value: string): string {
  return normalizeSearchSurfaceText(value).replace(/[\p{L}\p{N}]+/gu, (token) =>
    shouldPreserveAcronymToken(token) ? token : token.toLowerCase()
  );
}

export function foldSearchText(value: string): string {
  return normalizeSearchText(value).normalize('NFKD').replace(/\p{M}/gu, '');
}

export function foldSearchLookupText(value: string): string {
  return normalizeSearchSurfaceText(value).toLowerCase().normalize('NFKD').replace(/\p{M}/gu, '');
}

const WEAK_LOOKUP_PUNCTUATION = /[.,;:()[\]{}]+/gu;

export function foldWeakPunctuationLookupText(value: string): string {
  return foldSearchLookupText(value).replace(WEAK_LOOKUP_PUNCTUATION, ' ').replace(/\s+/gu, ' ').trim();
}

export function tokenizeNormalizedText(value: string): string[] {
  return value
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

export function tokenizeSurfaceText(value: string): string[] {
  return tokenizeNormalizedText(value);
}

export function isAcronymToken(token: string): boolean {
  const normalized = token.normalize('NFKC');
  return /^(?=.*\p{Lu})[\p{Lu}\p{N}]{2,5}$/u.test(normalized) && !COMMON_UPPERCASE_WORDS.has(normalized);
}

const COMMON_UPPERCASE_WORDS = new Set(['FAST', 'FOOD']);

function shouldPreserveAcronymToken(token: string): boolean {
  const normalized = token.normalize('NFKC');

  return isAcronymToken(normalized);
}
