import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { DEFAULT_ESCO_SOURCE_NAME, DEFAULT_RETRIEVAL_LOCALE } from '../retrieval/occupation-candidates.js';
import { parseRetrievalBackend } from '../retrieval/retrieval-engine-factory.js';
import { OccupationRuntimeContext } from '../runtime/occupation-runtime-context.js';
import { OccupationSearchPipeline } from '../search-pipeline/occupation-search-pipeline.js';
const execFileAsync = promisify(execFile);
// Set this to a commit hash locally when you want comparison by default.
const DEFAULT_COMPARE_COMMIT = null;
const EN_DEFAULT_QUERIES = [
    'Shoe Maker & Designer',
    'Shipping And Logistics Officer',
    'Digital Media Officer',
    'Personal Assistant',
    'Front Desk Officer',
    'Cashier',
    'Estate Management Personnel',
    'Content Creator / Graphics Designer',
    'Actuarial Analyst',
    'Cashiers',
    'Accountant',
    'Administrative Translator',
    'Cook',
    'Medical Representative',
    'Head of Treasury',
    'Sales Representative',
    'Territory Manager',
    'Customer Service Representative',
    'Laundry Personnel',
    'Strategic Command, Control, Communications, Computer Intelligence, Surveillance (C4ISR) to Operationalize the Stratosphere (SCOS) Prototype Project',
    'Brand & Growth Executive',
    'Customer Service Representatives',
    'Executive Assistant',
    'Computer Science Teacher',
    'Psychologist - Therapist',
    'Real Estate Manager',
    'Client Advisor',
    'Accountant',
    'Benching Officer',
    'Field Sales Officer',
    'Surveyor (Numan-Adamawa State)',
    'Market Sales Specialist',
    'Head of Government Affairs/ Human Resources Manager',
    'Implementation Officer (Lagos)',
    'Marketer',
    'Business Development Manager',
    'Maintenance Engineer',
    'Public Health Assistant',
    'Supervisor',
    'House Keeper',
    'Senior Full-stack Engineer',
    'Hotel Manager',
    'Social Media Lead',
    'Executive Assistant',
    'Training Officer',
    'Dental Assistant',
    'Lubricant Sales Engineer',
    'Chef',
    'Aesthetic Nurse',
    'Business Development Manager'
];
const RO_DEFAULT_QUERIES = [
    'Reprezentant Comercial',
    'Multi-lateral Multi-state Openarchitecture Integrate Transparent Eyeballs',
    'Innovative Methodical Data-warehouse Streamline Next-generation Experiences',
    'Agent cu Italiană -Chat-Hybrid - Galati (Full/Part-time)',
    'Cautam Meseriasi :fierari,dulgheri,personal Canalizari Instalari Tevi Pentru Germania, Cu Experienta',
    'Pre-emptive Fresh-thinking Challenge Cultivate Cutting-edge Communities',
    'Lucrător depozit Ieșire Marfă Lugoj (f/m)',
    'Cross-group Asymmetric Throughput Evolve Collaborative Markets',
    'Administrator Patrimoniu - Posturi Gov |  Locuri De Munca La Stat',
    'Cross-platform Bottom-line Capability Extend Interactive E-commerce',
    'Phased Real-time Processimprovement Repurpose Virtual Action-items',
    'Collection Officer – VODAFONE ROMÂNIA',
    'Muncitor Necalificat La Asamblarea, Montarea Pieselor',
    'Pre-emptive Systemic Archive Orchestrate Web-enabled Bandwidth',
    'Assimilated Upward-trending Protocol Deliver Web-enabled Interfaces',
    'Phased Exuding Forecast Facilitate Integrated Technologies',
    'Asistent medical generalist - Clinica Estetica',
    'Lucrator Sortator Deseuri Reciclabile Rematinvest Punct De Lucru Sacalaz',
    'Re-contextualized Asynchronous Orchestration Facilitate Scalable Experiences',
    'Ajutor Ospatar',
    'Remote French Bilingual Customer Support Representative',
    'Camerista Hotel',
    'Assimilated Neutral Alliance Iterate Cross-media ROI',
    'Brand Manager Salveo Romania',
    'Triple-buffered Systematic Info-mediaries Exploit Cross-media Vortals',
    'User-friendly Optimizing Product Exploit Enterprise Paradigms',
    'Manipulant Marfuri',
    'Customer Care Specialist - Dutch or German (Freelancer)',
    'Отворене пријаве за програм стипендирања „Верујемо у тебе“: 10 стипендиста добија прилику да буде део програма',
    'Agent Servicii Client',
    'Universal Composite Info-mediaries Aggregate Clicks-and-mortar Webservices',
    'Urgent! Angajam Ambalator In Fabrica Mase Plastice',
    'De-engineered Secondary Infrastructure Facilitate Bricks-and-clicks Schemas',
    'MERCANTIZOR KA RUTA MOBILA - JUD. BRASOV, BUCURESTI SECT 1,6',
    'Lucrător depozit Ieșire Marfă Lugoj (f/m)',
    'Front Desk Receptionist | Part-time',
    'Bucatar',
    'Angajez Sofer Profesionist Cat C+e',
    'Centralized Multi-tasking Alliance Architect Intuitive E-commerce',
    'Sef Centru Zonal Masura  Teleorman',
    'Frontend Developer',
    'Back Office Support - Departament vânzări',
    'Actuary',
    'Java Developer Trainee @ Siemens',
    'Lucrator Sortator Deseuri Reciclabile',
    'Manager/Consilier despagubiri accidente rutiere',
    'Consultant vânzări – Fomco Solar',
    'Lucrator Gestionar',
    'Sofer Personal, Profesionist.',
    'Sofer - Arad'
];
//'Assistant General Manager', 'Executive Assistant', 'Sales Manager', 'Programs Supervisor', 'Community Manager', 'Social Media Manager', 'Customer Service Representative', 'Product and Business Developer', 'Senior Cisco Engineer', 'Fuel Manager-Numan,Adamawa State', 'Accountant', 'App Growth Marketer', 'AI Engineer', 'Facility Officer', 'Deposit Mobilization Associate', 'House Manager', 'Administrative and Social Media Officer', 'Senior Accountant', 'Cook', 'Technical Manager', 'Social Media Manager', 'Social Media Manager', 'Kitchen Manager', 'Driver', 'Head Of Marketing', 'Accountant', 'Social Media Manager and Content Creator', 'Counsel / Legal Officer', 'Accountant', 'Project Manager', 'Youtube Channel Aqusition Agent', 'Sales Executive', 'Talent Acquisition Specialist', 'Legal Associate', 'Business Development Manager', 'Creative Content Creator', 'Head of Accounts & Finance', 'Social Media Manager', 'Sales Representative', 'Project Engineer', 'Human Resources Manager', 'Sales Person', 'Registered Nurse/Midwife', 'Customer Relations Manager', 'Finance and Accounting lead (Grocery Retail)', 'Accountant', 'Sales Executive', 'Spa Therapist', 'Housekeeper', 'Assistant Workshop Manager',
//'Chef', 'Gas Cylinders Sales Canvasser', 'Research Technician II', 'Health and Safety Officer', 'Sales Manager', 'Business Development Executive', 'Logistics Manager', 'Social Media & Community Manager', 'Care Assistant(Home Care)', 'Full Stack Development Instructor (Okemesi-Ekiti) at New Horizons Computer Learning Centers', 'Cybersecurity Facilitator', 'Senior Mechanical Engineer.', 'Learning and Development Supervisor', 'Risk & Credit Executive', 'Real Estate Advisor', 'iOS Application Developer (Remote)', 'Sales Representative', 'Senior Medical Officer', 'Forex Trading Assistant', 'Rachele Pizzillo', 'Policy Consultant (Remote)', 'Accountant', 'Accountant', 'Public Health Officer', 'Assistant Manager, Finance', 'Marketer', 'Brand and Creative Strategy Lead', 'Social Media & Business Development Coordinator', 'Cashier', 'Marine Support Officer', 'Business Manager', 'Cake Decator', 'Facility Officer', 'Technical PM / Product Owner', 'Marketing Officer', 'Front Desk and Admin Officer', 'QA / DevOps Associate', 'Technical Manager', 'Social Media & Content Lead', 'Administrative Officer', 'Customer Service Representative.', 'Receptionist', 'Website Administrator', 'Marketing & Communication Associate', 'Chinese Translator', 'Networking Instructor', 'Marketing Officer', 'Warehouse storekeeper', 'Animal Nutritionist', 'Chef'
const CSV_HEADERS = [
    'run_label',
    'row_number',
    'source',
    'compare_commit',
    'changed',
    'query',
    'effective_query',
    'decision_type',
    'selected_label',
    'selected_node_id',
    'confidence',
    'elapsed_ms',
    'coverage_status',
    'top_family_label',
    'top_family_id',
    'top_leaf_label',
    'top_leaf_id',
    'family_csv',
    'leaf_csv',
    'span_results',
    'error'
];
async function main() {
    const options = await parseCliOptions(process.argv.slice(2));
    const currentResults = await runCurrentResults(options);
    const baselineResults = options.compareCommit ? await runCommitResults(options, options.compareCommit) : null;
    const comparisons = buildComparisons(options.queries, currentResults, baselineResults);
    const rows = comparisonsToCsvRows(options.runLabel, options.compareCommit, comparisons);
    await mkdir(path.dirname(options.outPath), { recursive: true });
    await writeFile(options.outPath, toCsv(rows), 'utf8');
    printSummaryTable(comparisons, options.compareCommit);
    console.log('');
    console.log(`Wrote ${rows.length} comparison rows to ${options.outPath}`);
    console.log(`run_label=${options.runLabel}`);
    console.log(`locale=${options.locale}`);
    console.log(`retrieval_backend=${options.retrievalBackend ?? 'default'}`);
    console.log(`compare_commit=${options.compareCommit ?? 'none'}`);
}
async function runCurrentResults(options) {
    const runtime = await OccupationRuntimeContext.load({
        sourceName: options.sourceName,
        retrievalBackend: options.retrievalBackend ?? undefined,
        aliasNgramLocales: [options.locale]
    });
    const pipeline = OccupationSearchPipeline.withRuntime(runtime);
    const results = new Map();
    for (const query of options.queries) {
        try {
            const startedAt = performance.now();
            const result = await pipeline.run({
                query,
                locale: options.locale,
                sourceName: options.sourceName,
                limit: 20
            });
            results.set(query, summarizePipelineResult(query, result, performance.now() - startedAt));
        }
        catch (error) {
            results.set(query, summarizeError(query, error));
        }
    }
    return results;
}
async function runCommitResults(options, commit) {
    const repoRoot = process.cwd();
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'occupation-pipeline-compare-'));
    const worktreePath = path.join(tempRoot, 'worktree');
    const nodeModulesPath = path.join(worktreePath, 'node_modules');
    await execFileAsync('git', ['worktree', 'add', '--detach', worktreePath, commit], { cwd: repoRoot });
    try {
        try {
            await symlink(path.join(repoRoot, 'node_modules'), nodeModulesPath, 'dir');
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (!message.includes('EEXIST')) {
                throw error;
            }
        }
        await execFileAsync('npm', ['run', 'build'], {
            cwd: worktreePath,
            env: process.env,
            maxBuffer: 20 * 1024 * 1024
        });
        const results = new Map();
        for (const query of options.queries) {
            try {
                const startedAt = performance.now();
                const result = await runCommitPipelineQuery(worktreePath, options, query);
                results.set(query, summarizeJsonResult(query, result, performance.now() - startedAt));
            }
            catch (error) {
                results.set(query, summarizeError(query, error));
            }
        }
        return results;
    }
    finally {
        await safeUnlink(nodeModulesPath);
        await execFileAsync('git', ['worktree', 'remove', '--force', worktreePath], { cwd: repoRoot });
    }
}
async function runCommitPipelineQuery(worktreePath, options, query) {
    const args = [
        'dist/cli/resolve-occupation-pipeline.js',
        `--query=${query}`,
        `--locale=${options.locale}`,
        `--source-name=${options.sourceName}`,
        '--format=json',
        '--no-color'
    ];
    if (options.retrievalBackend) {
        args.push(`--retrieval-backend=${options.retrievalBackend}`);
    }
    const { stdout } = await execFileAsync('node', args, {
        cwd: worktreePath,
        env: process.env,
        maxBuffer: 20 * 1024 * 1024
    });
    return JSON.parse(stdout);
}
function summarizePipelineResult(query, result, elapsedMs) {
    const topFamily = result.rankedFamilies[0] ?? null;
    const bestFamilyLeaves = topFamily?.leaves ?? [];
    const topLeaf = bestFamilyLeaves[0] ?? result.rankedLeaves[0] ?? null;
    return {
        query,
        effectiveQuery: result.queryContext.query,
        decisionType: result.decision.decisionType,
        selectedLabel: result.decision.selectedLabel ?? null,
        selectedNodeId: result.decision.selectedNodeId ?? null,
        confidence: Math.round(result.decision.confidence * 100),
        elapsedMs: Math.round(elapsedMs),
        coverageStatus: result.coverageStatus.status,
        topFamilyLabel: topFamily?.familyLabel ?? null,
        topFamilyId: topFamily?.familyNodeId ?? null,
        topLeafLabel: topLeaf?.canonicalLabel ?? null,
        topLeafId: topLeaf?.graphNodeId ?? null,
        familyCsv: result.rankedFamilies.map((family) => `${family.familyLabel}#${family.familyNodeId}`).join(', '),
        leafCsv: bestFamilyLeaves.map((leaf) => `${leaf.canonicalLabel}#${leaf.graphNodeId}`).join(', '),
        spanResults: compactSpanResults(result),
        error: null
    };
}
function summarizeJsonResult(query, payload, elapsedMs) {
    const queryContext = objectValue(payload.query_context);
    const decision = objectValue(payload.decision);
    const coverageStatus = objectValue(payload.coverage_status);
    const rankedFamilies = arrayValue(payload.ranked_families);
    const rankedLeaves = arrayValue(payload.ranked_leaves);
    const topFamily = objectValue(rankedFamilies[0]);
    const familyLeaves = arrayValue(topFamily.leaves);
    const topLeaf = objectValue(familyLeaves[0] ?? rankedLeaves[0]);
    const spanResults = arrayValue(payload.span_results);
    return {
        query,
        effectiveQuery: stringValue(queryContext.query),
        decisionType: stringValue(decision.decisionType),
        selectedLabel: stringValue(decision.selectedLabel),
        selectedNodeId: numberValue(decision.selectedNodeId),
        confidence: percentValue(decision.confidence),
        elapsedMs: Math.round(elapsedMs),
        coverageStatus: stringValue(coverageStatus.status),
        topFamilyLabel: stringValue(topFamily.familyLabel),
        topFamilyId: numberValue(topFamily.familyNodeId),
        topLeafLabel: stringValue(topLeaf.canonicalLabel),
        topLeafId: numberValue(topLeaf.graphNodeId),
        familyCsv: rankedFamilies
            .map((family) => objectValue(family))
            .map((family) => {
            const label = stringValue(family.familyLabel);
            const id = numberValue(family.familyNodeId);
            return label ? `${label}#${id ?? 'unknown'}` : null;
        })
            .filter((value) => value !== null)
            .join(', '),
        leafCsv: familyLeaves
            .map((leaf) => objectValue(leaf))
            .map((leaf) => {
            const label = stringValue(leaf.canonicalLabel);
            const id = numberValue(leaf.graphNodeId);
            return label ? `${label}#${id ?? 'unknown'}` : null;
        })
            .filter((value) => value !== null)
            .join(', '),
        spanResults: compactJsonSpanResults(spanResults),
        error: null
    };
}
function summarizeError(query, error) {
    return {
        query,
        effectiveQuery: null,
        decisionType: null,
        selectedLabel: null,
        selectedNodeId: null,
        confidence: null,
        elapsedMs: null,
        coverageStatus: null,
        topFamilyLabel: null,
        topFamilyId: null,
        topLeafLabel: null,
        topLeafId: null,
        familyCsv: '',
        leafCsv: '',
        spanResults: '',
        error: error instanceof Error ? error.message : String(error)
    };
}
function buildComparisons(queries, currentResults, baselineResults) {
    return queries.map((query) => {
        const current = currentResults.get(query) ?? summarizeError(query, 'Missing current result');
        const baseline = baselineResults?.get(query) ?? null;
        return {
            query,
            current,
            baseline,
            changed: baseline ? hasMeaningfulChange(current, baseline) : false
        };
    });
}
function hasMeaningfulChange(current, baseline) {
    return (current.decisionType !== baseline.decisionType ||
        current.topFamilyLabel !== baseline.topFamilyLabel ||
        current.topLeafLabel !== baseline.topLeafLabel ||
        current.selectedLabel !== baseline.selectedLabel ||
        current.error !== baseline.error);
}
function comparisonsToCsvRows(runLabel, compareCommit, comparisons) {
    const rows = [];
    for (const [index, comparison] of comparisons.entries()) {
        rows.push(summaryToCsvRow(runLabel, index + 1, 'current', compareCommit, comparison.changed, comparison.current));
        if (comparison.baseline) {
            rows.push(summaryToCsvRow(runLabel, index + 1, compareCommit ?? 'compare', compareCommit, comparison.changed, comparison.baseline));
        }
    }
    return rows;
}
function summaryToCsvRow(runLabel, rowNumber, source, compareCommit, changed, summary) {
    return {
        run_label: runLabel,
        row_number: rowNumber,
        source,
        compare_commit: compareCommit,
        changed: changed ? 'yes' : 'no',
        query: summary.query,
        effective_query: summary.effectiveQuery,
        decision_type: summary.decisionType,
        selected_label: summary.selectedLabel,
        selected_node_id: summary.selectedNodeId,
        confidence: summary.confidence,
        elapsed_ms: summary.elapsedMs,
        coverage_status: summary.coverageStatus,
        top_family_label: summary.topFamilyLabel,
        top_family_id: summary.topFamilyId,
        top_leaf_label: summary.topLeafLabel,
        top_leaf_id: summary.topLeafId,
        family_csv: summary.familyCsv,
        leaf_csv: summary.leafCsv,
        span_results: summary.spanResults,
        error: summary.error
    };
}
function compactSpanResults(result) {
    if (result.spanResults.length === 0) {
        return '';
    }
    return result.spanResults
        .map((span) => {
        const topFamily = span.rankedFamilies[0]?.familyLabel ?? '';
        const topLeaf = span.rankedFamilies[0]?.leaves[0]?.canonicalLabel ?? '';
        return `${span.spanIndex}:${span.query}=>${span.decision.decisionType}:${topFamily}:${topLeaf}`;
    })
        .join('; ');
}
function compactJsonSpanResults(items) {
    if (items.length === 0) {
        return '';
    }
    return items
        .map((item) => objectValue(item))
        .map((span) => {
        const families = arrayValue(span.ranked_families);
        const topFamily = objectValue(families[0]);
        const topLeaf = objectValue(arrayValue(topFamily.leaves)[0]);
        return `${numberValue(span.span_index) ?? '?'}:${stringValue(span.query) ?? ''}=>${stringValue(objectValue(span.decision).decisionType) ?? ''}:${stringValue(topFamily.familyLabel) ?? ''}:${stringValue(topLeaf.canonicalLabel) ?? ''}`;
    })
        .join('; ');
}
function printSummaryTable(comparisons, compareCommit) {
    const color = createColor(process.env.NO_COLOR === undefined);
    const baselineLabel = compareCommit ? shortCommit(compareCommit) : '';
    const headers = ['source', 'query', 'selected', 'family', 'topLeaf', 'decision', 'timeMs'];
    const rows = [];
    for (const comparison of comparisons) {
        rows.push(toDisplayRow('current', comparison.current, comparison.changed, false));
        if (comparison.baseline) {
            rows.push(toDisplayRow(baselineLabel, comparison.baseline, comparison.changed, true));
            rows.push({
                source: '',
                query: '',
                selected: '',
                family: '',
                topLeaf: '',
                decision: '',
                timeMs: '',
                highlight: false,
                separator: true
            });
        }
    }
    const widths = headers.map((header) => {
        const contentWidth = Math.max(...rows.filter((row) => !row.separator).map((row) => row[header].length), 0);
        return Math.max(header.length, contentWidth);
    });
    console.log(formatTableRow(headers, widths));
    console.log(formatTableRow(widths.map((width) => '-'.repeat(width)), widths));
    for (const row of rows) {
        if (row.separator) {
            console.log(widths.map((width) => '-'.repeat(width)).join('-+-'));
            continue;
        }
        const values = headers.map((header) => row[header]);
        console.log(formatTableRow(row.highlight ? values.map((value) => color.yellow(value)) : values, widths));
    }
}
function toDisplayRow(source, summary, highlight, isBaseline) {
    return {
        source,
        query: summary.query,
        selected: summary.selectedLabel ? `${summary.selectedLabel}${summary.selectedNodeId ? `#${summary.selectedNodeId}` : ''}` : '',
        family: summary.topFamilyLabel ?? summary.error ?? '',
        topLeaf: summary.topLeafLabel ?? '',
        decision: summary.decisionType ?? 'error',
        timeMs: summary.elapsedMs === null ? '' : String(summary.elapsedMs),
        highlight: highlight && isBaseline,
        separator: false
    };
}
function formatTableRow(values, widths) {
    return values.map((value, index) => padAnsi(value, widths[index] ?? visibleLength(value))).join(' | ');
}
function toCsv(rows) {
    const lines = [CSV_HEADERS.join(','), ...rows.map((row) => CSV_HEADERS.map((header) => csvEscape(row[header])).join(','))];
    return `${lines.join('\n')}\n`;
}
function csvEscape(value) {
    if (value === null || value === undefined) {
        return '';
    }
    const text = String(value).replace(/\r?\n/gu, ' ').trim();
    return /[",\n\r]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}
async function parseCliOptions(args) {
    const runLabel = timestampRunLabel();
    const options = {
        locale: DEFAULT_RETRIEVAL_LOCALE,
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        runLabel,
        outPath: path.resolve('artifacts/evaluation/known-occupation-pipeline', `${runLabel}.csv`),
        retrievalBackend: 'binary-cache',
        queries: [],
        compareCommit: DEFAULT_COMPARE_COMMIT
    };
    let queryFilePath = null;
    for (const arg of args) {
        if (arg.startsWith('--locale=')) {
            options.locale = arg.slice('--locale='.length).trim();
            continue;
        }
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
            continue;
        }
        if (arg.startsWith('--run-label=')) {
            options.runLabel = arg.slice('--run-label='.length).trim();
            options.outPath = path.resolve('artifacts/evaluation/known-occupation-pipeline', `${options.runLabel}.csv`);
            continue;
        }
        if (arg.startsWith('--retrieval-backend=')) {
            options.retrievalBackend = parseRetrievalBackend(arg.slice('--retrieval-backend='.length));
            continue;
        }
        if (arg.startsWith('--compare-commit=')) {
            const commit = arg.slice('--compare-commit='.length).trim();
            options.compareCommit = commit || null;
            continue;
        }
        if (arg === '--no-compare') {
            options.compareCommit = null;
            continue;
        }
        if (arg.startsWith('--out=')) {
            options.outPath = path.resolve(arg.slice('--out='.length).trim());
            continue;
        }
        if (arg.startsWith('--query=')) {
            const query = arg.slice('--query='.length).trim();
            if (query) {
                options.queries.push(query);
            }
            continue;
        }
        if (arg.startsWith('--query-file=')) {
            queryFilePath = path.resolve(arg.slice('--query-file='.length).trim());
            continue;
        }
        if (arg === '--help') {
            printHelp();
            process.exit(0);
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    if (queryFilePath) {
        const fileContents = await readFile(queryFilePath, 'utf8');
        options.queries.push(...fileContents
            .split(/\r?\n/gu)
            .map((line) => line.trim())
            .filter(Boolean));
    }
    if (options.queries.length === 0) {
        if (options.locale === 'en') {
            options.queries = [...EN_DEFAULT_QUERIES];
        }
        else if (options.locale === 'ro') {
            options.queries = [...RO_DEFAULT_QUERIES];
        }
        else {
            options.queries = [...EN_DEFAULT_QUERIES];
        }
    }
    if (!options.locale) {
        throw new Error('--locale must not be empty.');
    }
    if (!options.runLabel) {
        throw new Error('--run-label must not be empty.');
    }
    return options;
}
function timestampRunLabel() {
    return `known-occupation-${new Date().toISOString().replace(/[:.]/gu, '-').replace('T', '_').replace('Z', 'Z')}`;
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/run-known-occupation-pipeline-csv.js',
        '[--locale=en]',
        '[--source-name=esco]',
        '[--run-label=before-last-2-commits]',
        '[--retrieval-backend=opensearch|binary-cache]',
        '[--compare-commit=<sha>]',
        '[--no-compare]',
        '[--out=artifacts/evaluation/known-occupation-pipeline/before.csv]',
        '[--query="Cashier"]',
        '[--query-file=queries.txt]'
    ].join(' '));
}
function objectValue(value) {
    return value !== null && typeof value === 'object' ? value : {};
}
function arrayValue(value) {
    return Array.isArray(value) ? value : [];
}
function stringValue(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
}
function numberValue(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function percentValue(value) {
    const numeric = numberValue(value);
    return numeric === null ? null : Math.round(numeric * 100);
}
function shortCommit(value) {
    return value.slice(0, 8);
}
const ANSI_ESCAPE_REGEX = new RegExp(String.raw `\u001b\[[0-9;]*m`, 'gu');
function visibleLength(value) {
    return value.replace(ANSI_ESCAPE_REGEX, '').length;
}
function padAnsi(value, width) {
    const padding = Math.max(width - visibleLength(value), 0);
    return `${value}${' '.repeat(padding)}`;
}
function createColor(enabled) {
    const wrap = (open, close) => (value) => (enabled ? `${open}${value}${close}` : value);
    return {
        yellow: wrap('\u001b[33m', '\u001b[39m')
    };
}
async function safeUnlink(filePath) {
    try {
        await unlink(filePath);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes('ENOENT')) {
            throw error;
        }
    }
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Known occupation pipeline CSV run failed.');
    console.error(message);
    process.exitCode = 1;
});
