type IntentTerm = {
  token: string;
  normalizedToken: string;
  index: number;
};

type IntentVocabularyLookupLike = {
  roleHeads: Set<string>;
  roleModifiers: Set<string>;
  domainModifiers: Set<string>;
  ambiguousModifiers: Set<string>;
};

type TokenInSetOrVariant = (token: string, values: Set<string>, locale: 'ro') => boolean;

type RomanianRoleHeadCandidate = IntentTerm & {
  termIndex: number;
  score: number;
  reasons: string[];
};

const ROMANIAN_NON_ROLE_HEADS = new Set([
  'restaurant',
  'client',
  'student',
  'pacient',
  'magazin',
  'depozit',
  'transport',
  'management',
  'departament',
  'serviciu',
  'sistem',
  'program',
  'proiect',
  'produs',
  'companie',
  'firma',
  'industrie',
  'productie',
  'educatie',
  'constructie',
  'administratie',
  'organizatie',
  'activitate',
  'experienta',
  'specializare',
  'functie',
  'pozitie',
  'post',
  'loc',
  'echipa',
  'munca',
  'meserie',
  'domeniu'
]);

const ROMANIAN_ROLE_COMPLEMENT_PREPOSITIONS = new Set(['de', 'in', 'la', 'pentru']);

const ROMANIAN_STRONG_ROLE_SUFFIXES = ['ator', 'itor', 'ician', 'ist', 'olog', 'terapeut'];

const ROMANIAN_WEAK_ROLE_SUFFIXES = ['tor', 'ier', 'ant', 'ent'];

const ROMANIAN_STANDALONE_ROLE_NOUN_MIN_LENGTH = 9;

const ROMANIAN_POST_HEAD_ROLE_TAIL_TERMS = new Set([
  'asamblare',
  'caramida',
  'digital',
  'digitala',
  'digitale',
  'intretinere',
  'online',
  'reabilitare',
  'reparatii',
  'retea',
  'retele',
  'termic',
  'termica',
  'termice',
  'termici'
]);

const ROMANIAN_MIN_ROLE_HEAD_SCORE = 6;

export function isRomanianNonRoleHead(token: string): boolean {
  return ROMANIAN_NON_ROLE_HEADS.has(token);
}

export function looksLikeRomanianModifierAdjective(token: string): boolean {
  return (
    token.length >= 6 &&
    ['ean', 'eana', 'ene', 'eni', 'ala', 'ale', 'ali', 'ica', 'ice', 'ici', 'ian', 'iana', 'iene', 'ieni', 'iva', 'ive', 'ivi'].some(
      (suffix) => token.endsWith(suffix)
    )
  );
}

export function shouldRomanianFallbackToVenue(input: {
  terms: IntentTerm[];
  termIndex: number;
  vocabulary: IntentVocabularyLookupLike;
  venueContextTerms: Set<string>;
  tokenInSetOrVariant: TokenInSetOrVariant;
}): boolean {
  const { terms, termIndex, vocabulary, venueContextTerms, tokenInSetOrVariant } = input;
  const term = terms[termIndex];
  const next = terms[termIndex + 1];

  if (!term || !tokenInSetOrVariant(term.normalizedToken, venueContextTerms, 'ro')) {
    return false;
  }

  if (!next) {
    return false;
  }

  return (
    !ROMANIAN_NON_ROLE_HEADS.has(next.normalizedToken) &&
    !tokenInSetOrVariant(next.normalizedToken, vocabulary.roleHeads, 'ro') &&
    !tokenInSetOrVariant(next.normalizedToken, vocabulary.roleModifiers, 'ro') &&
    !tokenInSetOrVariant(next.normalizedToken, vocabulary.domainModifiers, 'ro') &&
    !tokenInSetOrVariant(next.normalizedToken, vocabulary.ambiguousModifiers, 'ro') &&
    !looksLikeRomanianModifierAdjective(next.normalizedToken)
  );
}

export function shouldAttachRomanianPostHeadRoleTail(input: {
  terms: IntentTerm[];
  termIndex: number;
  selectedRoleHeadIndex: number;
  roleIndexes: Set<number>;
  venueContextTerms: Set<string>;
  tokenInSetOrVariant: TokenInSetOrVariant;
}): boolean {
  const { terms, termIndex, selectedRoleHeadIndex, roleIndexes, venueContextTerms, tokenInSetOrVariant } = input;
  const term = terms.find((candidate) => candidate.index === termIndex);

  if (!term || term.index <= selectedRoleHeadIndex || !looksLikeRomanianPostHeadRoleTail(term.normalizedToken)) {
    return false;
  }

  for (let cursor = term.index - 1; cursor > selectedRoleHeadIndex; cursor -= 1) {
    const previous = terms.find((candidate) => candidate.index === cursor);

    if (!previous) {
      continue;
    }

    if (
      roleIndexes.has(previous.index) ||
      tokenInSetOrVariant(previous.normalizedToken, venueContextTerms, 'ro') ||
      ROMANIAN_ROLE_COMPLEMENT_PREPOSITIONS.has(previous.normalizedToken)
    ) {
      return true;
    }
  }

  return term.index === selectedRoleHeadIndex + 1;
}

export function inferRomanianStructuralRoleHead(input: {
  terms: IntentTerm[];
  vocabulary: IntentVocabularyLookupLike;
  venueContextTerms: Set<string>;
  framePriorityByToken: Map<string, number>;
  tokenInSetOrVariant: TokenInSetOrVariant;
}): (IntentTerm & { termIndex: number; reason: string }) | null {
  const { terms, vocabulary, venueContextTerms, framePriorityByToken, tokenInSetOrVariant } = input;
  const candidates: RomanianRoleHeadCandidate[] = [];

  for (let termIndex = 0; termIndex < terms.length; termIndex += 1) {
    const term = terms[termIndex];

    if (!term) {
      continue;
    }

    const result = romanianStructuralRoleHeadScore({
      terms,
      termIndex,
      vocabulary,
      venueContextTerms,
      framePriorityByToken,
      tokenInSetOrVariant
    });

    if (result.score <= 0) {
      continue;
    }

    candidates.push({ ...term, termIndex, score: result.score, reasons: result.reasons });
  }

  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((left, right) => right.score - left.score || romanianCandidateTieBreak(left, right, terms));

  const bestCandidate = candidates[0];

  if (!bestCandidate || bestCandidate.score < ROMANIAN_MIN_ROLE_HEAD_SCORE) {
    return null;
  }

  return {
    token: bestCandidate.token,
    normalizedToken: bestCandidate.normalizedToken,
    index: bestCandidate.index,
    termIndex: bestCandidate.termIndex,
    reason: `Romanian structural score ${bestCandidate.score}: ${bestCandidate.reasons.join(', ')}`
  };
}

function romanianStructuralRoleHeadScore(input: {
  terms: IntentTerm[];
  termIndex: number;
  vocabulary: IntentVocabularyLookupLike;
  venueContextTerms: Set<string>;
  framePriorityByToken: Map<string, number>;
  tokenInSetOrVariant: TokenInSetOrVariant;
}): { score: number; reasons: string[] } {
  const { terms, termIndex, vocabulary, venueContextTerms, framePriorityByToken, tokenInSetOrVariant } = input;
  const term = terms[termIndex];

  if (!term) {
    return { score: 0, reasons: [] };
  }

  const token = term.normalizedToken;
  const reasons: string[] = [];
  let score = 0;

  if (tokenInSetOrVariant(token, venueContextTerms, 'ro')) {
    return { score: -10, reasons: ['known venue/context noun'] };
  }

  if (ROMANIAN_NON_ROLE_HEADS.has(token)) {
    return { score: -8, reasons: ['known non-role noun'] };
  }

  if (tokenInSetOrVariant(token, vocabulary.domainModifiers, 'ro')) {
    return { score: -5, reasons: ['known domain modifier'] };
  }

  if (tokenInSetOrVariant(token, vocabulary.roleModifiers, 'ro')) {
    return { score: -5, reasons: ['known role modifier'] };
  }

  if (tokenInSetOrVariant(token, vocabulary.roleHeads, 'ro')) {
    score += 10;
    reasons.push('known Romanian role head');
  }

  if (framePriorityByToken.has(token)) {
    score += 4;
    reasons.push('Romanian role frame marker');
  }

  const morphologyScore = romanianOccupationMorphologyScore(token);

  if (morphologyScore > 0) {
    score += morphologyScore;
    reasons.push(morphologyScore >= 2 ? 'strong occupation-like morphology' : 'weak occupation-like morphology');
  }

  const standaloneBonus = romanianStandaloneOccupationBonus(terms, termIndex, morphologyScore);

  if (standaloneBonus > 0) {
    score += standaloneBonus;
    reasons.push('standalone occupation-shaped noun');
  }

  const contextScore = romanianRoleContextScore({ terms, termIndex, vocabulary, venueContextTerms, tokenInSetOrVariant });

  if (contextScore > 0) {
    score += contextScore;
    reasons.push(`adjacent role context +${contextScore}`);
  } else if (contextScore < 0) {
    score += contextScore;
    reasons.push(`adjacent venue context ${contextScore}`);
  }

  const complementScore = scoreRomanianRoleComplement(terms, termIndex);

  if (complementScore > 0) {
    score += complementScore;
    reasons.push('Romanian role complement');
  }

  const adjectivePenalty = romanianAdjectivePenalty(token);

  if (adjectivePenalty !== 0) {
    score += adjectivePenalty;
    reasons.push('adjective-like surface form');
  }

  return { score, reasons };
}

function romanianCandidateTieBreak(left: RomanianRoleHeadCandidate, right: RomanianRoleHeadCandidate, terms: IntentTerm[]): number {
  const leftKnown = romanianKnownRoleTieBreakScore(left.normalizedToken);
  const rightKnown = romanianKnownRoleTieBreakScore(right.normalizedToken);

  if (rightKnown !== leftKnown) {
    return rightKnown - leftKnown;
  }

  const leftContext = romanianLocalContextStrength(terms, left.termIndex);
  const rightContext = romanianLocalContextStrength(terms, right.termIndex);

  if (rightContext !== leftContext) {
    return rightContext - leftContext;
  }

  return left.termIndex - right.termIndex;
}

function romanianKnownRoleTieBreakScore(token: string): number {
  if (
    [
      'medic',
      'avocat',
      'profesor',
      'inginer',
      'arhitect',
      'farmacist',
      'psiholog',
      'dentist',
      'consultant',
      'programator',
      'dezvoltator',
      'specialist',
      'tehnician',
      'electrician',
      'contabil'
    ].includes(token)
  ) {
    return 2;
  }

  return 0;
}

function romanianLocalContextStrength(terms: IntentTerm[], termIndex: number): number {
  let score = 0;
  const previous = terms[termIndex - 1];
  const next = terms[termIndex + 1];

  if (previous && ROMANIAN_ROLE_COMPLEMENT_PREPOSITIONS.has(previous.normalizedToken)) {
    score += 1;
  }

  if (next && ROMANIAN_ROLE_COMPLEMENT_PREPOSITIONS.has(next.normalizedToken)) {
    score += 1;
  }

  return score;
}

function romanianOccupationMorphologyScore(token: string): number {
  if (token.length < 6) {
    return 0;
  }

  if (ROMANIAN_STRONG_ROLE_SUFFIXES.some((suffix) => token.endsWith(suffix))) {
    return 2;
  }

  if (ROMANIAN_WEAK_ROLE_SUFFIXES.some((suffix) => token.endsWith(suffix))) {
    return 1;
  }

  return 0;
}

function romanianRoleContextScore(input: {
  terms: IntentTerm[];
  termIndex: number;
  vocabulary: IntentVocabularyLookupLike;
  venueContextTerms: Set<string>;
  tokenInSetOrVariant: TokenInSetOrVariant;
}): number {
  const { terms, termIndex, vocabulary, venueContextTerms, tokenInSetOrVariant } = input;
  let score = 0;
  const previous = terms[termIndex - 1];
  const next = terms[termIndex + 1];

  if (previous) {
    score += romanianAdjacentRoleTermScore({ token: previous.normalizedToken, vocabulary, venueContextTerms, tokenInSetOrVariant });
  }

  if (next) {
    score += romanianAdjacentRoleTermScore({ token: next.normalizedToken, vocabulary, venueContextTerms, tokenInSetOrVariant });
  }

  return score;
}

function romanianAdjacentRoleTermScore(input: {
  token: string;
  vocabulary: IntentVocabularyLookupLike;
  venueContextTerms: Set<string>;
  tokenInSetOrVariant: TokenInSetOrVariant;
}): number {
  const { token, vocabulary, venueContextTerms, tokenInSetOrVariant } = input;

  if (tokenInSetOrVariant(token, venueContextTerms, 'ro')) {
    return -2;
  }

  if (tokenInSetOrVariant(token, vocabulary.roleModifiers, 'ro')) {
    return 3;
  }

  if (tokenInSetOrVariant(token, vocabulary.domainModifiers, 'ro')) {
    return 2;
  }

  if (tokenInSetOrVariant(token, vocabulary.ambiguousModifiers, 'ro')) {
    return 1;
  }

  return 0;
}

function scoreRomanianRoleComplement(terms: IntentTerm[], termIndex: number): number {
  const previous = terms[termIndex - 1];
  const next = terms[termIndex + 1];
  let score = 0;

  if (next && ROMANIAN_ROLE_COMPLEMENT_PREPOSITIONS.has(next.normalizedToken)) {
    score += 2;
  }

  if (previous && ROMANIAN_ROLE_COMPLEMENT_PREPOSITIONS.has(previous.normalizedToken)) {
    score += 1;
  }

  return score;
}

function romanianAdjectivePenalty(token: string): number {
  if (token.length < 6 || !looksLikeRomanianModifierAdjective(token)) {
    return 0;
  }

  return -4;
}

function romanianStandaloneOccupationBonus(terms: IntentTerm[], termIndex: number, morphologyScore: number): number {
  const term = terms[termIndex];

  if (
    !term ||
    terms.length !== 1 ||
    termIndex !== 0 ||
    morphologyScore < 2 ||
    term.normalizedToken.length < ROMANIAN_STANDALONE_ROLE_NOUN_MIN_LENGTH ||
    looksLikeRomanianModifierAdjective(term.normalizedToken)
  ) {
    return 0;
  }

  return 4;
}

function looksLikeRomanianPostHeadRoleTail(token: string): boolean {
  return (
    ROMANIAN_POST_HEAD_ROLE_TAIL_TERMS.has(token) ||
    looksLikeRomanianModifierAdjective(token) ||
    ['are', 'ere', 'ire', 'atie', 'atii', 'itie', 'itii', 'iune', 'iuni', 'ele'].some((suffix) => token.endsWith(suffix))
  );
}
