import { isEnglishQuery } from '../utils/lang.js';
import { timed } from '../utils/timing.js';
import { defaultEscoApiClient } from './client.js';
import { ESCO_ISCO_URI_PREFIX, ESCO_VOCABULARY_SOURCE_NAME } from './config.js';
import { altLeafConfidence, selectSpanDecision } from './decision.js';
import { buildSpanEvidence } from './evidence.js';
import { prepareSpan, requireEscoApiLocale, splitTitleSpans } from './preparation.js';
export async function classifyOccupationTitleViaEscoApi(input) {
    return (await classifyOccupationTitleViaEscoApiDebug(input)).result;
}
export async function classifyOccupationTitleViaEscoApiDebug(input) {
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
async function classifySpan(spanText, locale, client) {
    const timings = {};
    const spanLanguage = await timed(() => detectSpanLanguage(spanText, locale), 'languageDetection', timings);
    const spanPass = await runLanguagePass(spanText, spanLanguage, client, timings);
    const needsEnglishPass = spanLanguage !== 'en' && spanPass.spanDecision.decision.type === 'unresolved';
    const englishPass = needsEnglishPass ? await runLanguagePass(spanText, 'en', client, timings) : null;
    const pass = englishPass && englishPass.spanDecision.decision.type !== 'unresolved' ? englishPass : spanPass;
    const { spanDecision } = pass;
    const familyUris = [spanDecision.familyUri, ...spanDecision.altFamilies.map((family) => family.familyUri)].filter((uri) => uri !== null);
    const familyGroups = familyUris.length > 0 ? await timed(() => client.getIscoGroups(familyUris, locale), 'familyLabels', timings) : new Map();
    const result = {
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
async function detectSpanLanguage(spanText, locale) {
    if (locale === 'en') {
        return 'en';
    }
    return (await isEnglishQuery(spanText, ESCO_VOCABULARY_SOURCE_NAME)) ? 'en' : locale;
}
async function runLanguagePass(spanText, language, client, timings) {
    const span = prepareSpan(spanText, language);
    const [hits, terms] = await Promise.all([
        timed(() => client.searchOccupations(span.text, language), `search.${language}`, timings),
        timed(() => client.searchTerms(span.text, language), `terms.${language}`, timings)
    ]);
    const evidence = buildSpanEvidence(span, language, hits, terms);
    return { language, evidence, spanDecision: selectSpanDecision(evidence) };
}
function toLeaf(candidate, confidence) {
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
function toFamily(uri, confidence, groups) {
    const group = groups.get(uri);
    const code = uri.slice(ESCO_ISCO_URI_PREFIX.length);
    return { uri, code: group?.code ?? code, label: group?.label ?? code, localLabel: group?.localLabel ?? code, confidence };
}
function emptyResult(type, reason) {
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
