/**
 * Qualification inference for the two BRITTLE subtypes where semantic/fuzzy
 * matching is unsafe and must be strictly context-gated:
 *
 *  - driving-license CLASS (b/c/ce/d) — the discriminator is a single letter, so
 *    embeddings can't tell B from C. We require a driving-license word in the
 *    clause AND take the class letter only when it qualifies a license word
 *    (so "category B products" / "plan B" never match).
 *  - language REQUIREMENT — a bare language name ("English CV") is not a
 *    requirement in body text, so we require a language-requirement cue nearby.
 *    In title mode ({@link FiniteInferOptions.titleMode}) that gate is loosened:
 *    a bare mention in a terse title ("(German)", "with German") is itself the
 *    signal, since titles rarely name a language incidentally the way body text does.
 *
 * The conceptual qualifications (degrees, certificates, registrations,
 * authorizations) stay on the hybrid semantic+lexical path; these two subtypes are
 * suppressed there and produced only here. Education terms are standardized onto a
 * shorter ladder with global/common forms plus per-locale idioms:
 * school_level_degree, short_cycle_tertiary_degree, 1c_degree, 2c_degree, and
 * 3c_degree.
 *
 * Gender restriction is captured only when the ad explicitly limits the role to
 * one gender ("female only", "doar bărbați") — the neutral "(m/f)"/"(m/w/d)"
 * marker means either gender is fine, so it is deliberately NOT captured (an
 * `any` value is as good as absent and cannot be filtered on). Patterns run on
 * the folded `loose` text (lowercased, diacritics stripped: bărbați→barbati,
 * nők→nok); the non-binary/diverse value exists for symmetry with EU forms
 * ("(m/f/x)" / "(m/w/d)") even though it is rare in practice.
 */
import type { Clause } from '../tokenizer.js';
import type { SupportedLanguage } from '../types.js';
import { type FiniteInferOptions, type InferredTerm } from './shared.js';
export declare function inferQualifications(clauses: Clause[], languages?: SupportedLanguage[], options?: FiniteInferOptions): InferredTerm[];
