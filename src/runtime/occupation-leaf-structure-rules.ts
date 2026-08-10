import { foldSearchText, tokenizeNormalizedText, type PreparedQuery } from '../query/query-preparation.js';
import type { LeafAuthorityKind, LeafSpecializationKind } from './occupation-leaf-structure-contract.js';

export const LEAF_STRUCTURE_AUTHORITY_ORDER: Array<{ token: string; kind: LeafAuthorityKind }> = [
  { token: 'chief', kind: 'chief' },
  { token: 'director', kind: 'director' },
  { token: 'manager', kind: 'manager' },
  { token: 'supervisor', kind: 'supervisor' },
  { token: 'lead', kind: 'lead' },
  { token: 'auditor', kind: 'auditor' }
];

export const LEAF_STRUCTURE_VENUE_TOKENS = new Set([
  'hotel',
  'hospital',
  'clinic',
  'school',
  'airport',
  'railway',
  'station',
  'restaurant',
  'shop',
  'store',
  'office',
  'mine',
  'laboratory',
  'lab'
]);
export const LEAF_STRUCTURE_CHANNEL_TOKENS = new Set([
  'chat',
  'online',
  'digital',
  'social',
  'media',
  'telephone',
  'call',
  'centre',
  'center',
  'broadcast',
  'helpdesk'
]);
export const LEAF_STRUCTURE_PRODUCT_TOKENS = new Set([
  'battery',
  'circuit',
  'hardware',
  'textile',
  'footwear',
  'furniture',
  'sensor',
  'satellite',
  'microelectronics',
  'games',
  'power',
  'device'
]);
export const LEAF_STRUCTURE_POPULATION_TOKENS = new Set([
  'customer',
  'client',
  'public',
  'student',
  'patient',
  'passenger',
  'visitor',
  'user'
]);
export const LEAF_STRUCTURE_TASK_FOCUS_TOKENS = new Set([
  'testing',
  'test',
  'maintenance',
  'repair',
  'repairer',
  'installation',
  'installer',
  'survey',
  'surveyor',
  'design',
  'designer',
  'simulation',
  'quality',
  'support',
  'operations',
  'operator',
  'analyst',
  'planner'
]);
export const LEAF_STRUCTURE_INDUSTRY_CONTEXT_TOKENS = new Set([
  'electrical',
  'electronics',
  'electronic',
  'electromechanical',
  'telecommunications',
  'telecom',
  'aviation',
  'aircraft',
  'flight',
  'automotive',
  'mining',
  'construction',
  'manufacturing',
  'medical',
  'energy',
  'software',
  'database',
  'network',
  'marketing',
  'advertising'
]);

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

  if (hasAny(tokens, LEAF_STRUCTURE_VENUE_TOKENS)) {
    kinds.add('venue');
  }
  if (hasAny(tokens, LEAF_STRUCTURE_CHANNEL_TOKENS)) {
    kinds.add('channel');
  }
  if (hasAny(tokens, LEAF_STRUCTURE_PRODUCT_TOKENS)) {
    kinds.add('product');
  }
  if (hasAny(tokens, LEAF_STRUCTURE_POPULATION_TOKENS)) {
    kinds.add('population');
  }
  if (hasAny(tokens, LEAF_STRUCTURE_TASK_FOCUS_TOKENS)) {
    kinds.add('task_focus');
  }
  if (hasAny(tokens, LEAF_STRUCTURE_INDUSTRY_CONTEXT_TOKENS)) {
    kinds.add('industry_context');
  }

  return Array.from(kinds).sort();
}

export function preparedQueryStructuralTokenSet(preparedQuery: PreparedQuery): Set<string> {
  return new Set(
    [
      ...preparedQuery.usefulFoldedTokens,
      ...preparedQuery.intent.roleTokens,
      ...preparedQuery.intent.roleHeadTokens,
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

export function preparedQuerySupportsSpecializationKind(preparedQuery: PreparedQuery, kind: LeafSpecializationKind): boolean {
  const structuralTokens = preparedQueryStructuralTokenSet(preparedQuery);

  if (kind === 'venue') {
    return (
      preparedQuery.intent.venueTokens.length > 0 ||
      preparedQuery.intent.domainTokens.length > 0 ||
      hasAny(structuralTokens, LEAF_STRUCTURE_VENUE_TOKENS)
    );
  }
  if (kind === 'channel') {
    return hasAny(structuralTokens, LEAF_STRUCTURE_CHANNEL_TOKENS);
  }
  if (kind === 'product') {
    return hasAny(structuralTokens, LEAF_STRUCTURE_PRODUCT_TOKENS);
  }
  if (kind === 'population') {
    return hasAny(structuralTokens, LEAF_STRUCTURE_POPULATION_TOKENS);
  }
  if (kind === 'task_focus') {
    return hasAny(structuralTokens, LEAF_STRUCTURE_TASK_FOCUS_TOKENS);
  }

  return preparedQuery.intent.domainTokens.length > 0 || hasAny(structuralTokens, LEAF_STRUCTURE_INDUSTRY_CONTEXT_TOKENS);
}

export function canonicalTokenSet(label: string): Set<string> {
  return new Set(tokenizeNormalizedText(foldSearchText(label)));
}

function hasAny(tokens: Set<string>, candidates: Set<string>): boolean {
  for (const token of tokens) {
    if (candidates.has(token)) {
      return true;
    }
  }

  return false;
}
