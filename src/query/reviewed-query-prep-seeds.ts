import type { SupportedQueryLocale } from './query-preparation.js';
import type { CommonRolePhraseEntry } from './common-role-phrase-atlas.js';
import type { FamilyAliasEntry } from './family-alias-atlas.js';
import type { OccupationNoiseRule, SupportedOccupationNoiseLocale } from './occupation-noise-peeling.js';
import reviewedCommonRolePhraseSeedsJson from '../runtime/seeds/occupation-reviewed-common-role-phrases.json' with { type: 'json' };
import reviewedFamilyAliasSeedsJson from '../runtime/seeds/occupation-reviewed-family-alias-anchors.json' with { type: 'json' };
import reviewedNoiseRuleSeedsJson from '../runtime/seeds/occupation-reviewed-noise-rules.json' with { type: 'json' };

type ReviewedCommonRolePhraseSeed = {
  locale: SupportedQueryLocale;
  surface: string;
  canonicalEnglish: string;
  roleKey: string;
  priority: number;
};

type ReviewedFamilyAliasSeed = {
  locale: SupportedQueryLocale;
  surface: string;
  canonicalEnglish: string;
  roleKey: string;
  priority: number;
};

type ReviewedNoiseRuleSeed = {
  locale: SupportedOccupationNoiseLocale;
  kind: OccupationNoiseRule['kind'];
  matchType: OccupationNoiseRule['matchType'];
  confidence: number;
  terms?: string[];
};

let cachedCommonRolePhrases: CommonRolePhraseEntry[] | null = null;
let cachedFamilyAliasAnchors: FamilyAliasEntry[] | null = null;
let cachedNoiseRules: ReviewedNoiseRuleSeed[] | null = null;

export function reviewedCommonRolePhraseEntries(): CommonRolePhraseEntry[] {
  if (!cachedCommonRolePhrases) {
    cachedCommonRolePhrases = parseCommonRolePhraseSeeds(reviewedCommonRolePhraseSeedsJson);
  }

  return cachedCommonRolePhrases;
}

export function reviewedFamilyAliasEntries(): FamilyAliasEntry[] {
  if (!cachedFamilyAliasAnchors) {
    cachedFamilyAliasAnchors = parseFamilyAliasSeeds(reviewedFamilyAliasSeedsJson);
  }

  return cachedFamilyAliasAnchors;
}

export function reviewedNoiseRules(locale: SupportedOccupationNoiseLocale): OccupationNoiseRule[] {
  if (!cachedNoiseRules) {
    cachedNoiseRules = parseNoiseRuleSeeds(reviewedNoiseRuleSeedsJson);
  }

  return cachedNoiseRules
    .filter((rule) => rule.locale === locale)
    .map((rule) => ({
      kind: rule.kind,
      matchType: rule.matchType,
      confidence: rule.confidence,
      terms: Array.isArray(rule.terms) ? [...rule.terms] : []
    }));
}

function parseCommonRolePhraseSeeds(value: unknown): CommonRolePhraseEntry[] {
  const entries = Array.isArray(value) ? value : [];

  return entries.filter(isReviewedCommonRolePhraseSeed).map((entry) => ({
    locale: entry.locale,
    surface: entry.surface,
    canonicalEnglish: entry.canonicalEnglish,
    roleKey: entry.roleKey,
    priority: entry.priority
  }));
}

function parseFamilyAliasSeeds(value: unknown): FamilyAliasEntry[] {
  const entries = Array.isArray(value) ? value : [];

  return entries.filter(isReviewedFamilyAliasSeed).map((entry) => ({
    locale: entry.locale,
    surface: entry.surface,
    canonicalEnglish: entry.canonicalEnglish,
    roleKey: entry.roleKey,
    priority: entry.priority
  }));
}

function parseNoiseRuleSeeds(value: unknown): ReviewedNoiseRuleSeed[] {
  const entries = Array.isArray(value) ? value : [];
  return entries.filter(isReviewedNoiseRuleSeed);
}

function isReviewedCommonRolePhraseSeed(value: unknown): value is ReviewedCommonRolePhraseSeed {
  return (
    isRecord(value) &&
    isSupportedQueryLocale(value.locale) &&
    isNonEmptyString(value.surface) &&
    isNonEmptyString(value.canonicalEnglish) &&
    isNonEmptyString(value.roleKey) &&
    isFinitePriority(value.priority)
  );
}

function isReviewedFamilyAliasSeed(value: unknown): value is ReviewedFamilyAliasSeed {
  return (
    isRecord(value) &&
    isSupportedQueryLocale(value.locale) &&
    isNonEmptyString(value.surface) &&
    isNonEmptyString(value.canonicalEnglish) &&
    isNonEmptyString(value.roleKey) &&
    isFinitePriority(value.priority)
  );
}

function isReviewedNoiseRuleSeed(value: unknown): value is ReviewedNoiseRuleSeed {
  return (
    isRecord(value) &&
    (value.locale === 'ro' || value.locale === 'hu') &&
    isNonEmptyString(value.kind) &&
    (value.matchType === 'phrase' || value.matchType === 'token') &&
    typeof value.confidence === 'number' &&
    Number.isFinite(value.confidence) &&
    (value.terms === undefined || (Array.isArray(value.terms) && value.terms.every(isNonEmptyString)))
  );
}

function isSupportedQueryLocale(value: unknown): value is SupportedQueryLocale {
  return value === 'en' || value === 'ro' || value === 'hu' || value === 'et' || value === 'unknown';
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isFinitePriority(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
