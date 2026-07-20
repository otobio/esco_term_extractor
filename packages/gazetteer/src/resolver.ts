/**
 * Gazetteer resolver — turns clauses (+ an optional structured location field)
 * into canonical location terms. Pure string + admin-hierarchy logic, no
 * embeddings. See docs/GAZETTEER_PLAN.md §7 for the pipeline.
 *
 * Notes on non-obvious behavior:
 * - `countryCode` gates by COUNTRY (a place's `languageCode` field actually
 *   holds the country bucket — ro/ng/hu/ee), not by text language: a Nigerian
 *   listing is country `ng` even when its text is English.
 * - Fuzzy matching is enabled only for the structured location field (a
 *   deliberate, possibly typo'd place); it stays off for free text, where
 *   edit-distance-1 of common words is catastrophic (munca→Lunca, masina→Magina).
 * - `accept()` is the precision core for a bare single-token leaf mention: it is
 *   trusted only if it's a major/container place, a "primary seat" (a leaf named
 *   like its own coarser ancestor — Iași, Tartu), or corroborated by an ancestor
 *   container appearing elsewhere in the text.
 * - `disambiguate()` first checks per-locale depth-shape templates ({@link
 *   SpecificityTemplate} in patterns.ts): a duplicate-name ancestor/descendant
 *   collision resolves to the more specific place once its own coarser ancestor
 *   is separately named in the text. Otherwise it scores by major > corroborated
 *   > seat > coarser-depth, and abstains if the winner has no distinguishing
 *   signal (a guess among same-named villages is worse than a miss).
 * - `toTerm()` prefers the literal matched surface (e.g. "Bucuresti") as
 *   `displayName` over the entity's canonical name (e.g. "Bucharest"), falling
 *   back to canonical only for ancestors added purely by hierarchy expansion.
 * - `GazetteerConfig.stopNames` / `subdivisions` / `specificityTemplates` default
 *   to the merged per-locale views in patterns.ts, but are injectable so tests
 *   can supply synthetic data without coupling to real locale data.
 */

import type { GazetteerReader } from './gazetteer-index.js';
import { normalizeText, words } from './normalize.js';
import type { SpecificityTemplate } from './patterns.js';
import { SPECIFICITY_TEMPLATES, STOP_NAMES, SUBDIVISIONS } from './patterns.js';
import type { Clause, ExtractedTerm, MatchEvidence, SupportedLanguage } from './types.js';

export interface GazetteerConfig {
  maxPerBucket: number;
  fuzzyMinLen: number;
  enableFuzzy: boolean;
  enableHierarchyExpansion: boolean;
  scores: { structured: number; exact: number; fuzzy: number; inferred: number };
  stopNames: ReadonlySet<string>;
  subdivisions: readonly { re: RegExp; parentKey: string }[];
  specificityTemplates: ReadonlyMap<SupportedLanguage, readonly SpecificityTemplate[]>;
}

export const GAZETTEER_CONFIG: GazetteerConfig = {
  maxPerBucket: 8,
  fuzzyMinLen: 5,
  enableFuzzy: false,
  enableHierarchyExpansion: true,
  scores: { structured: 0.99, exact: 0.95, fuzzy: 0.8, inferred: 0.75 },
  stopNames: STOP_NAMES,
  subdivisions: SUBDIVISIONS,
  specificityTemplates: SPECIFICITY_TEMPLATES,
};

const MAX_NGRAM = 5;

function baseName(displayName: string): string {
  const comma = displayName.indexOf(',');
  return normalizeText(comma >= 0 ? displayName.slice(0, comma) : displayName);
}

interface Mention {
  idxs: number[];
  spanWords: number;
  fuzzy: boolean;
  source: 'structured' | 'text';
  text: string;
}

interface Accepted {
  index: number;
  score: number;
  evidence: MatchEvidence[];
}

export class GazetteerResolver {
  constructor(
    private readonly gaz: GazetteerReader,
    private readonly cfg: GazetteerConfig = GAZETTEER_CONFIG,
  ) {}

  resolve(clauses: Clause[], structuredLocation?: string, countryCode?: string): ExtractedTerm[] {
    const mentions: Mention[] = [];
    if (structuredLocation) this.scanSpans(structuredLocation, 'structured', mentions);
    for (const c of clauses) {
      this.scanSpans(c.text, 'text', mentions);
      this.scanSubdivisions(c.text, mentions);
    }
    if (!mentions.length) return [];

    const scoped = countryCode
      ? mentions
          .map((m) => ({ ...m, idxs: m.idxs.filter((idx) => this.gaz.place(idx).languageCode === countryCode) }))
          .filter((m) => m.idxs.length)
      : mentions;
    if (!scoped.length) return [];

    const adminInText = new Set<number>();
    for (const m of scoped) {
      for (const idx of m.idxs) {
        if (!this.gaz.isLeaf(idx)) adminInText.add(idx);
      }
    }

    const accepted = new Map<string, Accepted>();
    for (const m of scoped) {
      const gated = m.idxs.filter((idx) => this.accept(idx, m, adminInText));
      if (!gated.length) continue;
      const chosen = this.disambiguate(gated, adminInText);
      const score =
        m.source === 'structured'
          ? this.cfg.scores.structured
          : m.fuzzy
            ? this.cfg.scores.fuzzy
            : this.cfg.scores.exact;
      for (const idx of chosen) {
        this.add(accepted, idx, score, { clause: m.text, method: 'gazetteer', score });
      }
    }

    if (this.cfg.enableHierarchyExpansion) {
      for (const a of [...accepted.values()]) {
        for (const parentIdx of this.gaz.parentsOf(a.index)) {
          this.add(accepted, parentIdx, this.cfg.scores.inferred, {
            clause: `inferred from ${this.gaz.place(a.index).displayName}`,
            method: 'gazetteer',
            score: this.cfg.scores.inferred,
          });
        }
      }
    }

    return [...accepted.values()]
      .map((a) => this.toTerm(a))
      .sort((x, y) => y.score - x.score)
      .slice(0, this.cfg.maxPerBucket);
  }

  private scanSpans(text: string, source: Mention['source'], out: Mention[]): void {
    const toks = words(normalizeText(text));
    const fuzzyOn = source === 'structured' || this.cfg.enableFuzzy;
    let i = 0;
    while (i < toks.length) {
      let matched = false;
      for (let n = Math.min(MAX_NGRAM, toks.length - i); n >= 1; n--) {
        const span = toks.slice(i, i + n).join(' ');
        if (n === 1 && source === 'text' && this.cfg.stopNames.has(span)) continue;
        const idxs = this.gaz.exact(span);
        if (idxs.length) {
          out.push({ idxs, spanWords: n, fuzzy: false, source, text: span });
          i += n;
          matched = true;
          break;
        }
      }
      if (!matched) {
        if (fuzzyOn && !(source === 'text' && this.cfg.stopNames.has(toks[i]))) {
          const fz = this.gaz.fuzzy(toks[i], this.cfg.fuzzyMinLen);
          if (fz) out.push({ idxs: [fz.index], spanWords: 1, fuzzy: true, source, text: toks[i] });
        }
        i += 1;
      }
    }
  }

  private scanSubdivisions(text: string, out: Mention[]): void {
    for (const sub of this.cfg.subdivisions) {
      const parent = this.gaz.indexOfKey(sub.parentKey);
      if (parent === undefined) continue;
      for (const m of text.matchAll(sub.re)) {
        out.push({ idxs: [parent], spanWords: 2, fuzzy: false, source: 'text', text: m[0] });
      }
    }
  }

  private accept(idx: number, m: Mention, adminInText: Set<number>): boolean {
    if (m.source === 'structured') return true;
    if (m.spanWords >= 2) return true;
    if (this.gaz.isMajor(idx)) return true;
    if (this.isPrimarySeat(idx)) return true;
    return this.gaz.parentsOf(idx).some((p) => adminInText.has(p));
  }

  private isPrimarySeat(idx: number): boolean {
    const name = baseName(this.gaz.place(idx).displayName);
    for (const pi of this.gaz.parentsOf(idx)) {
      if (this.gaz.isLeaf(pi)) continue;
      const parent = baseName(this.gaz.place(pi).displayName);
      if (parent === name || parent.startsWith(`${name} `)) return true;
    }
    return false;
  }

  private corroborated(idx: number, adminInText: Set<number>): boolean {
    return this.gaz.parentsOf(idx).some((q) => adminInText.has(q));
  }

  private disambiguate(gated: number[], adminInText: Set<number>): number[] {
    if (gated.length === 1) return gated;

    const lang = this.gaz.place(gated[0]).languageCode;
    for (const tpl of this.cfg.specificityTemplates.get(lang) ?? []) {
      const descendant = gated.find((idx) => this.gaz.place(idx).depth === tpl.descendantDepth);
      if (!descendant) continue;
      const hasAncestorInGated = gated.some((a) => a !== descendant && this.gaz.parentsOf(descendant).includes(a));
      if (!hasAncestorInGated) continue;
      const contextPresent = [...adminInText].some((idx) => this.gaz.place(idx).depth === tpl.contextDepth);
      if (contextPresent) return [descendant];
    }

    const score = (idx: number): number => {
      const p = this.gaz.place(idx);
      const major = this.gaz.isMajor(idx) ? 1 : 0;
      const corr = this.corroborated(idx, adminInText) ? 1 : 0;
      const seat = this.isPrimarySeat(idx) ? 1 : 0;
      return major * 1000 + corr * 100 + seat * 50 + (10 - p.depth);
    };
    const best = [...gated].sort((a, b) => {
      const d = score(b) - score(a);
      return d !== 0 ? d : this.gaz.place(a).canonicalKey < this.gaz.place(b).canonicalKey ? -1 : 1;
    })[0];
    const distinguished = this.gaz.isMajor(best) || this.corroborated(best, adminInText) || this.isPrimarySeat(best);
    return distinguished ? [best] : [];
  }

  private add(map: Map<string, Accepted>, index: number, score: number, evidence: MatchEvidence): void {
    const key = this.gaz.place(index).canonicalKey;
    const existing = map.get(key);
    if (!existing) {
      map.set(key, { index, score, evidence: [evidence] });
      return;
    }
    existing.evidence.push(evidence);
    if (score > existing.score) existing.score = score;
  }

  private toTerm(a: Accepted): ExtractedTerm {
    const p = this.gaz.place(a.index);
    const evidence = a.evidence.sort((x, y) => y.score - x.score).slice(0, 5);
    const literal = evidence[0] && !evidence[0].clause.startsWith('inferred from ') ? evidence[0].clause : undefined;
    return {
      bucket: 'location',
      canonicalKey: p.canonicalKey,
      displayName: literal ? titleCase(literal) : p.displayName,
      termType: `depth${p.depth}`,
      languageCode: p.languageCode,
      score: Math.round(a.score * 1000) / 1000,
      method: 'gazetteer',
      evidence,
    };
  }
}

function titleCase(span: string): string {
  return span
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}
