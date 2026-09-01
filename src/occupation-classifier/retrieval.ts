import { isSearchAliasRole } from '../query/alias-role-policy.js';
import { prepareQuery } from '../query/query-preparation.js';
import { retrieveBinaryAliasNgramHits } from '../retrieval/alias-ngram-retriever.js';
import { isAliasNgramFamilySupportEnabled, isAliasNgramRetrievalEnabled } from '../retrieval/occupation-candidates.js';
import type { AliasRetrievalResult, OccupationRetrievalEngine } from '../retrieval/retrieval-engine.js';
import { loadOccupationAliasNgramBinaryIfAvailable } from '../runtime/occupation-alias-ngram-binary-artifact.js';
import { loadOccupationFamilyProfileArtifactRequired } from '../runtime/occupation-family-profile-artifact.js';
import type { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
import { foldWeakPunctuationLookupText } from '../utils/texts.js';
import {
  type ClassifierRecallLimits,
  EXACT_ALIAS_LIMIT,
  EXACT_CANONICAL_LIMIT,
  NGRAM_ALIAS_EVIDENCE_LIMIT,
  SUBPHRASE_ALIAS_EVIDENCE_LIMIT
} from './constants.js';
import { QueryStructuralProfile } from './preparation.js';
import {
  expandRoleHeadGroupTerms,
  expandRoleHeadSpellingVariants,
  GENERIC_ROLE_HEAD_TOKENS,
  isRankRoleHead,
  NOISY_ROLE_HEAD_TERMS
} from './role-head-groups.js';
import type {
  CandidateEvidence,
  CandidateEvidenceById,
  CanonicalComparisonQuery,
  ClassifierRetrievalRequest,
  ClassifierSurface,
  ExactFamilyCandidate,
  HydratedCandidate
} from './types.js';

export type ExactLeafCandidate = {
  graphNodeId: number;
  weakFoldedCanonicalLabel: string;
};

export type ExactAliasCandidate = {
  graphNodeId: number;
  weakFoldedAlias: string;
};

export type RawRecallEvidence = {
  graphNodeId: number;
  channel:
    | 'exact_canonical'
    | 'weak_exact_canonical'
    | 'exact_primary_alias'
    | 'exact_supporting_alias'
    | 'folded_alias'
    | 'subphrase_alias'
    | 'english_alias'
    | 'family_scoped_title_token'
    | 'title_token'
    | 'ngram_alias'
    | 'role_head_equivalent';
  selectionUsable: boolean;
  tieBreakerScore: number;
  aliasRole?: string;
};

// The English translation is not reliably accurate (e.g. "Consilier de vanzari" -> "business sales
// adviser" folds two independent modifiers into one phrase), so the full-phrase canonical-exact key
// alone misses leaves whose canonical label is just one modifier + the role head (e.g. "sales
// adviser" or "business adviser"). Build every modifier+roleHead pair (both word orders, since
// translation/local phrasing order isn't reliable either) plus the bare role head alone when it
// carries real disambiguating signal on its own (excludes rank words like "manager" via
// isRankRoleHead/NOISY_ROLE_HEAD_TERMS, and non-discriminating heads like "worker" via
// GENERIC_ROLE_HEAD_TOKENS -- an exact match on those alone says nothing about which leaf is meant).
function buildRoleHeadComboExactKeys(modifierTokens: readonly string[], roleHeadTokens: readonly string[]): string[] {
  const keys = new Set<string>();

  for (const roleHead of roleHeadTokens) {
    if (!isRankRoleHead(roleHead) && !NOISY_ROLE_HEAD_TERMS.has(roleHead) && !GENERIC_ROLE_HEAD_TOKENS.has(roleHead)) {
      keys.add(foldWeakPunctuationLookupText(roleHead));
    }

    for (const modifier of modifierTokens) {
      keys.add(foldWeakPunctuationLookupText(`${modifier} ${roleHead}`));
      keys.add(foldWeakPunctuationLookupText(`${roleHead} ${modifier}`));
    }
  }

  return [...keys].filter((key) => key.length > 0);
}

export function buildRetrievalRequest(
  sourceName: string,
  locale: ClassifierRetrievalRequest['locale'],
  surface: ClassifierSurface,
  comparisonQuery: CanonicalComparisonQuery,
  queryProfile: QueryStructuralProfile
): ClassifierRetrievalRequest {
  const modifierTokens = new Set(comparisonQuery.modifierTokens);
  const hasResolvedRoleHead = comparisonQuery.resolvedRoleHeadTokens.length > 0;
  const roleHeadTokens = hasResolvedRoleHead
    ? comparisonQuery.resolvedRoleHeadTokens
    : comparisonQuery.englishTokens.filter((token) => !modifierTokens.has(token));

  const groupExpansionSeeds = Array.from(new Set([...roleHeadTokens, ...queryProfile.profile.role_head])).filter(
    (token) => !isRankRoleHead(token)
  );
  // There is still a case to find unrelated role_head that is been pulled
  const roleHeadEquivalentTerms = expandRoleHeadGroupTerms(groupExpansionSeeds);
  const englishRoleHeadTokens = Array.from(new Set([...roleHeadTokens, ...expandRoleHeadSpellingVariants(roleHeadTokens)]));

  const englishCanonicalExactKeys = Array.from(
    new Set([...comparisonQuery.canonicalExactKeys, ...buildRoleHeadComboExactKeys(comparisonQuery.modifierTokens, englishRoleHeadTokens)])
  );

  return {
    sourceName,
    locale,
    localFullAliasKey: surface.weakFolded,
    localAliasTokens: surface.weakFoldedTokens,
    englishCanonicalExactKeys,
    englishWeakFoldedTokens: comparisonQuery.englishTokens,
    englishFullAliasKey: foldWeakPunctuationLookupText(comparisonQuery.englishTokens.join(' ')),
    englishModifierTokens: comparisonQuery.modifierTokens,
    englishRoleHeadTokens,
    localRoleHeadTokens: comparisonQuery.localRoleHeadTokens,
    roleHeadEquivalentTerms,
    fuzzyAliasRecallEnabled: shouldEnableFuzzyAliasRecall(surface, comparisonQuery)
  };
}

export async function findExactCanonicalLeaves(
  runtime: OccupationRuntimeContext,
  request: ClassifierRetrievalRequest
): Promise<ExactLeafCandidate[]> {
  if (request.englishCanonicalExactKeys.length === 0) {
    return [];
  }

  const preparedQuery = await prepareQuery(request.englishWeakFoldedTokens.join(' '), 'en', { sourceName: request.sourceName });
  const hits = await runtime.retrievalEngine.occupations.retrieveCanonicalLabels({
    locale: 'en',
    sourceName: request.sourceName,
    limit: EXACT_CANONICAL_LIMIT,
    preparedQuery,
    foldedQueries: request.englishCanonicalExactKeys
  });

  return hits.slice(0, EXACT_CANONICAL_LIMIT).map((hit) => ({
    graphNodeId: hit.graphNodeId,
    weakFoldedCanonicalLabel: foldWeakPunctuationLookupText(hit.canonicalLabel)
  }));
}

export async function findExactAliasLeaves(
  runtime: OccupationRuntimeContext,
  request: ClassifierRetrievalRequest,
  limit: number
): Promise<{ candidates: ExactAliasCandidate[]; aliasResult: AliasRetrievalResult }> {
  // Fetches exact AND folded rows in one call (both come out of the same retrieve() call anyway)
  // so primaryRecall can reuse this result instead of re-querying the same exactAliasQueries.
  const preparedQuery = await preparedQueryForLocalSurface(request);

  // Same modifier+roleHead combo widening as the English canonical-exact fast path (translation is
  // not reliably accurate, so the full local phrase alone can miss an alias that is just one
  // modifier + the local role head), reusing the local role head found by reversing the
  // local->English translation (see translateTitleForClassifier).
  const localRoleHeadSet = new Set(request.localRoleHeadTokens);
  const localModifierTokens = request.localAliasTokens.filter((token) => !localRoleHeadSet.has(token));
  const localAliasKeys = Array.from(
    new Set([request.localFullAliasKey, ...buildRoleHeadComboExactKeys(localModifierTokens, request.localRoleHeadTokens)])
  ).filter((key) => key.length > 0);

  const aliasResult = await runtime.retrievalEngine.aliases.retrieve({
    sourceName: request.sourceName,
    locale: request.locale,
    preparedQuery,
    exactAliasQueries: localAliasKeys,
    foldedAliasQueries: localAliasKeys.map((key) => foldWeakPunctuationLookupText(key)),
    limit
  });

  // Both exactAliasQueries and foldedAliasQueries above are the same already-diacritic-folded key, so
  // exactRows is always a subset of foldedRows here: any alias with no diacritics folds to itself and
  // lands in foldedAliasIndex under the identical key it has in exactAliasIndex. So foldedRows alone
  // already covers every exact hit plus the diacritic-only ones exactRows can never see -- just use it.
  const matchedRows = aliasResult.foldedRows.filter((row) => isSearchAliasRole(row.alias_role, false));

  const candidates = matchedRows.slice(0, EXACT_ALIAS_LIMIT).map((row) => ({
    graphNodeId: row.graph_node_id,
    weakFoldedAlias: request.localFullAliasKey
  }));

  return { candidates, aliasResult };
}

export async function findExactCanonicalFamilies(
  _runtime: OccupationRuntimeContext,
  request: ClassifierRetrievalRequest
): Promise<ExactFamilyCandidate[]> {
  const keys = new Set(request.englishCanonicalExactKeys);

  if (keys.size === 0) {
    return [];
  }

  const familyProfiles = await loadOccupationFamilyProfileArtifactRequired(request.sourceName);
  const matches: ExactFamilyCandidate[] = [];

  for (let rowId = 0; rowId < familyProfiles.artifact.count; rowId += 1) {
    const profile = familyProfiles.getProfileCore(rowId);

    if (!profile) {
      continue;
    }

    const weakFoldedFamilyLabel = foldWeakPunctuationLookupText(profile.familyLabel);

    if (!keys.has(weakFoldedFamilyLabel)) {
      continue;
    }

    matches.push({
      familyNodeId: profile.familyNodeId,
      familyLabel: profile.familyLabel,
      weakFoldedFamilyLabel
    });
  }

  return matches;
}

export async function retrieveRecallCandidates(
  runtime: OccupationRuntimeContext,
  request: ClassifierRetrievalRequest,
  priorExact: {
    exactCanonicalLeaves: readonly ExactLeafCandidate[];
    exactAliasLeaves: readonly ExactAliasCandidate[];
    aliasResult: AliasRetrievalResult;
  },
  limits: ClassifierRecallLimits
): Promise<RawRecallEvidence[]> {
  const priorRows = buildExactCandidateEvidenceRows(priorExact.exactCanonicalLeaves, priorExact.exactAliasLeaves);
  const primaryRows = await primaryRecall(runtime, request, limits.primary, priorExact.aliasResult);
  const merged = [...priorRows, ...primaryRows];

  if (merged.length >= limits.minPrimary || !request.fuzzyAliasRecallEnabled) {
    return capRecall(merged, limits);
  }

  const fuzzyRows = await fuzzyAliasRecall(request, limits.secondary);
  return capRecall([...merged, ...fuzzyRows], limits);
}

export function mergeCandidateEvidence(rawRecall: readonly RawRecallEvidence[]): CandidateEvidenceById {
  const evidenceById: CandidateEvidenceById = new Map();

  for (const row of rawRecall) {
    const evidence = evidenceById.get(row.graphNodeId) ?? emptyCandidateEvidence();
    evidenceById.set(row.graphNodeId, mergeEvidence(evidence, row));
  }

  return evidenceById;
}

export function hydrateCandidateCores(runtime: OccupationRuntimeContext, evidenceById: CandidateEvidenceById): HydratedCandidate[] {
  const hydrated: HydratedCandidate[] = [];

  for (const [graphNodeId, evidence] of evidenceById) {
    const core = runtime.searchMetaArtifact.getCoreRecord(graphNodeId);

    if (!core) {
      continue;
    }

    hydrated.push({
      graphNodeId,
      canonicalLabel: core.canonicalLabel,
      canonicalWeakFolded: foldWeakPunctuationLookupText(core.canonicalLabel),
      familyNodeId: core.familyNodeId,
      familyLabel: core.familyLabel,
      evidence
    });
  }

  return hydrated;
}

async function primaryRecall(
  runtime: OccupationRuntimeContext,
  request: ClassifierRetrievalRequest,
  limit: number,
  aliasResult: AliasRetrievalResult
): Promise<RawRecallEvidence[]> {
  const engine = runtime.retrievalEngine;
  const localPreparedQuery = await preparedQueryForLocalSurface(request);

  const rows: RawRecallEvidence[] = [
    ...aliasResult.exactRows
      .filter((row) => row.alias_role !== 'locale_primary')
      .map((row) => aliasRecallRow(row, 'exact_supporting_alias')),
    ...aliasResult.foldedRows.map((row) => aliasRecallRow(row, 'folded_alias'))
  ];

  // A `family_supporting` alias (e.g. "jurist") is propagated onto every leaf in the implicated
  // family, so it already gave every one of those leaves weak exact_supporting_alias evidence above --
  // but that carries no leaf-level precision. Run the same family-scoped lexical search the old
  // pipeline used (retrieveWithinFamily) so leaves inside those families can be told apart by their
  // own text instead of all tying.
  // aliasResult.foldedRows is the raw, unfiltered retrieve() result -- it holds rows of every alias
  // role that matched the key (locale_primary, locale_supporting, family_supporting, ...), not just
  // the roles findExactAliasLeaves picks candidates from. So this scan is the real, only place that
  // isolates the family_supporting rows out of that mixed set.
  const familySupportingFamilyNodeIds = new Set<number>();
  for (const row of aliasResult.foldedRows) {
    if (row.alias_role !== 'family_supporting') {
      continue;
    }

    const core = runtime.searchMetaArtifact.getCoreRecord(row.graph_node_id);

    if (core && core.familyNodeId !== null) {
      familySupportingFamilyNodeIds.add(core.familyNodeId);
    }
  }

  for (const familyNodeId of familySupportingFamilyNodeIds) {
    const familyHits = await engine.occupations.retrieveWithinFamily({
      locale: request.locale,
      sourceName: request.sourceName,
      preparedQuery: localPreparedQuery,
      familyNodeId,
      limit
    });

    for (const hit of familyHits) {
      rows.push({
        graphNodeId: hit.graphNodeId,
        channel: 'family_scoped_title_token',
        selectionUsable: false,
        tieBreakerScore: hit.score
      });
    }
  }

  // engine.occupations.retrieve requires every query token to be present in the candidate label
  // (AND semantics), so joining all equivalent terms into one query would only match a canonical
  // label containing two of them at once -- essentially never. Query each term on its own instead;
  // the union across terms is exactly the OR-style widening this recall pass is meant to do.
  // Runs before the broad englishWeakFoldedTokens search below so its rows aren't starved out of
  // the eventual maxMerged cap by that search's much larger hit count.
  // TODO: consider promise.all
  // for (const term of request.roleHeadEquivalentTerms) {
  //   const equivalentPreparedQuery = await prepareQuery(term, 'en', { sourceName: request.sourceName });
  //   const equivalentHits = await engine.occupations.retrieve({
  //     locale: 'en',
  //     sourceName: request.sourceName,
  //     limit,
  //     preparedQuery: equivalentPreparedQuery
  //   });

  //   for (const hit of equivalentHits) {
  //     rows.push({
  //       graphNodeId: hit.graphNodeId,
  //       channel: 'role_head_equivalent',
  //       selectionUsable: false,
  //       tieBreakerScore: hit.score
  //     });
  //   }
  // }

  // This searches the canonical-label TOKEN index (scored partial overlap), not the alias index
  // aliasResult above just queried (exact/folded key match) -- keep both even when locale is 'en',
  // they surface different candidates from different indexes.
  // A non-authority rank word (e.g. "assistant", translated from "ajutor") is genuine, correct
  // translation, but it's common enough across the whole graph's canonical titles that including it
  // in this OR-style widening search lets it flood the result with unrelated "X assistant" leaves,
  // crowding the real content words (e.g. "solar") out of the eventual maxMerged cap -- the exact
  // failure "Ajutor - Sisteme panouri fotovoltaice" hit versus "Sisteme panouri fotovoltaice" alone.
  // Querying the rank-stripped token set too (when it differs) recovers those candidates without
  // dropping the rank word from the full-token query, which still runs and still contributes its own
  // (correctly rank-qualified) matches.
  const rankStrippedTokens = request.englishWeakFoldedTokens.filter((token) => !isRankRoleHead(token, 'non-authority'));
  const hasRankWord = rankStrippedTokens.length > 0 && rankStrippedTokens.length !== request.englishWeakFoldedTokens.length;
  // Rank-stripped variant first, when it differs, so its rows fill the maxMerged cap ahead of the
  // full-token query below -- otherwise the rank word's sheer match volume (e.g. "assistant" hits
  // hundreds of unrelated "X assistant" titles) starves out the real content words' rows before they
  // ever get merged in.
  const titleTokenQueries = hasRankWord ? [rankStrippedTokens, request.englishWeakFoldedTokens] : [request.englishWeakFoldedTokens];

  for (const tokens of titleTokenQueries) {
    const englishPreparedQuery = await prepareQuery(tokens.join(' '), 'en', { sourceName: request.sourceName });
    const textHits = await engine.occupations.retrieve({
      locale: 'en',
      sourceName: request.sourceName,
      limit,
      preparedQuery: englishPreparedQuery
    });

    for (const hit of textHits) {
      rows.push({
        graphNodeId: hit.graphNodeId,
        channel: 'title_token',
        selectionUsable: false,
        tieBreakerScore: hit.score
      });
    }
  }

  // Appended last, after every other channel, so capRecall's order-dependent slice drops these
  // weak, bare-word-matchable rows first rather than displacing established channels' candidates.
  for (const row of aliasResult.subphraseRows.slice(0, SUBPHRASE_ALIAS_EVIDENCE_LIMIT)) {
    rows.push(aliasRecallRow(row, 'subphrase_alias'));
  }

  // The RO alias search above only ever sees RO-locale aliases. A leaf can still be the right
  // answer with no RO alias at all, purely because its EN crosswalk alias (e.g. "Sales Person")
  // contains the translated query's words -- so run the identical alias search again against the
  // EN locale using the translated text as the key. Skipped when the query is already EN, since
  // aliasResult above already covered that locale.
  if (request.locale !== 'en' && request.englishFullAliasKey.length > 0) {
    const englishAliasKeys = new Set<string>([request.englishFullAliasKey]);

    for (const roleHead of request.englishRoleHeadTokens) {
      englishAliasKeys.add(foldWeakPunctuationLookupText(roleHead));

      for (const modifier of request.englishModifierTokens) {
        englishAliasKeys.add(foldWeakPunctuationLookupText(`${modifier} ${roleHead}`));
      }
    }

    const englishAliasKeyList = [...englishAliasKeys].filter((key) => key.length > 0);

    // Each key gets its own prepareQuery/retrieve call, not a single call across all keys, because
    // subphraseRows' phrase windows are built from the preparedQuery's own token sequence -- a role
    // head or modifier+roleHead combo (e.g. "sales advisor") only becomes a matchable phrase window
    // when it is the query text itself, not a fragment of the longer full-phrase query.
    for (const englishAliasKey of englishAliasKeyList) {
      const englishPreparedQuery = await prepareQuery(englishAliasKey, 'en', { sourceName: request.sourceName });
      const englishAliasResult = await engine.aliases.retrieve({
        sourceName: request.sourceName,
        locale: 'en',
        preparedQuery: englishPreparedQuery,
        exactAliasQueries: [englishAliasKey],
        foldedAliasQueries: [englishAliasKey],
        limit
      });

      // resolveAliasSubphraseRowsWithFallback merges each key's own precise phrase-window match
      // (matched_query === englishAliasKey) together with a much broader, score-sorted fallback match
      // on the bare role head alone (e.g. "advisor") -- the fallback rows can outnumber the precise
      // ones 30-to-1 and outrank them by authority score, burying the precise match past the
      // SUBPHRASE_ALIAS_EVIDENCE_LIMIT slice below. Keep only rows that matched this key's full
      // window; the bare-roleHead fallback signal is already covered by its own key in this same loop.
      const preciseSubphraseRows = englishAliasResult.subphraseRows.filter((row) => row.matched_query === englishAliasKey);

      for (const row of englishAliasResult.foldedRows) {
        rows.push(aliasRecallRow(row, 'english_alias'));
      }

      for (const row of preciseSubphraseRows.slice(0, SUBPHRASE_ALIAS_EVIDENCE_LIMIT)) {
        rows.push(aliasRecallRow(row, 'english_alias'));
      }
    }
  }

  return rows;
}

// Real fuzzy/n-gram alias matching (cosine similarity over alias feature vectors), not an exact
// folded-key lookup -- this is what lets a query token like "patiserie" partially match an alias
// like "patiser sef" even though neither string equals the other. Used as a fallback only when the
// primary recall channels (which do require exact/folded key matches) came back too thin.
async function fuzzyAliasRecall(request: ClassifierRetrievalRequest, limit: number): Promise<RawRecallEvidence[]> {
  if (!isAliasNgramRetrievalEnabled()) {
    return [];
  }

  const preparedQuery = await preparedQueryForLocalSurface(request);
  const index = await loadOccupationAliasNgramBinaryIfAvailable(request.sourceName, request.locale, isAliasNgramFamilySupportEnabled());

  if (!index) {
    return [];
  }

  const hits = retrieveBinaryAliasNgramHits(index, preparedQuery, { limit: Math.max(limit * 3, 25) });

  return hits
    .filter((hit) => hit.aliasRole !== 'family_supporting')
    .slice(0, NGRAM_ALIAS_EVIDENCE_LIMIT)
    .map((hit) => ({
      graphNodeId: hit.graphNodeId,
      channel: 'ngram_alias' as const,
      selectionUsable: false,
      tieBreakerScore: hit.score,
      aliasRole: hit.aliasRole
    }));
}

function preparedQueryForLocalSurface(request: ClassifierRetrievalRequest) {
  return prepareQuery(request.localFullAliasKey, request.locale, { sourceName: request.sourceName });
}

function aliasRecallRow(
  row: { graph_node_id: number; alias_role: string; weight: number | null },
  channel: RawRecallEvidence['channel']
): RawRecallEvidence {
  return {
    graphNodeId: row.graph_node_id,
    channel,
    selectionUsable: false,
    tieBreakerScore: row.weight ?? 0,
    aliasRole: row.alias_role
  };
}

// exactCanonicalLeaves/exactAliasLeaves were already found by the exact stages earlier in the
// pipeline (findExactCanonicalLeaves / findExactAliasLeaves) -- this just re-expresses each one as
// a RawRecallEvidence row carrying its evidence channel, so recall can merge them with the rest.
function buildExactCandidateEvidenceRows(
  exactCanonicalLeaves: readonly ExactLeafCandidate[],
  exactAliasLeaves: readonly ExactAliasCandidate[]
): RawRecallEvidence[] {
  return [
    ...exactCanonicalLeaves.map((row) => ({
      graphNodeId: row.graphNodeId,
      channel: 'exact_canonical' as const,
      selectionUsable: true,
      tieBreakerScore: 1
    })),
    ...exactAliasLeaves.map((row) => ({
      graphNodeId: row.graphNodeId,
      channel: 'exact_primary_alias' as const,
      selectionUsable: false,
      tieBreakerScore: 0.96
    }))
  ];
}

function capRecall(rows: readonly RawRecallEvidence[], limits: ClassifierRecallLimits): RawRecallEvidence[] {
  return rows.slice(0, limits.maxMerged);
}

function emptyCandidateEvidence(): CandidateEvidence {
  return {
    exactCanonical: false,
    weakExactCanonical: false,
    exactPrimaryAlias: false,
    exactSupportingAlias: false,
    foldedAlias: false,
    subphraseAlias: false,
    englishAlias: false,
    titleToken: false,
    ngramAlias: false,
    roleHeadEquivalent: false,
    tieBreakerScore: 0
  };
}

function mergeEvidence(evidence: CandidateEvidence, row: RawRecallEvidence): CandidateEvidence {
  return {
    exactCanonical: evidence.exactCanonical || row.channel === 'exact_canonical',
    weakExactCanonical: evidence.weakExactCanonical || row.channel === 'weak_exact_canonical',
    exactPrimaryAlias: evidence.exactPrimaryAlias || row.channel === 'exact_primary_alias',
    exactSupportingAlias: evidence.exactSupportingAlias || row.channel === 'exact_supporting_alias',
    foldedAlias: evidence.foldedAlias || row.channel === 'folded_alias',
    subphraseAlias: evidence.subphraseAlias || row.channel === 'subphrase_alias',
    englishAlias: evidence.englishAlias || row.channel === 'english_alias',
    titleToken: evidence.titleToken || row.channel === 'title_token' || row.channel === 'family_scoped_title_token',
    ngramAlias: evidence.ngramAlias || row.channel === 'ngram_alias',
    roleHeadEquivalent: evidence.roleHeadEquivalent || row.channel === 'role_head_equivalent',
    tieBreakerScore: Math.max(evidence.tieBreakerScore, row.tieBreakerScore)
  };
}

function shouldEnableFuzzyAliasRecall(surface: ClassifierSurface, comparisonQuery: CanonicalComparisonQuery): boolean {
  return true;
  // return comparisonQuery.canonicalExactKeys.length === 0 && surface.weakFoldedTokens.some((token) => token.length >= 5);
}
