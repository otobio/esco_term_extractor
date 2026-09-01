import type { PreparedQuery, SupportedQueryLocale } from '../query/query-preparation.js';
import { tokenMatchesLocaleVariant } from '../query/token-variants.js';
import { foldSearchText, tokenizeNormalizedText } from '../utils/texts.js';
import type { LeafAuthorityKind, LeafSpecializationKind } from './occupation-leaf-structure-contract.js';
import type { RuntimeCapabilityRecord } from './occupation-search-meta-artifact.js';
import leafStructureSynonymsSeed from './seeds/occupation-leaf-structure-synonyms.json' with { type: 'json' };

export const LEAF_LEVEL_KINDS = ['none', 'assistant', 'junior', 'senior', 'lead', 'supervisor', 'manager', 'director', 'chief'] as const;
export type LeafLevelKind = (typeof LEAF_LEVEL_KINDS)[number];

export const LEAF_STRUCTURE_AUTHORITY_ORDER = leafStructureSynonymsSeed.leafStructureAuthorityOrder as Array<{
  token: string;
  kind: LeafAuthorityKind;
}>;

export const LEVEL_SPECIALIZATION_SYNONYMS = leafStructureSynonymsSeed.levelSpecializationSynonyms as Record<LeafLevelKind, string[]>;

export const ATOMIC_SPECIALIZATION_SYNONYMS = leafStructureSynonymsSeed.atomicSpecializationSynonyms as Record<
  LeafSpecializationKind,
  Record<string, string[]>
>;

// Flattened lookup map per specialization kind for rapid set-checking
function buildFlatKindSets(): Record<LeafSpecializationKind, Set<string>> {
  const result = {} as Record<LeafSpecializationKind, Set<string>>;
  for (const [kind, clusters] of Object.entries(ATOMIC_SPECIALIZATION_SYNONYMS)) {
    const tokens = new Set<string>();
    for (const aliases of Object.values(clusters)) {
      for (const alias of aliases) {
        tokens.add(foldSearchText(alias));
      }
    }
    result[kind as LeafSpecializationKind] = tokens;
  }
  return result;
}

export const LEAF_STRUCTURE_TOKENS_BY_KIND = buildFlatKindSets();

// Marker-equivalence groups: ATOMIC_SPECIALIZATION_SYNONYMS keys listed together here are treated as
// the SAME specific specialization value for alignment purposes (e.g. a leaf marked with the 'hotel'
// key and a query using a 'restaurant' word are the same venue). This used to be a separate flat table
// (LEAF_STRUCTURE_SPECIALIZATION_EQUIVALENCE_ROWS) of raw token rows, maintained independently of
// ATOMIC_SPECIALIZATION_SYNONYMS -- most of those rows turned out to be pure duplicates of one ATOMIC
// key's own alias list (e.g. ['shop','store','magazin','mall'] was already exactly
// ATOMIC_SPECIALIZATION_SYNONYMS.venue.shop). Folded into this smaller table so there is only ONE place
// that maintains locale/synonym vocabulary (ATOMIC_SPECIALIZATION_SYNONYMS); this table only records
// which otherwise-DISTINCT ATOMIC keys are additionally equivalent to each other -- see
// specializationKindAlignedWithQuery below, which now expands a key's full alias list (including any
// group it belongs to here) directly from ATOMIC_SPECIALIZATION_SYNONYMS instead of consulting a
// separately-curated row. A side effect: alignment now automatically benefits from every locale form
// ATOMIC already has for a key, even ones an old row never got around to copying in.
//
// WHY THIS MECHANISM EXISTS: a leaf carries a specialization kind (venue/product/population/channel)
// when its canonical label or alias contains one of the LEAF_STRUCTURE_TOKENS_BY_KIND words. If the
// query doesn't use that exact same word, the leaf's specific claim looks "unsupported" by the query and
// gets penalized (hasUnsupportedSpecialization in rank-family-leaves-core.ts) even when the query names
// the identical real-world thing in different vocabulary (store vs shop, phone vs telephone). This table
// is how that penalty gets waived correctly for genuinely distinct ATOMIC keys, instead of by loosening
// the check generally. Within ONE ATOMIC key, this waiving already happens for free -- no entry needed.
//
// WHEN THIS MECHANISM APPLIES: 'venue', 'product', 'population', and 'channel' are curated this way --
// each is a small, closed vocabulary (a few dozen words, mined from real canonical-label frequency in
// data/runtime-review/occupation-search-meta.esco_1_2_1.jsonl) that can be hand-grouped with confidence.
// 'task_focus' has a much larger, open-ended vocabulary where hand-grouped rows would be guesswork;
// that kind instead draws on real per-leaf capability data (specializationKindSupportedByCapabilities
// below), not curated synonym rows. 'industry_context' already has a more accurate signal (family-label
// token inherence, see industryContextInherentToFamily in rank-family-leaves-core.ts, plus the narrow
// venue-implies-industry mapping below) and doesn't need this either.
//
// HOW A GROUP (or a new ATOMIC key/alias) EARNS ITS PLACE -- same process as before the fold:
//   1. Mine real recurrence: grep/count the candidate word's actual frequency across canonicalLabel
//      in data/runtime-review/occupation-search-meta.esco_1_2_1.jsonl. A word that never or almost never
//      recurs in real ESCO labels doesn't get a token or a group -- one-off invented vocabulary is
//      exactly the kind of guesswork this mechanism is designed to avoid.
//   2. Group only genuine synonyms for the SAME specific real-world referent, not merely related or
//      adjacent concepts. "fruit" and "vegetable" are both food products but are NOT grouped together --
//      ESCO models "fruit and vegetable specialised seller" as leaves distinguishable by exactly this
//      difference, so merging them would destroy real signal ESCO itself encodes. Compare: "hotel" and
//      "restaurant" ARE merged, because ESCO's own canonical vocabulary blurs them (see the bakery/
//      restaurant blend already inside ATOMIC_SPECIALIZATION_SYNONYMS.venue.restaurant) -- the merge
//      reflects ESCO's modeling, not a convenience shortcut.
//   3. Verify with the CLI on a real query, not just by reading the code: run
//      `node dist/cli/rank-family-leaves-v2.js --family="..." --query="..." --locale=...` and confirm
//      the intended leaf actually outranks the generic/unrelated alternatives once the change is made.
//   4. Verify with both eval variants (`npm run rank:family-leaves:eval` and `-- --with-sibling-families=3`)
//      that overall/stable/developing pass counts hold or improve -- never regress -- before keeping a
//      change. A group that "fixes" one query but breaks another synonym grouping elsewhere is not a fix.
//   5. Prefer adding a golden test (search-pipeline/golden-suite.ts, PIPELINE_DEVELOPING_GOLDEN_CASES)
//      that isolates the new group's effect specifically -- a query where the win depends on the group
//      existing, not one that already wins on an exact alias match regardless.
//
// DO NOT: add a group, or fold two existing groups together, purely to make one specific query or one
// user-reported complaint pass, without doing steps 1-4 above. A group is a claim that two ATOMIC keys
// denote the same real-world thing across ESCO's entire vocabulary, not a query-specific patch -- treat
// every addition or merge here with the same scrutiny as adding a new taxonomy fact, because a wrong
// merge silently blunders search quality for every OTHER query that happens to use either key's words.
//
// Deliberately NOT merged despite a coincidental old row pairing them: 'device'+'audio' (the old row
// was really about the narrow phrase "musical instrument", not a claim that all device words and all
// audio words are interchangeable -- promoting it to a full key merge would let e.g. 'sensor' align with
// 'radio'), and 'beverage'+'food' (an old row bridged cocoa/chocolate with confectionery, but merging the
// whole beverage and food keys would let 'coffee' align with 'meat'). Both concepts already have a
// correct home in ATOMIC_SPECIALIZATION_SYNONYMS on their own; they just don't need to be equivalent.
const SPECIALIZATION_MARKER_EQUIVALENCE_GROUPS = leafStructureSynonymsSeed.specializationMarkerEquivalenceGroups as Partial<
  Record<LeafSpecializationKind, string[][]>
>;

// For every ATOMIC_SPECIALIZATION_SYNONYMS key, the full set of folded tokens that count as aligned
// with a leaf marked by that key -- the key's own alias list, plus (if it belongs to a group above) the
// alias lists of every other key in that group. Computed once at module load, not per comparison.
function buildKeyAlignedTokenSets(): Record<LeafSpecializationKind, Map<string, Set<string>>> {
  const result = {} as Record<LeafSpecializationKind, Map<string, Set<string>>>;

  for (const [kind, clusters] of Object.entries(ATOMIC_SPECIALIZATION_SYNONYMS)) {
    const groups = SPECIALIZATION_MARKER_EQUIVALENCE_GROUPS[kind as LeafSpecializationKind] ?? [];
    const map = new Map<string, Set<string>>();

    for (const key of Object.keys(clusters)) {
      const equivalenceGroup = groups.find((group) => group.includes(key)) ?? [key];
      const tokens = new Set<string>();

      for (const groupKey of equivalenceGroup) {
        const aliases = clusters[groupKey];
        if (!aliases) {
          throw new Error(
            `SPECIALIZATION_MARKER_EQUIVALENCE_GROUPS.${kind} references "${groupKey}", which is not a key in ATOMIC_SPECIALIZATION_SYNONYMS.${kind}`
          );
        }
        for (const alias of aliases) {
          tokens.add(foldSearchText(alias));
        }
      }

      map.set(key, tokens);
    }

    result[kind as LeafSpecializationKind] = map;
  }

  return result;
}

// Reverse lookup: folded token -> the ATOMIC_SPECIALIZATION_SYNONYMS key(s), per kind, whose alias list
// contains it. A token can belong to more than one key (a handful of ATOMIC entries already share a
// word, e.g. 'imbracaminte' sits in both product.clothing and product.textile) -- that pre-existing
// overlap is preserved, not deduplicated, here.
function buildMarkerKeyIndex(): Record<LeafSpecializationKind, Map<string, string[]>> {
  const result = {} as Record<LeafSpecializationKind, Map<string, string[]>>;

  for (const [kind, clusters] of Object.entries(ATOMIC_SPECIALIZATION_SYNONYMS)) {
    const index = new Map<string, string[]>();

    for (const [key, aliases] of Object.entries(clusters)) {
      for (const alias of aliases) {
        const folded = foldSearchText(alias);
        const keys = index.get(folded) ?? [];
        keys.push(key);
        index.set(folded, keys);
      }
    }

    result[kind as LeafSpecializationKind] = index;
  }

  return result;
}

const SPECIALIZATION_KEY_ALIGNED_TOKENS = buildKeyAlignedTokenSets();
const SPECIALIZATION_MARKER_KEY_INDEX = buildMarkerKeyIndex();

// Canonical-label contradiction rules.
//
// These groups are intentionally narrower than ATOMIC_SPECIALIZATION_SYNONYMS and
// SPECIALIZATION_MARKER_EQUIVALENCE_GROUPS. Those say "these tokens/keys can support the same value";
// contradiction groups say "if the query names one value and the visible canonical leaf label names
// another value in this group, those values should not both describe the same leaf". ATOMIC's own
// synonym clusters are usually too broad to reuse directly as a contradiction value (e.g.
// product.hardware bundles hardware/device/circuit/sensor/microelectronics, which this file treats as
// ALIGNED, not mutually exclusive) -- the exception is pharmacy_practice_context below, where the
// venue/population concepts genuinely are ATOMIC keys already decomposed to a safe single concept.
//
// A value is `string[][]`: an AND of "anchor groups", each anchor group an OR of interchangeable
// tokens (locale spellings included -- see below). Most values need only one anchor group (a plain
// OR-list of synonyms for one concept, e.g. ['backend', 'back-end']); a second anchor group is only
// added when one word alone is ambiguous within the same slot (e.g. distinguishing "office furniture"
// from "furniture, carpets and lighting equipment" needs both ['office'] and ['furniture']).
//
// A leaf or query can legitimately match MORE THAN ONE value in the same slot (e.g. "marine
// electronics technician" matches both the marine and the electronics values below) -- that is not a
// contradiction with itself. Matching is therefore disjoint-based: two sides contradict only when
// their matched-value sets share NO value at all, not merely when some pair of matched values differs
// (see canonicalLeafSpecializationContradictionCount below). Never go back to an any-pair-differs
// check -- it flags a false contradiction the instant either side matches two values in one slot.
//
// Locale variants are written directly alongside the English tokens in the same OR-list (matching the
// existing 'aeronava'/'spital' style below) -- the leaf side of a contradiction check is always English
// (ESCO canonical labels), only the query side needs the locale word, so one flat mixed-language list
// per value is simpler and sufficient. A locale word is added only when it unambiguously means the
// same specific value in that language; where a confident single-word translation was not available,
// the value is intentionally English-only rather than guessed -- read as coverage still to fill in.
//
// Expansion rules:
// - Use canonical leaf labels only. Do not use aliases or capabilities here; contradiction penalties
//   must be explainable from the result text callers can see.
// - Add only mutually exclusive values inside one title slot. If two values can plausibly co-exist
//   in one occupation title, do not put them in the same contradiction group.
// - Keep each synonym cluster small and concrete. Prefer adding a new group over broadening an
//   existing one when a term has multiple senses.
// - Add locale variants only after checking they preserve the same mutually-exclusive meaning.
// - Add a structural test for every new conflict group. These penalties are deliberately stronger
//   than unsupportedSpecialization, so an unsafe group can suppress correct leaves.
function contradictionValue(label: string, ...anchorGroups: string[][]): ContradictionValue {
  return { label, anchors: anchorGroups };
}

// A single mutually-exclusive value within a contradiction slot -- `label` is a short human-readable
// name for the value (used in debugging/reporting, e.g. "leaf matched 'dance', query matched 'art'"),
// `anchors` is the AND-of-OR token structure described above.
type ContradictionValue = { label: string; anchors: string[][] };

// otherContradictionGroups (software_surface, vehicle_powertrain_or_type, trade_goods_domain,
// technician_industry_domain, academic_subject_domain, therapist_modality_domain, artist_medium_domain,
// broker_market_domain, counsellor_specialty_domain, driver_vehicle_type_domain, pilot_aircraft_domain)
// is seeded fully-resolved from occupation-leaf-structure-synonyms.json's build script, which documents
// each group's rationale (ESCO family ids, decomposition rules).
const LEAF_CANONICAL_SPECIALIZATION_CONTRADICTION_GROUPS: Array<{
  slot: string;
  // Which LeafSpecializationKind this slot's contradiction/alignment counts against -- lets callers
  // (e.g. rank-family-leaves-core.ts's specialization buckets) check a specific kind such as
  // product/industry_context rather than only a leaf-wide contradiction count.
  kind: LeafSpecializationKind;
  values: ContradictionValue[];
}> = [
  ...(leafStructureSynonymsSeed.otherContradictionGroups as Array<{
    slot: string;
    kind: LeafSpecializationKind;
    values: ContradictionValue[];
  }>),
  {
    slot: 'pharmacy_practice_context',
    kind: 'industry_context',
    // Reused directly from ATOMIC_SPECIALIZATION_SYNONYMS rather than hand-copied: both concepts here
    // are already decomposed to one safe single concept in ATOMIC (unlike e.g. product.hardware, which
    // bundles several), so hand-maintaining a second, slightly-out-of-sync copy of the same alias list
    // added no value -- it only had 4-5 locale forms where ATOMIC already carries the fuller list.
    values: [
      contradictionValue('hospital', ATOMIC_SPECIALIZATION_SYNONYMS.venue.hospital),
      contradictionValue('community', ATOMIC_SPECIALIZATION_SYNONYMS.population.community)
    ]
  }
];

const FOLDED_CANONICAL_SPECIALIZATION_CONTRADICTION_GROUPS = LEAF_CANONICAL_SPECIALIZATION_CONTRADICTION_GROUPS.map((group) => ({
  slot: group.slot,
  kind: group.kind,
  values: group.values.map((value) => ({
    label: value.label,
    anchors: value.anchors.map((anchorGroup) => new Set(anchorGroup.map((token) => foldSearchText(token))))
  }))
}));

export function leafMarkerTokensForKind(kind: LeafSpecializationKind, tokens: Set<string>, locale: SupportedQueryLocale = 'en'): string[] {
  const tokenSet = LEAF_STRUCTURE_TOKENS_BY_KIND[kind];
  return Array.from(tokens).filter((token) => matchesTokenOrPlural(token, tokenSet, locale));
}

// Compares the leaf and query's matched values in every contradiction slot and classifies each slot
// into one of four outcomes (mirrors a query/leaf "specialization dimension" comparison without
// needing a separate profile type -- FOLDED_CANONICAL_SPECIALIZATION_CONTRADICTION_GROUPS already IS
// the set of dimensions that matter for contradiction/alignment purposes):
// - leaf matches nothing in the slot                        -> not counted (neutral; query specificity
//   the leaf doesn't speak to at all is unsupportedSpecialization's job, not this slot machinery's)
// - query matches nothing in the slot                       -> not counted (same reason, other side)
// - both match, and share at least one value                -> alignment (query says frontend, leaf
//   says frontend: reward it explicitly instead of scoring the same as "leaf has no opinion")
// - both match, and share no value at all                   -> contradiction (query says backend, leaf
//   says frontend: penalize; the disjoint check, not an any-pair-differs check, so a leaf legitimately
//   matching two values in one slot -- e.g. "marine electronics technician" -- isn't falsely flagged
//   the instant its second value doesn't happen to be the one word the query used)
// contradictionDetails/alignmentDetails carry the matched value labels (e.g. "leaf=dance,
// query=art") alongside each kind -- purely a debugging/reporting aid on top of the
// contradictionKinds/alignmentKinds counts that actually drive scoring; no existing caller needs to
// change to keep working.
export function canonicalLeafSpecializationSlotComparison(
  canonicalTokens: Set<string>,
  preparedQuery: PreparedQuery
): {
  contradictionCount: number;
  alignmentCount: number;
  contradictionKinds: LeafSpecializationKind[];
  alignmentKinds: LeafSpecializationKind[];
  contradictionDetails: Array<{ slot: string; kind: LeafSpecializationKind; leafLabels: string[]; queryLabels: string[] }>;
  alignmentDetails: Array<{ slot: string; kind: LeafSpecializationKind; labels: string[] }>;
} {
  const queryTokens = preparedQueryStructuralTokenSet(preparedQuery);
  let contradictionCount = 0;
  let alignmentCount = 0;
  const contradictionKinds: LeafSpecializationKind[] = [];
  const alignmentKinds: LeafSpecializationKind[] = [];
  const contradictionDetails: Array<{ slot: string; kind: LeafSpecializationKind; leafLabels: string[]; queryLabels: string[] }> = [];
  const alignmentDetails: Array<{ slot: string; kind: LeafSpecializationKind; labels: string[] }> = [];

  for (const group of FOLDED_CANONICAL_SPECIALIZATION_CONTRADICTION_GROUPS) {
    const leafValueIndexes = matchingContradictionValueIndexes(canonicalTokens, group.values);
    const queryValueIndexes = matchingContradictionValueIndexes(queryTokens, group.values, preparedQuery.locale);

    if (leafValueIndexes.length === 0 || queryValueIndexes.length === 0) {
      continue;
    }

    const sharedIndexes = leafValueIndexes.filter((leafIndex) => queryValueIndexes.includes(leafIndex));
    if (sharedIndexes.length > 0) {
      alignmentCount += 1;
      alignmentKinds.push(group.kind);
      alignmentDetails.push({ slot: group.slot, kind: group.kind, labels: sharedIndexes.map((i) => group.values[i].label) });
    } else {
      contradictionCount += 1;
      contradictionKinds.push(group.kind);
      contradictionDetails.push({
        slot: group.slot,
        kind: group.kind,
        leafLabels: leafValueIndexes.map((i) => group.values[i].label),
        queryLabels: queryValueIndexes.map((i) => group.values[i].label)
      });
    }
  }

  return { contradictionCount, alignmentCount, contradictionKinds, alignmentKinds, contradictionDetails, alignmentDetails };
}

export function canonicalLeafSpecializationContradictionCount(canonicalTokens: Set<string>, preparedQuery: PreparedQuery): number {
  return canonicalLeafSpecializationSlotComparison(canonicalTokens, preparedQuery).contradictionCount;
}

function matchingContradictionValueIndexes(
  tokens: Set<string>,
  values: Array<{ label: string; anchors: Set<string>[] }>,
  locale: SupportedQueryLocale = 'en'
): number[] {
  const indexes: number[] = [];

  values.forEach((value, index) => {
    if (value.anchors.every((anchorTokens) => hasAny(tokens, anchorTokens, locale))) {
      indexes.push(index);
    }
  });

  return indexes;
}

// True when a leaf's specific specialization marker (e.g. "shop") and a query token (e.g. "store")
// resolve to the same ATOMIC_SPECIALIZATION_SYNONYMS key (or two keys in the same
// SPECIALIZATION_MARKER_EQUIVALENCE_GROUPS group) -- i.e. the query names the same specific venue/etc.
// using different vocabulary, so the leaf should not be penalized for "not matching" a value it
// actually does match.
export function specializationKindAlignedWithQuery(
  kind: LeafSpecializationKind,
  canonicalTokens: Set<string>,
  preparedQuery: PreparedQuery
): boolean {
  return specializationKindAlignedWithQueryMatch(kind, canonicalTokens, preparedQuery) !== null;
}

// Debug-only variant of specializationKindAlignedWithQuery that also reports the leaf marker token
// and the query token it aligned with, so a "supported" verdict can be read back to the actual
// matched text instead of taken on faith.
export function specializationKindAlignedWithQueryMatch(
  kind: LeafSpecializationKind,
  canonicalTokens: Set<string>,
  preparedQuery: PreparedQuery
): { leafToken: string; queryToken: string } | null {
  const keyIndex = SPECIALIZATION_MARKER_KEY_INDEX[kind];
  const alignedTokensByKey = SPECIALIZATION_KEY_ALIGNED_TOKENS[kind];
  const markerTokens = leafMarkerTokensForKind(kind, canonicalTokens);

  if (markerTokens.length === 0) {
    return null;
  }

  const structuralTokens =
    kind === 'venue'
      ? new Set([...preparedQuery.intent.venueTokens, ...preparedQuery.intent.domainTokens].map((token) => foldSearchText(token)))
      : preparedQueryStructuralTokenSet(preparedQuery);

  for (const marker of markerTokens) {
    const keys = keyIndex.get(foldSearchText(marker)) ?? [];
    for (const key of keys) {
      const alignedTokens = alignedTokensByKey.get(key);
      if (alignedTokens === undefined) {
        continue;
      }
      const queryToken = Array.from(structuralTokens).find((token) => matchesTokenOrPlural(token, alignedTokens, preparedQuery.locale));
      if (queryToken !== undefined) {
        return { leafToken: marker, queryToken };
      }
    }
  }

  return null;
}

// Broad-level counterpart to specializationKindAlignedWithQueryMatch: true when the leaf carries a
// marker for `kind` (e.g. venue="shop"), the query ALSO names a specific ATOMIC_SPECIALIZATION_SYNONYMS
// value for the same kind (e.g. venue="hospital"), and those two values are not the same/equivalent key
// (specializationKindAlignedWithQueryMatch already covers the equivalent case). Unlike the narrow,
// curated FOLDED_CANONICAL_SPECIALIZATION_CONTRADICTION_GROUPS check, this reuses the full ATOMIC
// vocabulary already indexed for alignment, so it needs no separate hand-maintained group list -- any
// two distinct keys under the same kind are read as mutually exclusive values of that kind.
export function specializationKindContradictedByQueryMatch(
  kind: LeafSpecializationKind,
  canonicalTokens: Set<string>,
  preparedQuery: PreparedQuery
): { leafToken: string; queryToken: string } | null {
  const keyIndex = SPECIALIZATION_MARKER_KEY_INDEX[kind];
  const markerTokens = leafMarkerTokensForKind(kind, canonicalTokens);

  if (markerTokens.length === 0) {
    return null;
  }

  if (specializationKindAlignedWithQueryMatch(kind, canonicalTokens, preparedQuery) !== null) {
    return null;
  }

  const structuralTokens =
    kind === 'venue'
      ? new Set([...preparedQuery.intent.venueTokens, ...preparedQuery.intent.domainTokens].map((token) => foldSearchText(token)))
      : preparedQueryStructuralTokenSet(preparedQuery);

  for (const queryToken of structuralTokens) {
    if ((keyIndex.get(queryToken) ?? []).length > 0) {
      return { leafToken: markerTokens[0], queryToken };
    }
  }

  return null;
}

export function specializationKindContradictedByQuery(
  kind: LeafSpecializationKind,
  canonicalTokens: Set<string>,
  preparedQuery: PreparedQuery
): boolean {
  return specializationKindContradictedByQueryMatch(kind, canonicalTokens, preparedQuery) !== null;
}

// A query naming a specific venue often implies a specific industry without saying the industry word
// itself -- "clinic receptionist" names the medical industry via "clinic", not via "medical". This maps
// a handful of common, unambiguous venue words (across en/ro/hu) to the industry_context token(s) they
// imply, so a leaf like "front line medical receptionist" isn't penalized just because the query said
// the venue instead of the industry. Deliberately small and conservative -- industry_context's own
// detection/family-inherence check (industryContextInherentToFamily in rank-family-leaves-core.ts)
// stays untouched; this only adds one more way for a leaf's industry_context claim to be considered
// query-supported.
const VENUE_IMPLIES_INDUSTRY_CONTEXT = leafStructureSynonymsSeed.venueImpliesIndustryContext as Record<string, string[]>;

export function specializationKindImpliedByQueryVenue(
  kind: LeafSpecializationKind,
  canonicalTokens: Set<string>,
  preparedQuery: PreparedQuery
): boolean {
  if (kind !== 'industry_context') {
    return false;
  }

  const markerTokens = leafMarkerTokensForKind(kind, canonicalTokens);

  if (markerTokens.length === 0) {
    return false;
  }

  const structuralTokens = preparedQueryStructuralTokenSet(preparedQuery);
  return Array.from(structuralTokens).some((token) => {
    const impliedIndustries = Object.hasOwn(VENUE_IMPLIES_INDUSTRY_CONTEXT, token) ? VENUE_IMPLIES_INDUSTRY_CONTEXT[token] : undefined;
    if (!impliedIndustries) {
      return false;
    }
    return markerTokens.some((marker) =>
      impliedIndustries.some((industry) => ATOMIC_SPECIALIZATION_SYNONYMS.industry_context[industry]?.includes(marker))
    );
  });
}

// task_focus vocabulary is too large and open-ended to hand-group into equivalence groups the way
// venue was (see SPECIALIZATION_MARKER_EQUIVALENCE_GROUPS above) -- curated groups there would be
// guesswork. Real per-leaf ESCO skill/knowledge data (searchMetaArtifact.getCapabilityLabels) already
// carries this locale-by-locale for free, so instead of guessing synonyms, this checks whether the
// query's own words actually appear in what the leaf's real capability text says it does -- a leaf
// whose skills genuinely mention the query's task is legitimately supported, not exempted by hunch.
export function specializationKindSupportedByCapabilities(
  kind: LeafSpecializationKind,
  preparedQuery: PreparedQuery,
  capabilityLabels: RuntimeCapabilityRecord[]
): boolean {
  if ((kind !== 'task_focus' && kind !== 'industry_context') || capabilityLabels.length === 0) {
    return false;
  }

  const locale = preparedQuery.locale;
  const relevantLabels = capabilityLabels.filter((capability) => capability.localeCode === locale || capability.localeCode === 'en');
  const capabilityTokens = new Set(
    relevantLabels.flatMap((capability) => tokenizeNormalizedText(foldSearchText(capability.normalizedLabel || capability.label)))
  );

  if (capabilityTokens.size === 0) {
    return false;
  }

  const queryTokens = preparedQueryStructuralTokenSet(preparedQuery);
  if (kind === 'industry_context') {
    const impliedIndustryTokens = queryImpliedIndustryContextTokens(queryTokens);
    return (
      Array.from(queryTokens).some((token) => capabilityTokens.has(token) && LEAF_STRUCTURE_TOKENS_BY_KIND.industry_context.has(token)) ||
      Array.from(impliedIndustryTokens).some((token) => capabilityTokens.has(token))
    );
  }

  return Array.from(queryTokens).some((token) => capabilityTokens.has(token));
}

function queryImpliedIndustryContextTokens(queryTokens: Set<string>): Set<string> {
  const tokens = new Set<string>();

  for (const token of queryTokens) {
    const impliedIndustries = Object.hasOwn(VENUE_IMPLIES_INDUSTRY_CONTEXT, token) ? VENUE_IMPLIES_INDUSTRY_CONTEXT[token] : undefined;

    if (!impliedIndustries) {
      continue;
    }

    for (const industry of impliedIndustries) {
      for (const alias of ATOMIC_SPECIALIZATION_SYNONYMS.industry_context[industry] ?? []) {
        tokens.add(foldSearchText(alias));
      }
    }
  }

  return tokens;
}

export function detectLeafAuthorityKind(tokens: string[]): LeafAuthorityKind {
  for (const entry of LEAF_STRUCTURE_AUTHORITY_ORDER) {
    if (tokens.includes(entry.token)) {
      return entry.kind;
    }
  }

  return 'none';
}

export function detectLeafSpecializationKinds(tokens: Set<string>): LeafSpecializationKind[] {
  const kinds = new Set<LeafSpecializationKind>();
  for (const [kind, tokenSet] of Object.entries(LEAF_STRUCTURE_TOKENS_BY_KIND)) {
    if (hasAny(tokens, tokenSet)) {
      kinds.add(kind as LeafSpecializationKind);
    }
  }
  return Array.from(kinds).sort();
}

export function detectLeafLevelKind(tokens: Set<string>): LeafLevelKind {
  for (let index = LEAF_LEVEL_KINDS.length - 1; index > 0; index -= 1) {
    const kind = LEAF_LEVEL_KINDS[index];
    if (kind && tokensContainLevelKind(tokens, kind)) {
      return kind;
    }
  }

  return 'none';
}

// A leaf's authored specializationKinds can legitimately be empty (verified: none apply) or
// unclassified (never authored). Both look identical as `[]`. The cache disambiguates by remembering,
// per graphNodeId, whether we've already derived a value for an unclassified leaf this run: `Map.has()`
// false means "not yet computed," a cached `[]` means "computed, genuinely none derivable."
export function resolveLeafSpecializationKindsFromTokens(
  cache: Map<number, LeafSpecializationKind[]>,
  graphNodeId: number,
  structure: { specializationKinds: LeafSpecializationKind[] } | null,
  tokens: Set<string>
): LeafSpecializationKind[] {
  if (structure && structure.specializationKinds.length > 0) {
    return structure.specializationKinds;
  }

  const cached = cache.get(graphNodeId);
  if (cached !== undefined) {
    return cached;
  }

  const derived = detectLeafSpecializationKinds(tokens);
  cache.set(graphNodeId, derived);
  return derived;
}

export function resolveLeafSpecializationKinds(
  cache: Map<number, LeafSpecializationKind[]>,
  graphNodeId: number,
  structure: { specializationKinds: LeafSpecializationKind[] } | null,
  canonicalLabel: string
): LeafSpecializationKind[] {
  return resolveLeafSpecializationKindsFromTokens(cache, graphNodeId, structure, canonicalTokenSet(canonicalLabel));
}

// Folded once at module load -- LEVEL_SPECIALIZATION_SYNONYMS entries are static strings, so
// re-folding each one on every detectLeafLevelKind call (once per leaf, per query) was pure waste.
const FOLDED_LEVEL_SPECIALIZATION_SYNONYMS: Record<LeafLevelKind, Set<string>> = Object.fromEntries(
  Object.entries(LEVEL_SPECIALIZATION_SYNONYMS).map(([kind, aliases]) => [kind, new Set(aliases.map((alias) => foldSearchText(alias)))])
) as Record<LeafLevelKind, Set<string>>;

function tokensContainLevelKind(tokens: Set<string>, kind: LeafLevelKind): boolean {
  const foldedAliases = FOLDED_LEVEL_SPECIALIZATION_SYNONYMS[kind];
  for (const token of tokens) {
    if (foldedAliases.has(token)) {
      return true;
    }
  }
  return false;
}

export function preparedQueryStructuralTokenSet(preparedQuery: PreparedQuery): Set<string> {
  // Must include altRoleHeadTokens/altRoleModifierTokens (the curated cross-locale equivalents) --
  // otherwise a non-English query's specialization signal only shows up here when it happens to be
  // expressed in the query's own locale tokens, breaking specialization-kind alignment for RO/HU.
  return new Set(
    [
      ...preparedQuery.usefulFoldedRecallTokens,
      ...preparedQuery.intent.roleTokens,
      ...preparedQuery.intent.roleHeadTokens,
      ...preparedQuery.intent.altRoleHeadTokens,
      ...preparedQuery.intent.roleModifierTokens,
      ...preparedQuery.intent.altRoleModifierTokens,
      ...preparedQuery.intent.domainTokens,
      ...preparedQuery.intent.venueTokens
    ].map((token) => foldSearchText(token))
  );
}

export function preparedQueryRequestsAuthority(preparedQuery: PreparedQuery, authorityKind: LeafAuthorityKind): boolean {
  if (authorityKind === 'none') {
    return true;
  }

  const tokens = preparedQueryStructuralTokenSet(preparedQuery);
  return Array.from(tokens).includes(authorityKind);
}

// Discount family-level baseline noise tokens when evaluating query specializations
export function preparedQuerySpecializationTokensForFamily(preparedQuery: PreparedQuery, familySharedTokens: Set<string>): Set<string> {
  const queryTokens = preparedQueryStructuralTokenSet(preparedQuery);
  const specializationTokens = new Set<string>();

  for (const token of queryTokens) {
    if (!familySharedTokens.has(token)) {
      specializationTokens.add(token);
    }
  }

  return specializationTokens;
}

export function preparedQuerySupportsSpecializationKind(
  preparedQuery: PreparedQuery,
  kind: LeafSpecializationKind,
  familySharedTokens?: Set<string>
): boolean {
  const structuralTokens = familySharedTokens
    ? preparedQuerySpecializationTokensForFamily(preparedQuery, familySharedTokens)
    : preparedQueryStructuralTokenSet(preparedQuery);

  const kindTokens = LEAF_STRUCTURE_TOKENS_BY_KIND[kind];

  if (kind === 'venue') {
    return (
      preparedQuery.intent.venueTokens.length > 0 ||
      preparedQuery.intent.domainTokens.some((token) => kindTokens.has(foldSearchText(token)))
    );
  }

  return hasAny(structuralTokens, kindTokens, preparedQuery.locale);
}

export function canonicalTokenSet(label: string): Set<string> {
  return new Set(tokenizeNormalizedText(foldSearchText(label)));
}

// Specialization token sets are curated by hand, so they only ever list one grammatical form of a
// word (e.g. 'vehicle', but not the 'vehicles' that actually shows up in a canonical label like "motor
// vehicles parts advisor"). Rather than hand-duplicating an inflected entry for every noun, tolerate a
// morphological mismatch in either direction wherever these sets are matched against. Leaf-side tokens
// (canonical ESCO labels) are always English, so the plain trailing-s check covers them; query-side
// tokens can be RO/HU/ET, so those callers pass the query's locale to reuse the same masculine/feminine
// and singular/plural reduction rules token-variants.ts already maintains for retrieval matching.
function matchesTokenOrPlural(token: string, candidates: Set<string>, locale: SupportedQueryLocale = 'en'): boolean {
  if (candidates.has(token)) {
    return true;
  }

  if (locale !== 'en') {
    return tokenMatchesLocaleVariant(token, candidates, locale);
  }

  if (token.endsWith('s') && token.length > 3 && candidates.has(token.slice(0, -1))) {
    return true;
  }

  return !token.endsWith('s') && candidates.has(`${token}s`);
}

function hasAny(tokens: Set<string>, candidates: Set<string>, locale: SupportedQueryLocale = 'en'): boolean {
  for (const token of tokens) {
    if (matchesTokenOrPlural(token, candidates, locale)) {
      return true;
    }
  }

  return false;
}
