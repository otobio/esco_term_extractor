import type { SupportedQueryLocale } from './query-preparation.js';
import { BoundedCache } from '../utils/cache.js';
import {
  isEnglishWord,
  splitVocabularyCompoundToken,
  splitVocabularyCompoundTokenWithArtifact,
  usesVocabularyCompoundSplit,
  type CompoundSplitLocale
} from '../utils/lang.js';
import type { OccupationSignalVocabularyArtifact } from '../runtime/occupation-signal-vocabulary-artifact.js';
import { foldSearchText } from '../utils/texts.js';
// Loaded directly from the seed (not from occupation-leaf-structure-rules.ts) to avoid a circular
// import -- that module already imports tokenMatchesLocaleVariant from this file.
import leafStructureSynonymsSeed from '../runtime/seeds/occupation-leaf-structure-synonyms.json' with { type: 'json' };

type TokenVariantRule = (token: string) => string[];

const COMPOUND_SPLIT_PARTS_BY_LOCALE: Record<SupportedQueryLocale, Set<string>> = {
  en: new Set(),
  ro: new Set(),
  // HU compound splitting is vocabulary-driven (see vocabularyCompoundSplit) rather than this curated
  // list, so it can recognize any real ESCO-derived HU/EN word pair, not just a hand-picked few.
  hu: new Set(),
  et: new Set(['andme', 'analuutik', 'analüütik', 'arendaja', 'insener', 'juht', 'opetaja', 'õpetaja', 'spetsialist', 'tarkvara']),
  unknown: new Set()
};

/**
 * Vocabulary-driven (HU) or curated-list (ET) compound-word splitting, shared by every consumer that
 * needs to decompose a compound token into its constituent parts — query intent classification, phrase-atlas
 * rewrite, and retrieval evidence (alias-ngram / family-profile) alike.
 */
export async function perTokenVocabularyCompoundSplits(
  tokens: string[],
  locale: SupportedQueryLocale,
  sourceName: string
): Promise<string[][] | null> {
  if (!usesVocabularyCompoundSplit(locale)) {
    return null;
  }

  return Promise.all(tokens.map((token) => splitVocabularyCompoundToken(token, locale, sourceName)));
}

export function reconstructCompoundExpandedSurface(tokens: string[], perTokenSplits: string[][] | null): string | null {
  if (!perTokenSplits?.some((parts) => parts.length > 0)) {
    return null;
  }

  return tokens.map((token, index) => (perTokenSplits[index]?.length > 0 ? perTokenSplits[index]?.join(' ') : token)).join(' ');
}

export async function splitCompoundTokens(tokens: string[], locale: SupportedQueryLocale, sourceName: string): Promise<string[]> {
  if (usesVocabularyCompoundSplit(locale)) {
    const splits = await Promise.all(tokens.map((token) => splitVocabularyCompoundToken(token, locale, sourceName)));
    return splits.flat();
  }

  const knownParts = COMPOUND_SPLIT_PARTS_BY_LOCALE[locale];

  if (knownParts.size === 0) {
    return [];
  }

  return tokens.flatMap((token) => splitCompoundToken(token, knownParts));
}

// Sync counterpart of splitCompoundTokens, for callers (artifact-build-time alias tokenization) that
// preload the vocabulary artifact once up front instead of awaiting a lookup per token/alias.
export function splitCompoundTokensWithArtifact(
  tokens: string[],
  locale: SupportedQueryLocale,
  artifact: OccupationSignalVocabularyArtifact
): string[] {
  if (usesVocabularyCompoundSplit(locale as CompoundSplitLocale)) {
    return tokens.flatMap((token) =>
      splitVocabularyCompoundTokenWithArtifact(token, locale as CompoundSplitLocale, artifact, { bypassWholeWordShortCircuit: true })
    );
  }

  const knownParts = COMPOUND_SPLIT_PARTS_BY_LOCALE[locale];

  if (knownParts.size === 0) {
    return [];
  }

  return tokens.flatMap((token) => splitCompoundToken(token, knownParts));
}

function splitCompoundToken(token: string, knownParts: Set<string>): string[] {
  if (knownParts.has(token) || token.length < 8) {
    return [];
  }

  for (const left of knownParts) {
    if (!token.startsWith(left) || left.length < 4) {
      continue;
    }

    const right = token.slice(left.length);

    if (knownParts.has(right) && right.length >= 4) {
      return [left, right];
    }
  }

  for (const right of knownParts) {
    if (!token.endsWith(right) || right.length < 4) {
      continue;
    }

    const left = token.slice(0, -right.length);

    if (knownParts.has(left) && left.length >= 4) {
      return [left, right];
    }
  }

  return [];
}

const EXPANDED_VARIANTS_CACHE = new BoundedCache<string, readonly string[]>(500);
const MATCH_VARIANTS_CACHE = new BoundedCache<string, readonly string[]>(500);

const TOKEN_VARIANT_RULES_BY_LOCALE: Record<SupportedQueryLocale, TokenVariantRule[]> = {
  en: [expandEnglishToken],
  ro: [expandRomanianToken],
  hu: [expandHungarianToken],
  et: [expandEstonianToken],
  unknown: []
};

const ROMANIAN_TOKEN_VARIANT_MAP = new Map<string, string[]>([
  ['achizitor', ['buyer']],
  ['agenti', ['agent']],
  ['agenți', ['agent']],
  ['asistenta', ['asistent']],
  ['asistente', ['asistent']],
  ['contabila', ['contabil']],
  ['contabile', ['contabil']],
  ['contabili', ['contabil']],
  ['dezvoltatoare', ['dezvoltator']],
  ['dezvoltatori', ['dezvoltator']],
  ['electricieni', ['electrician']],
  ['gestionara', ['gestionar']],
  ['instalatori', ['instalator']],
  ['lucratoare', ['lucrator']],
  ['lucratori', ['lucrator']],
  ['mecanici', ['mecanic']],
  ['medic', ['doctor', 'physician']],
  ['medici', ['medic', 'doctor', 'physician']],
  ['operatori', ['operator']],
  ['programatoare', ['programator']],
  ['programatori', ['programator']],
  ['profesoara', ['profesor']],
  ['profesoară', ['profesor']],
  ['profesoare', ['profesor']],
  ['receptionera', ['receptioner', 'receptionist']],
  ['receptionere', ['receptioner']],
  ['receptioer', ['receptioner']],
  ['registrator', ['records', 'registrar']],
  ['registratoare', ['records', 'registrar']],
  ['registratori', ['registrator', 'records', 'registrar']],
  ['responsabila', ['responsabil']],
  ['responsabile', ['responsabil']],
  ['sefi', ['sef']],
  ['șefi', ['șef']],
  ['soferi', ['sofer', 'driver']],
  ['șoferi', ['șofer', 'driver']],
  ['specialisti', ['specialist']],
  ['specialiști', ['specialist']],
  ['stivuitorist', ['forklift']],
  ['stivuitoristi', ['stivuitorist', 'forklift']],
  ['stivuitoriști', ['stivuitorist', 'forklift']],
  ['strungar', ['lathe']],
  ['strungari', ['strungar', 'lathe']],
  ['tehnicieni', ['tehnician']],
  ['vanzatoare', ['vanzator']],
  ['vanzatori', ['vanzator']],
  ['vanzatoarei', ['vanzator']],
  ['vânzătoare', ['vânzător']],
  ['vânzători', ['vânzător']]
]);

export function expandLocaleTokenVariants(token: string, locale: SupportedQueryLocale): string[] {
  const cacheKey = `${locale}\u0000${token}`;
  const cached = EXPANDED_VARIANTS_CACHE.get(cacheKey);

  if (cached) {
    return [...cached];
  }

  const expanded = new Set<string>([token]);
  const rules = TOKEN_VARIANT_RULES_BY_LOCALE[locale] ?? TOKEN_VARIANT_RULES_BY_LOCALE.unknown;

  for (const rule of rules) {
    for (const variant of rule(token)) {
      expanded.add(variant);
    }
  }

  const variants = Object.freeze(Array.from(expanded));
  EXPANDED_VARIANTS_CACHE.set(cacheKey, variants);
  return [...variants];
}

export function expandLocaleTokenVariantArray(tokens: string[], locale: SupportedQueryLocale): string[] {
  const expanded = new Set<string>();

  for (const token of tokens) {
    for (const variant of expandLocaleTokenVariants(token, locale)) {
      expanded.add(variant);
    }
  }

  return Array.from(expanded);
}

export function tokenMatchesLocaleVariant(token: string, values: ReadonlySet<string>, locale: SupportedQueryLocale): boolean {
  // Reduction rules are suffix-stripping only (e.g. ro "dezvoltatoare" -> "dezvoltator"), so they
  // resolve in that direction but not the reverse ("dezvoltator" never re-expands to
  // "dezvoltatoare"). Checking both directions makes the match symmetric regardless of which side
  // -- query token or title token -- happens to carry the longer inflected form.
  for (const variant of localeMatchVariants(token, locale)) {
    if (values.has(variant)) {
      return true;
    }
  }

  for (const value of values) {
    if (localeMatchVariants(value, locale).includes(token)) {
      return true;
    }
  }

  return false;
}

// otherContradictionGroups anchor-groups already mix English words with their ro/hu/et forms for the
// SAME specific concept (e.g. ['telecommunications', 'telecom', 'tavkozles', 'tavkozlesi',
// 'telekommunikatsioon']) -- they are curated multi-locale equivalence classes in their own right, on
// top of their primary job of contradiction anchoring. This indexes them once, at module load, purely
// for lookup by folded token -- the source data itself is untouched and keeps serving its original
// purpose unchanged.
//
// atomicSpecializationSynonyms clusters are deliberately NOT included here: some ATOMIC keys are
// narrow true-synonym sets (safe), but others (e.g. industry_context.business) are intentionally
// broad topic buckets for specialization DETECTION, lumping many non-synonymous concepts (sales,
// advertising, procurement, retail, ...) under one key -- fine for "does this query mention business
// context" but not for "these words mean the same thing." Contradiction anchor-groups are the only
// part of this data documented and enforced as narrow/mutually-exclusive, so they're the only safe
// source for a translation-equivalence lookup.
let leafStructureConceptGroupsCache: Array<ReadonlySet<string>> | null = null;

function leafStructureConceptGroups(): Array<ReadonlySet<string>> {
  if (leafStructureConceptGroupsCache) {
    return leafStructureConceptGroupsCache;
  }

  const groups: Array<ReadonlySet<string>> = [];
  const contradictionGroups = leafStructureSynonymsSeed.otherContradictionGroups as Array<{
    values: Array<{ anchors: string[][] }>;
  }>;

  for (const group of contradictionGroups) {
    for (const value of group.values) {
      for (const anchorGroup of value.anchors) {
        groups.push(new Set(anchorGroup.map((token) => foldSearchText(token))));
      }
    }
  }

  leafStructureConceptGroupsCache = groups;
  return groups;
}

// Per-(sourceName, token) result cache, filled lazily on first lookup only for tokens actually
// queried -- there are only a few dozen anchor-groups, so scanning them for a match is cheap, and it
// avoids precomputing an isEnglishWord classification for every token across every group (which would
// grow with the dataset regardless of whether a given token is ever looked up).
const LEAF_STRUCTURE_MODIFIER_TOKEN_CACHE = new Map<string, Map<string, readonly string[]>>();

async function englishEquivalentsForFoldedToken(folded: string, sourceName: string): Promise<readonly string[]> {
  let bySourceName = LEAF_STRUCTURE_MODIFIER_TOKEN_CACHE.get(sourceName);
  if (!bySourceName) {
    bySourceName = new Map();
    LEAF_STRUCTURE_MODIFIER_TOKEN_CACHE.set(sourceName, bySourceName);
  }

  const cached = bySourceName.get(folded);
  if (cached) {
    return cached;
  }

  let matchedGroup: ReadonlySet<string> | null = null;
  for (const group of leafStructureConceptGroups()) {
    if (group.has(folded)) {
      matchedGroup = group;
      break;
    }
  }

  if (!matchedGroup) {
    bySourceName.set(folded, []);
    return [];
  }

  const englishTerms: string[] = [];
  for (const candidate of matchedGroup) {
    // Candidates under 3 chars are never real English words in this vocabulary -- skip the
    // isEnglishWord lookup for them entirely rather than paying for it.
    if (candidate === folded || candidate.length < 3) {
      continue;
    }
    if (await isEnglishWord(candidate, sourceName)) {
      englishTerms.push(candidate);
    }
  }

  englishTerms.sort();
  bySourceName.set(folded, englishTerms);
  return englishTerms;
}

// Returns the safe English term(s) sharing a leaf-structure contradiction anchor-group with `token`
// -- e.g. ro "telecomunicatii" resolves to "telecommunications"/"telecom". This is a runtime lookup
// against the existing curated data, not a separate named translation list: there is nothing here to
// fall out of sync or to forget maintaining.
export async function englishModifierEquivalentsFromLeafStructure(
  token: string,
  locale: SupportedQueryLocale,
  sourceName: string
): Promise<readonly string[]> {
  if (locale === 'en') {
    return [];
  }

  const folded = foldSearchText(token);

  if (!folded) {
    return [];
  }

  return englishEquivalentsForFoldedToken(folded, sourceName);
}

function localeMatchVariants(token: string, locale: SupportedQueryLocale): string[] {
  const cacheKey = `${locale}\u0000${token}`;
  const cached = MATCH_VARIANTS_CACHE.get(cacheKey);

  if (cached) {
    return [...cached];
  }

  const variants = new Set<string>([token]);

  switch (locale) {
    case 'en': {
      for (const variant of englishReductionVariants(token)) {
        variants.add(variant);
      }
      break;
    }
    case 'ro': {
      for (const variant of romanianReductionVariants(token)) {
        variants.add(variant);
      }
      break;
    }
    case 'hu': {
      for (const variant of hungarianReductionVariants(token)) {
        variants.add(variant);
      }
      break;
    }
    case 'et': {
      for (const variant of estonianReductionVariants(token)) {
        variants.add(variant);
      }
      break;
    }
    default:
      break;
  }

  const matchVariants = Object.freeze(Array.from(variants));
  MATCH_VARIANTS_CACHE.set(cacheKey, matchVariants);
  return [...matchVariants];
}

// EN
function expandEnglishToken(token: string): string[] {
  if (token.length < 3) {
    return [];
  }

  if (isVisibleAcronymToken(token)) {
    return [];
  }

  if (token.endsWith('ies') && token.length > 4) {
    return [`${token.slice(0, -3)}y`];
  }

  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
    return [token.slice(0, -1)];
  }

  if (token.endsWith('y') && token.length > 3) {
    return [`${token.slice(0, -1)}ies`];
  }

  if (token.endsWith('er') && token.length > 3) {
    return [`${token.slice(0, -2)}or`];
  }

  if (token.endsWith('or') && token.length > 3) {
    return [`${token.slice(0, -2)}er`];
  }

  return [`${token}s`];
}

function englishReductionVariants(token: string): string[] {
  const variants = new Set<string>();

  if (token.endsWith('ies') && token.length > 4) {
    variants.add(`${token.slice(0, -3)}y`);
  }

  if (token.endsWith('s') && !token.endsWith('ss') && token.length > 3) {
    variants.add(token.slice(0, -1));
  }

  if (token.endsWith('er') && token.length > 3) {
    variants.add(`${token.slice(0, -2)}or`);
  }

  if (token.endsWith('or') && token.length > 3) {
    variants.add(`${token.slice(0, -2)}er`);
  }

  return Array.from(variants);
}

// RO
function expandRomanianToken(token: string): string[] {
  if (token.length < 4) {
    return [];
  }

  const variants = new Set<string>();

  for (const mappedVariant of ROMANIAN_TOKEN_VARIANT_MAP.get(token) ?? []) {
    variants.add(mappedVariant);
  }

  if (token.endsWith('i') && token.length > 4) {
    variants.add(token.replace(/i$/u, ''));
  }

  if (token.endsWith('e') && token.length > 4) {
    variants.add(token.slice(0, -1));
  }

  // Trade/shop noun -> agent noun (patiserie -> patiser, brutarie -> brutar). The "-rie" suffix
  // (borrowed from French "-erie") is the specific shop/trade-noun pattern -- a bare "-ie" suffix is
  // too broad and also strips unrelated words like "productie" ("product"), corrupting the equivalence
  // lookup with a spurious match.
  if (token.endsWith('rie') && token.length > 5) {
    variants.add(token.slice(0, -2));
  }

  if ((token.endsWith('a') || token.endsWith('ă')) && token.length > 5) {
    variants.add(token.slice(0, -1));
  }

  if (token.endsWith('oare') && token.length > 7) {
    variants.add(`${token.slice(0, -4)}or`);
  }

  if (token.endsWith('oarea') && token.length > 8) {
    variants.add(`${token.slice(0, -5)}or`);
  }

  if (token.endsWith('toare') && token.length > 7) {
    variants.add(`${token.slice(0, -5)}tor`);
  }

  if (token.endsWith('toarea') && token.length > 8) {
    variants.add(`${token.slice(0, -6)}tor`);
  }

  if (token.endsWith('ori') && token.length > 5) {
    variants.add(token.slice(0, -1));
  }

  if (token.endsWith('iste') && token.length > 6) {
    variants.add(`${token.slice(0, -1)}t`);
  }

  if (token.endsWith('istei') && token.length > 7) {
    variants.add(`${token.slice(0, -2)}t`);
  }

  if (!/[aeiă]$/u.test(token) && token.length > 4) {
    variants.add(`${token}i`);
  }

  return Array.from(variants).filter((variant) => variant !== token && variant.length >= 3);
}

function romanianReductionVariants(token: string): string[] {
  const variants = new Set<string>(ROMANIAN_TOKEN_VARIANT_MAP.get(token) ?? []);

  if (token.endsWith('i') && token.length > 4) {
    variants.add(token.replace(/i$/u, ''));
  }

  if (token.endsWith('e') && token.length > 4) {
    variants.add(token.slice(0, -1));
  }

  if ((token.endsWith('a') || token.endsWith('ă')) && token.length > 5) {
    variants.add(token.slice(0, -1));
  }

  if (token.endsWith('oare') && token.length > 7) {
    variants.add(`${token.slice(0, -4)}or`);
  }

  if (token.endsWith('oarea') && token.length > 8) {
    variants.add(`${token.slice(0, -5)}or`);
  }

  if (token.endsWith('toare') && token.length > 7) {
    variants.add(`${token.slice(0, -5)}tor`);
  }

  if (token.endsWith('toarea') && token.length > 8) {
    variants.add(`${token.slice(0, -6)}tor`);
  }

  if (token.endsWith('ori') && token.length > 5) {
    variants.add(token.slice(0, -1));
  }

  if (token.endsWith('iste') && token.length > 6) {
    variants.add(`${token.slice(0, -1)}t`);
  }

  if (token.endsWith('istei') && token.length > 7) {
    variants.add(`${token.slice(0, -2)}t`);
  }

  return Array.from(variants).filter((variant) => variant !== token && variant.length >= 3);
}

// HU
function expandHungarianToken(token: string): string[] {
  if (token.length < 4) {
    return [];
  }

  const variants = new Set<string>();

  if (token.endsWith('k') && token.length > 4) {
    variants.add(token.slice(0, -1));
  }

  if ((token.endsWith('ok') || token.endsWith('ek') || token.endsWith('ak') || token.endsWith('ök')) && token.length > 5) {
    variants.add(token.slice(0, -2));
  }

  if (!token.endsWith('k') && token.length > 4) {
    variants.add(`${token}k`);
  }

  return Array.from(variants).filter((variant) => variant !== token && variant.length >= 3);
}

function hungarianReductionVariants(token: string): string[] {
  const variants = new Set<string>();

  if (token.endsWith('k') && token.length > 4) {
    variants.add(token.slice(0, -1));
  }

  if ((token.endsWith('ok') || token.endsWith('ek') || token.endsWith('ak') || token.endsWith('ök')) && token.length > 5) {
    variants.add(token.slice(0, -2));
  }

  return Array.from(variants).filter((variant) => variant !== token && variant.length >= 3);
}

// ET
function expandEstonianToken(token: string): string[] {
  if (token.length < 4) {
    return [];
  }

  const variants = new Set<string>();

  if (token.endsWith('id') && token.length > 5) {
    variants.add(token.slice(0, -2));
  }

  if (token.endsWith('d') && token.length > 4) {
    variants.add(token.slice(0, -1));
  }

  if (!token.endsWith('d') && token.length > 4) {
    variants.add(`${token}d`);
  }

  return Array.from(variants).filter((variant) => variant !== token && variant.length >= 3);
}

function estonianReductionVariants(token: string): string[] {
  const variants = new Set<string>();

  if (token.endsWith('id') && token.length > 5) {
    variants.add(token.slice(0, -2));
  }

  if (token.endsWith('d') && token.length > 4) {
    variants.add(token.slice(0, -1));
  }

  return Array.from(variants).filter((variant) => variant !== token && variant.length >= 3);
}

function isVisibleAcronymToken(token: string): boolean {
  return /^[A-Z0-9]{2,}$/u.test(token);
}
