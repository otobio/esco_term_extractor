/**
 * In-memory LexicalIndex builder for tests (no data/lexical.lxb on disk).
 * Deliberately duplicates LexicalIndex's build-time surface-generation logic
 * rather than exposing it from src/lexical-index.ts, which is production-only:
 * ingest never builds from raw terms, it only loads the packaged bin.
 */
import { LexicalBin, pack } from '../../src/lexical-bin.ts';
import { LexicalIndex, type LexicalEntry } from '../../src/lexical-index.ts';
import { normalizeText } from '../../src/normalize.ts';
import type { DictionaryTerm } from '../../src/types.ts';

export function buildLexicalIndex(terms: DictionaryTerm[]): LexicalIndex {
  const entries: LexicalEntry[] = new Array(terms.length);
  const byAlias = new Map<string, number[]>();
  for (let i = 0; i < terms.length; i++) {
    const t = terms[i];
    entries[i] = {
      canonicalKey: t.canonicalKey,
      bucket: t.bucket,
      displayName: t.displayName,
      termType: t.termType,
      languageCode: t.languageCode,
    };
    const surfaces = new Set<string>();
    for (const s of [t.displayName, t.value, ...t.aliases]) {
      const norm = normalizeText(s ?? '');
      if (norm.length < 3) continue;
      if (/^\d+$/.test(norm)) continue;
      surfaces.add(norm);
    }
    for (const norm of surfaces) {
      const list = byAlias.get(norm);
      if (list) list.push(i);
      else byAlias.set(norm, [i]);
    }
  }
  return LexicalIndex.fromBin(LexicalBin.fromBuffer(pack(entries, byAlias)));
}
