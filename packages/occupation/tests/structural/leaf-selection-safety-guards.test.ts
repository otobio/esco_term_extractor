import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { OccupationRuntimeContext } from '../../src/runtime/occupation-runtime-context.js';
import { OccupationSearchPipeline } from '../../src/search-pipeline/occupation-search-pipeline.js';

// Locks in two safety guards added to leaf selection this session, both aimed at the same failure
// mode: promoting a specific leaf the query never actually distinguished.
//
//   1. LEAF_SEPARATION_MARGIN / hasInsufficientLeafSeparation -- a general "competing leaf too
//      close" check, distinct from the narrower alias-tie / specialized-tie guards that existed
//      before. Applies within a single family.
//
//   2. isCollectiveOccupationalQuery -- "<domain> personnel/staff/workers/professionals/employees/
//      team" names a CATEGORY of occupations, not one occupation. hasBroadRoleLeafAuthority's
//      token-count heuristic can't catch this (a same-length wrong leaf like "security consultant"
//      passes it trivially), so this is a separate, English-only, raw-exact-match-gated check.
//
// Both guards are wired into isLeafSelectable AND the parallel
// selectExactLeafCanonicalOrAliasFullStringRescue promotion path -- tests here cover both entry
// points since a fix in only one previously let "bar staff" slip through the rescue path.

const SOURCE = 'esco_1_2_1';
let pipeline: OccupationSearchPipeline;

before(async () => {
  const runtime = await OccupationRuntimeContext.load({
    sourceName: SOURCE,
    retrievalBackend: 'binary-cache',
    aliasNgramLocales: ['en', 'ro', 'hu', 'et'],
    leafStructureRuntime: true
  });
  pipeline = OccupationSearchPipeline.withRuntime(runtime);
});

// -- Collective-occupational-noun queries: "<domain> personnel/staff/workers/..." should abstain
// to family, not manufacture a specific leaf off a same-family retrieval hit. --

for (const query of ['Security Personnel', 'Media Personnel', 'Medical Personnel', 'Sales Personnel', 'Kitchen Staff']) {
  test(`collective-noun query "${query}" does not manufacture an over-specific leaf`, async () => {
    const result = await pipeline.run({ query, locale: 'en', sourceName: SOURCE, limit: 20 });

    assert.notEqual(result.decision.decisionType, 'leaf');
  });
}

test('"Sales Personnel" does not resolve to the flagship over-specific leaf (call centre analyst)', async () => {
  const result = await pipeline.run({ query: 'Sales Personnel', locale: 'en', sourceName: SOURCE, limit: 20 });

  assert.notEqual(result.decision.selectedLabel, 'call centre analyst');
  assert.notEqual(result.decision.decisionType, 'leaf');
});

test('collective-noun guard also blocks the exact-alias full-string rescue path ("bar staff")', async () => {
  const result = await pipeline.run({ query: 'bar staff', locale: 'en', sourceName: SOURCE, limit: 20 });

  assert.notEqual(result.decision.decisionType, 'leaf');
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Waiters and bartenders');
});

test('collective-noun guard is English-only and does not suppress a clear single-occupation leaf', async () => {
  const result = await pipeline.run({ query: 'bartender', locale: 'en', sourceName: SOURCE, limit: 20 });

  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.decision.selectedLabel, 'bartender');
});

test('"personnel manager" is not a collective-noun query (collective word is not the final token)', async () => {
  const result = await pipeline.run({ query: 'personnel manager', locale: 'en', sourceName: SOURCE, limit: 20 });

  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.decision.selectedLabel, 'human resources manager');
});

test('"staff nurse" is not a collective-noun query (collective word is not the final token)', async () => {
  const result = await pipeline.run({ query: 'staff nurse', locale: 'en', sourceName: SOURCE, limit: 20 });

  assert.equal(result.decision.decisionType, 'leaf');
});

test('bare single-word "staff" does not manufacture a leaf', async () => {
  const result = await pipeline.run({ query: 'staff', locale: 'en', sourceName: SOURCE, limit: 20 });

  assert.notEqual(result.decision.decisionType, 'leaf');
});

// -- General leaf-separation guard: a genuine near-tie within one family should abstain to family,
// even when neither the alias-tie nor specialized-tie special-case shapes apply. --

test('near-tie sibling leaves within one family abstain to family ("hospital technician")', async () => {
  const result = await pipeline.run({ query: 'hospital technician', locale: 'en', sourceName: SOURCE, limit: 20 });

  assert.notEqual(result.decision.decisionType, 'leaf');
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Medical and pharmaceutical technicians');
});

test('a clear-winner leaf with no close in-family rival still resolves to leaf ("computer technician")', async () => {
  const result = await pipeline.run({ query: 'computer technician', locale: 'en', sourceName: SOURCE, limit: 20 });

  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.decision.selectedLabel, 'computer hardware repair technician');
});

test('a raw exact canonical match is exempt from the leaf-separation guard even with close siblings', async () => {
  const result = await pipeline.run({ query: 'bus driver', locale: 'en', sourceName: SOURCE, limit: 20 });

  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.decision.selectedLabel, 'bus driver');
  assert.equal(result.coverageStatus.status, 'exact_canonical_match');
});

// -- Regression sanity: prior exact-canonical / cross-family / localized behavior is untouched. --

test('exact canonical single-token leaf still resolves cleanly ("electrician")', async () => {
  const result = await pipeline.run({ query: 'electrician', locale: 'en', sourceName: SOURCE, limit: 20 });

  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.decision.selectedLabel, 'electrician');
});

test('cross-family strength trap still abstains to family ("factory manager")', async () => {
  const result = await pipeline.run({ query: 'factory manager', locale: 'en', sourceName: SOURCE, limit: 20 });

  assert.notEqual(result.decision.decisionType, 'leaf');
});

test('a specific compound-domain leaf still resolves despite sharing a head with the abstained case ("wood factory manager")', async () => {
  const result = await pipeline.run({ query: 'wood factory manager', locale: 'en', sourceName: SOURCE, limit: 20 });

  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.decision.selectedLabel, 'wood factory manager');
});

test('localized exact leaf resolution is unaffected by the English-only collective-noun guard ("director magazin", ro)', async () => {
  const result = await pipeline.run({ query: 'director magazin', locale: 'ro', sourceName: SOURCE, limit: 20 });

  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.decision.selectedLabel, 'department store manager');
});

test('localized ambiguous supervisor phrase still abstains to family ("supervizor restaurant", ro)', async () => {
  const result = await pipeline.run({ query: 'supervizor restaurant', locale: 'ro', sourceName: SOURCE, limit: 20 });

  assert.notEqual(result.decision.decisionType, 'leaf');
});

test('localized exact alias phrase still resolves to leaf ("Agent Servicii Client", ro)', async () => {
  const result = await pipeline.run({ query: 'Agent Servicii Client', locale: 'ro', sourceName: SOURCE, limit: 20 });

  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.decision.selectedLabel, 'customer service representative');
});

// -- Locale-agnostic guards: the leaf-separation margin and the raw-exact-canonical exemption are
// not English-only (unlike the collective-noun guard) -- they operate on the leaf/family evidence
// itself, not on locale-specific vocabulary. Confirmed directly in hu and et here, not just ro. --

test('raw-exact-canonical exemption from the leaf-separation guard is locale-agnostic (hu)', async () => {
  const result = await pipeline.run({ query: 'electrician', locale: 'hu', sourceName: SOURCE, limit: 20 });

  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.decision.selectedLabel, 'electrician');
});

test('raw-exact-canonical exemption from the leaf-separation guard is locale-agnostic (et)', async () => {
  const result = await pipeline.run({ query: 'electrician', locale: 'et', sourceName: SOURCE, limit: 20 });

  assert.equal(result.decision.decisionType, 'leaf');
  assert.equal(result.decision.selectedLabel, 'electrician');
});

test('a real hu query with several plausible sibling leaves abstains to family, not a guess ("ügyfélszolgálati munkatárs")', async () => {
  const result = await pipeline.run({
    query: 'ügyfélszolgálati munkatárs',
    locale: 'hu',
    sourceName: SOURCE,
    limit: 20
  });

  assert.notEqual(result.decision.decisionType, 'leaf');
  assert.equal(result.rankedFamilies[0]?.familyLabel, 'Client information workers');
});

// -- Bare generic-head guard (isBroadRoleQuery / resolution.md #16) across every supported locale's
// own generic-role vocabulary, not just English -- a bare generic-head word must never manufacture
// a specific leaf regardless of which locale's word list it came from. --

for (const [query, locale] of [
  ['specialist', 'ro'],
  ['technikus', 'hu'],
  ['szakember', 'hu'],
  ['tehnik', 'et'],
  ['spetsialist', 'et']
] as const) {
  test(`bare generic-head word "${query}" (${locale}) does not manufacture a leaf`, async () => {
    const result = await pipeline.run({ query, locale, sourceName: SOURCE, limit: 20 });

    assert.notEqual(result.decision.decisionType, 'leaf');
  });
}

// isCollectiveOccupationalQuery was English-only (see occupation-search-pipeline.ts); "personal
// medical" is the Romanian equivalent of "Medical Personnel". The guard now abstains to family
// for this query too, so this no longer needs recording as a known gap.
test('Romanian collective-noun equivalent abstains to family ("personal medical")', async () => {
  const result = await pipeline.run({ query: 'personal medical', locale: 'ro', sourceName: SOURCE, limit: 20 });

  assert.equal(result.decision.decisionType, 'family');
});
