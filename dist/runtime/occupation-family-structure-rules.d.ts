import type { SupportedQueryLocale } from '../query/query-preparation.js';
import { type FamilyStructureVocabularyDimension } from './occupation-family-structure-vocabulary.js';
/**
 * Family structure rules
 * ======================
 *
 * This module is the family-level contradiction and shortlisting layer for ESCO
 * occupation resolution. It deliberately does not replace ESCO retrieval,
 * aliases, family profiles, graph evidence, or leaf recovery. The purpose is to
 * add a compact, explainable control layer over the 125 ESCO occupation
 * families so obviously incompatible families can be rejected or penalized when
 * the query contains enough structural information.
 *
 * Why this exists
 * ---------------
 *
 * ESCO retrieval is rich but permissive. A query can retrieve a leaf or family
 * because one word overlaps an alias, a capability, a family profile, or a
 * graph branch. That is useful for discovery, but it is not enough to decide
 * whether the family actually represents the submitted job title.
 *
 * Example:
 * - "Airline Compliance Auditors" contains a strong aviation/domain term.
 * - Aviation families can retrieve well from "airline".
 * - The role is still auditor/compliance, not pilot or aircraft controller.
 *
 * This layer asks a separate question:
 *
 *   Given the query dimensions we can confidently detect, can this ESCO family
 *   plausibly represent the query?
 *
 * The answer is used as structural support, structural contradiction, or a hard
 * rejection signal. It is intentionally orthogonal to raw retrieval strength.
 *
 * Curated family profiles vs generated/seeded query vocabulary
 * -----------------------------------------------------------
 *
 * The 125-family table below is curated by hand because there are only 125
 * families and their broad meaning should remain human-auditable. Each family
 * row describes stable dimensions:
 *
 * - occupation_level: broad occupational level such as professional, clerical,
 *   skilled_trades, plant_machine_operator, driver_transport, elementary.
 * - role_heads: the actual occupational head concepts that can represent the
 *   family, such as engineer, nurse, mechanic, cashier, driver, assembler.
 * - knowledge_domains: professional or work-domain context, such as health,
 *   finance, ICT, construction, logistics, food service.
 * - work_objects: things worked on, such as patients, machinery, accounts,
 *   software, goods, vehicles, food, metal.
 * - settings: where the work happens, such as hospital, shop, office,
 *   warehouse, factory, construction site.
 * - population_or_channel: who or which channel the role serves, such as
 *   customers, patients, passengers, call-centre, public/community.
 * - transport_mode: road/rail/air/ship/mobile-plant distinctions.
 * - authority_band: manager/supervisor/professional/associate/assistant/worker
 *   style authority markers.
 * - activities: broad activity verbs such as repair, sell, care, operate,
 *   assemble, teach, analyse.
 *
 * Query-side terms are not maintained only in this file. The query vocabulary
 * lives in occupation-family-structure-vocabulary.ts and is assembled from:
 *
 * - a built-in TypeScript baseline,
 * - reviewed multilingual JSON seeds under src/runtime/seeds,
 * - derived leaf-structure vocabulary from occupation-leaf-structure-rules-v2.
 *
 * The current multilingual seed is intentionally additive. It lets Romanian,
 * Hungarian, and Estonian terms grow without rewriting the baseline code. That
 * supports gradual rollout: add reviewed query terms, test their dimensional
 * effect, and only then consider generated runtime artifacts.
 *
 * Runtime contract and fallback behavior
 * --------------------------------------
 *
 * This layer must not become an all-or-nothing replacement for the old pipeline.
 * The intended runtime order is:
 *
 *   1. Query preparation extracts useful tokens, spans, role/domain intent.
 *   2. Alias, lexical, family-profile, graph, and recovery retrieval still run.
 *   3. Family structure compares query dimensions against candidate families.
 *   4. If dimensions are strong enough, impossible families are rejected or
 *      compatible families are boosted.
 *   5. If dimensions are absent or only weak/generic, structure stays neutral
 *      and the existing retrieval/ranking path remains the fallback.
 *
 * In other words:
 *
 * - "operator musa" should not die because the structure vocabulary cannot
 *   understand "musa".
 * - "Senior Procurement Specialist - Indirect" should still allow retrieval to
 *   surface procurement leaves, while structure can reject the wrong family if
 *   query dimensions clearly align with sales/purchasing instead.
 * - "AJUTOR BUCATAR FAST FOOD" should not be forced to Cooks just because
 *   "bucatar" means cook; "ajutor" supplies assistant/helper/elementary
 *   evidence and keeps Food preparation assistants eligible.
 *
 * Broad terms must be handled carefully
 * -------------------------------------
 *
 * Some words are too broad to be role-head authority by themselves:
 *
 * - operator
 * - manager
 * - assistant
 * - specialist
 * - consultant
 * - service
 * - support
 * - worker / lucrator
 *
 * These terms may be useful as authority_band or weak occupation_level evidence,
 * but they must not create hard domain/object evidence or false certainty by
 * themselves. When they are used as role heads, they need companion dimensions
 * or explicit bridge logic.
 *
 * Concrete example from Romanian:
 *
 * - "lucrator" is common market language and may mean retail worker, warehouse
 *   worker, kitchen worker, or another helper role. It should not assert
 *   role_heads=labourer and reject administrative/logistics/sales families.
 *   It is kept as worker authority evidence instead.
 *
 * Bridge logic
 * ------------
 *
 * The bridge functions below are deliberately narrow. They handle cases where a
 * broad query role and a family role are not literal matches, but another
 * concrete dimension proves compatibility.
 *
 * Examples:
 *
 * - operator + assembly activity can bridge to Assemblers.
 * - operator + billing/accounts object can bridge to Numerical clerks.
 * - advisor + sales domain/activity can bridge to shop/sales families.
 * - assistant + clerical/shop/health support can bridge to the corresponding
 *   assistant families.
 * - manager + customer channel can bridge to Client information workers in
 *   market titles such as "Manager Relatii Clienti".
 * - mobile plant + material handling can keep Transport and storage labourers
 *   eligible for titles like "Stivuitorist(manipulant marfa)".
 *
 * Bridges should not be added just to satisfy one failing expected label. Add a
 * bridge only when the compatibility is reusable, explainable, and requires a
 * concrete supporting dimension.
 *
 * Hard rejection policy
 * ---------------------
 *
 * role_heads and occupation_level are the main semantic guardrails. A role-head
 * mismatch can reject a family unless a bridge explains compatibility. Some
 * dimensions, such as transport_mode, are hard contradictions because they
 * separate materially different work contexts: truck driver vs car driver,
 * mobile plant vs rail/air/ship, and so on.
 *
 * Other dimensions can be soft contradictions. For example, a domain mismatch
 * may reduce score without eliminating a candidate when the query is sparse.
 *
 * The scoring output must remain explainable. Debug output should show:
 *
 * - aligned dimensions,
 * - contradicted dimensions,
 * - hard rejection reasons,
 * - raw structural score,
 * - normalized support/contradiction used by ranking.
 *
 * Extension process
 * -----------------
 *
 * When expanding this layer:
 *
 * 1. Start from real title samples or explicit failing cases.
 * 2. Decide which dimension the term actually supports.
 * 3. Prefer adding locale terms to the reviewed JSON seed, not this table.
 * 4. Use comparable values already present in the family table when possible.
 *    If a query value is invented and no family row contains it, it will often
 *    become a contradiction rather than support.
 * 5. Avoid phrase-canonicalization shortcuts here. Multi-word market phrases
 *    belong in query preparation or reviewed family signals only when explicitly
 *    approved. This module should work from dimensions, not hidden phrase rewrites.
 * 6. Add structural tests for both vocabulary lookup and family comparison.
 * 7. Run a slow-title structural audit to verify the change improves shortlist
 *    behavior without increasing false hard rejections.
 * 8. Run focused pipeline invariants for any integrated behavior touched by the
 *    vocabulary/rule change.
 *
 * Design goal
 * -----------
 *
 * The desired end state is not a hand-maintained giant dictionary in code. The
 * desired end state is:
 *
 *   curated 125-family dimension table
 *     + generated/reviewed multilingual vocabulary artifact
 *     + ESCO retrieval/profile/leaf recovery
 *     -> explainable structural shortlisting and fallback-safe ranking.
 *
 * Until the generated artifact exists, this module and the reviewed JSON seed
 * are the explicit, auditable bridge from zero-dimensional retrieval to
 * dimension-aware family selection.
 */
export type FamilyOccupationLevel = 'military_officer' | 'military_non_commissioned' | 'military_other_rank' | 'executive_manager' | 'professional' | 'associate_technical' | 'clerical' | 'service_sales' | 'skilled_trades' | 'plant_machine_operator' | 'driver_transport' | 'elementary';
export type FamilyStructureDimension = 'role_heads' | 'knowledge_domains' | 'work_objects' | 'settings' | 'population_or_channel' | 'transport_mode' | 'authority_band' | 'activities';
export type FamilyStructureRule = {
    familyNodeId: number;
    familyLabel: string;
    occupationLevel: FamilyOccupationLevel;
    roleHeads: readonly string[];
    knowledgeDomains: readonly string[];
    workObjects: readonly string[];
    settings: readonly string[];
    populationOrChannel: readonly string[];
    transportMode: readonly string[];
    authorityBand: readonly string[];
    activities: readonly string[];
    hardRejectNotes: string;
};
export type FamilyStructureProfile = {
    readonly valuesByDimension: ReadonlyMap<FamilyStructureVocabularyDimension, readonly string[]>;
};
export type FamilyStructureDimensionComparison = {
    readonly dimension: FamilyStructureVocabularyDimension;
    readonly queryValues: readonly string[];
    readonly familyValues: readonly string[];
    readonly sharedValues: readonly string[];
    readonly aligned: boolean;
    readonly contradicted: boolean;
    readonly unsupportedFamilySpecificity: boolean;
};
export type FamilyStructureComparison = {
    readonly familyNodeId: number;
    readonly familyLabel: string;
    readonly queryProfile: FamilyStructureProfile;
    readonly familyProfile: FamilyStructureProfile;
    readonly dimensions: readonly FamilyStructureDimensionComparison[];
    readonly alignedDimensions: readonly FamilyStructureVocabularyDimension[];
    readonly contradictedDimensions: readonly FamilyStructureVocabularyDimension[];
    readonly unsupportedFamilySpecificityDimensions: readonly FamilyStructureVocabularyDimension[];
    readonly roleHeadAligned: boolean;
    readonly roleHeadMissing: boolean;
    readonly hardRejected: boolean;
    readonly reasons: readonly string[];
};
export type FamilyStructureShortlistCandidate = {
    readonly comparison: FamilyStructureComparison;
    readonly structuralScore: number;
    readonly supportDimensions: readonly FamilyStructureVocabularyDimension[];
    readonly softContradictionDimensions: readonly FamilyStructureVocabularyDimension[];
};
export type FamilyStructureShortlist = {
    readonly queryProfile: FamilyStructureProfile;
    readonly candidates: readonly FamilyStructureShortlistCandidate[];
    readonly rejected: readonly FamilyStructureComparison[];
};
export type FamilyStructureShortlistOptions = {
    readonly familyNodeIds?: readonly number[];
    readonly limit?: number;
};
export declare const FAMILY_STRUCTURE_RULES: readonly FamilyStructureRule[];
export declare const FAMILY_STRUCTURE_RULE_BY_ID: ReadonlyMap<number, FamilyStructureRule>;
export declare function getFamilyStructureRule(familyNodeId: number): FamilyStructureRule | undefined;
export declare function requireFamilyStructureRule(familyNodeId: number): FamilyStructureRule;
export declare function buildFamilyStructureQueryProfile(tokens: readonly string[], locale?: SupportedQueryLocale): FamilyStructureProfile;
export declare function buildFamilyStructureProfile(rule: FamilyStructureRule): FamilyStructureProfile;
export declare function compareFamilyStructureToQuery(family: FamilyStructureRule | number, queryTokens: readonly string[], locale?: SupportedQueryLocale): FamilyStructureComparison;
export declare function shortlistFamilyStructureMatches(queryTokens: readonly string[], locale?: SupportedQueryLocale, options?: FamilyStructureShortlistOptions): FamilyStructureShortlist;
export declare function familyStructureSupportScore(comparison: FamilyStructureComparison): number;
export declare function validateFamilyStructureRules(): void;
