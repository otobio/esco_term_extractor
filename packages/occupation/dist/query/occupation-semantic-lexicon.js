import { loadOccupationSemanticBootstrapArtifactRequired } from '../runtime/occupation-semantic-bootstrap-artifact.js';
import { normalizeSearchText } from '../utils/texts.js';
import { classifyOccupationBootstrapPhraseContribution, classifyOccupationBootstrapTokenContribution, computeOccupationBootstrapNetSignal } from './occupation-semantic-bootstrap.js';
const RUNTIME_CACHE = new Map();
const CORE_RULE_KINDS = new Set([
    'role_head',
    'domain_modifier',
    'role_phrase',
    'generic_noise',
    'generic_phrase'
]);
async function loadOccupationSemanticLexicon(locale) {
    const normalizedLocale = normalizeOccupationSemanticLocale(locale);
    if (!normalizedLocale) {
        return createNoopRuntime(locale);
    }
    const cacheKey = normalizedLocale;
    let cached = RUNTIME_CACHE.get(cacheKey);
    if (!cached) {
        cached = loadOccupationSemanticBootstrapArtifactRequired(normalizedLocale).then((entry) => compileRuntime(normalizedLocale, entry.artifact));
        RUNTIME_CACHE.set(cacheKey, cached);
    }
    return cached;
}
export async function analyzeOccupationSemanticSurface(surface, locale, options = {}) {
    const runtime = await loadOccupationSemanticLexicon(locale);
    return analyzeOccupationSemanticSurfaceFromRuntime(surface, runtime, options);
}
export function compareOccupationSemanticSurfaceAnalyses(left, right, options = {}) {
    const leftTokenSet = new Set(left.helpTokens);
    const rightTokenSet = new Set(right.helpTokens);
    const sharedTokens = uniqueSorted(left.helpTokens.filter((token) => rightTokenSet.has(token)));
    const leftOnlyTokens = uniqueSorted(left.helpTokens.filter((token) => !rightTokenSet.has(token)));
    const rightOnlyTokens = uniqueSorted(right.helpTokens.filter((token) => !leftTokenSet.has(token)));
    const sharedPhrases = options.debug ? uniqueSorted(extractSharedPhrases(left, right)) : [];
    const score = computeOccupationSemanticComparisonScore(left, right, sharedTokens, sharedPhrases);
    const decision = sharedTokens.length > 0 || sharedPhrases.length > 0 ? summarizeOccupationSemanticComparison(score, left, right) : 'neutral';
    return {
        locale: left.locale === right.locale ? left.locale : right.locale || left.locale,
        supportedLocale: left.supportedLocale && right.supportedLocale,
        leftSurface: left.surface,
        rightSurface: right.surface,
        left,
        right,
        sharedTokens,
        score,
        decision,
        debug: options.debug
            ? {
                leftOnlyTokens,
                rightOnlyTokens,
                sharedPhrases
            }
            : undefined
    };
}
export async function compareOccupationSemanticSurfaces(leftSurface, rightSurface, locale, options = {}) {
    const runtime = await loadOccupationSemanticLexicon(locale);
    const left = analyzeOccupationSemanticSurfaceFromRuntime(leftSurface, runtime, options);
    const right = analyzeOccupationSemanticSurfaceFromRuntime(rightSurface, runtime, options);
    return compareOccupationSemanticSurfaceAnalyses(left, right, options);
}
export async function cleanOccupationSemanticSurface(surface, locale, options = {}) {
    const runtime = await loadOccupationSemanticLexicon(locale);
    if (!runtime.supportedLocale) {
        return String(surface ?? '').trim();
    }
    return cleanOccupationSemanticSurfaceFromRuntime(surface, runtime, options);
}
function classifyToken(token, runtime, options) {
    const surface = String(token ?? '').trim();
    const normalizedSurface = normalizeOccupationSemanticSurface(surface);
    const matches = lookupRules(runtime.tokenLookup, normalizedSurface, options.includeAuxiliaryRules);
    const rule = chooseBestTokenRule(matches, runtime.thresholds);
    if (!rule) {
        return {
            matched: false,
            kind: 'token',
            surface,
            normalizedSurface,
            decision: 'neutral',
            occupationSignal: 0,
            penaltySignal: 0,
            netSignal: 0,
            rule: null
        };
    }
    const decision = classifyOccupationBootstrapTokenContribution(rule.occupationSignal, rule.penaltySignal, runtime.thresholds ?? undefined);
    return {
        matched: true,
        kind: 'token',
        surface,
        normalizedSurface,
        decision,
        occupationSignal: rule.occupationSignal,
        penaltySignal: rule.penaltySignal,
        netSignal: computeOccupationBootstrapNetSignal(rule.occupationSignal, rule.penaltySignal),
        rule: {
            kind: rule.kind,
            token: rule.token,
            note: rule.note
        }
    };
}
function _classifyPhrase(phrase, runtime, options) {
    const surface = String(phrase ?? '').trim();
    const normalizedSurface = normalizeOccupationSemanticSurface(surface);
    const matches = lookupRules(runtime.phraseLookup, normalizedSurface, options.includeAuxiliaryRules);
    const rule = chooseBestPhraseRule(matches, runtime.thresholds);
    if (!rule) {
        return {
            matched: false,
            kind: 'phrase',
            surface,
            normalizedSurface,
            decision: 'neutral',
            occupationSignal: 0,
            penaltySignal: 0,
            netSignal: 0,
            rule: null
        };
    }
    const decision = classifyOccupationBootstrapPhraseContribution(rule.occupationSignal, rule.penaltySignal, runtime.thresholds ?? undefined);
    return {
        matched: true,
        kind: 'phrase',
        surface,
        normalizedSurface,
        decision,
        occupationSignal: rule.occupationSignal,
        penaltySignal: rule.penaltySignal,
        netSignal: computeOccupationBootstrapNetSignal(rule.occupationSignal, rule.penaltySignal),
        rule: {
            kind: rule.kind,
            phrase: rule.phrase,
            note: rule.note
        }
    };
}
function cleanOccupationSemanticSurfaceFromRuntime(surface, runtime, options) {
    const original = String(surface ?? '').trim();
    const tokenSurfaces = tokenizeOccupationSemanticSurface(original);
    const retainedTokens = [];
    for (const token of tokenSurfaces) {
        const match = classifyToken(token, runtime, options);
        if (match.decision === 'hurt') {
            continue;
        }
        retainedTokens.push(token);
    }
    return retainedTokens.join(' ').trim();
}
function analyzeOccupationSemanticSurfaceFromRuntime(surface, runtime, options) {
    const original = String(surface ?? '').trim();
    if (!runtime.supportedLocale) {
        return {
            locale: runtime.locale,
            supportedLocale: false,
            surface: original,
            normalizedSurface: normalizeOccupationSemanticSurface(original),
            cleanedSurface: original,
            signalTokens: [],
            helpTokens: [],
            hurtTokens: [],
            tokenCount: 0,
            helpCount: 0,
            hurtCount: 0,
            neutralCount: 0,
            occupationSignal: 0,
            penaltySignal: 0,
            netSignal: 0,
            decision: 'neutral'
        };
    }
    const normalizedSurface = normalizeOccupationSemanticSurface(original);
    const tokenSurfaces = tokenizeOccupationSemanticSurface(original);
    const tokenMatches = options.debug ? [] : undefined;
    const phraseMatches = options.debug ? [] : undefined;
    const retainedTokens = [];
    const droppedTokens = [];
    const signalTokens = [];
    const helpTokens = [];
    const hurtTokens = [];
    const summary = createSemanticSummaryAccumulator();
    for (const token of tokenSurfaces) {
        const match = classifyToken(token, runtime, options);
        if (tokenMatches) {
            tokenMatches.push(match);
        }
        accumulateSemanticSummary(summary, match);
        if (match.decision === 'hurt') {
            droppedTokens.push(token);
            signalTokens.push(normalizeOccupationSemanticSurface(token));
            hurtTokens.push(normalizeOccupationSemanticSurface(token));
            continue;
        }
        retainedTokens.push(token);
        if (match.decision !== 'neutral') {
            signalTokens.push(normalizeOccupationSemanticSurface(token));
            helpTokens.push(normalizeOccupationSemanticSurface(token));
        }
    }
    for (const [normalizedPhrase, rules] of runtime.phraseLookup.entries()) {
        if (!containsNormalizedTerm(normalizedSurface, normalizedPhrase)) {
            continue;
        }
        const rule = chooseBestPhraseRule(rules, runtime.thresholds, options.includeAuxiliaryRules);
        if (!rule) {
            continue;
        }
        const match = buildPhraseMatch(rule, normalizedPhrase, runtime);
        if (phraseMatches) {
            phraseMatches.push(match);
        }
        accumulateSemanticSummary(summary, match);
        if (match.decision !== 'neutral') {
            signalTokens.push(normalizedPhrase);
            helpTokens.push(normalizedPhrase);
        }
    }
    const summaryDecision = summarizeOccupationSemanticCounts(summary.helpCount, summary.hurtCount, summary.netSignal);
    return {
        locale: runtime.locale,
        supportedLocale: true,
        surface: original,
        normalizedSurface,
        cleanedSurface: retainedTokens.join(' ').trim(),
        signalTokens: uniqueSorted(signalTokens),
        helpTokens: uniqueSorted(helpTokens),
        hurtTokens: uniqueSorted(hurtTokens),
        tokenCount: tokenSurfaces.length,
        helpCount: summary.helpCount,
        hurtCount: summary.hurtCount,
        neutralCount: summary.neutralCount,
        occupationSignal: summary.occupationSignal,
        penaltySignal: summary.penaltySignal,
        netSignal: summary.netSignal,
        decision: summaryDecision,
        debug: options.debug
            ? {
                tokenMatches: tokenMatches ?? [],
                phraseMatches: phraseMatches ?? [],
                retainedTokens,
                droppedTokens
            }
            : undefined
    };
}
function lookupRules(lookup, normalizedSurface, includeAuxiliaryRules = false) {
    const rules = lookup.get(normalizedSurface) ?? [];
    return includeAuxiliaryRules ? rules : rules.filter((rule) => CORE_RULE_KINDS.has(rule.kind));
}
function chooseBestTokenRule(rules, _thresholds) {
    if (rules.length === 0) {
        return null;
    }
    const ordered = [...rules].sort((left, right) => compareRuleScore(right.occupationSignal, right.penaltySignal, left.occupationSignal, left.penaltySignal));
    return ordered[0] ?? null;
}
function chooseBestPhraseRule(rules, _thresholds, includeAuxiliaryRules = false) {
    const filtered = includeAuxiliaryRules
        ? rules
        : rules.filter((rule) => CORE_RULE_KINDS.has(rule.kind));
    if (filtered.length === 0) {
        return null;
    }
    const ordered = [...filtered].sort((left, right) => compareRuleScore(right.occupationSignal, right.penaltySignal, left.occupationSignal, left.penaltySignal));
    return ordered[0] ?? null;
}
function compareRuleScore(leftOccupationSignal, leftPenaltySignal, rightOccupationSignal, rightPenaltySignal) {
    const leftScore = leftOccupationSignal - leftPenaltySignal;
    const rightScore = rightOccupationSignal - rightPenaltySignal;
    if (leftScore !== rightScore) {
        return leftScore - rightScore;
    }
    if (leftOccupationSignal !== rightOccupationSignal) {
        return leftOccupationSignal - rightOccupationSignal;
    }
    return rightPenaltySignal - leftPenaltySignal;
}
function createSemanticSummaryAccumulator() {
    return {
        helpCount: 0,
        hurtCount: 0,
        neutralCount: 0,
        occupationSignal: 0,
        penaltySignal: 0,
        netSignal: 0
    };
}
function accumulateSemanticSummary(summary, match) {
    summary.occupationSignal += match.occupationSignal;
    summary.penaltySignal += match.penaltySignal;
    summary.netSignal += match.netSignal;
    if (match.decision === 'help') {
        summary.helpCount += 1;
    }
    else if (match.decision === 'hurt') {
        summary.hurtCount += 1;
    }
    else {
        summary.neutralCount += 1;
    }
}
function summarizeOccupationSemanticCounts(helpCount, hurtCount, netScore) {
    const neutralBand = 0.15;
    if (netScore >= neutralBand && helpCount > 0) {
        return 'help';
    }
    if (netScore <= -neutralBand && hurtCount > 0) {
        return 'hurt';
    }
    return 'neutral';
}
function summarizeOccupationSemanticComparison(score, left, right) {
    if (score >= 1.5 && (left.signalTokens.length > 0 || right.signalTokens.length > 0)) {
        return 'help';
    }
    if (score <= -0.5 && (left.decision === 'hurt' || right.decision === 'hurt')) {
        return 'hurt';
    }
    return 'neutral';
}
function computeOccupationSemanticComparisonScore(left, right, sharedTokens, sharedPhrases) {
    return left.netSignal + right.netSignal + sharedTokens.length * 1.5 + sharedPhrases.length * 2;
}
function extractSharedPhrases(left, right) {
    if (!left.debug || !right.debug) {
        return [];
    }
    const rightPhraseSet = new Set(right.debug.phraseMatches.map((match) => match.normalizedSurface));
    return left.debug.phraseMatches.map((match) => match.normalizedSurface).filter((phrase) => rightPhraseSet.has(phrase));
}
function buildPhraseMatch(rule, normalizedPhrase, runtime) {
    const decision = classifyOccupationBootstrapPhraseContribution(rule.occupationSignal, rule.penaltySignal, runtime.thresholds ?? undefined);
    return {
        matched: true,
        kind: 'phrase',
        surface: rule.phrase,
        normalizedSurface: normalizedPhrase,
        decision,
        occupationSignal: rule.occupationSignal,
        penaltySignal: rule.penaltySignal,
        netSignal: computeOccupationBootstrapNetSignal(rule.occupationSignal, rule.penaltySignal),
        rule: {
            kind: rule.kind,
            phrase: rule.phrase,
            note: rule.note
        }
    };
}
function uniqueSorted(values) {
    return Array.from(new Set(values)).sort();
}
function createNoopRuntime(locale) {
    return {
        locale: String(locale ?? ''),
        supportedLocale: false,
        artifact: null,
        thresholds: null,
        tokenLookup: new Map(),
        phraseLookup: new Map()
    };
}
function compileRuntime(locale, artifact) {
    const tokenLookup = new Map();
    const phraseLookup = new Map();
    for (const rule of artifact.tokenRules) {
        const normalizedToken = normalizeOccupationSemanticSurface(rule.token);
        if (!normalizedToken) {
            continue;
        }
        const bucket = tokenLookup.get(normalizedToken);
        if (bucket) {
            bucket.push(rule);
        }
        else {
            tokenLookup.set(normalizedToken, [rule]);
        }
    }
    for (const rule of artifact.phraseRules) {
        const normalizedPhrase = normalizeOccupationSemanticSurface(rule.phrase);
        if (!normalizedPhrase) {
            continue;
        }
        const bucket = phraseLookup.get(normalizedPhrase);
        if (bucket) {
            bucket.push(rule);
        }
        else {
            phraseLookup.set(normalizedPhrase, [rule]);
        }
    }
    return {
        locale,
        supportedLocale: true,
        artifact,
        thresholds: artifact.thresholds,
        tokenLookup,
        phraseLookup
    };
}
function normalizeOccupationSemanticLocale(locale) {
    const normalized = String(locale ?? '')
        .trim()
        .toLowerCase();
    if (normalized === 'ro' || normalized === 'hu') {
        return normalized;
    }
    return null;
}
function normalizeOccupationSemanticSurface(value) {
    return normalizeSearchText(value);
}
function tokenizeOccupationSemanticSurface(value) {
    return normalizeOccupationSemanticSurface(value)
        .split(/\s+/u)
        .map((token) => token.trim())
        .filter(Boolean);
}
function containsNormalizedTerm(text, term) {
    const normalizedText = normalizeOccupationSemanticSurface(text);
    const normalizedTerm = normalizeOccupationSemanticSurface(term);
    if (!normalizedText || !normalizedTerm) {
        return false;
    }
    return ` ${normalizedText} `.includes(` ${normalizedTerm} `);
}
