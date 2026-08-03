/**
 * Description resolve profile — section-aware, locale-first extraction for noisy
 * job-body text.
 *
 * The description body is not a generic clause firehose. It is parsed into coarse
 * sections (requirements / responsibilities / benefits / company / application /
 * unknown) with locale-first header detection for ro/hu/et and English fallback.
 * Bucket extraction is then routed by section:
 *
 *   - capabilities   → requirements/unknown only, lexical span led
 *   - qualifications → requirements/unknown only, with qualification cues
 *   - benefits       → benefits/unknown only, with offer/perk cues
 *   - compensation   → benefits/unknown only, with pay cues
 *   - workplace / employment / schedule → explicit clauses only, never from
 *     responsibilities/company/application sections
 *   - location       → gazetteer-owned over the full body
 *
 * Identity-like and highly ambiguous buckets (occupation, level, sector,
 * job_function, company_size, collar_kind) are intentionally excluded from the
 * description profile by default. Precision is the point.
 */

import type { GazetteerResolver } from '@term-extractor/gazetteer';
import { timed } from '@term-extractor/utils/perf';
import type { LexicalEntry, LexicalIndex } from '../lexical-index.js';
import { type CandidateResult, finalizeFinite, osFinalize, type ResolvedTerm } from '../matchers/finite.js';
import { numberVariants } from '../matchers/morphology.js';
import { buildFilters, strategyForBucket } from '../matchers/resolve.js';
import type { OpenSearchClient } from '../matchers/types.js';
import { classifyClause } from '../noise-guard.js';
import { normalizeText, words } from '../normalize.js';
import { type Clause, splitClauses } from '../tokenizer.js';
import type { BucketName, SupportedLanguage } from '../types.js';

export type DescriptionSectionKind =
  | 'requirements'
  | 'responsibilities'
  | 'benefits'
  | 'company'
  | 'application'
  | 'unknown';

export interface DescriptionSection {
  kind: DescriptionSectionKind;
  header?: string;
  text: string;
  clauses: string[];
  confidence?: number;
  reasons?: string[];
}

interface SectionedClause extends Clause {
  section: DescriptionSectionKind;
}

export interface DescriptionDeps {
  client: OpenSearchClient;
  lexical: LexicalIndex;
  gazetteer?: GazetteerResolver;
  locale?: string;
  countryCode?: string;
  buckets?: BucketName[];
}

export interface DescriptionProfileResult {
  sections: DescriptionSection[];
  byBucket: Record<string, ResolvedTerm[]>;
  /** Section kinds whose clauses contributed to each bucket's resolved terms. */
  sectionsByBucket: Record<string, DescriptionSectionKind[]>;
}

/** Hard cap on input size; longer bodies are truncated before parsing to bound
 * clause-classification and gazetteer/ES resolution cost on pathological input. */
const DESCRIPTION_MAX_CHARS = 20_000;
/** Cap on clauses handed to a single bucket's resolution to bound msearch/gazetteer fanout. */
const MAX_CLAUSES_PER_BUCKET = 200;

const DISPLAY_SOURCE = ['canonical_key', 'value', 'display_name', 'aliases', 'searchable', 'language_code'];

const DESCRIPTION_ALLOWED_BUCKETS = new Set<BucketName>([
  'capabilities',
  'location',
  'qualifications',
  'benefits',
  'compensation',
  'workplace',
  'employment',
  'schedule',
]);

interface SectionFamily {
  exact: readonly string[];
  stems?: readonly string[];
  cues?: readonly string[];
  anti?: readonly string[];
}

type SectionLexicon = Record<DescriptionSectionKind, SectionFamily>;

const SECTION_LEXICONS: Record<'ro' | 'hu' | 'et' | 'en', SectionLexicon> = {
  ro: {
    requirements: {
      exact: [
        'cerinte',
        'calificari',
        'profilul candidatului',
        'candidatul ideal',
        'profilul pe care il cautam',
        'ce cautam',
        'cerintele postului',
        'criterii de selectie',
        'conditii',
        'cerinte obligatorii',
      ],
      stems: ['cerint', 'calificar', 'candidat', 'profil', 'competent', 'abilitat', 'cunostint', 'cerem', 'cautam'],
      cues: ['studii', 'experienta', 'permis', 'diploma', 'abilitati', 'cunostinte', 'disponibilitate', 'vechime'],
      anti: ['salariu', 'beneficii', 'despre companie', 'aplica'],
    },
    responsibilities: {
      exact: [
        'responsabilitati',
        'atribuiti',
        'atributii',
        'ce vei face',
        'rolul tau',
        'sarcini',
        'descrierea jobului',
        'responsabilitati principale',
        'ce presupune rolul',
      ],
      stems: ['responsabil', 'atribut', 'sarcin', 'vei', 'te vei', 'descrierea job', 'rolul'],
      cues: ['vei', 'te vei', 'vei asigura', 'vei verifica', 'vei implementa', 'vei colabora', 'va trebui'],
      anti: ['salariu', 'beneficii', 'aplica'],
    },
    benefits: {
      exact: [
        'beneficii',
        'ce oferim',
        'ce iti oferim',
        'oferim',
        'avantaje',
        'oferta',
        'pachet oferit',
        'salarizare si beneficii',
        'program de lucru',
        'pachet salarial',
        'ce oferim noi',
        'beneficii oferite',
      ],
      stems: ['benefic', 'oferim', 'avantaj', 'salariz', 'program de lucru', 'pachet salarial', 'ofert'],
      cues: ['salariu', 'tichete', 'abonament', 'bonus', 'decont', 'contract', 'telefon', 'masina', 'program flexibil'],
      anti: ['responsabilitati', 'cerinte', 'despre companie'],
    },
    company: {
      exact: ['despre noi', 'companie', 'angajator', 'despre companie', 'descrierea companiei', 'cine suntem'],
      stems: ['compani', 'angajator', 'despre noi', 'cine suntem'],
      cues: ['echipa noastra', 'companie nationala', 'lider pe piata', 'de ani'],
      anti: ['salariu', 'beneficii', 'aplica'],
    },
    application: {
      exact: ['aplica', 'trimite cv', 'contact', 'cum aplici', 'cum poti aplica', 'pasii urmatori'],
      stems: ['aplic', 'contact', 'trimite', 'cv', 'candidatur', 'interviu'],
      cues: ['trimite cv', 'aplica acum', 'telefon', 'email'],
      anti: ['beneficii', 'responsabilitati'],
    },
    unknown: { exact: [] },
  },
  hu: {
    requirements: {
      exact: [
        'elvarasok',
        'kovetelmenyek',
        'feltetelek',
        'amit keresunk',
        'amit elvarunk',
        'szukseges',
        'elonyt jelent',
      ],
      stems: ['elvar', 'kovetel', 'feltetel', 'keresunk', 'elonyt', 'szukseg'],
      cues: ['tapasztalat', 'vegzettseg', 'jogositvany', 'ismeret', 'keszseg'],
      anti: ['fizetes', 'juttatas', 'jelentkezes'],
    },
    responsibilities: {
      exact: ['feladatok', 'munkakor', 'miben szamitunk rad', 'fo feladatok'],
      stems: ['feladat', 'munkakor', 'miben szamitunk', 'teendo'],
      cues: ['fogsz', 'lesz a feladatod', 'felelos leszel'],
      anti: ['juttatas', 'fizetes'],
    },
    benefits: {
      exact: ['amit kinalunk', 'juttatasok', 'elonyok', 'amit nyujtunk', 'ajanlatunk'],
      stems: ['kinal', 'juttatas', 'elony', 'ajanlat'],
      cues: ['fizetes', 'ber', 'bonusz', 'telefon', 'auto', 'rugalmas'],
      anti: ['elvaras', 'feladat'],
    },
    company: {
      exact: ['rolunk', 'cegunkrol', 'cegunk', 'a vallalatrol', 'ceginformacio'],
      stems: ['ceg', 'vallalat', 'rolunk'],
      cues: ['stabil hatter', 'piacvezeto'],
      anti: ['fizetes', 'jelentkezes'],
    },
    application: {
      exact: ['jelentkezes', 'palyazat', 'kapcsolat', 'hogyan jelentkezz', 'jelentkezes modja'],
      stems: ['jelentkez', 'palyaz', 'kapcsolat'],
      cues: ['oneletrajz', 'email', 'telefon'],
      anti: ['juttatas', 'feladat'],
    },
    unknown: { exact: [] },
  },
  et: {
    requirements: {
      exact: ['nouded', 'ootused', 'sobiv kandidaat', 'mida ootame', 'vajalik', 'noudmised'],
      stems: ['noud', 'oot', 'vajalik', 'kandidaat'],
      cues: ['kogemus', 'haridus', 'sertifikaat', 'oskus', 'load'],
      anti: ['palk', 'hüved', 'kandideeri'],
    },
    responsibilities: {
      exact: ['ulesanded', 'tooulesanded', 'mida teed', 'too sisu'],
      stems: ['ulesan', 'mida teed', 'too sisu'],
      cues: ['sa teed', 'vastutad', 'tagad'],
      anti: ['palk', 'hüved'],
    },
    benefits: {
      exact: ['pakume', 'huved', 'mida pakume', 'omalt poolt', 'soodustused'],
      stems: ['paku', 'huv', 'soodust'],
      cues: ['palk', 'boonus', 'transport', 'telefon', 'graafik'],
      anti: ['ulesanded', 'nouded'],
    },
    company: {
      exact: ['meist', 'ettevottest', 'toandjast'],
      stems: ['ettevot', 'toandj', 'meist'],
      cues: ['stabiilne', 'kasvav'],
      anti: ['palk', 'kandideeri'],
    },
    application: {
      exact: ['kandideeri', 'kandideerimine', 'kontakt', 'kuidas kandideerida'],
      stems: ['kandideer', 'kontakt'],
      cues: ['cv', 'e-post', 'telefon'],
      anti: ['soodustused', 'ulesanded'],
    },
    unknown: { exact: [] },
  },
  en: {
    requirements: {
      exact: ['requirements', 'qualifications', 'what we expect', 'what you bring', 'skills', 'must have'],
      stems: ['require', 'qualif', 'what you bring', 'must have'],
      cues: ['experience', 'degree', 'license', 'skills', 'knowledge'],
      anti: ['salary', 'benefits', 'apply'],
    },
    responsibilities: {
      exact: ['responsibilities', 'what you will do', 'role', 'duties'],
      stems: ['responsib', 'dut', 'what you will do'],
      cues: ['you will', 'responsible for', 'maintain', 'support'],
      anti: ['salary', 'benefits'],
    },
    benefits: {
      exact: ['benefits', 'what we offer', 'we offer', 'perks'],
      stems: ['benefit', 'offer', 'perk', 'compensation'],
      cues: ['salary', 'bonus', 'insurance', 'voucher', 'flexible'],
      anti: ['requirements', 'duties'],
    },
    company: {
      exact: ['about us', 'company', 'about the company'],
      stems: ['about us', 'company'],
      cues: ['we are', 'our company'],
      anti: ['salary', 'apply'],
    },
    application: {
      exact: ['apply', 'application', 'contact'],
      stems: ['apply', 'contact'],
      cues: ['send your cv', 'email', 'phone'],
      anti: ['benefits', 'responsibilities'],
    },
    unknown: { exact: [] },
  },
};

const CAPABILITY_CUE =
  /\b(experienta|experienta in|cunostinte|abilitati|competente|skill|skills|experience|knowledge|proficien(?:cy|t)|familiar(?:ity)?|expertise|competenc(?:e|ies)|ability|tapasztalat|ismeret|keszseg|kepesseg|jartassag|kogemus|teadmised|oskused|suutlikkus|vajalik|required|must have|nice to have)\b/i;
const QUALIFICATION_CUE =
  /\b(studii|diploma|diplome|licenta|certificat|autorizatie|limba|permis|licence|degree|diploma|certificate|certification|license|licence|language|diploma|vegzettseg|bizonyitvany|tanusitvany|jogositvany|nyelv|haridus|tunnistus|sertifikaat|keel)\b/i;
const BENEFIT_CUE =
  /\b(beneficii|oferim|avantaje|bonus|bonuri|bonuri de masa|asigurare|training platit|juttatas|juttatasok|elony|ajanlunk|pakume|huved|boonus|kindlustus|benefit|benefits|offer|we offer|perk|perks|insurance|voucher)\b/i;
const COMPENSATION_CUE =
  /\b(salariu|salariu fix|bonus|comision|prime|pachet salarial|ber|fizetes|jutalek|boonus|palk|tasu|salary|compensation|pay|commission|bonus)\b/i;

function headerLocales(locale?: string): ('ro' | 'hu' | 'et' | 'en')[] {
  if (locale === 'ro' || locale === 'hu' || locale === 'et') return [locale, 'en'];
  return ['ro', 'hu', 'et', 'en'];
}

interface SectionScore {
  kind: DescriptionSectionKind;
  score: number;
  reasons: string[];
  matchedPrefix?: string;
}

const BULLET_PREFIX_RE = /^[\s]*(?:[-*•·▪‣◦]+|\(?(?:\d{1,2}|[a-hA-H])[.)]\)?)\s+/;

function cleanLine(line: string): string {
  return line.replace(BULLET_PREFIX_RE, '').trim();
}

function extractInlineHeaderRest(raw: string): string {
  const m = raw.match(/[:?]\s*(.+)$/u);
  return m?.[1]?.trim() ?? '';
}

function scoreSectionFamily(
  kind: DescriptionSectionKind,
  family: SectionFamily,
  norm: string,
  raw: string,
): SectionScore {
  let score = 0;
  const reasons: string[] = [];
  let matchedPrefix: string | undefined;
  for (const exact of family.exact) {
    if (norm === exact) {
      score += 8;
      matchedPrefix = exact;
      reasons.push(`exact:${exact}`);
      break;
    }
    if (norm.startsWith(`${exact} `)) {
      score += 7;
      matchedPrefix = exact;
      reasons.push(`prefix:${exact}`);
      break;
    }
  }
  for (const stem of family.stems ?? []) {
    if (norm.includes(stem)) {
      score += 2;
      reasons.push(`stem:${stem}`);
    }
  }
  for (const cue of family.cues ?? []) {
    if (norm.includes(cue)) {
      score += 1;
      reasons.push(`cue:${cue}`);
    }
  }
  for (const anti of family.anti ?? []) {
    if (norm.includes(anti)) {
      score -= 2;
      reasons.push(`anti:${anti}`);
    }
  }
  if (raw.trim().endsWith(':') || raw.trim().endsWith('?')) {
    score += 1.5;
    reasons.push('shape:terminal_punct');
  }
  const tokenCount = words(norm).length;
  if (tokenCount > 0 && tokenCount <= 6) {
    score += 1;
    reasons.push('shape:short_line');
  }
  if (tokenCount > 10) {
    score -= 1.5;
    reasons.push('shape:long_line');
  }
  return { kind, score, reasons, matchedPrefix };
}

function scoreHeaderLine(line: string, locale?: string): SectionScore | null {
  const raw = cleanLine(line);
  const norm = normalizeText(raw);
  if (!norm) return null;
  const tokenCount = words(norm).length;
  const scored = headerLocales(locale)
    .flatMap((lang) =>
      (Object.keys(SECTION_LEXICONS[lang]) as DescriptionSectionKind[])
        .filter((kind) => kind !== 'unknown')
        .map((kind) => scoreSectionFamily(kind, SECTION_LEXICONS[lang][kind], norm, raw)),
    )
    .sort((a, b) => b.score - a.score);
  const first = scored[0];
  const second = scored[1];
  if (!first || first.score < 3) return null;
  const strong = !!first.matchedPrefix;
  const titleLike = /^[\p{Lu}\d][\p{L}\d\s&/+\-()]+[?:]?$/u.test(raw);
  const hasDelimiter = /[:?]$/.test(raw) || /[:?]\s+\S/u.test(raw);
  const prefixWords = first.matchedPrefix ? words(normalizeText(first.matchedPrefix)).length : 0;
  if (!strong) {
    if (tokenCount > 4) return null;
    if (!/[?:]$/.test(raw) && !titleLike) return null;
    if (first.score < 4.5) return null;
  } else {
    if (!hasDelimiter && prefixWords > 0 && tokenCount > prefixWords + 1 && !titleLike) return null;
  }
  if (second && first.score - second.score < 1 && first.score < 7) return null;
  return first;
}

function scoreBlockKind(kind: DescriptionSectionKind, text: string, locale?: string): SectionScore {
  const norm = normalizeText(text);
  const reasons: string[] = [];
  let score = 0;
  for (const lang of headerLocales(locale)) {
    const family = SECTION_LEXICONS[lang][kind];
    for (const cue of [...(family.stems ?? []), ...(family.cues ?? []), ...family.exact]) {
      if (cue && norm.includes(cue)) {
        score += family.exact.includes(cue) ? 2 : 1;
        reasons.push(`cue:${cue}`);
      }
    }
    for (const anti of family.anti ?? []) {
      if (norm.includes(anti)) {
        score -= 1.5;
        reasons.push(`anti:${anti}`);
      }
    }
  }
  const bulletLines = text.split(/\r?\n/).filter((line) => BULLET_PREFIX_RE.test(line)).length;
  if (bulletLines >= 2) {
    score += 1;
    reasons.push('shape:bullet_block');
  }
  return { kind, score, reasons };
}

function classifyBlock(text: string, locale?: string): SectionScore {
  const scores = (
    ['requirements', 'responsibilities', 'benefits', 'company', 'application'] as DescriptionSectionKind[]
  )
    .map((kind) => scoreBlockKind(kind, text, locale))
    .sort((a, b) => b.score - a.score);
  const best = scores[0];
  const next = scores[1];
  if (!best || best.score < 2 || (next && best.score - next.score < 1 && best.score < 4)) {
    return { kind: 'unknown', score: 0, reasons: ['fallback:unknown'] };
  }
  return best;
}

interface SectionLine {
  text: string;
  /** Whether the original (pre-clean) line carried a bullet/number marker. */
  hadBullet: boolean;
}

const SENTENCE_TERMINAL_RE = /[.!?:;]['")\]]?\s*$/;

/**
 * Joins soft-wrapped continuation lines (no bullet marker, previous line not
 * sentence-terminal) into a single clause before splitting on `;`, so a
 * hard-wrapped sentence copy-pasted from a PDF/HTML source doesn't fracture
 * into multiple truncated clauses.
 */
function descriptionClausesFromLines(lines: SectionLine[]): string[] {
  const out: string[] = [];
  let buffer = '';
  const flushBuffer = () => {
    if (!buffer) return;
    for (const part of buffer.split(/[;]+/)) {
      const clause = part
        .trim()
        .replace(/[.,:]+$/g, '')
        .trim();
      if (clause && classifyClause(clause).keep) out.push(clause);
    }
    buffer = '';
  };
  for (const { text: line, hadBullet } of lines) {
    if (!line) continue;
    // Require a lowercase-starting line as the wrap-continuation signal: a real
    // hard-wrapped sentence resumes mid-clause, whereas standalone short list
    // items (even without terminal punctuation) generally start capitalized.
    const looksLikeContinuation = !hadBullet && /^\p{Ll}/u.test(line);
    if (looksLikeContinuation && buffer && !SENTENCE_TERMINAL_RE.test(buffer)) {
      buffer = `${buffer} ${line}`;
      continue;
    }
    flushBuffer();
    buffer = line;
  }
  flushBuffer();
  return out;
}

export function parseDescriptionSections(text: string, locale?: string): DescriptionSection[] {
  const rawLines = text.split(/\r?\n/);
  const out: {
    kind: DescriptionSectionKind;
    header?: string;
    lines: SectionLine[];
    confidence?: number;
    reasons?: string[];
  }[] = [];
  let current = {
    kind: 'unknown' as DescriptionSectionKind,
    header: undefined as string | undefined,
    lines: [] as SectionLine[],
    confidence: 0,
    reasons: [] as string[],
  };
  const flush = () => {
    const body = current.lines
      .map((l) => l.text)
      .join('\n')
      .trim();
    if (!body) return;
    out.push({
      kind: current.kind,
      header: current.header,
      lines: [...current.lines],
      confidence: current.confidence,
      reasons: [...current.reasons],
    });
  };
  for (const rawLine of rawLines) {
    const line = cleanLine(rawLine);
    if (!line) continue;
    const header = scoreHeaderLine(line, locale);
    if (header) {
      flush();
      const headerLine = cleanLine(line);
      const rest = extractInlineHeaderRest(headerLine);
      current = {
        kind: header.kind,
        header: headerLine,
        lines: rest ? [{ text: rest, hadBullet: false }] : [],
        confidence: header.score,
        reasons: header.reasons,
      };
      continue;
    }
    current.lines.push({ text: line, hadBullet: BULLET_PREFIX_RE.test(rawLine) });
  }
  flush();
  if (!out.length && text.trim()) out.push({ kind: 'unknown', lines: [{ text: text.trim(), hadBullet: false }] });
  const classified = out.map((section) => {
    const body = section.lines
      .map((l) => l.text)
      .join('\n')
      .trim();
    const fallback = section.kind === 'unknown' ? classifyBlock(body, locale) : null;
    const kind = fallback?.kind && fallback.kind !== 'unknown' ? fallback.kind : section.kind;
    const confidence = Math.max(section.confidence ?? 0, fallback?.score ?? 0);
    const reasons = [...(section.reasons ?? []), ...(fallback?.reasons ?? [])];
    return {
      kind,
      header: section.header,
      lines: section.lines,
      confidence,
      reasons,
    };
  });
  const merged: typeof classified = [];
  for (const section of classified) {
    const prev = merged[merged.length - 1];
    if (prev && prev.kind === section.kind && prev.kind !== 'unknown') {
      prev.lines.push(...section.lines);
      prev.confidence = Math.max(prev.confidence, section.confidence);
      prev.reasons = [...(prev.reasons ?? []), ...(section.reasons ?? [])];
      if (!prev.header) prev.header = section.header;
      continue;
    }
    // Bridge a short, unclassified stray block sandwiched between two same-kind
    // sections (e.g. a stray note line) into the surrounding section, rather than
    // letting it fracture one logical block into three.
    if (section.kind !== 'unknown' && prev && prev.kind === 'unknown' && !prev.confidence) {
      const strayWordCount = words(normalizeText(prev.lines.map((l) => l.text).join(' '))).length;
      const before = merged[merged.length - 2];
      if (strayWordCount <= 15 && before && before.kind === section.kind) {
        before.lines.push(...prev.lines, ...section.lines);
        before.confidence = Math.max(before.confidence, section.confidence);
        before.reasons = [...(before.reasons ?? []), ...(section.reasons ?? [])];
        merged.pop();
        continue;
      }
    }
    merged.push({ ...section, lines: [...section.lines], reasons: [...(section.reasons ?? [])] });
  }
  return merged.map((section) => {
    const body = section.lines
      .map((l) => l.text)
      .join('\n')
      .trim();
    const clauses = descriptionClausesFromLines(section.lines);
    return {
      kind: section.kind,
      header: section.header,
      text: body,
      clauses,
      confidence: section.confidence,
      reasons: section.reasons,
    };
  });
}

function toResolvedTerm(entry: LexicalEntry, span: string): ResolvedTerm {
  return {
    key: entry.canonicalKey,
    name: entry.displayName,
    score: 1,
    lang: entry.languageCode,
    status: 'resolved',
    span,
  };
}

function dedupeTerms(terms: ResolvedTerm[]): ResolvedTerm[] {
  const best = new Map<string, ResolvedTerm>();
  for (const term of terms) {
    const prev = best.get(term.key);
    if (!prev || (term.status === 'resolved' && prev.status !== 'resolved') || term.score > prev.score)
      best.set(term.key, term);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

function sectionedClauses(
  sections: DescriptionSection[],
  kinds: ReadonlySet<DescriptionSectionKind>,
  gate?: (clause: string, section: DescriptionSectionKind) => boolean,
): SectionedClause[] {
  return sections.flatMap((section) =>
    kinds.has(section.kind)
      ? section.clauses
          .filter((clause) => (gate ? gate(clause, section.kind) : true))
          .map((clause) => ({ text: clause, source: section.kind, section: section.kind }))
      : [],
  );
}

function shortListLike(clause: string): boolean {
  const count = words(normalizeText(clause)).length;
  return count > 0 && count <= 6;
}

function capabilityClauseAllowed(clause: string, section: DescriptionSectionKind): boolean {
  if (section === 'requirements') return true;
  return CAPABILITY_CUE.test(clause) || shortListLike(clause);
}

function qualificationClauseAllowed(clause: string, section: DescriptionSectionKind): boolean {
  if (section === 'requirements') return true;
  return QUALIFICATION_CUE.test(clause);
}

function benefitClauseAllowed(clause: string, section: DescriptionSectionKind): boolean {
  if (section === 'benefits') return true;
  return BENEFIT_CUE.test(clause);
}

function compensationClauseAllowed(clause: string, section: DescriptionSectionKind): boolean {
  if (section === 'benefits') return true;
  return COMPENSATION_CUE.test(clause);
}

function allowedDescriptionBuckets(requested?: BucketName[]): BucketName[] {
  const base = requested?.length ? requested : [...DESCRIPTION_ALLOWED_BUCKETS];
  return [...new Set(base)].filter((bucket) => DESCRIPTION_ALLOWED_BUCKETS.has(bucket));
}

function lexicalLanguages(locale?: string): SupportedLanguage[] | undefined {
  if (!locale) return undefined;
  return [...new Set(locale === 'en' ? ['en', 'global'] : [locale, 'en', 'global'])] as SupportedLanguage[];
}

async function resolveCapabilityTerms(clauses: SectionedClause[], deps: DescriptionDeps): Promise<ResolvedTerm[]> {
  if (!clauses.length) return [];
  const langs = lexicalLanguages(deps.locale);
  const expand = (gram: string) => numberVariants(gram, deps.locale);
  const seen = new Set<string>();
  const candidates: { surface: string; source: 'span' }[] = [];
  for (const clause of clauses) {
    for (const hit of deps.lexical.lookup(clause.text, 'capabilities', langs, expand)) {
      const key = `${clause.text}::${hit.gram}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({ surface: hit.gram, source: 'span' });
    }
  }
  if (!candidates.length) return [];
  const matchCtx = { queryModelId: await deps.client.queryModelId(), buildFilters };
  const responses = await timed(
    () =>
      deps.client.msearch(
        candidates.map((candidate) => {
          const q = strategyForBucket('capabilities').buildQuery(
            { bucket: 'capabilities', surface: candidate.surface, locale: deps.locale },
            matchCtx,
          ) as Record<string, unknown> & { _source?: string[] };
          q._source = DISPLAY_SOURCE;
          return q;
        }),
      ),
    `description_capabilities clauses=${clauses.length} candidates=${candidates.length}`,
  );
  const results: CandidateResult[] = candidates.map((candidate, i) => ({ ...candidate, response: responses[i] }));
  return dedupeTerms(osFinalize('capabilities', results, { locale: deps.locale }));
}

function resolveFiniteDescriptionBucket(
  bucket: BucketName,
  clauses: SectionedClause[],
  deps: DescriptionDeps,
): ResolvedTerm[] {
  if (!clauses.length) return [];
  const langs = lexicalLanguages(deps.locale);
  const expand = (gram: string) => numberVariants(gram, deps.locale);
  const lexicalTerms = clauses.flatMap((clause) =>
    deps.lexical.lookup(clause.text, bucket, langs, expand).map((hit) => toResolvedTerm(hit.entry, hit.gram)),
  );
  return dedupeTerms(finalizeFinite(bucket, lexicalTerms, clauses, { locale: deps.locale, titleMode: false }));
}

function resolveLocationTerms(text: string, deps: DescriptionDeps): ResolvedTerm[] {
  if (!deps.gazetteer) return [];
  const country = deps.countryCode ?? deps.locale;
  return deps.gazetteer.resolve(splitClauses(text, 'text'), undefined, country).map((term) => ({
    key: term.canonicalKey,
    name: term.displayName,
    score: term.score,
    lang: term.languageCode,
    status: 'resolved',
    span: term.evidence?.[0]?.clause ?? term.displayName,
  }));
}

function sectionKindsOf(clauses: SectionedClause[]): DescriptionSectionKind[] {
  return [...new Set(clauses.map((clause) => clause.section))];
}

export async function resolveDescription(rawText: string, deps: DescriptionDeps): Promise<DescriptionProfileResult> {
  const text = rawText.length > DESCRIPTION_MAX_CHARS ? rawText.slice(0, DESCRIPTION_MAX_CHARS) : rawText;
  const sections = parseDescriptionSections(text, deps.locale);
  if (!sections.length) return { sections: [], byBucket: {}, sectionsByBucket: {} };
  const buckets = allowedDescriptionBuckets(deps.buckets);
  const byBucket: Record<string, ResolvedTerm[]> = {};
  const sectionsByBucket: Record<string, DescriptionSectionKind[]> = {};

  if (buckets.includes('capabilities')) {
    const clauses = sectionedClauses(
      sections,
      new Set<DescriptionSectionKind>(['requirements', 'unknown']),
      capabilityClauseAllowed,
    ).slice(0, MAX_CLAUSES_PER_BUCKET);
    const terms = await resolveCapabilityTerms(clauses, deps);
    if (terms.length) {
      byBucket.capabilities = terms;
      sectionsByBucket.capabilities = sectionKindsOf(clauses);
    }
  }

  const finitePolicies: Array<{
    bucket: BucketName;
    sections: ReadonlySet<DescriptionSectionKind>;
    gate?: (clause: string, section: DescriptionSectionKind) => boolean;
  }> = [
    {
      bucket: 'qualifications',
      sections: new Set<DescriptionSectionKind>(['requirements', 'unknown']),
      gate: qualificationClauseAllowed,
    },
    {
      bucket: 'benefits',
      sections: new Set<DescriptionSectionKind>(['benefits', 'unknown']),
      gate: benefitClauseAllowed,
    },
    {
      bucket: 'compensation',
      sections: new Set<DescriptionSectionKind>(['benefits', 'unknown']),
      gate: compensationClauseAllowed,
    },
    { bucket: 'workplace', sections: new Set<DescriptionSectionKind>(['requirements', 'benefits', 'unknown']) },
    { bucket: 'employment', sections: new Set<DescriptionSectionKind>(['requirements', 'benefits', 'unknown']) },
    { bucket: 'schedule', sections: new Set<DescriptionSectionKind>(['requirements', 'benefits', 'unknown']) },
  ];

  for (const policy of finitePolicies) {
    if (!buckets.includes(policy.bucket)) continue;
    const clauses = sectionedClauses(sections, policy.sections, policy.gate).slice(0, MAX_CLAUSES_PER_BUCKET);
    const terms = resolveFiniteDescriptionBucket(policy.bucket, clauses, deps);
    if (terms.length) {
      byBucket[policy.bucket] = terms;
      sectionsByBucket[policy.bucket] = sectionKindsOf(clauses);
    }
  }

  if (buckets.includes('location')) {
    const terms = resolveLocationTerms(text, deps);
    if (terms.length) {
      byBucket.location = terms;
      sectionsByBucket.location = sections.map((section) => section.kind);
    }
  }

  return { sections, byBucket, sectionsByBucket };
}
