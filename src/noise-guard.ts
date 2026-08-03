/**
 * Lightweight noise guard.
 *
 * Job posts are full of clauses that should never be matched to a canonical term:
 * contact details, application instructions, equal-opportunity boilerplate, URLs,
 * emails and phone numbers. Dropping them before embedding both speeds things up
 * and removes a large class of false positives.
 */

const NOISE_PATTERNS: RegExp[] = [
  // Contact / application instructions (multilingual, loose).
  /\b(apply|application|send your|cv|resume|e-?mail|contact|call us|phone|tel\.?|website|www\.)\b/i,
  /\b(candideaza|aplica|trimite|trimiteti|contact|telefon)\b/i, // ro
  /\b(jelentkez|önéletrajz|kapcsolat|telefon)\b/i, // hu
  /\b(kandideeri|saada|kontakt|telefon)\b/i, // et
  // Equal opportunity / legal boilerplate.
  /\b(equal opportunit|regardless of|we are an|gdpr|privacy policy|all qualified applicants)\b/i,
  // Raw contact tokens.
  /[\w.+-]+@[\w-]+\.[\w.-]+/, // email
  /https?:\/\/\S+/i, // url
  /(\+?\d[\d\s().-]{7,}\d)/, // phone-ish number run
];

const SECTION_HEADER_PATTERN =
  /^(?:responsibilities|requirements|qualifications|qualified candidates|job summary|summary|about (?:the )?(?:role|job)|what (?:you(?:'ll| will)|we) (?:do|offer)|benefits)$/i;

export interface NoiseVerdict {
  keep: boolean;
  reason?: 'contact_noise' | 'too_short';
}

export function classifyClause(text: string): NoiseVerdict {
  if (text.replace(/\s+/g, '').length < 3) return { keep: false, reason: 'too_short' };
  if (SECTION_HEADER_PATTERN.test(text.trim())) return { keep: false, reason: 'contact_noise' };
  for (const p of NOISE_PATTERNS) {
    if (p.test(text)) return { keep: false, reason: 'contact_noise' };
  }
  return { keep: true };
}
