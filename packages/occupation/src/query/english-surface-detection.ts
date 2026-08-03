import type { OccupationIntentVocabularyLocale } from './query-intent.js';

export type OccupationSurfaceLocaleProfile = Pick<
  OccupationIntentVocabularyLocale,
  'roleHeadTerms' | 'roleModifierTerms' | 'domainModifierTerms' | 'credentialModifierTerms' | 'ambiguousModifierTerms'
>;

type SurfaceSignalCounts = {
  englishHits: number;
  englishRoleHeadHits: number;
  localeHits: number;
  localeRoleHeadHits: number;
};

export function isHighConfidenceEnglishSurfaceQueryFromProfiles(
  foldedTokens: readonly string[],
  englishProfile: OccupationSurfaceLocaleProfile,
  activeLocaleProfile: OccupationSurfaceLocaleProfile | null,
  intentConfidence: number
): boolean {
  const counts = countSurfaceSignalMatches(foldedTokens, englishProfile, activeLocaleProfile);

  return (
    counts.englishRoleHeadHits > 0 &&
    counts.localeRoleHeadHits === 0 &&
    counts.englishHits >= 2 &&
    counts.localeHits > 0 &&
    counts.englishHits > counts.localeHits &&
    intentConfidence >= 0.8
  );
}

export function isLikelyEnglishSurfaceQueryFromProfiles(
  foldedTokens: readonly string[],
  englishProfile: OccupationSurfaceLocaleProfile,
  activeLocaleProfile: OccupationSurfaceLocaleProfile | null,
  intentConfidence: number
): boolean {
  const counts = countSurfaceSignalMatches(foldedTokens, englishProfile, activeLocaleProfile);

  return (
    counts.englishRoleHeadHits > 0 &&
    counts.localeRoleHeadHits === 0 &&
    counts.englishHits >= 1 &&
    counts.englishHits > counts.localeHits &&
    intentConfidence >= 0.6
  );
}

function countSurfaceSignalMatches(
  foldedTokens: readonly string[],
  englishProfile: OccupationSurfaceLocaleProfile,
  activeLocaleProfile: OccupationSurfaceLocaleProfile | null
): SurfaceSignalCounts {
  if (foldedTokens.length < 2 || foldedTokens.length > 5) {
    return { englishHits: 0, englishRoleHeadHits: 0, localeHits: 0, localeRoleHeadHits: 0 };
  }

  if (!foldedTokens.every((token) => /^[a-z0-9]+$/u.test(token))) {
    return { englishHits: 0, englishRoleHeadHits: 0, localeHits: 0, localeRoleHeadHits: 0 };
  }

  const foldedTokenSet = new Set(foldedTokens);
  let englishHits = 0;
  let englishRoleHeadHits = 0;
  let localeHits = 0;
  let localeRoleHeadHits = 0;

  for (const term of englishProfile.roleHeadTerms) {
    if (foldedTokenSet.has(term)) {
      englishRoleHeadHits += 1;
      englishHits += 1;
    }
  }

  for (const term of englishProfile.roleModifierTerms) {
    if (foldedTokenSet.has(term)) {
      englishHits += 1;
    }
  }

  for (const term of englishProfile.domainModifierTerms) {
    if (foldedTokenSet.has(term)) {
      englishHits += 1;
    }
  }

  for (const term of englishProfile.credentialModifierTerms) {
    if (foldedTokenSet.has(term)) {
      englishHits += 1;
    }
  }

  for (const term of englishProfile.ambiguousModifierTerms) {
    if (foldedTokenSet.has(term)) {
      englishHits += 1;
    }
  }

  if (activeLocaleProfile) {
    for (const term of activeLocaleProfile.roleHeadTerms) {
      if (foldedTokenSet.has(term)) {
        localeRoleHeadHits += 1;
        localeHits += 1;
      }
    }

    for (const term of activeLocaleProfile.roleModifierTerms) {
      if (foldedTokenSet.has(term)) {
        localeHits += 1;
      }
    }

    for (const term of activeLocaleProfile.domainModifierTerms) {
      if (foldedTokenSet.has(term)) {
        localeHits += 1;
      }
    }

    for (const term of activeLocaleProfile.credentialModifierTerms) {
      if (foldedTokenSet.has(term)) {
        localeHits += 1;
      }
    }

    for (const term of activeLocaleProfile.ambiguousModifierTerms) {
      if (foldedTokenSet.has(term)) {
        localeHits += 1;
      }
    }
  }

  return { englishHits, englishRoleHeadHits, localeHits, localeRoleHeadHits };
}
