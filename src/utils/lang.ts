import {
  hashVocabularyText,
  loadOccupationSignalVocabularyArtifactRequired,
  localeBitOrdinal,
  type OccupationSignalVocabularyArtifact
} from '../runtime/occupation-signal-vocabulary-artifact.js';
import { foldSearchText, tokenizeNormalizedText } from './texts.js';

const SIGNAL_VOCABULARY_ARTIFACT_CACHE = new Map<string, Promise<OccupationSignalVocabularyArtifact>>();

export const FUNCTION_WORDS_BY_LOCALE: Record<'en' | 'ro' | 'hu' | 'et' | 'unknown', Set<string>> = {
  en: new Set(['a', 'an', 'and', 'as', 'at', 'for', 'in', 'it', 'of', 'on', 'or', 'the', 'to', 'who', 'with']),
  ro: new Set(['a', 'al', 'ale', 'cu', 'de', 'din', 'in', 'la', 'o', 'pe', 'pentru', 'si', 'un', 'în', 'și']),
  hu: new Set(['a', 'az', 'egy', 'es', 'és', 'hogy', 'meg', 'vagy']),
  et: new Set(['ja', 'koos', 'ning', 'on', 'voi', 'või']),
  unknown: new Set()
};

async function loadSignalVocabularyArtifact(sourceName: string): Promise<OccupationSignalVocabularyArtifact> {
  const cachedArtifact = SIGNAL_VOCABULARY_ARTIFACT_CACHE.get(sourceName);

  if (cachedArtifact) {
    return cachedArtifact;
  }

  const artifactPromise = loadOccupationSignalVocabularyArtifactRequired(sourceName).then((entry) => entry.artifact);
  SIGNAL_VOCABULARY_ARTIFACT_CACHE.set(sourceName, artifactPromise);
  return artifactPromise;
}

export async function isEnglishWord(value: string, sourceName: string): Promise<boolean> {
  const artifact = await loadSignalVocabularyArtifact(sourceName);
  const tokens = tokenizeNormalizedText(foldSearchText(value));

  if (tokens.length !== 1) {
    return false;
  }

  const token = tokens[0];

  if (!token) {
    return false;
  }

  const tokenIndex = artifact.tokenHashes.indexOf(hashVocabularyText(token));
  const localeBit = localeBitOrdinal(artifact.locales, 'en');
  return (tokenIndex >= 0 && localeBit >= 0 && artifact.localeMask.has(tokenIndex, localeBit)) || FUNCTION_WORDS_BY_LOCALE.en.has(token);
}

export async function isEnglishQuery(value: string, sourceName: string): Promise<boolean> {
  const artifact = await loadSignalVocabularyArtifact(sourceName);
  const tokens = tokenizeNormalizedText(foldSearchText(value));

  if (tokens.length === 0) {
    return false;
  }

  const localeBit = localeBitOrdinal(artifact.locales, 'en');

  for (const token of tokens) {
    const tokenIndex = artifact.tokenHashes.indexOf(hashVocabularyText(token));

    if (tokenIndex < 0 || localeBit < 0 || !artifact.localeMask.has(tokenIndex, localeBit)) {
      if (FUNCTION_WORDS_BY_LOCALE.en.has(token)) {
        continue;
      }
      return false;
    }
  }

  return true;
}

export type CompoundSplitLocale = 'en' | 'ro' | 'hu' | 'et' | 'unknown';

// Locales whose compounding calls for vocabulary-driven splitting rather than a small curated word list.
const VOCABULARY_COMPOUND_SPLIT_LOCALES = new Set<CompoundSplitLocale>(['hu']);

export function usesVocabularyCompoundSplit(locale: CompoundSplitLocale): boolean {
  return VOCABULARY_COMPOUND_SPLIT_LOCALES.has(locale);
}

// Additive-only: tells the caller what a compound token WOULD split into, without touching any surface
// text itself. This exists because HU is a compounding language (e.g. "autószerelő" = "autó" + "szerelő",
// car + fitter) where a single surface token can carry a role head that only ever appears as a modifier
// prefix in ESCO's Hungarian aliases -- but rewriting the query surface to do this (as this used to work)
// runs upstream of curated phrase-atlas/exact-alias matching and can silently break it (e.g. "raktári
// munkatárs" becoming "raktári munka társ", because "munkatárs" -- an ordinary, non-compound word --
// happens to decompose into "munka" + "társ"). Callers append the result as extra lexical/intent tokens
// instead. Split parts are required to be tagged with `locale` (or English, ESCO's structural backbone
// locale) so a split can't succeed purely off cross-locale (e.g. Romanian/Estonian) token contamination.
const MIN_COMPOUND_PART_LENGTH = 4;

type CompoundPartEvidence = {
  attested: boolean;
  requestedLocale: boolean;
};

type CompoundSplitCandidate = {
  left: string;
  right: string;
  anchoredLength: number;
  attestedCount: number;
  balanceScore: number;
};

export async function splitVocabularyCompoundToken(token: string, locale: CompoundSplitLocale, sourceName: string): Promise<string[]> {
  const artifact = await loadSignalVocabularyArtifact(sourceName);
  return splitVocabularyCompoundTokenWithArtifact(token, locale, artifact);
}

// Preloads the vocabulary artifact once so a sync-only caller (e.g. artifact-build-time alias
// tokenization, which processes thousands of aliases without an event loop turn per lookup) can
// call splitVocabularyCompoundTokenWithArtifact directly instead of awaiting per-token.
export async function preloadVocabularyCompoundSplitArtifact(sourceName: string): Promise<OccupationSignalVocabularyArtifact> {
  return loadSignalVocabularyArtifact(sourceName);
}

export function splitVocabularyCompoundTokenWithArtifact(
  token: string,
  locale: CompoundSplitLocale,
  artifact: OccupationSignalVocabularyArtifact,
  options: { bypassWholeWordShortCircuit?: boolean } = {}
): string[] {
  if (token.length < 8) {
    return [];
  }

  // A token that is already attested as its own whole word (e.g. "személyzet" = "personnel") is usually
  // an ordinary word, not a genuine compound -- splitting it risks injecting nonsense fragments (e.g.
  // "szem" + "elyzet") as first-class tokens. Query-side callers feed split output directly into intent
  // classification (role head vs. modifier), where a bad split corrupts that query's own decision, so
  // they keep this guard. Alias-side callers (artifact-build-time tokenization) only append split output
  // as extra, additive search tokens on one alias -- low blast radius -- and bypass this guard, because
  // the words we most need to split (e.g. "kamionsofőr") are *themselves* already whole-word attested too
  // (they appear as real ESCO alias surfaces), so the guard would otherwise block them as well.
  if (!options.bypassWholeWordShortCircuit && artifact.tokenHashes.has(hashVocabularyText(token))) {
    return [];
  }

  const localeBit = localeBitOrdinal(artifact.locales, locale as 'en' | 'ro' | 'hu' | 'et');
  const enBit = localeBitOrdinal(artifact.locales, 'en');

  const getPartEvidence = (candidate: string): CompoundPartEvidence => {
    const tokenIndex = artifact.tokenHashes.indexOf(hashVocabularyText(candidate));

    if (tokenIndex < 0) {
      return { attested: false, requestedLocale: false };
    }

    const requestedLocale = localeBit >= 0 && artifact.localeMask.has(tokenIndex, localeBit);
    const isEnglish = enBit >= 0 && artifact.localeMask.has(tokenIndex, enBit);

    return { attested: requestedLocale || isEnglish, requestedLocale };
  };

  const candidates: CompoundSplitCandidate[] = [];

  for (let splitAt = MIN_COMPOUND_PART_LENGTH; splitAt <= token.length - MIN_COMPOUND_PART_LENGTH; splitAt += 1) {
    const left = token.slice(0, splitAt);
    const right = token.slice(splitAt);

    const leftEvidence = getPartEvidence(left);
    const rightEvidence = getPartEvidence(right);

    // A side "anchors" a split only when it is attested as the REQUESTED locale specifically --
    // an English-only attestation doesn't count, since that's cross-locale contamination, not
    // evidence of requested-locale compounding (locale === 'en' trivially anchors on either side).
    const leftAnchored = locale === 'en' ? leftEvidence.attested : leftEvidence.requestedLocale;
    const rightAnchored = locale === 'en' ? rightEvidence.attested : rightEvidence.requestedLocale;

    if (!leftAnchored && !rightAnchored) {
      continue;
    }

    // The anchored side must be independently recognized vocabulary; the OTHER side is allowed to be
    // out-of-vocabulary entirely (e.g. "sofor" in "kamionsofor") as long as it clears the minimum part
    // length enforced by the loop bounds above -- this is the common case of a real HU root word that
    // ESCO's own corpus never happens to use standalone.
    //
    // anchoredLength ranks the LONGEST confirmed requested-locale fragment first, ahead of any
    // English-attested or OOV consideration on the other side -- this is what stops a short coincidental
    // requested-locale match (e.g. HU "orok") from outranking a longer, more specific requested-locale
    // match elsewhere in the token.
    const anchoredLength = Math.max(leftAnchored ? left.length : 0, rightAnchored ? right.length : 0);
    const attestedCount = (leftEvidence.attested ? 1 : 0) + (rightEvidence.attested ? 1 : 0);
    const balanceScore = Math.min(left.length, right.length);

    candidates.push({ left, right, anchoredLength, attestedCount, balanceScore });
  }

  if (candidates.length === 0) {
    return [];
  }

  candidates.sort((a, b) => b.anchoredLength - a.anchoredLength || b.attestedCount - a.attestedCount || b.balanceScore - a.balanceScore);

  const [best, secondBest] = candidates;

  // Don't guess when two splits are equally plausible.
  if (
    secondBest &&
    secondBest.anchoredLength === best.anchoredLength &&
    secondBest.attestedCount === best.attestedCount &&
    secondBest.balanceScore === best.balanceScore
  ) {
    return [];
  }

  return [best.left, best.right];
}
