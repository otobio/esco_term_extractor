import { normalizeSearchText } from '../utils/texts.js';
import type { RuntimeAliasRecord } from './occupation-search-meta-artifact.js';
import reviewedAliasSeedsJson from './seeds/occupation-reviewed-alias-seeds.json' with { type: 'json' };

const ALIAS_ROLES = ['locale_primary', 'locale_supporting', 'reviewed_crosswalk', 'family_supporting', 'english_backbone'] as const;

type ReviewedAliasSeed = {
  sourceName: string;
  leafNodeId: number;
  leafLabel: string;
  locale: string;
  alias: string;
  aliasRole: (typeof ALIAS_ROLES)[number];
  weight: number;
  note?: string;
};

type AliasOverrideRecord = {
  graphNodeId: number;
  canonicalLabel: string;
  aliases: RuntimeAliasRecord[];
};

let cachedAliasSeeds: ReviewedAliasSeed[] | null = null;
let cachedAliasSeedsByKey: Map<string, ReviewedAliasSeed[]> | null = null;

export function reviewedAliasSeeds(): readonly ReviewedAliasSeed[] {
  return aliasSeeds();
}

export function applyReviewedAliasSeeds<T extends AliasOverrideRecord>(sourceName: string, record: T): T {
  const seeds = aliasSeedsByKey().get(overrideKey(sourceName, record.graphNodeId));

  if (!seeds || seeds.length === 0) {
    return record;
  }

  const existingKeys = new Set(record.aliases.map((alias) => aliasKey(alias.localeCode, alias.normalizedAlias)));
  const additions: RuntimeAliasRecord[] = [];

  for (const seed of seeds) {
    const normalizedAlias = normalizeSearchText(seed.alias);
    const key = aliasKey(seed.locale, normalizedAlias);

    if (existingKeys.has(key)) {
      continue;
    }

    existingKeys.add(key);
    additions.push({
      localeCode: seed.locale,
      alias: seed.alias,
      normalizedAlias,
      aliasRole: seed.aliasRole,
      isPrimary: seed.aliasRole === 'locale_primary',
      confidence: seed.weight,
      weight: seed.weight
    });
  }

  if (additions.length === 0) {
    return record;
  }

  return {
    ...record,
    aliases: [...record.aliases, ...additions]
  };
}

function aliasSeeds(): ReviewedAliasSeed[] {
  if (!cachedAliasSeeds) {
    const entries: unknown[] = Array.isArray(reviewedAliasSeedsJson) ? reviewedAliasSeedsJson : [];
    cachedAliasSeeds = entries.filter(isReviewedAliasSeed);
  }

  return cachedAliasSeeds;
}

function aliasSeedsByKey(): Map<string, ReviewedAliasSeed[]> {
  if (!cachedAliasSeedsByKey) {
    cachedAliasSeedsByKey = new Map();

    for (const seed of aliasSeeds()) {
      const key = overrideKey(seed.sourceName, seed.leafNodeId);
      const grouped = cachedAliasSeedsByKey.get(key) ?? [];
      grouped.push(seed);
      cachedAliasSeedsByKey.set(key, grouped);
    }
  }

  return cachedAliasSeedsByKey;
}

function aliasKey(locale: string, normalizedAlias: string): string {
  return `${locale}:${normalizedAlias}`;
}

function overrideKey(sourceName: string, leafNodeId: number): string {
  return `${sourceName}:${leafNodeId}`;
}

function isReviewedAliasSeed(value: unknown): value is ReviewedAliasSeed {
  return (
    isRecord(value) &&
    isNonEmptyString(value.sourceName) &&
    isPositiveInteger(value.leafNodeId) &&
    isNonEmptyString(value.leafLabel) &&
    isNonEmptyString(value.locale) &&
    isNonEmptyString(value.alias) &&
    isAliasRole(value.aliasRole) &&
    typeof value.weight === 'number' &&
    Number.isFinite(value.weight) &&
    (value.note === undefined || typeof value.note === 'string')
  );
}

function isAliasRole(value: unknown): value is (typeof ALIAS_ROLES)[number] {
  return typeof value === 'string' && (ALIAS_ROLES as readonly string[]).includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
