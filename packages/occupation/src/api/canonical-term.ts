import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { loadOccupationSearchMetaArtifactRequired, type RuntimeCapabilityRecord } from '../runtime/occupation-search-meta-artifact.js';
import { classifyOccupationTitle } from '../occupation-classifier/index.js';
import type {
  AltLeafCanonicalTerm as ClassifierAltLeafCanonicalTerm,
  RuntimeResult,
  SupportedQueryLocale
} from '../occupation-classifier/index.js';
import { classifyOccupationTitleViaEscoApi } from '../occupation-esco-api-classifier/index.js';
import type { EscoApiClassification, EscoFamily, EscoLeaf } from '../occupation-esco-api-classifier/index.js';

export type CanonicalTerm = {
  graphNodeId: number;
  canonicalTerm: string;
  confidence: number;
  fitTier?: string;
  fitReasons?: string[];
};

export type CapabilityCanonicalTerm = {
  capabilityId: number;
  canonicalTerm: string;
  capabilityType: 'skill' | 'knowledge' | 'tool' | 'software' | 'language';
  confidence: number;
};

export type GetCanonicalTermInput = {
  input: string;
  locale?: string;
  limit?: number;
  jobFunction?: string;
  // 'v2' (default) routes through the occupation-classifier.
  // 'v3' routes through the ESCO REST API classifier; its ESCO labels are mapped back to graph node ids.
  mode?: 'v2' | 'v3';
};

export type CanonicalDecision = {
  decisionType: RuntimeResult['decision']['type'] | EscoApiClassification['decision']['type'];
  selectedCanonicalTerm: string | null;
  selectedGraphNodeId: number | null;
  confidence: number;
};

export type GetCanonicalTermResult = {
  input: string;
  locale: string;
  occupationContexts: CanonicalOccupationContext[];
};

export type CanonicalOccupationContext = {
  spanIndex: number;
  input: string;
  decision: CanonicalDecision;
  coverageStatus: RuntimeResult['coverage']['status'];
  // Only present when the decision resolved a specific leaf occupation (decisionType === 'leaf').
  selectedLeafTerm: CanonicalTerm | null;
  // Present whenever the decision resolved at least a family/group, independent of leaf resolution.
  selectedFamilyTerm: CanonicalTerm | null;
  // Other candidates considered, excluding whichever term is already selected above. Informational only.
  altLeafCanonicalTerms: CanonicalTerm[];
  altFamilyCanonicalTerms: CanonicalTerm[];
  // Only present when selectedLeafTerm is present.
  capabilityTerms: CapabilityCanonicalTerm[];
};

const DEFAULT_API_LOCALE = 'en';
const DEFAULT_API_LIMIT = 3;
const ESCO_LABEL_NODE_INDEX_CACHE = new Map<string, Promise<EscoLabelNodeIndex>>();

type EscoLabelNodeIndex = { leafNodeIdByLabel: Map<string, number>; familyNodeIdByLabel: Map<string, number> };

const ESCO_API_COVERAGE_STATUS: Record<EscoApiClassification['decision']['reason'], RuntimeResult['coverage']['status']> = {
  empty_query: 'insufficient_evidence',
  multi_span: 'multi_span',
  exact_preferred_label_leaf: 'exact_canonical_match',
  exact_alternative_label_leaf: 'exact_canonical_match',
  exact_hidden_label_leaf: 'exact_canonical_match',
  exact_family_label: 'exact_canonical_match',
  family_leaf_ambiguity: 'closest_available_match',
  family_dictionary_gap: 'likely_dictionary_gap',
  unresolved_weak_evidence: 'insufficient_evidence',
  unresolved_no_candidates: 'insufficient_evidence'
};

export async function getCanonicalTerm(options: GetCanonicalTermInput): Promise<GetCanonicalTermResult> {
  if (options.mode === 'v3') {
    return getCanonicalTermV3(options);
  }

  return getCanonicalTermV2(options);
}

async function getCanonicalTermV2(options: GetCanonicalTermInput): Promise<GetCanonicalTermResult> {
  const input = options.input.trim();

  if (!input) {
    throw new Error('getCanonicalTerm requires a non-empty input.');
  }

  const limit = normalizeLimit(options.limit);
  const sourceName = DEFAULT_ESCO_SOURCE_NAME;
  const runtimeResult = await classifyOccupationTitle({
    query: input,
    locale: options.locale as SupportedQueryLocale | undefined,
    sourceName
  });
  const spanResults = runtimeResult.spans ?? [{ query: input, result: runtimeResult }];
  const occupationContexts: CanonicalOccupationContext[] = [];

  for (let spanIndex = 0; spanIndex < spanResults.length; spanIndex++) {
    const span = spanResults[spanIndex];
    occupationContexts.push(await canonicalOccupationContextFromRuntimeResult(sourceName, spanIndex + 1, span.query, span.result, limit));
  }

  return {
    input,
    locale: options.locale ?? DEFAULT_API_LOCALE,
    occupationContexts
  };
}

async function canonicalOccupationContextFromRuntimeResult(
  sourceName: string,
  spanIndex: number,
  query: string,
  result: RuntimeResult,
  limit: number
): Promise<CanonicalOccupationContext> {
  const selectedLeafTerm: CanonicalTerm | null = result.leaf
    ? { graphNodeId: result.leaf.graphNodeId, canonicalTerm: result.leaf.canonicalLabel, confidence: result.decision.confidence }
    : null;
  const selectedFamilyTerm: CanonicalTerm | null = result.family
    ? { graphNodeId: result.family.familyNodeId, canonicalTerm: result.family.familyLabel, confidence: result.decision.confidence }
    : null;
  const altLeafCanonicalTerms = toAltLeafCanonicalTerms(result.altLeafCanonicalTerms, limit);
  const capabilityLeafTerms = selectedLeafTerm ? [selectedLeafTerm] : [];

  return {
    spanIndex,
    input: query,
    decision: {
      decisionType: result.decision.type,
      selectedCanonicalTerm: result.leaf?.canonicalLabel ?? result.family?.familyLabel ?? null,
      selectedGraphNodeId: result.leaf?.graphNodeId ?? result.family?.familyNodeId ?? null,
      confidence: result.decision.confidence
    },
    coverageStatus: result.coverage.status,
    selectedLeafTerm,
    selectedFamilyTerm,
    altLeafCanonicalTerms,
    altFamilyCanonicalTerms: [],
    capabilityTerms: await topCapabilityTerms(sourceName, capabilityLeafTerms, limit)
  };
}

async function getCanonicalTermV3(options: GetCanonicalTermInput): Promise<GetCanonicalTermResult> {
  const input = options.input.trim();

  if (!input) {
    throw new Error('getCanonicalTerm requires a non-empty input.');
  }

  const limit = normalizeLimit(options.limit);
  const locale = options.locale ?? DEFAULT_API_LOCALE;
  const sourceName = DEFAULT_ESCO_SOURCE_NAME;
  const [result, nodeIndex] = await Promise.all([
    classifyOccupationTitleViaEscoApi({ query: input, locale }),
    loadEscoLabelNodeIndex(sourceName)
  ]);
  const spanResults = result.spans ?? [{ query: input, result }];
  const occupationContexts: CanonicalOccupationContext[] = [];

  for (let spanIndex = 0; spanIndex < spanResults.length; spanIndex++) {
    const span = spanResults[spanIndex];
    occupationContexts.push(await canonicalOccupationContextFromEscoApiResult(sourceName, nodeIndex, spanIndex + 1, span.query, span.result, limit));
  }

  return { input, locale, occupationContexts };
}

async function canonicalOccupationContextFromEscoApiResult(
  sourceName: string,
  nodeIndex: EscoLabelNodeIndex,
  spanIndex: number,
  query: string,
  result: EscoApiClassification,
  limit: number
): Promise<CanonicalOccupationContext> {
  const selectedLeafTerm = result.leaf ? escoLeafTerm(nodeIndex, result.leaf) : null;
  const selectedFamilyTerm = result.family ? escoFamilyTerm(nodeIndex, result.family) : null;
  const selectedTerm = selectedLeafTerm ?? selectedFamilyTerm;
  const altLeafCanonicalTerms = result.altLeaves.map((leaf) => escoLeafTerm(nodeIndex, leaf)).filter(isMappedTerm).slice(0, limit);
  const altFamilyCanonicalTerms = result.altFamilies.map((family) => escoFamilyTerm(nodeIndex, family)).filter(isMappedTerm).slice(0, limit);
  const capabilityLeafTerms = selectedLeafTerm && isMappedTerm(selectedLeafTerm) ? [selectedLeafTerm] : [];

  return {
    spanIndex,
    input: query,
    decision: {
      decisionType: result.decision.type,
      selectedCanonicalTerm: selectedTerm?.canonicalTerm ?? null,
      selectedGraphNodeId: selectedTerm?.graphNodeId ?? null,
      confidence: result.decision.confidence
    },
    coverageStatus: ESCO_API_COVERAGE_STATUS[result.decision.reason],
    selectedLeafTerm,
    selectedFamilyTerm,
    altLeafCanonicalTerms,
    altFamilyCanonicalTerms,
    capabilityTerms: await topCapabilityTerms(sourceName, capabilityLeafTerms, limit)
  };
}

function escoLeafTerm(nodeIndex: EscoLabelNodeIndex, leaf: EscoLeaf): CanonicalTerm {
  return { graphNodeId: nodeIndex.leafNodeIdByLabel.get(leaf.label) ?? -1, canonicalTerm: leaf.label, confidence: leaf.confidence };
}

function escoFamilyTerm(nodeIndex: EscoLabelNodeIndex, family: EscoFamily): CanonicalTerm {
  return { graphNodeId: nodeIndex.familyNodeIdByLabel.get(family.label) ?? -1, canonicalTerm: family.label, confidence: family.confidence };
}

function isMappedTerm(term: CanonicalTerm): boolean {
  return term.graphNodeId >= 0;
}

function loadEscoLabelNodeIndex(sourceName: string): Promise<EscoLabelNodeIndex> {
  let cached = ESCO_LABEL_NODE_INDEX_CACHE.get(sourceName);

  if (!cached) {
    cached = loadOccupationSearchMetaArtifactRequired(sourceName).then(buildEscoLabelNodeIndex);
    ESCO_LABEL_NODE_INDEX_CACHE.set(sourceName, cached);
  }

  return cached;
}

function buildEscoLabelNodeIndex(artifactEntry: Awaited<ReturnType<typeof loadOccupationSearchMetaArtifactRequired>>): EscoLabelNodeIndex {
  const leafNodeIdByLabel = new Map<string, number>();
  const familyNodeIdByLabel = new Map<string, number>();

  for (const record of artifactEntry.getAllCoreRecords()) {
    leafNodeIdByLabel.set(record.canonicalLabel, record.graphNodeId);

    if (record.familyNodeId !== null && record.familyLabel !== null) {
      familyNodeIdByLabel.set(record.familyLabel, record.familyNodeId);
    }
  }

  return { leafNodeIdByLabel, familyNodeIdByLabel };
}

function toAltLeafCanonicalTerms(terms: ClassifierAltLeafCanonicalTerm[], limit: number): CanonicalTerm[] {
  return terms.slice(0, limit).map((term) => ({
    graphNodeId: term.graphNodeId,
    canonicalTerm: term.canonicalTerm,
    confidence: term.confidence
  }));
}

async function topCapabilityTerms(sourceName: string, leafTerms: CanonicalTerm[], limit: number): Promise<CapabilityCanonicalTerm[]> {
  if (leafTerms.length === 0) {
    return [];
  }

  const artifactEntry = await loadOccupationSearchMetaArtifactRequired(sourceName);
  const byCapabilityId = new Map<number, CapabilityCanonicalTerm>();

  for (const leafTerm of leafTerms) {
    const record = artifactEntry.getDetails(leafTerm.graphNodeId);

    if (!record) {
      continue;
    }

    for (const capability of sortRuntimeCapabilities(record.capabilityLabels)) {
      mergeCapabilityTerm(byCapabilityId, capability, leafTerm.confidence);
    }
  }

  return Array.from(byCapabilityId.values())
    .sort((left, right) => right.confidence - left.confidence || left.canonicalTerm.localeCompare(right.canonicalTerm))
    .slice(0, limit);
}

function mergeCapabilityTerm(
  byCapabilityId: Map<number, CapabilityCanonicalTerm>,
  capability: RuntimeCapabilityRecord,
  leafConfidence: number
): void {
  const hintWeight = capability.weight ?? 0.7;
  const hintKindMultiplier = capability.hintKind === 'essential' ? 1 : capability.hintKind === 'optional' ? 0.72 : 0.86;
  const confidence = clampScore(leafConfidence * hintWeight * hintKindMultiplier);
  const existing = byCapabilityId.get(capability.capabilityId);

  if (existing && existing.confidence >= confidence) {
    return;
  }

  byCapabilityId.set(capability.capabilityId, {
    capabilityId: capability.capabilityId,
    canonicalTerm: capability.label,
    capabilityType: capability.capabilityType,
    confidence
  });
}

function sortRuntimeCapabilities(capabilities: RuntimeCapabilityRecord[]): RuntimeCapabilityRecord[] {
  return [...capabilities].sort(
    (left, right) =>
      capabilityKindOrder(left.hintKind) - capabilityKindOrder(right.hintKind) ||
      (right.weight ?? 0) - (left.weight ?? 0) ||
      left.label.localeCompare(right.label)
  );
}

function capabilityKindOrder(hintKind: string): number {
  if (hintKind === 'essential') {
    return 1;
  }

  if (hintKind === 'knowledge') {
    return 2;
  }

  if (hintKind === 'tool') {
    return 3;
  }

  if (hintKind === 'software') {
    return 4;
  }

  if (hintKind === 'optional') {
    return 5;
  }

  return 6;
}

function normalizeLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_API_LIMIT;

  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw new Error(`getCanonicalTerm limit must be an integer from 1 to 10. Received "${limit}".`);
  }

  return limit;
}

function clampScore(value: number): number {
  const rounded = Number(Math.max(0, Math.min(1, value)).toFixed(6));
  return Object.is(rounded, -0) ? 0 : rounded;
}
