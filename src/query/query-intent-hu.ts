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

type TokenInSetOrVariant = (token: string, values: Set<string>, locale: 'hu') => boolean;

type HungarianRoleHeadCandidate = IntentTerm & {
  termIndex: number;
  score: number;
  reasons: string[];
};

const HUNGARIAN_NON_ROLE_HEADS = new Set([
  'allas',
  'allasok',
  'ceg',
  'cegek',
  'gyar',
  'gyartas',
  'hotel',
  'iskola',
  'iroda',
  'karrier',
  'klinika',
  'korhaz',
  'labor',
  'logisztika',
  'munkakor',
  'munkalehetoseg',
  'munka',
  'mozgas',
  'office',
  'pozicio',
  'repuloter',
  'raktar',
  'szerep',
  'telephely',
  'termeles',
  'uzem',
  'uzlet',
  'vallalat',
  'vasarlas',
  'varos'
]);

const HUNGARIAN_STRONG_ROLE_SUFFIXES = ['ar', 'as', 'es', 'lo', 'nok', 'os', 'szakacs', 'to'];
const HUNGARIAN_HIGH_CONFIDENCE_HEADS = new Set([
  'adminisztrator',
  'asszisztens',
  'dolgozo',
  'beszerzo',
  'elemzo',
  'elado',
  'futar',
  'hegeszto',
  'hivatalnok',
  'karbantarto',
  'kepviselo',
  'koordinator',
  'konyvelo',
  'lakatos',
  'menedzser',
  'munkas',
  'munkatars',
  'operator',
  'penztaros',
  'pultos',
  'raktaros',
  'szerelo',
  'specialista',
  'szakacs',
  'technikus',
  'takarito',
  'vezeto',
  'ertekesito'
]);

const HUNGARIAN_HARD_ROLE_HEADS = HUNGARIAN_HIGH_CONFIDENCE_HEADS;

const HUNGARIAN_ROLE_FRAME_PREPOSITIONS = new Set(['a', 'az', 'de', 'es', 'fel', 'for', 'mellett', 'nal', 'nel', 're', 'ra']);

const HUNGARIAN_MIN_ROLE_HEAD_SCORE = 6;

export function inferHungarianStructuralRoleHead(input: {
  terms: IntentTerm[];
  vocabulary: IntentVocabularyLookupLike;
  venueContextTerms: Set<string>;
  framePriorityByToken: Map<string, number>;
  tokenInSetOrVariant: TokenInSetOrVariant;
}): (IntentTerm & { termIndex: number; reason: string }) | null {
  const { terms, vocabulary, venueContextTerms, framePriorityByToken, tokenInSetOrVariant } = input;
  const candidates: HungarianRoleHeadCandidate[] = [];

  for (let termIndex = 0; termIndex < terms.length; termIndex += 1) {
    const term = terms[termIndex];

    if (!term) {
      continue;
    }

    const result = hungarianStructuralRoleHeadScore({
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

  candidates.sort((left, right) => right.score - left.score || hungarianCandidateTieBreak(left, right, terms));

  const bestCandidate = candidates[0];

  if (!bestCandidate || bestCandidate.score < HUNGARIAN_MIN_ROLE_HEAD_SCORE) {
    return null;
  }

  return {
    token: bestCandidate.token,
    normalizedToken: bestCandidate.normalizedToken,
    index: bestCandidate.index,
    termIndex: bestCandidate.termIndex,
    reason: `Hungarian structural score ${bestCandidate.score}: ${bestCandidate.reasons.join(', ')}`
  };
}

function hungarianStructuralRoleHeadScore(input: {
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

  if (tokenInSetOrVariant(token, venueContextTerms, 'hu')) {
    return { score: -10, reasons: ['known venue/context noun'] };
  }

  if (HUNGARIAN_NON_ROLE_HEADS.has(token)) {
    return { score: -8, reasons: ['known non-role noun'] };
  }

  // A curated hard role head (e.g. "vezeto") can also get corpus-mined into vocabulary.domainModifiers /
  // roleModifiers from its appearance inside compound family-label phrases (e.g. "Penzugyi vezetok"). That
  // incidental tagging must not veto a token we've deliberately curated as a safe, standalone role head.
  if (!HUNGARIAN_HARD_ROLE_HEADS.has(token)) {
    if (tokenInSetOrVariant(token, vocabulary.domainModifiers, 'hu')) {
      return { score: -5, reasons: ['known domain modifier'] };
    }

    if (tokenInSetOrVariant(token, vocabulary.roleModifiers, 'hu')) {
      return { score: -5, reasons: ['known role modifier'] };
    }
  }

  if (tokenInSetOrVariant(token, vocabulary.roleHeads, 'hu')) {
    score += 10;
    reasons.push('known Hungarian role head');
  }

  if (HUNGARIAN_HARD_ROLE_HEADS.has(token)) {
    score += 2;
    reasons.push('stable Hungarian role head');
  }

  if (framePriorityByToken.has(token)) {
    score += 4;
    reasons.push('Hungarian role frame marker');
  }

  const morphologyScore = hungarianOccupationMorphologyScore(token);

  if (morphologyScore > 0) {
    score += morphologyScore;
    reasons.push(morphologyScore >= 2 ? 'strong occupation-like morphology' : 'weak occupation-like morphology');
  }

  const contextScore = hungarianRoleContextScore({ terms, termIndex, vocabulary, venueContextTerms, tokenInSetOrVariant });

  if (contextScore > 0) {
    score += contextScore;
    reasons.push(`adjacent role context +${contextScore}`);
  } else if (contextScore < 0) {
    score += contextScore;
    reasons.push(`adjacent venue context ${contextScore}`);
  }

  const adjectivePenalty = hungarianAdjectivePenalty(token);

  if (adjectivePenalty !== 0) {
    score += adjectivePenalty;
    reasons.push('adjective-like surface form');
  }

  if (HUNGARIAN_HARD_ROLE_HEADS.has(token) && score < 8) {
    score = 8;
    reasons.push('hard role head floor');
  }

  return { score, reasons };
}

function hungarianCandidateTieBreak(left: HungarianRoleHeadCandidate, right: HungarianRoleHeadCandidate, terms: IntentTerm[]): number {
  const leftKnown = HUNGARIAN_HARD_ROLE_HEADS.has(left.normalizedToken) ? 2 : 0;
  const rightKnown = HUNGARIAN_HARD_ROLE_HEADS.has(right.normalizedToken) ? 2 : 0;

  if (rightKnown !== leftKnown) {
    return rightKnown - leftKnown;
  }

  const leftContext = hungarianLocalContextStrength(terms, left.termIndex);
  const rightContext = hungarianLocalContextStrength(terms, right.termIndex);

  if (rightContext !== leftContext) {
    return rightContext - leftContext;
  }

  return left.termIndex - right.termIndex;
}

function hungarianLocalContextStrength(terms: IntentTerm[], termIndex: number): number {
  let score = 0;
  const previous = terms[termIndex - 1];
  const next = terms[termIndex + 1];

  if (previous && HUNGARIAN_ROLE_FRAME_PREPOSITIONS.has(previous.normalizedToken)) {
    score += 1;
  }

  if (next && HUNGARIAN_ROLE_FRAME_PREPOSITIONS.has(next.normalizedToken)) {
    score += 1;
  }

  return score;
}

function hungarianOccupationMorphologyScore(token: string): number {
  if (token.length < 5) {
    return 0;
  }

  if (HUNGARIAN_STRONG_ROLE_SUFFIXES.some((suffix) => token.endsWith(suffix))) {
    return 2;
  }

  if (token.endsWith('ista') || token.endsWith('istai')) {
    return 1;
  }

  return 0;
}

function hungarianRoleContextScore(input: {
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
    score += hungarianAdjacentRoleTermScore({ token: previous.normalizedToken, vocabulary, venueContextTerms, tokenInSetOrVariant });
  }

  if (next) {
    score += hungarianAdjacentRoleTermScore({ token: next.normalizedToken, vocabulary, venueContextTerms, tokenInSetOrVariant });
  }

  return score;
}

function hungarianAdjacentRoleTermScore(input: {
  token: string;
  vocabulary: IntentVocabularyLookupLike;
  venueContextTerms: Set<string>;
  tokenInSetOrVariant: TokenInSetOrVariant;
}): number {
  const { token, vocabulary, venueContextTerms, tokenInSetOrVariant } = input;

  if (tokenInSetOrVariant(token, venueContextTerms, 'hu')) {
    return -2;
  }

  if (tokenInSetOrVariant(token, vocabulary.roleModifiers, 'hu')) {
    return 3;
  }

  if (tokenInSetOrVariant(token, vocabulary.domainModifiers, 'hu')) {
    return 2;
  }

  if (tokenInSetOrVariant(token, vocabulary.ambiguousModifiers, 'hu')) {
    return 1;
  }

  return 0;
}

function hungarianAdjectivePenalty(token: string): number {
  if (token.length < 5 || !looksLikeHungarianModifierAdjective(token)) {
    return 0;
  }

  return -4;
}

function looksLikeHungarianModifierAdjective(token: string): boolean {
  return token.length >= 5 && ['i', 'ai', 'ei', 'osi', 'esi', 'asi', 'nyi', 'sdi'].some((suffix) => token.endsWith(suffix));
}
