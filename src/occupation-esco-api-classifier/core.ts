import { isEnglishQuery } from '../utils/lang.js';
import { timed, type TimingMap } from '../utils/timing.js';
import { defaultEscoApiClient, type EscoApiClient } from './client.js';
import { ESCO_ISCO_URI_PREFIX, ESCO_VOCABULARY_SOURCE_NAME } from './config.js';
import { altLeafConfidence, selectSpanDecision } from './decision.js';
import { buildSpanEvidence } from './evidence.js';
import { prepareSpan, requireEscoApiLocale, splitTitleSpans } from './preparation.js';
import type {
  EscoApiClassification,
  EscoApiClassificationDebug,
  EscoApiClassificationInput,
  EscoApiLocale,
  EscoApiSpanDebug,
  EscoFamily,
  EscoIscoGroup,
  EscoLeaf,
  OccupationCandidate,
  SpanDecision,
  SpanEvidence
} from './types.js';

type LanguagePass = { language: EscoApiLocale; evidence: SpanEvidence; spanDecision: SpanDecision };

type SpanRun = { result: EscoApiClassification; debug: EscoApiSpanDebug };

export async function classifyOccupationTitleViaEscoApi(input: EscoApiClassificationInput): Promise<EscoApiClassification> {
  return (await classifyOccupationTitleViaEscoApiDebug(input)).result;
}

export async function classifyOccupationTitleViaEscoApiDebug(input: EscoApiClassificationInput): Promise<EscoApiClassificationDebug> {
  const locale = requireEscoApiLocale(input.locale);
  const client = input.client ?? defaultEscoApiClient();
  const spans = splitTitleSpans(input.query);

  if (spans.length === 0) {
    return { result: emptyResult('unresolved', 'empty_query'), spans: [] };
  }

  const runs = await Promise.all(spans.map((span) => classifySpan(span, locale, client)));
  const [singleRun] = runs;

  if (runs.length === 1 && singleRun) {
    return { result: singleRun.result, spans: [singleRun.debug] };
  }

  return {
    result: {
      ...emptyResult('multi_span', 'multi_span'),
      spans: runs.map((run) => ({ query: run.debug.query, result: run.result }))
    },
    spans: runs.map((run) => run.debug)
  };
}

async function classifySpan(spanText: string, locale: EscoApiLocale, client: EscoApiClient): Promise<SpanRun> {
  const timings: TimingMap = {};

  const spanLanguage = await timed(() => detectSpanLanguage(spanText, locale), 'languageDetection', timings);
  const spanPass = await runLanguagePass(spanText, spanLanguage, client, timings);
  const needsEnglishPass = spanLanguage !== 'en' && spanPass.spanDecision.decision.type === 'unresolved';
  const englishPass = needsEnglishPass ? await runLanguagePass(spanText, 'en', client, timings) : null;
  const pass = englishPass && englishPass.spanDecision.decision.type !== 'unresolved' ? englishPass : spanPass;

  const { spanDecision } = pass;
  const familyUris = [spanDecision.familyUri, ...spanDecision.altFamilies.map((family) => family.familyUri)].filter((uri): uri is string => uri !== null);
  const familyGroups =
    familyUris.length > 0 ? await timed(() => client.getIscoGroups(familyUris, locale), 'familyLabels', timings) : new Map<string, EscoIscoGroup>();

  const result: EscoApiClassification = {
    decision: spanDecision.decision,
    leaf: spanDecision.leaf ? toLeaf(spanDecision.leaf, spanDecision.decision.confidence) : null,
    family: spanDecision.familyUri ? toFamily(spanDecision.familyUri, spanDecision.decision.confidence, familyGroups) : null,
    altLeaves: spanDecision.altLeaves.map((candidate) => toLeaf(candidate, altLeafConfidence(candidate.match))),
    altFamilies: spanDecision.altFamilies.map((family) => toFamily(family.familyUri, family.confidence, familyGroups)),
    coverage: spanDecision.coverage,
    evidenceLanguage: pass.language
  };

  return {
    result,
    debug: {
      query: spanText,
      evidenceLanguage: pass.language,
      candidates: pass.evidence.candidates,
      familyLabelCandidates: pass.evidence.familyLabelCandidates,
      timings
    }
  };
}

async function detectSpanLanguage(spanText: string, locale: EscoApiLocale): Promise<EscoApiLocale> {
  if (locale === 'en') {
    return 'en';
  }

  return (await isEnglishQuery(spanText, ESCO_VOCABULARY_SOURCE_NAME)) ? 'en' : locale;
}

async function runLanguagePass(spanText: string, language: EscoApiLocale, client: EscoApiClient, timings: TimingMap): Promise<LanguagePass> {
  const span = prepareSpan(spanText, language);

  const [hits, terms] = await Promise.all([
    timed(() => client.searchOccupations(span.text, language), `search.${language}`, timings),
    timed(() => client.searchTerms(span.text, language), `terms.${language}`, timings)
  ]);

  const evidence = buildSpanEvidence(span, language, hits, terms);

  return { language, evidence, spanDecision: selectSpanDecision(evidence) };
}

function toLeaf(candidate: OccupationCandidate, confidence: number): EscoLeaf {
  return {
    uri: candidate.uri,
    code: candidate.code,
    label: candidate.label,
    localLabel: candidate.localLabel,
    familyUri: candidate.familyUri,
    matchedLabel: candidate.match?.label ?? null,
    matchedLabelSource: candidate.match?.source ?? null,
    confidence
  };
}

function toFamily(uri: string, confidence: number, groups: Map<string, EscoIscoGroup>): EscoFamily {
  const group = groups.get(uri);
  const code = uri.slice(ESCO_ISCO_URI_PREFIX.length);

  return { uri, code: group?.code ?? code, label: group?.label ?? code, localLabel: group?.localLabel ?? code, confidence };
}

function emptyResult(type: 'unresolved' | 'multi_span', reason: 'empty_query' | 'multi_span'): EscoApiClassification {
  return {
    decision: { type, reason, confidence: type === 'multi_span' ? 1 : 0 },
    leaf: null,
    family: null,
    altLeaves: [],
    altFamilies: [],
    coverage: { matchedTokens: [], missingTokens: [] },
    evidenceLanguage: null
  };
}
