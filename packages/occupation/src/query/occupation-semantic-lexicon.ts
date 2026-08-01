import { loadOccupationSemanticBootstrapArtifactRequired, type OccupationSemanticBootstrapArtifact, type OccupationSemanticBootstrapPhraseRule, type OccupationSemanticBootstrapTokenRule } from '../runtime/occupation-semantic-bootstrap-artifact.js';
import { normalizeSearchText } from '../utils/texts.js';
import {
  classifyOccupationBootstrapPhraseContribution,
  classifyOccupationBootstrapTokenContribution,
  computeOccupationBootstrapNetSignal,
  type OccupationSemanticBootstrapContribution,
  type OccupationSemanticBootstrapThresholds
} from './occupation-semantic-bootstrap.js';

export type OccupationSemanticLexiconMatchKind = 'token' | 'phrase';

export type OccupationSemanticLexiconRuleKind =
  | 'role_head'
  | 'domain_modifier'
  | 'role_phrase'
  | 'generic_noise'
  | 'generic_phrase';

export type OccupationSemanticLexiconDecision = OccupationSemanticBootstrapContribution;

export type OccupationSemanticLexiconMatch = {
  matched: boolean;
  kind: OccupationSemanticLexiconMatchKind;
  surface: string;
  normalizedSurface: string;
  decision: OccupationSemanticLexiconDecision;
  occupationSignal: number;
  penaltySignal: number;
  netSignal: number;
  rule: {
    kind: OccupationSemanticLexiconRuleKind;
    token?: string;
    phrase?: string;
    note: string;
  } | null;
};

export type OccupationSemanticLexiconDebug = {
  tokenMatches: OccupationSemanticLexiconMatch[];
  phraseMatches: OccupationSemanticLexiconMatch[];
  retainedTokens: string[];
  droppedTokens: string[];
};

export type OccupationSemanticLexiconAnalysis = {
  locale: string;
  supportedLocale: boolean;
  surface: string;
  normalizedSurface: string;
  cleanedSurface: string;
  signalTokens: string[];
  helpTokens: string[];
  hurtTokens: string[];
  tokenCount: number;
  helpCount: number;
  hurtCount: number;
  neutralCount: number;
  occupationSignal: number;
  penaltySignal: number;
  netSignal: number;
  decision: OccupationSemanticLexiconDecision;
  debug?: OccupationSemanticLexiconDebug;
};

export type OccupationSemanticLexiconComparison = {
  locale: string;
  supportedLocale: boolean;
  leftSurface: string;
  rightSurface: string;
  left: OccupationSemanticLexiconAnalysis;
  right: OccupationSemanticLexiconAnalysis;
  sharedTokens: string[];
  score: number;
  decision: OccupationSemanticLexiconDecision;
  debug?: {
    leftOnlyTokens: string[];
    rightOnlyTokens: string[];
    sharedPhrases: string[];
  };
};

export type OccupationSemanticLexiconOptions = {
  includeAuxiliaryRules?: boolean;
  debug?: boolean;
};

type OccupationSemanticLexiconRuntime = {
  locale: string;
  supportedLocale: boolean;
  artifact: OccupationSemanticBootstrapArtifact | null;
  thresholds: OccupationSemanticBootstrapThresholds | null;
  tokenLookup: Map<string, OccupationSemanticBootstrapTokenRule[]>;
  phraseLookup: Map<string, OccupationSemanticBootstrapPhraseRule[]>;
};

const RUNTIME_CACHE = new Map<string, Promise<OccupationSemanticLexiconRuntime>>();
const CORE_RULE_KINDS = new Set<OccupationSemanticLexiconRuleKind>([
  'role_head',
  'domain_modifier',
  'role_phrase',
  'generic_noise',
  'generic_phrase'
]);

async function loadOccupationSemanticLexicon(locale: string): Promise<OccupationSemanticLexiconRuntime> {
  const normalizedLocale = normalizeOccupationSemanticLocale(locale);

  if (!normalizedLocale) {
    return createNoopRuntime(locale);
  }

  const cacheKey = normalizedLocale;
  let cached = RUNTIME_CACHE.get(cacheKey);

  if (!cached) {
    cached = loadOccupationSemanticBootstrapArtifactRequired(normalizedLocale).then((entry) =>
      compileRuntime(normalizedLocale, entry.artifact)
    );
    RUNTIME_CACHE.set(cacheKey, cached);
  }

  return cached;
}

export async function analyzeOccupationSemanticSurface(
  surface: string,
  locale: string,
  options: OccupationSemanticLexiconOptions = {}
): Promise<OccupationSemanticLexiconAnalysis> {
  const runtime = await loadOccupationSemanticLexicon(locale);
  return analyzeOccupationSemanticSurfaceFromRuntime(surface, runtime, options);
}

export function compareOccupationSemanticSurfaceAnalyses(
  left: OccupationSemanticLexiconAnalysis,
  right: OccupationSemanticLexiconAnalysis,
  options: OccupationSemanticLexiconOptions = {}
): OccupationSemanticLexiconComparison {
  const leftTokenSet = new Set(left.helpTokens);
  const rightTokenSet = new Set(right.helpTokens);
  const sharedTokens = uniqueSorted(left.helpTokens.filter((token) => rightTokenSet.has(token)));
  const leftOnlyTokens = uniqueSorted(left.helpTokens.filter((token) => !rightTokenSet.has(token)));
  const rightOnlyTokens = uniqueSorted(right.helpTokens.filter((token) => !leftTokenSet.has(token)));
  const sharedPhrases = options.debug ? uniqueSorted(extractSharedPhrases(left, right)) : [];
  const score = computeOccupationSemanticComparisonScore(left, right, sharedTokens, sharedPhrases);
  const decision = sharedTokens.length > 0 || sharedPhrases.length > 0
    ? summarizeOccupationSemanticComparison(score, left, right)
    : 'neutral';

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

export async function compareOccupationSemanticSurfaces(
  leftSurface: string,
  rightSurface: string,
  locale: string,
  options: OccupationSemanticLexiconOptions = {}
): Promise<OccupationSemanticLexiconComparison> {
  const runtime = await loadOccupationSemanticLexicon(locale);
  const left = analyzeOccupationSemanticSurfaceFromRuntime(leftSurface, runtime, options);
  const right = analyzeOccupationSemanticSurfaceFromRuntime(rightSurface, runtime, options);
  return compareOccupationSemanticSurfaceAnalyses(left, right, options);
}

export async function cleanOccupationSemanticSurface(
  surface: string,
  locale: string,
  options: OccupationSemanticLexiconOptions = {}
): Promise<string> {
  const runtime = await loadOccupationSemanticLexicon(locale);

  if (!runtime.supportedLocale) {
    return String(surface ?? '').trim();
  }

  return cleanOccupationSemanticSurfaceFromRuntime(surface, runtime, options);
}

function classifyToken(
  token: string,
  runtime: OccupationSemanticLexiconRuntime,
  options: OccupationSemanticLexiconOptions
): OccupationSemanticLexiconMatch {
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

  const decision = classifyOccupationBootstrapTokenContribution(
    rule.occupationSignal,
    rule.penaltySignal,
    runtime.thresholds ?? undefined
  );

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

function classifyPhrase(
  phrase: string,
  runtime: OccupationSemanticLexiconRuntime,
  options: OccupationSemanticLexiconOptions
): OccupationSemanticLexiconMatch {
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

  const decision = classifyOccupationBootstrapPhraseContribution(
    rule.occupationSignal,
    rule.penaltySignal,
    runtime.thresholds ?? undefined
  );

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

function cleanOccupationSemanticSurfaceFromRuntime(
  surface: string,
  runtime: OccupationSemanticLexiconRuntime,
  options: OccupationSemanticLexiconOptions
): string {
  const original = String(surface ?? '').trim();
  const tokenSurfaces = tokenizeOccupationSemanticSurface(original);
  const retainedTokens: string[] = [];

  for (const token of tokenSurfaces) {
    const match = classifyToken(token, runtime, options);

    if (match.decision === 'hurt') {
      continue;
    }

    retainedTokens.push(token);
  }

  return retainedTokens.join(' ').trim();
}

function analyzeOccupationSemanticSurfaceFromRuntime(
  surface: string,
  runtime: OccupationSemanticLexiconRuntime,
  options: OccupationSemanticLexiconOptions
): OccupationSemanticLexiconAnalysis {
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
  const tokenMatches: OccupationSemanticLexiconMatch[] | undefined = options.debug ? [] : undefined;
  const phraseMatches: OccupationSemanticLexiconMatch[] | undefined = options.debug ? [] : undefined;
  const retainedTokens: string[] = [];
  const droppedTokens: string[] = [];
  const signalTokens: string[] = [];
  const helpTokens: string[] = [];
  const hurtTokens: string[] = [];
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

function lookupRules<T extends OccupationSemanticBootstrapTokenRule | OccupationSemanticBootstrapPhraseRule>(
  lookup: Map<string, T[]>,
  normalizedSurface: string,
  includeAuxiliaryRules = false
): T[] {
  const rules = lookup.get(normalizedSurface) ?? [];
  return includeAuxiliaryRules ? rules : rules.filter((rule) => CORE_RULE_KINDS.has(rule.kind as OccupationSemanticLexiconRuleKind));
}

function chooseBestTokenRule(
  rules: OccupationSemanticBootstrapTokenRule[],
  thresholds: OccupationSemanticBootstrapThresholds | null
): OccupationSemanticBootstrapTokenRule | null {
  if (rules.length === 0) {
    return null;
  }

  const ordered = [...rules].sort((left, right) => compareRuleScore(right.occupationSignal, right.penaltySignal, left.occupationSignal, left.penaltySignal));
  return ordered[0] ?? null;
}

function chooseBestPhraseRule(
  rules: OccupationSemanticBootstrapPhraseRule[],
  thresholds: OccupationSemanticBootstrapThresholds | null,
  includeAuxiliaryRules = false
): OccupationSemanticBootstrapPhraseRule | null {
  const filtered = includeAuxiliaryRules ? rules : rules.filter((rule) => CORE_RULE_KINDS.has(rule.kind as OccupationSemanticLexiconRuleKind));

  if (filtered.length === 0) {
    return null;
  }

  const ordered = [...filtered].sort((left, right) => compareRuleScore(right.occupationSignal, right.penaltySignal, left.occupationSignal, left.penaltySignal));
  return ordered[0] ?? null;
}

function compareRuleScore(leftOccupationSignal: number, leftPenaltySignal: number, rightOccupationSignal: number, rightPenaltySignal: number): number {
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

function createSemanticSummaryAccumulator(): {
  helpCount: number;
  hurtCount: number;
  neutralCount: number;
  occupationSignal: number;
  penaltySignal: number;
  netSignal: number;
} {
  return {
    helpCount: 0,
    hurtCount: 0,
    neutralCount: 0,
    occupationSignal: 0,
    penaltySignal: 0,
    netSignal: 0
  };
}

function accumulateSemanticSummary(
  summary: {
    helpCount: number;
    hurtCount: number;
    neutralCount: number;
    occupationSignal: number;
    penaltySignal: number;
    netSignal: number;
  },
  match: OccupationSemanticLexiconMatch
): void {
  summary.occupationSignal += match.occupationSignal;
  summary.penaltySignal += match.penaltySignal;
  summary.netSignal += match.netSignal;

  if (match.decision === 'help') {
    summary.helpCount += 1;
  } else if (match.decision === 'hurt') {
    summary.hurtCount += 1;
  } else {
    summary.neutralCount += 1;
  }
}

function summarizeOccupationSemanticCounts(
  helpCount: number,
  hurtCount: number,
  netScore: number
): OccupationSemanticLexiconDecision {
  const neutralBand = 0.15;

  if (netScore >= neutralBand && helpCount > 0) {
    return 'help';
  }

  if (netScore <= -neutralBand && hurtCount > 0) {
    return 'hurt';
  }

  return 'neutral';
}

function summarizeOccupationSemanticComparison(
  score: number,
  left: OccupationSemanticLexiconAnalysis,
  right: OccupationSemanticLexiconAnalysis
): OccupationSemanticLexiconDecision {
  if (score >= 1.5 && (left.signalTokens.length > 0 || right.signalTokens.length > 0)) {
    return 'help';
  }

  if (score <= -0.5 && (left.decision === 'hurt' || right.decision === 'hurt')) {
    return 'hurt';
  }

  return 'neutral';
}

function computeOccupationSemanticComparisonScore(
  left: OccupationSemanticLexiconAnalysis,
  right: OccupationSemanticLexiconAnalysis,
  sharedTokens: string[],
  sharedPhrases: string[]
): number {
  return left.netSignal + right.netSignal + sharedTokens.length * 1.5 + sharedPhrases.length * 2;
}

function extractSharedPhrases(
  left: OccupationSemanticLexiconAnalysis,
  right: OccupationSemanticLexiconAnalysis
): string[] {
  if (!left.debug || !right.debug) {
    return [];
  }

  const rightPhraseSet = new Set(right.debug.phraseMatches.map((match) => match.normalizedSurface));
  return left.debug.phraseMatches
    .map((match) => match.normalizedSurface)
    .filter((phrase) => rightPhraseSet.has(phrase));
}

function buildPhraseMatch(
  rule: OccupationSemanticBootstrapPhraseRule,
  normalizedPhrase: string,
  runtime: OccupationSemanticLexiconRuntime
): OccupationSemanticLexiconMatch {
  const decision = classifyOccupationBootstrapPhraseContribution(
    rule.occupationSignal,
    rule.penaltySignal,
    runtime.thresholds ?? undefined
  );

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

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort();
}

function createNoopRuntime(locale: string): OccupationSemanticLexiconRuntime {
  return {
    locale: String(locale ?? ''),
    supportedLocale: false,
    artifact: null,
    thresholds: null,
    tokenLookup: new Map(),
    phraseLookup: new Map()
  };
}

function compileRuntime(
  locale: string,
  artifact: OccupationSemanticBootstrapArtifact
): OccupationSemanticLexiconRuntime {
  const tokenLookup = new Map<string, OccupationSemanticBootstrapTokenRule[]>();
  const phraseLookup = new Map<string, OccupationSemanticBootstrapPhraseRule[]>();

  for (const rule of artifact.tokenRules) {
    const normalizedToken = normalizeOccupationSemanticSurface(rule.token);
    if (!normalizedToken) {
      continue;
    }

    const bucket = tokenLookup.get(normalizedToken);
    if (bucket) {
      bucket.push(rule);
    } else {
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
    } else {
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

function normalizeOccupationSemanticLocale(locale: string | undefined): string | null {
  const normalized = String(locale ?? '').trim().toLowerCase();
  if (normalized === 'ro' || normalized === 'hu') {
    return normalized;
  }

  return null;
}

function normalizeOccupationSemanticSurface(value: string): string {
  return normalizeSearchText(value);
}

function tokenizeOccupationSemanticSurface(value: string): string[] {
  return normalizeOccupationSemanticSurface(value)
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean);
}

function containsNormalizedTerm(text: string, term: string): boolean {
  const normalizedText = normalizeOccupationSemanticSurface(text);
  const normalizedTerm = normalizeOccupationSemanticSurface(term);

  if (!normalizedText || !normalizedTerm) {
    return false;
  }

  return ` ${normalizedText} `.includes(` ${normalizedTerm} `);
}
