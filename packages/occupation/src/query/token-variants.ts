import type { SupportedQueryLocale } from './query-preparation.js';

type TokenVariantRule = (token: string) => string[];

const EXPANDED_VARIANTS_CACHE = new Map<string, readonly string[]>();
const MATCH_VARIANTS_CACHE = new Map<string, readonly string[]>();

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

export function tokenMatchesLocaleVariant(token: string, values: Set<string>, locale: SupportedQueryLocale): boolean {
  for (const variant of localeMatchVariants(token, locale)) {
    if (values.has(variant)) {
      return true;
    }
  }

  return false;
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
