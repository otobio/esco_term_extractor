/**
 * Negation guard for controlled-vocabulary matches.
 *
 * Controlled terms are often explicitly negated in prose ("no remote", "not
 * full-time", "fără tichete", "nem távmunka"). A lexical alias hit whose span is
 * immediately preceded by a negation cue should be suppressed rather than tagged.
 */
import { normalizeText, words } from './normalize.ts';

const NEGATION_CUES: ReadonlySet<string> = new Set([
  // en
  'no',
  'not',
  'without',
  'non',
  'never',
  'excluding',
  'except',
  "isn't",
  "aren't",
  "don't",
  "doesn't",
  'cannot',
  'lacking',
  // ro
  'fara',
  'nu',
  'niciun',
  'nicio',
  'nici',
  // hu
  'nem',
  'nincs',
  'sem',
  'nelkul',
  // et
  'ei',
  'pole',
  'ilma',
  'mitte',
]);

/** How many tokens before the span to scan for a negation cue. */
const WINDOW = 3;

/**
 * True when `span` (a normalized alias) occurs in `clause` immediately after a
 * negation cue (within {@link WINDOW} tokens). If the span itself starts with a
 * negation cue (e.g. the alias "no experience"), that leading cue is ignored.
 */
export function isNegated(clause: string, span: string): boolean {
  const toks = words(normalizeText(clause));
  const spanToks = words(normalizeText(span));
  if (!spanToks.length) return false;
  for (let i = 0; i + spanToks.length <= toks.length; i++) {
    let hit = true;
    for (let j = 0; j < spanToks.length; j++) {
      if (toks[i + j] !== spanToks[j]) {
        hit = false;
        break;
      }
    }
    if (!hit) continue;
    for (let k = Math.max(0, i - WINDOW); k < i; k++) {
      if (NEGATION_CUES.has(toks[k])) return true;
    }
  }
  return false;
}
