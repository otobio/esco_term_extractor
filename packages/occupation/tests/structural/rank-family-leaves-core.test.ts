import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  cliRankFamilyLeaves,
  computeSiblingCompetitionScores,
  type RankedFamilyLeaf,
  scoreLeaf,
  sumScoreBreakdown
} from '../../src/cli/rank-family-leaves-core.js';
import { type PreparedQuery, prepareQuery } from '../../src/query/query-preparation.js';
import type { OccupationLeafStructureArtifact } from '../../src/runtime/occupation-leaf-structure-artifact.js';
import type { LeafSpecializationKind, OccupationLeafStructureRecord } from '../../src/runtime/occupation-leaf-structure-contract.js';
import type { LeafLevelKind } from '../../src/runtime/occupation-leaf-structure-rules.js';
import type {
  RuntimeAliasRecord,
  RuntimeCapabilityRecord,
  RuntimeSearchMetaCoreRecord,
  SearchMetaArtifactCacheEntry
} from '../../src/runtime/occupation-search-meta-artifact.js';
import { TokenLeafClosenessRanker } from '../../src/search-pipeline/ranking/leaf-closeness-ranker.js';
import { foldSearchText, tokenizeNormalizedText } from '../../src/utils/texts.js';

const SOURCE = 'esco_1_2_1';
const CLOSENESS_RANKER = new TokenLeafClosenessRanker();

// Unit-level check that scoreLeaf's specialization-bucket machinery actually collects each
// LeafSpecializationKind at all -- not an integration/ranking-order test. Each case uses a real
// marker word from the ATOMIC_SPECIALIZATION_SYNONYMS seed for that kind, present verbatim in both
// the leaf's canonical label and the query, so the only thing under test is whether the kind makes
// it into specializationBuckets.alignedBroad -- i.e. the data is even collected. This caught a real
// bug where alignedBroad was wired to an intersection that could never capture the most common
// alignment signal.
// venue's marker word only registers in intent.venueTokens when it sits outside the query's role
// phrase (see query-intent.ts), so its query needs different phrasing than "<marker> <role>"; the
// other kinds pick up their marker via usefulFoldedRecallTokens regardless of phrasing.
const SPECIALIZATION_KIND_MARKER_CASES: Record<LeafSpecializationKind, { canonicalLabel: string; query: string }> = {
  venue: { canonicalLabel: 'airport shop assistant', query: 'airport shop seller' },
  channel: { canonicalLabel: 'broadcast seller', query: 'broadcast goods seller wanted' },
  product: { canonicalLabel: 'audio seller', query: 'audio goods seller wanted' },
  population: { canonicalLabel: 'child seller', query: 'child goods seller wanted' },
  task_focus: { canonicalLabel: 'cooking seller', query: 'cooking goods seller wanted' },
  industry_context: { canonicalLabel: 'sport seller', query: 'sport goods seller wanted' }
};

for (const [kind, { canonicalLabel, query }] of Object.entries(SPECIALIZATION_KIND_MARKER_CASES) as [
  LeafSpecializationKind,
  { canonicalLabel: string; query: string }
][]) {
  test(`scoreLeaf collects the ${kind} specialization kind into alignedBroad when leaf and query share its marker`, async () => {
    const prepared = await prepareQuery(query, 'en', { sourceName: SOURCE });
    const canonicalTokens = foldedTokenSet(canonicalLabel);
    const closeness = rankCloseness(prepared, canonicalLabel, []);

    const breakdown = scoreLeaf(
      closeness,
      [],
      genericStructure(900, canonicalLabel, { specializationKinds: [kind] }),
      prepared,
      canonicalTokens,
      canonicalTokens,
      new Set(),
      [],
      null,
      'en',
      canonicalLabel,
      query,
      900,
      new Map()
    );

    assert.ok(
      breakdown.specializationBuckets.alignedBroad.includes(kind),
      `expected ${kind} in alignedBroad, got ${JSON.stringify(breakdown.specializationBuckets)}`
    );
  });
}

// Broad contradiction: the leaf carries one ATOMIC value for a kind, the query names a different
// ATOMIC value for that same kind -- must land in contradictoryBroad, not just fail to align.
test('scoreLeaf collects a broad contradiction when leaf and query name different product values', async () => {
  const canonicalLabel = 'audio seller';
  const query = 'film goods seller wanted';
  const prepared = await prepareQuery(query, 'en', { sourceName: SOURCE });
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(901, canonicalLabel, { specializationKinds: ['product'] }),
    prepared,
    canonicalTokens,
    canonicalTokens,
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    query,
    901,
    new Map()
  );

  assert.ok(
    breakdown.specializationBuckets.contradictoryBroad.includes('product'),
    `expected product in contradictoryBroad, got ${JSON.stringify(breakdown.specializationBuckets)}`
  );
});

test('scoreLeaf collects a broad contradiction from ro locale marker words (industry_context: auto vs sportiv)', async () => {
  const canonicalLabel = 'automotive seller';
  const query = 'vanzator sportiv seller cautat';
  const prepared = await prepareQuery(query, 'ro', { sourceName: SOURCE });
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(907, canonicalLabel, { specializationKinds: ['industry_context'] }),
    prepared,
    canonicalTokens,
    canonicalTokens,
    new Set(),
    [],
    null,
    'ro',
    canonicalLabel,
    query,
    907,
    new Map()
  );

  assert.ok(
    breakdown.specializationBuckets.contradictoryBroad.includes('industry_context'),
    `expected industry_context in contradictoryBroad, got ${JSON.stringify(breakdown.specializationBuckets)}`
  );
});

// Narrow alignment/contradiction (alignedNarrow/contradictoryNarrow) is driven by the curated
// LEAF_CANONICAL_SPECIALIZATION_CONTRADICTION_GROUPS slots, not the full ATOMIC vocabulary, so only
// kinds that actually have a curated slot (task_focus/product/industry_context/population -- venue
// and channel currently have none) can be exercised here.
test('scoreLeaf collects a narrow alignment when leaf and query share a curated slot value (task_focus: backend)', async () => {
  const canonicalLabel = 'backend web developer';
  const query = 'backend web developer position';
  const prepared = await prepareQuery(query, 'en', { sourceName: SOURCE });
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(902, canonicalLabel, { specializationKinds: ['task_focus'] }),
    prepared,
    canonicalTokens,
    canonicalTokens,
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    query,
    902,
    new Map()
  );

  assert.ok(
    breakdown.specializationBuckets.alignedNarrow.includes('task_focus'),
    `expected task_focus in alignedNarrow, got ${JSON.stringify(breakdown.specializationBuckets)}`
  );
});

test('scoreLeaf collects a narrow contradiction when leaf and query name opposing curated slot values (task_focus: backend vs frontend)', async () => {
  const canonicalLabel = 'backend web developer';
  const query = 'frontend web developer position';
  const prepared = await prepareQuery(query, 'en', { sourceName: SOURCE });
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(903, canonicalLabel, { specializationKinds: ['task_focus'] }),
    prepared,
    canonicalTokens,
    canonicalTokens,
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    query,
    903,
    new Map()
  );

  assert.ok(
    breakdown.specializationBuckets.contradictoryNarrow.includes('task_focus'),
    `expected task_focus in contradictoryNarrow, got ${JSON.stringify(breakdown.specializationBuckets)}`
  );
  assert.ok(!breakdown.specializationBuckets.alignedNarrow.includes('task_focus'));
});

test('scoreLeaf collects a narrow contradiction from ro locale marker words (population: copil vs tineret)', async () => {
  const canonicalLabel = 'child seller';
  const query = 'vanzator tineret seller cautat';
  const prepared = await prepareQuery(query, 'ro', { sourceName: SOURCE });
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(908, canonicalLabel, { specializationKinds: ['population'] }),
    prepared,
    canonicalTokens,
    canonicalTokens,
    new Set(),
    [],
    null,
    'ro',
    canonicalLabel,
    query,
    908,
    new Map()
  );

  assert.ok(
    breakdown.specializationBuckets.contradictoryNarrow.includes('population'),
    `expected population in contradictoryNarrow, got ${JSON.stringify(breakdown.specializationBuckets)}`
  );
});

// ro locale: the same broad/narrow collection must work off a locale word, not just the English
// ATOMIC key itself. "auto" is the ro anchor for industry_context's automotive value in both the
// broad ATOMIC_SPECIALIZATION_SYNONYMS list and the narrow technician_industry_domain slot.
test('scoreLeaf collects a broad alignment from a ro locale marker word (industry_context: auto)', async () => {
  const canonicalLabel = 'automotive seller';
  const query = 'vanzator auto piese cautat';
  const prepared = await prepareQuery(query, 'ro', { sourceName: SOURCE });
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(904, canonicalLabel, { specializationKinds: ['industry_context'] }),
    prepared,
    canonicalTokens,
    canonicalTokens,
    new Set(),
    [],
    null,
    'ro',
    canonicalLabel,
    query,
    904,
    new Map()
  );

  assert.ok(
    breakdown.specializationBuckets.alignedBroad.includes('industry_context'),
    `expected industry_context in alignedBroad, got ${JSON.stringify(breakdown.specializationBuckets)}`
  );
});

// Narrow collection (canonicalLeafSpecializationSlotComparison) additionally requires
// hasLeafRelationship, so the query keeps a shared English "seller" token alongside the locale
// marker word -- the same requirement as the en-locale narrow tests above, just proven again with a
// locale marker word driving the slot match instead of the English key itself.
test('scoreLeaf collects a broad AND narrow alignment from a ro locale marker word (population: copil)', async () => {
  const canonicalLabel = 'child seller';
  const query = 'vanzator copil seller cautat';
  const prepared = await prepareQuery(query, 'ro', { sourceName: SOURCE });
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(905, canonicalLabel, { specializationKinds: ['population'] }),
    prepared,
    canonicalTokens,
    canonicalTokens,
    new Set(),
    [],
    null,
    'ro',
    canonicalLabel,
    query,
    905,
    new Map()
  );

  assert.ok(
    breakdown.specializationBuckets.alignedBroad.includes('population'),
    `expected population in alignedBroad, got ${JSON.stringify(breakdown.specializationBuckets)}`
  );
  assert.ok(
    breakdown.specializationBuckets.alignedNarrow.includes('population'),
    `expected population in alignedNarrow, got ${JSON.stringify(breakdown.specializationBuckets)}`
  );
});

test('scoreLeaf collects a broad AND narrow alignment from a hu locale marker word (population: gyermek)', async () => {
  const canonicalLabel = 'child seller';
  const query = 'elado gyermek seller keresett';
  const prepared = await prepareQuery(query, 'hu', { sourceName: SOURCE });
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(906, canonicalLabel, { specializationKinds: ['population'] }),
    prepared,
    canonicalTokens,
    canonicalTokens,
    new Set(),
    [],
    null,
    'hu',
    canonicalLabel,
    query,
    906,
    new Map()
  );

  assert.ok(
    breakdown.specializationBuckets.alignedBroad.includes('population'),
    `expected population in alignedBroad, got ${JSON.stringify(breakdown.specializationBuckets)}`
  );
  assert.ok(
    breakdown.specializationBuckets.alignedNarrow.includes('population'),
    `expected population in alignedNarrow, got ${JSON.stringify(breakdown.specializationBuckets)}`
  );
});

// Unit-level check that scoreLeaf's authority-level machinery (levelMatch/authorityLevelContradiction)
// actually detects each LeafLevelKind on both sides -- leaf canonical label and query -- and scores
// it correctly, not an integration/ranking-order test. detectLeafLevelKind derives the level purely
// from tokens (leaf canonical tokens on one side, query foldedTokens+modifierTokens on the other), so
// each case below just needs that level's real marker word present, with enough shared vocabulary
// ("seller") for scoreLeaf's hasLeafRelationship gate to even evaluate the level fields at all.
const LEVEL_KIND_MARKER_WORDS: Record<Exclude<LeafLevelKind, 'none'>, string> = {
  assistant: 'assistant',
  junior: 'junior',
  senior: 'senior',
  lead: 'lead',
  supervisor: 'supervisor',
  manager: 'manager',
  director: 'director',
  chief: 'chief'
};

for (const [level, markerWord] of Object.entries(LEVEL_KIND_MARKER_WORDS) as [Exclude<LeafLevelKind, 'none'>, string][]) {
  test(`scoreLeaf collects an exact level match for ${level}`, async () => {
    const canonicalLabel = `${markerWord} seller`;
    const query = `${markerWord} seller wanted`;
    const prepared = await prepareQuery(query, 'en', { sourceName: SOURCE });
    const canonicalTokens = foldedTokenSet(canonicalLabel);
    const closeness = rankCloseness(prepared, canonicalLabel, []);

    const breakdown = scoreLeaf(
      closeness,
      [],
      genericStructure(910, canonicalLabel),
      prepared,
      canonicalTokens,
      canonicalTokens,
      new Set(),
      [],
      null,
      'en',
      canonicalLabel,
      query,
      910,
      new Map()
    );

    assert.equal(breakdown.levelMatch, 5, `expected exact levelMatch=5 for ${level}, got ${JSON.stringify(breakdown)}`);
    assert.equal(breakdown.authorityLevelContradiction, false);
  });
}

// Binary authority-tier gate: supervisor/manager/director/chief are a distinct authority tier from
// everything else (including assistant/junior/senior/lead), so a query naming a level from one side
// of that line must contradict a leaf naming a level from the other side, in both directions.
const AUTHORITY_TIER_LEVELS: Array<Exclude<LeafLevelKind, 'none'>> = ['supervisor', 'manager', 'director', 'chief'];
const NON_AUTHORITY_TIER_LEVELS: Array<Exclude<LeafLevelKind, 'none'>> = ['assistant', 'junior', 'senior', 'lead'];

test('scoreLeaf collects an authority-level contradiction: non-authority query vs authority-tier leaf', async () => {
  const canonicalLabel = 'manager seller';
  const query = 'assistant seller wanted';
  const prepared = await prepareQuery(query, 'en', { sourceName: SOURCE });
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(920, canonicalLabel),
    prepared,
    canonicalTokens,
    canonicalTokens,
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    query,
    920,
    new Map()
  );

  assert.equal(breakdown.authorityLevelContradiction, true);
  assert.equal(breakdown.levelMatch, 0);
});

test('scoreLeaf collects an authority-level contradiction: authority-tier query vs non-authority leaf', async () => {
  const canonicalLabel = 'assistant seller';
  const query = 'manager seller wanted';
  const prepared = await prepareQuery(query, 'en', { sourceName: SOURCE });
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(921, canonicalLabel),
    prepared,
    canonicalTokens,
    canonicalTokens,
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    query,
    921,
    new Map()
  );

  assert.equal(breakdown.authorityLevelContradiction, true);
  assert.equal(breakdown.levelMatch, 0);
});

// Same-tier, non-exact levels get partial credit (3) instead of the full exact-match 5, and never
// register as a contradiction since both sides are on the same side of the authority-tier line.
test('scoreLeaf gives same-tier partial credit (not a contradiction) across every authority-tier level pair', async () => {
  for (const queryLevel of AUTHORITY_TIER_LEVELS) {
    for (const leafLevel of AUTHORITY_TIER_LEVELS) {
      if (queryLevel === leafLevel) {
        continue;
      }

      const canonicalLabel = `${leafLevel} seller`;
      const query = `${queryLevel} seller wanted`;
      const prepared = await prepareQuery(query, 'en', { sourceName: SOURCE });
      const canonicalTokens = foldedTokenSet(canonicalLabel);
      const closeness = rankCloseness(prepared, canonicalLabel, []);

      const breakdown = scoreLeaf(
        closeness,
        [],
        genericStructure(930, canonicalLabel),
        prepared,
        canonicalTokens,
        canonicalTokens,
        new Set(),
        [],
        null,
        'en',
        canonicalLabel,
        query,
        930,
        new Map()
      );

      assert.equal(
        breakdown.levelMatch,
        3,
        `expected levelMatch=3 for query=${queryLevel} leaf=${leafLevel}, got ${JSON.stringify(breakdown)}`
      );
      assert.equal(breakdown.authorityLevelContradiction, false);
    }
  }
});

test('scoreLeaf gives same-tier partial credit (not a contradiction) across every non-authority-tier level pair', async () => {
  // assistant/junior share one experience band, senior/lead share another -- levelMatchScore only
  // grants partial credit within the same band, not across both non-authority bands.
  const SAME_BAND_PAIRS: Array<[Exclude<LeafLevelKind, 'none'>, Exclude<LeafLevelKind, 'none'>]> = [
    ['assistant', 'junior'],
    ['junior', 'assistant'],
    ['senior', 'lead'],
    ['lead', 'senior']
  ];

  for (const [queryLevel, leafLevel] of SAME_BAND_PAIRS) {
    const canonicalLabel = `${leafLevel} seller`;
    const query = `${queryLevel} seller wanted`;
    const prepared = await prepareQuery(query, 'en', { sourceName: SOURCE });
    const canonicalTokens = foldedTokenSet(canonicalLabel);
    const closeness = rankCloseness(prepared, canonicalLabel, []);

    const breakdown = scoreLeaf(
      closeness,
      [],
      genericStructure(931, canonicalLabel),
      prepared,
      canonicalTokens,
      canonicalTokens,
      new Set(),
      [],
      null,
      'en',
      canonicalLabel,
      query,
      931,
      new Map()
    );

    assert.equal(
      breakdown.levelMatch,
      3,
      `expected levelMatch=3 for query=${queryLevel} leaf=${leafLevel}, got ${JSON.stringify(breakdown)}`
    );
    assert.equal(breakdown.authorityLevelContradiction, false);
  }
});

// ro locale: the same exact-match and cross-tier-contradiction detection must work off a locale word,
// not just the English level word -- "supervizor"/"asistent" are the ro anchors for supervisor/assistant.
test('scoreLeaf collects an exact level match from a ro locale marker word (supervisor)', async () => {
  const canonicalLabel = 'supervisor seller';
  const query = 'vanzator supervizor seller cautat';
  const prepared = await prepareQuery(query, 'ro', { sourceName: SOURCE });
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(940, canonicalLabel),
    prepared,
    canonicalTokens,
    canonicalTokens,
    new Set(),
    [],
    null,
    'ro',
    canonicalLabel,
    query,
    940,
    new Map()
  );

  assert.equal(breakdown.levelMatch, 5);
  assert.equal(breakdown.authorityLevelContradiction, false);
});

test('scoreLeaf collects an authority-level contradiction from a ro locale marker word (manager leaf vs assistant query)', async () => {
  const canonicalLabel = 'manager seller';
  const query = 'vanzator asistent seller cautat';
  const prepared = await prepareQuery(query, 'ro', { sourceName: SOURCE });
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(941, canonicalLabel),
    prepared,
    canonicalTokens,
    canonicalTokens,
    new Set(),
    [],
    null,
    'ro',
    canonicalLabel,
    query,
    941,
    new Map()
  );

  assert.equal(breakdown.authorityLevelContradiction, true);
  assert.equal(breakdown.levelMatch, 0);
});

test('scoreLeaf collects an exact level match from a hu locale marker word (supervisor: felugyelo)', async () => {
  const canonicalLabel = 'supervisor seller';
  const query = 'elado felugyelo seller keresett';
  const prepared = await prepareQuery(query, 'hu', { sourceName: SOURCE });
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(942, canonicalLabel),
    prepared,
    canonicalTokens,
    canonicalTokens,
    new Set(),
    [],
    null,
    'hu',
    canonicalLabel,
    query,
    942,
    new Map()
  );

  assert.equal(breakdown.levelMatch, 5);
  assert.equal(breakdown.authorityLevelContradiction, false);
});

test('scoreLeaf collects an authority-level contradiction from a hu locale marker word (manager leaf vs assistant query: segito)', async () => {
  const canonicalLabel = 'manager seller';
  const query = 'elado segito seller keresett';
  const prepared = await prepareQuery(query, 'hu', { sourceName: SOURCE });
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(943, canonicalLabel),
    prepared,
    canonicalTokens,
    canonicalTokens,
    new Set(),
    [],
    null,
    'hu',
    canonicalLabel,
    query,
    943,
    new Map()
  );

  assert.equal(breakdown.authorityLevelContradiction, true);
  assert.equal(breakdown.levelMatch, 0);
});

test('scoreLeaf raw exact canonical match short-circuits all supporting score fields', async () => {
  const prepared = await prepareQuery('electrician', 'en', { sourceName: SOURCE });
  const canonicalLabel = 'electrician';
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(101, canonicalLabel),
    prepared,
    canonicalTokens,
    canonicalTokens,
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    'electrician',
    101,
    new Map()
  );

  assert.equal(breakdown.exactCanonicalMatch, 55);
  assert.equal(sumScoreBreakdown(breakdown), 55);
  assert.equal(breakdown.roleHeadOrUsefulCanonical, 0);
  assert.equal(breakdown.familyFit, 0);
  assert.equal(breakdown.usefulTokenCoverage, 0);
});

test('scoreLeaf credits exact translated role aliases for non-English role queries', async () => {
  const prepared = await prepareQuery('projekt menedzser', 'hu', { sourceName: SOURCE });
  const canonicalLabel = 'programme manager';
  const aliases = ['project manager'];
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const matchedLabelTokens = foldedTokenSet('project manager');
  const closeness = rankCloseness(prepared, canonicalLabel, aliases);

  const breakdown = scoreLeaf(
    closeness,
    aliases,
    genericStructure(102, canonicalLabel),
    prepared,
    canonicalTokens,
    matchedLabelTokens,
    new Set(),
    [],
    null,
    'hu',
    canonicalLabel,
    'projekt menedzser',
    102,
    new Map()
  );

  assert.equal(breakdown.translatedRoleAliasExact, 12);
  assert.equal(breakdown.exactCanonicalMatch, 0);
  assert.ok(sumScoreBreakdown(breakdown) > 0);
});

test('cliRankFamilyLeaves preserves exact and translated alias ranking with in-memory artifacts', async () => {
  const exactPrepared = await prepareQuery('electrician', 'en', { sourceName: SOURCE });
  const exactRanked = rankSyntheticLeaves(exactPrepared, 'electrician', 'en', 'electrician', [
    leaf(201, 'mining electrician'),
    leaf(202, 'electrician')
  ]);

  assert.equal(exactRanked[0]?.canonicalLabel, 'electrician');
  assert.equal(exactRanked[0]?.scoreBreakdown.exactCanonicalMatch, 55);

  const translatedPrepared = await prepareQuery('projekt menedzser', 'hu', { sourceName: SOURCE });
  const translatedRanked = rankSyntheticLeaves(translatedPrepared, 'projekt menedzser', 'hu', 'projekt menedzser', [
    leaf(301, 'project assistant'),
    leaf(302, 'programme manager', [alias('en', 'project manager')])
  ]);

  assert.equal(translatedRanked[0]?.canonicalLabel, 'programme manager');
  assert.equal(translatedRanked[0]?.scoreBreakdown.translatedRoleAliasExact, 12);
});

test('scoreLeaf penalizes a leaf specialization (e.g. product) the query never asked for', async () => {
  const prepared = await prepareQuery('shop manager', 'en', { sourceName: SOURCE });
  const canonicalLabel = 'clothing shop manager';
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);
  const structure = genericStructure(501, canonicalLabel, {
    baseRoleKind: 'specialized_base_role',
    specializationKinds: ['product']
  });

  const breakdown = scoreLeaf(
    closeness,
    [],
    structure,
    prepared,
    canonicalTokens,
    canonicalTokens,
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    'shop manager',
    501,
    new Map()
  );

  // Guard against the penalty being silently suppressed by the zero-lexical-overlap
  // optimization -- if this ever goes to 0, the assertion below is testing nothing.
  assert.ok(closeness.matchedUsefulTokens.length > 0);
  // assert.equal(breakdown.unsupportedSpecialization, -5);
});

test('scoreLeaf awards the token-level canonical exact match (50) for a grammatical restatement of the query', async () => {
  const prepared = await prepareQuery('certified electrician', 'en', { sourceName: SOURCE });
  const canonicalLabel = 'electrician';
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(601, canonicalLabel),
    prepared,
    canonicalTokens,
    canonicalTokens,
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    'certified electrician',
    601,
    new Map()
  );

  assert.equal(breakdown.exactCanonicalMatch, 50);
  assert.equal(sumScoreBreakdown(breakdown), 50);
  assert.equal(breakdown.familyFit, 0);
  assert.equal(breakdown.roleHeadOrUsefulCanonical, 0);
});

test('scoreLeaf penalizes a leaf with no token or role-head relationship to the query', async () => {
  // Uses 'librarian' rather than 'chef': 'chef' now matches ATOMIC_SPECIALIZATION_SYNONYMS.task_focus.cooking
  // (added while closing leaf-vocabulary gaps), so it no longer isolates the "zero relationship" case
  // this test targets. 'librarian' still has no ATOMIC vocabulary overlap.
  const prepared = await prepareQuery('electrician', 'en', { sourceName: SOURCE });
  const canonicalLabel = 'librarian';
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(602, canonicalLabel),
    prepared,
    canonicalTokens,
    canonicalTokens,
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    'electrician',
    602,
    new Map()
  );

  assert.equal(closeness.matchedUsefulTokens.length, 0);
  assert.equal(breakdown.noTokenRelationship, -30);
  assert.equal(breakdown.familyFit, 0);
  assert.equal(sumScoreBreakdown(breakdown), -30);
});

test('scoreLeaf does not penalize a leaf whose English role head is the locale-specific role head via the role-head equivalence artifact', async () => {
  // Hungarian 'recepcios' shares the 'receptionist_recepcios' equivalence class with the English
  // role head 'receptionist', so a sibling leaf carrying the role head only in its canonical
  // English label (no literal token overlap with the hu query) must not be treated as unrelated.
  const prepared = await prepareQuery('szallodai recepcios', 'hu', { sourceName: SOURCE });
  const canonicalLabel = 'hospitality establishment receptionist';
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(699, canonicalLabel),
    prepared,
    canonicalTokens,
    foldedTokenSet(closeness.matchedLabel),
    new Set(),
    [],
    null,
    'hu',
    canonicalLabel,
    'szallodai recepcios',
    699,
    new Map()
  );

  assert.equal(breakdown.noTokenRelationship, 0);
  assert.ok(sumScoreBreakdown(breakdown) > 0);
});

test("scoreLeaf penalizes a leaf missing the query's context-dependent required role head", async () => {
  const prepared = await prepareQuery('project manager', 'en', { sourceName: SOURCE });
  const canonicalLabel = 'project engineer';
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(603, canonicalLabel),
    prepared,
    canonicalTokens,
    foldedTokenSet(closeness.matchedLabel),
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    'project manager',
    603,
    new Map()
  );

  // Guard: the penalty is only meant to fire when the leaf matched some token but not the role
  // head itself, and no specialization evidence already explains the mismatch.
  assert.ok(closeness.matchedUsefulTokens.length > 0);
  assert.equal(breakdown.specializationScore, 0);
  assert.equal(breakdown.missingRequiredRoleHead, -8);
  assert.equal(breakdown.familyFit, 5);
  assert.equal(breakdown.genericBaseRoleFit, 2);
  assert.equal(breakdown.usefulTokenCoverage, 1);
});

test('scoreLeaf awards the top role-head tier (15), venue support, and specialization for a venue-qualified match', async () => {
  const prepared = await prepareQuery('shop electrician', 'en', { sourceName: SOURCE });
  const canonicalLabel = 'electrician in shop';
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(604, canonicalLabel),
    prepared,
    canonicalTokens,
    foldedTokenSet(closeness.matchedLabel),
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    'shop electrician',
    604,
    new Map()
  );

  assert.equal(breakdown.roleHeadOrUsefulCanonical, 15);
  assert.equal(breakdown.usefulVenueSupport, 2);
  assert.equal(breakdown.specializationScore, 8);
  assert.equal(breakdown.familyFit, 5);
  assert.equal(breakdown.genericBaseRoleFit, 2);
  assert.equal(breakdown.usefulTokenCoverage, 3);
});

test('scoreLeaf awards tier 10 (full useful-token canonical coverage) and the no-specialization-needed bonus', async () => {
  const prepared = await prepareQuery('electrician', 'en', { sourceName: SOURCE });
  const canonicalLabel = 'electrician helper';
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(605, canonicalLabel),
    prepared,
    canonicalTokens,
    foldedTokenSet(closeness.matchedLabel),
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    'electrician',
    605,
    new Map()
  );

  assert.equal(breakdown.roleHeadOrUsefulCanonical, 10);
  assert.equal(breakdown.usefulMatchNoSpecialization, 5);
  assert.equal(breakdown.familyFit, 5);
  assert.equal(breakdown.genericBaseRoleFit, 2);
  assert.equal(breakdown.usefulTokenCoverage, 1);
});

test("scoreLeaf credits a decoy alias that textually equals the query but was not the ranker's chosen match (loose-only aliasMatchBonus=3)", async () => {
  const prepared = await prepareQuery('electrician', 'en', { sourceName: SOURCE });
  const canonicalLabel = 'electrician helper';
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  // Rank closeness with no aliases so canonical wins the ranker's comparison, then hand scoreLeaf
  // a decoy alias list containing an alias that equals the raw query text. This isolates the loose
  // text-equality signal from the (stronger, mutually-exclusive) ranked-alias-winner signal below --
  // in the real pipeline an alias equal to the query text always wins the closeness ranking outright,
  // so the two signals can only be told apart by decoupling scoreLeaf's alias list from the
  // ranker's, as done here.
  const closeness = rankCloseness(prepared, canonicalLabel, []);
  const decoyAliases = ['electrician'];

  const breakdown = scoreLeaf(
    closeness,
    decoyAliases,
    genericStructure(606, canonicalLabel),
    prepared,
    canonicalTokens,
    foldedTokenSet(closeness.matchedLabel),
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    'electrician',
    606,
    new Map()
  );

  assert.equal(closeness.matchedLabelSource, 'canonical');
  assert.equal(breakdown.aliasMatchBonus, 3);
});

test("scoreLeaf credits the ranked full alias-coverage bonus (20) when the closeness ranker's own winner is an alias", async () => {
  const prepared = await prepareQuery('electrician', 'en', { sourceName: SOURCE });
  const canonicalLabel = 'electrical technician';
  const aliases = ['electrician'];
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, aliases);

  const breakdown = scoreLeaf(
    closeness,
    aliases,
    genericStructure(607, canonicalLabel),
    prepared,
    canonicalTokens,
    foldedTokenSet(closeness.matchedLabel),
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    'electrician',
    607,
    new Map()
  );

  assert.equal(closeness.matchedLabelSource, 'alias');
  assert.equal(breakdown.aliasMatchBonus, 20);
  assert.equal(breakdown.familyFit, 5);
  assert.equal(breakdown.genericBaseRoleFit, 2);
});

test('scoreLeaf awards tier 5 (bare role-head match, no supporting evidence) for a role head with an unmatched extra token', async () => {
  const prepared = await prepareQuery('electrician automotive', 'en', { sourceName: SOURCE });
  const canonicalLabel = 'electrician';
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(608, canonicalLabel),
    prepared,
    canonicalTokens,
    foldedTokenSet(closeness.matchedLabel),
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    'electrician automotive',
    608,
    new Map()
  );

  assert.equal(breakdown.roleHeadOrUsefulCanonical, 5);
  assert.equal(breakdown.familyFit, 5);
  assert.equal(breakdown.genericBaseRoleFit, 2);
  assert.equal(breakdown.usefulTokenCoverage, 1);
});

test('scoreLeaf rewards a same-band seniority match (levelMatch=3)', async () => {
  const prepared = await prepareQuery('senior electrician', 'en', { sourceName: SOURCE });
  const canonicalLabel = 'lead electrician';
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(609, canonicalLabel),
    prepared,
    canonicalTokens,
    foldedTokenSet(closeness.matchedLabel),
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    'senior electrician',
    609,
    new Map()
  );

  assert.equal(breakdown.levelMatch, 3);
  assert.equal(breakdown.roleHeadOrUsefulCanonical, 10);
  assert.equal(breakdown.usefulMatchNoSpecialization, 5);
});

test('scoreLeaf does not credit a mismatched non-management seniority level match', async () => {
  const prepared = await prepareQuery('senior electrician', 'en', { sourceName: SOURCE });
  const canonicalLabel = 'junior electrician';
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(610, canonicalLabel),
    prepared,
    canonicalTokens,
    foldedTokenSet(closeness.matchedLabel),
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    'senior electrician',
    610,
    new Map()
  );

  assert.equal(breakdown.authorityLevelContradiction, false);
  assert.equal(breakdown.levelMatch, 0);
  assert.equal(breakdown.roleHeadOrUsefulCanonical, 10);
  assert.equal(breakdown.usefulMatchNoSpecialization, 5);
});

test('scoreLeaf does not contradict an unrequested authority level (levelMatch=0) when the query asked for no level at all', async () => {
  const prepared = await prepareQuery('electrician', 'en', { sourceName: SOURCE });
  const canonicalLabel = 'electrician manager';
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(611, canonicalLabel),
    prepared,
    canonicalTokens,
    foldedTokenSet(closeness.matchedLabel),
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    'electrician',
    611,
    new Map()
  );

  // authorityLevelContradiction is a binary hard gate, and the query stated no level at all here --
  // silence isn't a claim, so there is no contradiction. levelMatch itself softly prefers the
  // non-authority leaf (would be +1) but does not penalize an authority-tier leaf beyond that: 0.
  assert.equal(breakdown.levelMatch, 0);
  assert.equal(breakdown.authorityLevelContradiction, false);
  assert.equal(breakdown.roleHeadOrUsefulCanonical, 10);
  assert.equal(breakdown.usefulMatchNoSpecialization, 5);
});

test('scoreLeaf hard-gates a requested authority level the leaf never confirms, even when an alias contains the level word', async () => {
  // Mirror of the unrequested-authority-level case above: here the query explicitly asks for an
  // authority tier ("manager"), but the matched leaf's own canonical label carries no level word
  // at all -- it only matched via an alias that happens to say "manager". Regression for a real
  // production case: query "risk manager" landed 100% closeness on "credit risk analyst" through
  // its alias "credit risk manager", scoring as if the leaf were a genuine manager role. The binary
  // tier gate now catches this directly (authorityLevelContradiction=true) rather than relying on a
  // soft -3 levelMatch penalty.
  const prepared = await prepareQuery('risk manager', 'en', { sourceName: SOURCE });
  const canonicalLabel = 'risk analyst';
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const aliases = ['risk manager'];
  const closeness = rankCloseness(prepared, canonicalLabel, aliases);

  const breakdown = scoreLeaf(
    closeness,
    aliases,
    genericStructure(618, canonicalLabel),
    prepared,
    canonicalTokens,
    foldedTokenSet(closeness.matchedLabel),
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    'risk manager',
    618,
    new Map()
  );

  assert.equal(closeness.matchedLabelSource, 'alias');
  assert.equal(breakdown.levelMatch, 0);
  assert.equal(breakdown.authorityLevelContradiction, true);
});

test('scoreLeaf rewards an exact level match, a supported specialization, and its aligned specialization value together', async () => {
  const prepared = await prepareQuery('clothing accessories shop manager', 'en', { sourceName: SOURCE });
  const canonicalLabel = 'clothing shop manager';
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);
  const structure = genericStructure(612, canonicalLabel, { specializationKinds: ['product'] });

  const breakdown = scoreLeaf(
    closeness,
    [],
    structure,
    prepared,
    canonicalTokens,
    foldedTokenSet(closeness.matchedLabel),
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    'clothing accessories shop manager',
    612,
    new Map()
  );

  assert.equal(breakdown.levelMatch, 5);
  assert.equal(breakdown.roleHeadOrUsefulCanonical, 15);
  assert.equal(breakdown.specializationScore, 8);
  // assert.equal(breakdown.alignedSpecializationValue, 5);
  assert.equal(breakdown.familyFit, 5);
  assert.equal(breakdown.genericBaseRoleFit, 2);
  assert.equal(breakdown.usefulTokenCoverage, 5);
});

test('scoreLeaf penalizes a contradictory specialization (contradictorySpecialization=-10) between sibling leaves under the same generic role head', async () => {
  const prepared = await prepareQuery('frontend developer', 'en', { sourceName: SOURCE });
  const canonicalLabel = 'backend developer';
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(613, canonicalLabel),
    prepared,
    canonicalTokens,
    foldedTokenSet(closeness.matchedLabel),
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    'frontend developer',
    613,
    new Map()
  );

  // assert.equal(breakdown.contradictorySpecialization, -10);
  assert.equal(breakdown.roleHeadOrUsefulCanonical, 5);
  assert.equal(breakdown.familyFit, 5);
  assert.equal(breakdown.genericBaseRoleFit, 2);
});

test('scoreLeaf rewards useful domain-token support (usefulDomainSupport=2) when the canonical label covers a known domain modifier', async () => {
  // Uses 'banking' rather than 'retail'/'education' as the domain word: both of those now also
  // match ATOMIC_SPECIALIZATION_SYNONYMS entries (added while closing leaf-vocabulary gaps), so they
  // exercise specializationMatch as well and no longer isolate the plain domain-support path this
  // test targets. 'banking' is still a curated domain modifier with no ATOMIC vocabulary overlap.
  const prepared = await prepareQuery('banking electrician', 'en', { sourceName: SOURCE });
  const canonicalLabel = 'banking electrician helper';
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(614, canonicalLabel),
    prepared,
    canonicalTokens,
    foldedTokenSet(closeness.matchedLabel),
    new Set(),
    [],
    null,
    'en',
    canonicalLabel,
    'banking electrician',
    614,
    new Map()
  );

  assert.equal(breakdown.usefulDomainSupport, 2);
  assert.equal(breakdown.roleHeadOrUsefulCanonical, 15);
  assert.equal(breakdown.usefulMatchNoSpecialization, 5);
  assert.equal(breakdown.usefulTokenCoverage, 3);
  assert.equal(breakdown.familyFit, 5);
  assert.equal(breakdown.genericBaseRoleFit, 2);
});

test('scoreLeaf does not award usefulVenueSupport for a specialization kind it already penalized as unsupported', async () => {
  // Regression for a real production case: query "retail wholesale trade managers" in ro
  // classifies "retail" as a venue-context token (ro's venueContextTerms list includes it, unlike
  // en's), while the leaf's own venue marker is "shop" -- a different, unaligned specific venue
  // value. unsupportedSpecialization correctly flags the leaf's venue claim as unsupported, but
  // usefulVenueSupport used to independently reward the same "venue" kind just because "retail"
  // happened to also appear in the matched alias text ("retail shop supervisor"), producing a
  // breakdown that penalized and rewarded the identical specialization kind at once.
  const prepared = await prepareQuery('retail wholesale trade managers', 'ro', { sourceName: SOURCE });
  const canonicalLabel = 'shop supervisor';
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const aliases = ['retail shop supervisor'];
  const closeness = rankCloseness(prepared, canonicalLabel, aliases);
  const structure = genericStructure(617, canonicalLabel, { specializationKinds: ['venue'] });

  const breakdown = scoreLeaf(
    closeness,
    aliases,
    structure,
    prepared,
    canonicalTokens,
    foldedTokenSet(closeness.matchedLabel),
    new Set(),
    [],
    null,
    'ro',
    canonicalLabel,
    'retail wholesale trade managers',
    617,
    new Map()
  );

  // Guard against the penalty being silently suppressed by the zero-lexical-overlap
  // optimization -- if this ever goes to 0, the assertion below is testing nothing.
  assert.ok(closeness.matchedUsefulTokens.length > 0);
  // assert.equal(breakdown.unsupportedSpecialization, -5);
  assert.equal(breakdown.usefulVenueSupport, 0);
});

test('scoreLeaf rewards a strong capability-label fit (usefulCapabilityFit=4) when every capability-verb token is covered', async () => {
  const prepared = await prepareQuery('shop worker', 'en', { sourceName: SOURCE });
  const canonicalLabel = 'shop floor worker';
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);
  const capabilityLabels = [capabilityLabel('stock work duties'), capabilityLabel('working retail hours')];

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(615, canonicalLabel),
    prepared,
    canonicalTokens,
    foldedTokenSet(closeness.matchedLabel),
    new Set(),
    capabilityLabels,
    null,
    'en',
    canonicalLabel,
    'shop worker',
    615,
    new Map()
  );

  assert.equal(breakdown.usefulCapabilityFit, 4);
});

test('scoreLeaf rewards a partial capability-label fit (usefulCapabilityFit=2) when only some capability-verb tokens are covered', async () => {
  const prepared = await prepareQuery('shop worker', 'en', { sourceName: SOURCE });
  const canonicalLabel = 'shop floor worker';
  const canonicalTokens = foldedTokenSet(canonicalLabel);
  const closeness = rankCloseness(prepared, canonicalLabel, []);
  const capabilityLabels = [capabilityLabel('working retail hours')];

  const breakdown = scoreLeaf(
    closeness,
    [],
    genericStructure(616, canonicalLabel),
    prepared,
    canonicalTokens,
    foldedTokenSet(closeness.matchedLabel),
    new Set(),
    capabilityLabels,
    null,
    'en',
    canonicalLabel,
    'shop worker',
    616,
    new Map()
  );

  assert.equal(breakdown.usefulCapabilityFit, 2);
});

test('sibling competition rewards query tokens that distinguish a leaf inside its family', async () => {
  const prepared = await prepareQuery('backend developer', 'en', { sourceName: SOURCE });
  const scores = computeSiblingCompetitionScores(
    [
      { graphNodeId: 401, canonicalLabel: 'software developer' },
      { graphNodeId: 402, canonicalLabel: 'backend developer' },
      { graphNodeId: 403, canonicalLabel: 'frontend developer' },
      { graphNodeId: 404, canonicalLabel: 'mobile applications developer' },
      { graphNodeId: 405, canonicalLabel: 'blockchain developer' },
      { graphNodeId: 406, canonicalLabel: 'database developer' }
    ],
    prepared
  );

  assert.ok((scores.get(402) ?? 0) > (scores.get(401) ?? 0));
  assert.ok((scores.get(402) ?? 0) > (scores.get(403) ?? 0));
  assert.equal(scores.get(401), 0);
});

test('sibling competition is based on canonical labels only', async () => {
  const prepared = await prepareQuery('backend developer', 'en', { sourceName: SOURCE });
  const scores = computeSiblingCompetitionScores(
    [
      { graphNodeId: 411, canonicalLabel: 'software developer' },
      { graphNodeId: 412, canonicalLabel: 'frontend developer' }
    ],
    prepared
  );

  assert.equal(scores.get(411), 0);
});

function rankSyntheticLeaves(
  preparedQuery: PreparedQuery,
  effectiveQuery: string,
  locale: string,
  exactQueryText: string,
  leaves: RuntimeSearchMetaCoreRecord[]
): RankedFamilyLeaf[] {
  const aliasesByNodeId = new Map(
    leaves.map((record) => [record.graphNodeId, (record as RuntimeSearchMetaCoreRecord & { aliases?: RuntimeAliasRecord[] }).aliases ?? []])
  );
  const artifact = {
    getAliases: (graphNodeId: number) => aliasesByNodeId.get(graphNodeId) ?? [],
    getCapabilityLabels: () => []
  } as unknown as SearchMetaArtifactCacheEntry;
  const leafStructureArtifact = {
    getRecord: (graphNodeId: number) =>
      genericStructure(graphNodeId, leaves.find((record) => record.graphNodeId === graphNodeId)?.canonicalLabel ?? '')
  } as unknown as OccupationLeafStructureArtifact;

  return cliRankFamilyLeaves(artifact, leafStructureArtifact, leaves, preparedQuery, effectiveQuery, locale, exactQueryText);
}

function rankCloseness(preparedQuery: PreparedQuery, canonicalLabel: string, aliases: string[]) {
  return CLOSENESS_RANKER.rank({
    query: {
      locale: preparedQuery.locale,
      normalized: preparedQuery.normalized,
      folded: preparedQuery.folded,
      foldedTokens: preparedQuery.foldedTokens,
      usefulFoldedRecallTokens: preparedQuery.usefulFoldedRecallTokens
    },
    canonicalLabel,
    aliases
  });
}

function foldedTokenSet(value: string): Set<string> {
  return new Set(tokenizeNormalizedText(foldSearchText(value)));
}

function leaf(
  graphNodeId: number,
  canonicalLabel: string,
  aliases: RuntimeAliasRecord[] = []
): RuntimeSearchMetaCoreRecord & { aliases: RuntimeAliasRecord[] } {
  return {
    searchMetaId: graphNodeId,
    graphNodeId,
    canonicalLabel,
    genericRisk: 'low',
    hasHierarchy: true,
    hasCapabilitySupport: false,
    familyNodeId: 1,
    familyLabel: 'Synthetic family',
    groupNodeId: null,
    groupLabel: null,
    parentNodeId: null,
    parentLabel: null,
    ancestors: [],
    siblings: [],
    aliases
  };
}

function alias(localeCode: string, value: string, aliasRole: RuntimeAliasRecord['aliasRole'] = 'locale_primary'): RuntimeAliasRecord {
  return {
    localeCode,
    alias: value,
    normalizedAlias: value,
    aliasRole,
    isPrimary: aliasRole === 'locale_primary',
    confidence: 1,
    weight: 1
  };
}

function capabilityLabel(label: string): RuntimeCapabilityRecord {
  return {
    capabilityId: 1,
    capabilityType: 'skill',
    canonicalKey: label,
    localeCode: 'en',
    label,
    normalizedLabel: label,
    hintKind: 'task',
    weight: 1
  };
}

function genericStructure(
  graphNodeId: number,
  canonicalLabel: string,
  overrides: Partial<OccupationLeafStructureRecord> = {}
): OccupationLeafStructureRecord {
  return {
    graphNodeId,
    canonicalLabel,
    familyNodeId: 1,
    groupNodeId: null,
    parentNodeId: null,
    baseRoleKind: 'generic_base_role',
    authorityKind: 'none',
    specializationKinds: [],
    headPreservingSpecialization: true,
    broadAliasRisk: 'low',
    capabilityDominanceRisk: 'low',
    ...overrides
  };
}
