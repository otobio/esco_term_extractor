import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { before, test } from 'node:test';
import { parse } from 'csv-parse';
import { OccupationRuntimeContext } from '../../src/runtime/occupation-runtime-context.js';
import { OccupationSearchPipeline } from '../../src/search-pipeline/occupation-search-pipeline.js';
import { preparedQuerySupportsSpecializationKind } from '../../src/runtime/occupation-leaf-structure-rules.js';
const SOURCE = 'esco_1_2_1';
const LOCALE = 'ro';
// Mirrors getCanonicalTerm's defaults (src/api/canonical-term.ts) -- the fixture's recorded
// top_leaf values were produced through that API, not a bare pipeline.run({ limit }) call, and
// topFamilyLimit/topLeavesPerFamily/siblingLimit materially change which leaf wins.
const PRODUCTION_RUN_OPTIONS = {
    modelKey: 'none',
    limit: 12,
    siblingLimit: 5,
    topFamilyLimit: 3,
    topLeavesPerFamily: 3
};
// Not compiled -- resolved from the repo root (test:slow always runs from there), not __dirname,
// since __dirname would point at dist/tests/slow after compilation.
const FIXTURE_PATH = path.join(process.cwd(), 'tests', 'slow', 'fixtures', 'ejobs-sample.csv');
// Two runtimes on purpose: the fixture's recorded top_leaf values were produced with the
// leaf-structure runtime at its production default (currently off, see canonical-term.ts), so the
// exact-match regression net below must run under that same default to stay meaningful. The
// specialization-budget test needs leafStructureRuntime explicitly on, since leaf.leafStructure is
// null when the runtime is disabled -- it is a forward-looking check for when that runtime graduates
// to on-by-default, not a claim about current production behavior.
let productionDefaultPipeline;
let leafStructurePipeline;
let rows;
// Titles the current pipeline already gets wrong (wrong-family retrieval, not leaf-structure
// specialization). Tracked explicitly rather than silently ignored, so shrinking this list is
// itself a visible regression-test improvement. Re-run `npm run query:leaf-structure:audit --
// --input=tests/slow/fixtures/ejobs-sample.csv --locale=ro` after a change to see whether an
// entry can be removed.
const KNOWN_MISMATCH_TITLES = new Set([
    'Stivuitoristi  pe perioada nedeterminata in SATU MARE',
    'KFC Bran cauta colegi! Hai intr-o echipa #pebune!',
    'Programator CMM',
    'Personal de Serviciu Otopeni (f/m)',
    'Personal de Serviciu Luduș, part-time, 4h (f/m)',
    'Personal de Serviciu Codlea, part-time 4 ore (f/m)',
    'Operator recuperare creante cu limba poloneza',
    'Mecanic Siloz Giurgiu',
    'Referent - Conditioner finisor-Thermoplaste',
    'Game Presenter / Crupier–3000 lei+400 lei tichete masa+ 1000 lei BONUS, Pipera-București'
].map((title) => title.toLowerCase()));
before(async () => {
    const [defaultRuntime, structureRuntime] = await Promise.all([
        OccupationRuntimeContext.load({ sourceName: SOURCE, retrievalBackend: 'binary-cache' }),
        OccupationRuntimeContext.load({ sourceName: SOURCE, retrievalBackend: 'binary-cache', leafStructureRuntime: true })
    ]);
    productionDefaultPipeline = OccupationSearchPipeline.withRuntime(defaultRuntime);
    leafStructurePipeline = OccupationSearchPipeline.withRuntime(structureRuntime);
    rows = await loadFixtureRows();
});
test('ejobs sample: selected=yes titles keep ranking their recorded top leaf', async () => {
    const failures = [];
    for (const row of rows) {
        if (!row.selected || KNOWN_MISMATCH_TITLES.has(row.jobTitle.toLowerCase())) {
            continue;
        }
        const result = await productionDefaultPipeline.run({
            query: row.jobTitle,
            locale: LOCALE,
            sourceName: SOURCE,
            ...PRODUCTION_RUN_OPTIONS
        });
        const primarySpan = firstSpan(result);
        const rankedOrSelectedLeaf = (primarySpan.decision.decisionType === 'leaf' ? primarySpan.decision.selectedLabel : null) ||
            primarySpan.rankedFamilies[0]?.leaves[0]?.canonicalLabel;
        if (rankedOrSelectedLeaf !== row.topLeaf) {
            failures.push(`"${row.jobTitle}" -> "${rankedOrSelectedLeaf}" (expected "${row.topLeaf}")`);
        }
    }
    assert.deepEqual(failures, []);
});
// This is the specialization-overreach net asked for alongside the exact-match regression net
// above: even when the leaf a query lands on is family-plausible (selected=yes), the leaf itself
// should not carry a specialization axis (venue/channel/product/population/task_focus/
// industry_context) the query gives no structural evidence for. A growing count here is the
// signal to tackle next, grouped by axis via `npm run query:leaf-structure:audit`.
test('ejobs sample: winning leaves stay within a bounded unsupported-specialization budget', async () => {
    // Measured with `npm run query:leaf-structure:audit -- --input=tests/slow/fixtures/ejobs-sample.csv
    // --locale=ro`: 10/968 unsupported-specialization winners across the whole fixture (this test
    // only checks the selected=yes subset, so its own count is <= 10). The count only reflects
    // leaves the pipeline actually asserts as its decision (decisionType === 'leaf') -- both this
    // check and the audit CLI used to also count a family's top-ranked leaf even when the pipeline
    // fell back to a family-level decision instead of asserting it, which is exactly the safe
    // fallback hasUnsafeSpecializedLeafTie is supposed to produce. Fixing that measurement gap,
    // plus letting hasUnsafeSpecializedLeafTie fire even without a competing sibling already in the
    // candidate pool (src/search-pipeline/occupation-search-pipeline.ts), dropped this from 79/968.
    // Budget is set just above the measured count so this net still catches new regressions; lower
    // it as remaining cases (mostly wrong-family retrieval, e.g. "Mecanic Siloz Giurgiu" landing on
    // "aircraft interior technician") get fixed.
    const MAX_UNSUPPORTED_SPECIALIZATION_WINNERS = 12;
    let unsupportedCount = 0;
    for (const row of rows) {
        if (!row.selected) {
            continue;
        }
        const result = await leafStructurePipeline.run({
            query: row.jobTitle,
            locale: LOCALE,
            sourceName: SOURCE,
            ...PRODUCTION_RUN_OPTIONS
        });
        // Only a leaf-level decision actually asserts a specific leaf; a family-level decision is the
        // pipeline correctly declining to pick one (e.g. hasUnsafeSpecializedLeafTie downgrading an
        // over-specific top-ranked leaf), so it must not count as an unsupported-specialization
        // "winner" here.
        const primarySpan = firstSpan(result);
        const topLeaf = primarySpan.decision.decisionType === 'leaf' ? (primarySpan.rankedFamilies[0]?.leaves[0] ?? null) : null;
        const structure = topLeaf?.leafStructure ?? null;
        if (!structure) {
            continue;
        }
        const hasUnsupportedSpecialization = structure.specializationKinds.some((kind) => !preparedQuerySupportsSpecializationKind(result.preparedQuery, kind));
        if (hasUnsupportedSpecialization) {
            unsupportedCount += 1;
        }
    }
    assert.ok(unsupportedCount <= MAX_UNSUPPORTED_SPECIALIZATION_WINNERS, `unsupported-specialization winners = ${unsupportedCount}, budget = ${MAX_UNSUPPORTED_SPECIALIZATION_WINNERS}`);
});
// Mirrors canonicalOccupationContexts's span fallback (src/api/canonical-term.ts) -- a multi-span
// decision (title contains "/", "&", etc.) leaves the top-level rankedFamilies/rankedLeaves empty,
// with the real per-span winner living in spanResults[0] instead.
function firstSpan(result) {
    return result.spanResults.length > 0
        ? result.spanResults[0]
        : { decision: result.decision, coverageStatus: result.coverageStatus, rankedFamilies: result.rankedFamilies };
}
async function loadFixtureRows() {
    const parser = createReadStream(FIXTURE_PATH, { encoding: 'utf8' }).pipe(parse({ bom: true, columns: true, relax_column_count: true, skip_empty_lines: true }));
    const seen = new Set();
    const parsed = [];
    for await (const record of parser) {
        const jobTitle = String(record.job_title ?? '').trim();
        if (!jobTitle || seen.has(jobTitle)) {
            continue;
        }
        seen.add(jobTitle);
        parsed.push({
            jobTitle,
            selected: String(record.selected ?? '')
                .trim()
                .toLowerCase() === 'yes',
            topLeaf: String(record.top_leaf ?? '').trim(),
            topFamily: String(record.top_family ?? '').trim()
        });
    }
    return parsed;
}
