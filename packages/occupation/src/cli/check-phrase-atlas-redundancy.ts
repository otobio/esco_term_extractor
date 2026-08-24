import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
import { commonRolePhraseEntries } from '../query/common-role-phrase-atlas.js';
import { foldSearchText } from '../utils/texts.js';
import type { SupportedQueryLocale } from '../query/query-preparation.js';

const LOCALES: SupportedQueryLocale[] = ['ro', 'hu', 'et'];

async function main(): Promise<void> {
  const runtime = await OccupationRuntimeContext.load({ sourceName: DEFAULT_ESCO_SOURCE_NAME });
  const artifact = runtime.searchMetaArtifact;

  // Build, per locale, a map of folded alias text -> the set of canonical labels it's attached to
  // in the real ESCO/runtime alias data -- this is the actual "OOV dictionary" of known aliases,
  // as opposed to the curated phrase-atlas which hand-maps a surface to a canonical role.
  const aliasIndexByLocale = new Map<SupportedQueryLocale, Map<string, Set<string>>>();

  for (const locale of LOCALES) {
    aliasIndexByLocale.set(locale, new Map());
  }

  for (const record of artifact.getAllCoreRecords()) {
    const aliases = artifact.getAliases(record.graphNodeId);

    for (const alias of aliases) {
      // Exclude family-supporting aliases -- a generic crosswalk list shared verbatim across many
      // unrelated leaves in a family, so a match against it isn't evidence this specific phrase
      // is a genuine direct alias (see rank-family-leaves-core.ts's leafSpecificAliasLabels).
      if (alias.aliasRole === 'family_supporting') {
        continue;
      }

      const localeIndex = aliasIndexByLocale.get(alias.localeCode as SupportedQueryLocale);
      if (!localeIndex) {
        continue;
      }

      const folded = foldSearchText(alias.alias);
      const bucket = localeIndex.get(folded) ?? new Set<string>();
      bucket.add(record.canonicalLabel);
      localeIndex.set(folded, bucket);
    }
  }

  for (const locale of LOCALES) {
    const localeIndex = aliasIndexByLocale.get(locale)!;
    const entries = commonRolePhraseEntries(locale).filter((entry) => entry.locale === locale);
    const seenSurfaces = new Set<string>();

    for (const entry of entries) {
      if (seenSurfaces.has(entry.surface)) {
        continue;
      }
      seenSurfaces.add(entry.surface);

      const foldedSurface = foldSearchText(entry.surface);
      const matchingLabels = localeIndex.get(foldedSurface);

      if (!matchingLabels || matchingLabels.size === 0) {
        continue;
      }

      // Only flag when the alias is already attached to the SAME concept the phrase-atlas entry
      // maps to -- an alias attached to a different leaf is noise (mistagged ESCO data), not proof
      // that the manual entry is redundant.
      const foldedCanonicalEnglish = foldSearchText(entry.canonicalEnglish);
      const confirmedLabels = Array.from(matchingLabels).filter((label) => foldSearchText(label) === foldedCanonicalEnglish);

      if (confirmedLabels.length > 0) {
        console.log(
          `[redundant] locale=${locale} surface="${entry.surface}" role=${entry.roleKey} canonicalEnglish="${entry.canonicalEnglish}" -- already exists as a real alias for the same concept: ${confirmedLabels.join(' | ')}`
        );
      } else {
        console.log(
          `[mismatch]  locale=${locale} surface="${entry.surface}" role=${entry.roleKey} canonicalEnglish="${entry.canonicalEnglish}" -- alias exists but attached to a different leaf: ${Array.from(matchingLabels).join(' | ')}`
        );
      }
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
