/**
 * Types owned by the gazetteer package. Structurally identical to the host app's
 * shared types (TS is structural), so values cross the boundary without adapters.
 * The gazetteer only ever deals with the `location` bucket and its own `gazetteer`
 * method, so those fields are narrowed to exactly what it produces/consumes.
 */

export type SupportedLanguage = 'ro' | 'en' | 'hu' | 'et' | 'ng' | 'global';

/** A clause of input text (the host app tokenizes; the gazetteer consumes). */
export interface Clause {
  text: string;
  source: string;
}

/** A single piece of evidence supporting a match. */
export interface MatchEvidence {
  clause: string;
  method: 'gazetteer';
  score: number;
}

/** A canonical location term the gazetteer can be seeded from (legacy JSON path). */
export interface DictionaryTerm {
  canonicalKey: string;
  bucket: 'location';
  termType: string;
  displayName: string;
  value: string;
  languageCode: SupportedLanguage;
  aliases: string[];
}

/** A resolved location term returned by the resolver. */
export interface ExtractedTerm {
  bucket: 'location';
  canonicalKey: string;
  displayName: string;
  termType: string;
  languageCode: SupportedLanguage;
  /** Best confidence in [0, 1] across all supporting evidence. */
  score: number;
  method: 'gazetteer';
  evidence: MatchEvidence[];
}
