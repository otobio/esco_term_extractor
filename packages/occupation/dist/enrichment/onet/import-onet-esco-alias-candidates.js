import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { foldSearchText, isGenericQueryToken, normalizeSearchText, tokenizeNormalizedText } from '../../query/query-preparation.js';
export const ONET_ALIAS_SOURCE_TAG = 'onet_esco_bridge';
export const DEFAULT_ONET_DOWNLOAD_DIR = '/private/tmp/ose-onet-esco';
export const ONET_CROSSWALK_URL = 'https://www.onetcenter.org/crosswalks/esco/ESCO_to_ONET-SOC.xlsx';
export const ONET_JOB_TITLES_URL = 'https://www.onetcenter.org/dl_files/database/db_30_3_excel/Job%20Titles.xlsx';
export const ONET_REPORTED_TITLES_URL = 'https://www.onetcenter.org/dl_files/database/db_30_3_excel/Sample%20of%20Reported%20Titles.xlsx';
export const DEFAULT_ONET_REPORT_DIR = 'artifacts/enrichment/onet';
const FILES = {
    crosswalk: 'ESCO_to_ONET-SOC.xlsx',
    jobTitles: 'Job Titles.xlsx',
    reportedTitles: 'Sample of Reported Titles.xlsx'
};
const BROAD_ONET_TITLE_PATTERN = /\ball other\b/i;
const UNSAFE_ALIAS_PATTERN = /^[\d\s\W_]+$/u;
const GENERIC_ONE_WORD_ALIASES = new Set([
    'agent',
    'analyst',
    'assistant',
    'consultant',
    'coordinator',
    'creator',
    'designer',
    'developer',
    'employee',
    'engineer',
    'expert',
    'manager',
    'officer',
    'operator',
    'producer',
    'specialist',
    'supervisor',
    'technician',
    'worker'
]);
export async function importOnetEscoAliasCandidates(connection, options = {}) {
    const sourceName = options.sourceName?.trim() || 'esco_1_2_1';
    const downloadDir = options.downloadDir?.trim() || DEFAULT_ONET_DOWNLOAD_DIR;
    const reportDir = options.reportDir?.trim() || path.resolve(process.cwd(), DEFAULT_ONET_REPORT_DIR);
    const sampleLimit = options.sampleLimit ?? 20;
    const writeArtifact = options.writeArtifact ?? true;
    await mkdir(downloadDir, { recursive: true });
    await mkdir(reportDir, { recursive: true });
    const filePaths = await downloadInputFiles(downloadDir);
    const targetNodesByEscoCode = await loadTargetNodes(connection, sourceName);
    const existingAliasesByNormalizedAlias = await loadExistingAliases(connection);
    const crosswalkRows = parseCrosswalkRows(readFirstWorksheet(filePaths.crosswalk));
    const jobTitleRows = parseJobTitleRows(readFirstWorksheet(filePaths.jobTitles));
    const reportedTitleRows = parseReportedTitleRows(readFirstWorksheet(filePaths.reportedTitles));
    const rawAliases = [...jobTitleRows, ...reportedTitleRows];
    const crosswalkRowsByOnetCode = groupBy(crosswalkRows, (row) => row.onetCode);
    const rawAliasesByKey = new Map();
    for (const row of rawAliases) {
        const normalizedAlias = normalizeSearchText(row.alias);
        if (!normalizedAlias) {
            continue;
        }
        rawAliasesByKey.set(`${row.onetCode}\u0000${normalizedAlias}\u0000${row.sourceFileRole}`, row);
    }
    const candidates = [];
    const unmatchedCrosswalkTargets = crosswalkRows.filter((row) => row.escoCode && !targetNodesByEscoCode.has(row.escoCode)).length;
    for (const rawAlias of rawAliasesByKey.values()) {
        const mappedRows = crosswalkRowsByOnetCode.get(rawAlias.onetCode) ?? [];
        const targetNodes = uniqueTargets(mappedRows.map((row) => targetNodesByEscoCode.get(row.escoCode)).filter((target) => Boolean(target)));
        if (targetNodes.length === 0) {
            candidates.push(buildCandidate(rawAlias, null, null, mappedRows, existingAliasesByNormalizedAlias));
            continue;
        }
        for (const target of targetNodes) {
            candidates.push(buildCandidate(rawAlias, target, targetNodes.length, mappedRows, existingAliasesByNormalizedAlias));
        }
    }
    candidates.sort(compareCandidates);
    const reportPath = path.join(reportDir, 'onet-esco-alias-candidates-report.json');
    const result = {
        sourceTag: ONET_ALIAS_SOURCE_TAG,
        sourceName,
        downloadDir,
        reportPath,
        summary: {
            crosswalkRows: crosswalkRows.length,
            jobTitleRows: jobTitleRows.length,
            reportedTitleRows: reportedTitleRows.length,
            rawAliases: rawAliases.length,
            uniqueAliases: rawAliasesByKey.size,
            generate: candidates.filter((candidate) => candidate.candidateMode === 'generate').length,
            review: candidates.filter((candidate) => candidate.candidateMode === 'review').length,
            exclude: candidates.filter((candidate) => candidate.candidateMode === 'exclude').length,
            unmatchedCrosswalkTargets
        },
        samples: {
            generate: candidates.filter((candidate) => candidate.candidateMode === 'generate').slice(0, sampleLimit),
            review: candidates.filter((candidate) => candidate.candidateMode === 'review').slice(0, sampleLimit),
            exclude: candidates.filter((candidate) => candidate.candidateMode === 'exclude').slice(0, sampleLimit)
        }
    };
    await writeFile(reportPath, `${JSON.stringify({
        ...result,
        candidates
    }, null, 2)}\n`, 'utf8');
    if (writeArtifact) {
        await writeBuildArtifact(connection, sourceName, result);
    }
    return result;
}
async function downloadInputFiles(downloadDir) {
    const filePaths = {
        crosswalk: path.join(downloadDir, FILES.crosswalk),
        jobTitles: path.join(downloadDir, FILES.jobTitles),
        reportedTitles: path.join(downloadDir, FILES.reportedTitles)
    };
    await downloadIfMissing(ONET_CROSSWALK_URL, filePaths.crosswalk);
    await downloadIfMissing(ONET_JOB_TITLES_URL, filePaths.jobTitles);
    await downloadIfMissing(ONET_REPORTED_TITLES_URL, filePaths.reportedTitles);
    return filePaths;
}
async function downloadIfMissing(url, destinationPath) {
    if (existsSync(destinationPath)) {
        return;
    }
    await mkdir(path.dirname(destinationPath), { recursive: true });
    execFileSync('curl', ['-fL', '--retry', '3', '--retry-delay', '2', '-o', destinationPath, url], { stdio: 'inherit' });
}
async function loadTargetNodes(connection, sourceName) {
    const [rows] = await connection.execute(`
      SELECT DISTINCT
        node.id AS graph_node_id,
        node.canonical_label,
        node.normalized_label,
        concept.external_id AS esco_code,
        concept.preferred_label AS esco_title
      FROM ose_graph_nodes node
      JOIN ose_graph_node_sources source ON source.graph_node_id = node.id
      JOIN ose_source_concepts concept ON concept.id = source.source_concept_id
      WHERE source.source_name = ?
        AND concept.source_name = ?
        AND concept.locale_code = 'en'
        AND concept.external_id IS NOT NULL
        AND node.bucket = 'occupation'
        AND node.node_level = 'occupation'
        AND node.status = 'active'
        AND node.is_searchable = 1
    `, [sourceName, sourceName]);
    const targets = new Map();
    for (const row of rows) {
        targets.set(String(row.esco_code), {
            graphNodeId: Number(row.graph_node_id),
            canonicalLabel: String(row.canonical_label),
            normalizedLabel: String(row.normalized_label ?? normalizeSearchText(String(row.canonical_label))),
            escoCode: String(row.esco_code),
            escoTitle: row.esco_title ? String(row.esco_title) : null
        });
    }
    return targets;
}
async function loadExistingAliases(connection) {
    const [rows] = await connection.execute(`
      SELECT alias.normalized_alias, meta.graph_node_id, node.canonical_label, 'search_meta' AS alias_source
      FROM ose_search_meta_aliases alias
      JOIN ose_search_meta meta ON meta.id = alias.search_meta_id
      JOIN ose_graph_nodes node ON node.id = meta.graph_node_id
      WHERE alias.locale_code = 'en'
      UNION ALL
      SELECT alias.normalized_alias, alias.graph_node_id, node.canonical_label, 'graph_alias' AS alias_source
      FROM ose_graph_aliases alias
      JOIN ose_graph_nodes node ON node.id = alias.graph_node_id
      WHERE alias.locale_code = 'en'
        AND alias.is_active = 1
    `);
    const aliases = new Map();
    for (const row of rows) {
        const normalizedAlias = String(row.normalized_alias);
        const targets = aliases.get(normalizedAlias) ?? [];
        const graphNodeId = Number(row.graph_node_id);
        const source = String(row.alias_source);
        if (!targets.some((target) => target.graphNodeId === graphNodeId && target.source === source)) {
            targets.push({
                graphNodeId,
                canonicalLabel: String(row.canonical_label),
                source
            });
        }
        aliases.set(normalizedAlias, targets);
    }
    return aliases;
}
function buildCandidate(rawAlias, target, targetCount, mappedRows, existingAliasesByNormalizedAlias) {
    const normalizedAlias = normalizeSearchText(rawAlias.alias);
    const foldedAlias = foldSearchText(rawAlias.alias);
    const aliasTokens = tokenizeNormalizedText(foldedAlias);
    const targetOverlapScore = target ? calculateOverlapScore(aliasTokens, tokenizeNormalizedText(foldSearchText(target.canonicalLabel))) : 0;
    const existingTargets = existingAliasesByNormalizedAlias.get(normalizedAlias) ?? [];
    const conflictTargets = target ? existingTargets.filter((existing) => existing.graphNodeId !== target.graphNodeId) : existingTargets;
    const matchingExistingTarget = target ? existingTargets.some((existing) => existing.graphNodeId === target.graphNodeId) : false;
    const reviewReasons = [];
    const excludeReasons = [];
    const onetTitle = rawAlias.onetTitle ?? mappedRows.find((row) => row.onetCode === rawAlias.onetCode)?.onetTitle ?? null;
    const escoCode = target?.escoCode ?? mappedRows[0]?.escoCode ?? null;
    const escoTitle = target?.escoTitle ?? mappedRows[0]?.escoTitle ?? null;
    const crosswalkTargetCount = targetCount ?? 0;
    if (!target) {
        excludeReasons.push('no_matching_esco_graph_node');
    }
    if (BROAD_ONET_TITLE_PATTERN.test(onetTitle ?? '') || BROAD_ONET_TITLE_PATTERN.test(rawAlias.alias)) {
        excludeReasons.push('broad_onet_all_other');
    }
    if (normalizedAlias.length < 4 || UNSAFE_ALIAS_PATTERN.test(normalizedAlias)) {
        excludeReasons.push('unsafe_or_too_short_alias');
    }
    if (isGenericOneWordAlias(aliasTokens)) {
        excludeReasons.push('generic_one_word_alias');
    }
    if (target && normalizedAlias === normalizeSearchText(target.canonicalLabel)) {
        excludeReasons.push('already_canonical_label');
    }
    if (conflictTargets.length > 0) {
        reviewReasons.push('existing_alias_conflict');
    }
    if (crosswalkTargetCount > 1) {
        reviewReasons.push('onet_code_maps_to_multiple_esco_targets');
    }
    if (target && targetOverlapScore === 0 && rawAlias.sourceFileRole === 'reported_title') {
        reviewReasons.push('reported_title_without_target_token_overlap');
    }
    if (matchingExistingTarget) {
        excludeReasons.push('already_existing_alias_for_target');
    }
    const candidateMode = excludeReasons.length > 0 ? 'exclude' : reviewReasons.length > 0 ? 'review' : 'generate';
    const confidence = calculateCandidateConfidence(candidateMode, targetOverlapScore, crosswalkTargetCount, rawAlias.sourceFileRole);
    return {
        candidateMode,
        reviewReason: [...excludeReasons, ...reviewReasons].join(', ') || null,
        alias: rawAlias.alias,
        normalizedAlias,
        localeCode: 'en',
        graphNodeId: target?.graphNodeId ?? null,
        canonicalLabel: target?.canonicalLabel ?? null,
        confidence,
        sourceTag: ONET_ALIAS_SOURCE_TAG,
        onetCode: rawAlias.onetCode,
        onetTitle,
        escoCode,
        escoTitle,
        sourceFileRole: rawAlias.sourceFileRole,
        crosswalkTargetCount,
        targetOverlapScore,
        conflictTargets
    };
}
function readFirstWorksheet(filePath) {
    const sharedStrings = readSharedStrings(filePath);
    const workbookXml = execFileSync('unzip', ['-p', filePath, 'xl/workbook.xml'], { encoding: 'utf8' });
    const relsXml = execFileSync('unzip', ['-p', filePath, 'xl/_rels/workbook.xml.rels'], { encoding: 'utf8' });
    const sheetMatch = workbookXml.match(/<sheet\b[^>]*r:id="([^"]+)"/u);
    if (!sheetMatch) {
        throw new Error(`Unable to find first worksheet in ${filePath}`);
    }
    const relId = sheetMatch[1];
    const relPattern = new RegExp(`<Relationship\\b[^>]*Id="${escapeRegExp(relId)}"[^>]*Target="([^"]+)"`, 'u');
    const relMatch = relsXml.match(relPattern);
    const targetPath = relMatch?.[1];
    if (!targetPath) {
        throw new Error(`Unable to resolve worksheet relationship ${relId} in ${filePath}`);
    }
    const worksheetPath = `xl/${targetPath.replace(/^\/?xl\//u, '')}`;
    const worksheetXml = execFileSync('unzip', ['-p', filePath, worksheetPath], { encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 });
    const rows = parseWorksheetXml(worksheetXml, sharedStrings);
    return {
        headers: rows[0] ?? [],
        rows: rows.slice(1)
    };
}
function readSharedStrings(filePath) {
    try {
        const xml = execFileSync('unzip', ['-p', filePath, 'xl/sharedStrings.xml'], { encoding: 'utf8', maxBuffer: 80 * 1024 * 1024 });
        return Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gu)).map((match) => {
            const fragments = Array.from(match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gu)).map((fragment) => decodeXml(fragment[1]));
            return fragments.join('');
        });
    }
    catch {
        return [];
    }
}
function parseWorksheetXml(xml, sharedStrings) {
    return Array.from(xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/gu)).map((rowMatch) => {
        const cells = new Map();
        for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gu)) {
            const attrs = cellMatch[1];
            const body = cellMatch[2];
            const refMatch = attrs.match(/\br="([A-Z]+)\d+"/u);
            const typeMatch = attrs.match(/\bt="([^"]+)"/u);
            const valueMatch = body.match(/<v>([\s\S]*?)<\/v>/u);
            const inlineMatch = body.match(/<is\b[^>]*>[\s\S]*?<t\b[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/u);
            const columnIndex = refMatch ? columnNameToIndex(refMatch[1]) : cells.size;
            const rawValue = valueMatch?.[1] ?? inlineMatch?.[1] ?? '';
            const value = typeMatch?.[1] === 's' ? (sharedStrings[Number.parseInt(rawValue, 10)] ?? '') : decodeXml(rawValue);
            cells.set(columnIndex, value.trim());
        }
        const width = cells.size === 0 ? 0 : Math.max(...cells.keys()) + 1;
        return Array.from({ length: width }, (_, index) => cells.get(index) ?? '');
    });
}
function parseCrosswalkRows(sheet) {
    const headeredRows = findHeaderedRows(sheet, ['ESCO/ISCO Code', 'O*NET-SOC 2019 Code']);
    sheet = headeredRows;
    const escoCodeIndex = findHeaderIndex(sheet.headers, ['ESCO/ISCO Code', 'ESCO Code']);
    const escoTitleIndex = findHeaderIndex(sheet.headers, ['ESCO/ISCO Title', 'ESCO Title']);
    const onetCodeIndex = findHeaderIndex(sheet.headers, ['O*NET-SOC 2019 Code', 'O*NET-SOC Code']);
    const onetTitleIndex = findHeaderIndex(sheet.headers, ['O*NET-SOC 2019 Title', 'O*NET-SOC Title']);
    return sheet.rows
        .map((row) => ({
        escoCode: readCell(row, escoCodeIndex),
        escoTitle: readNullableCell(row, escoTitleIndex),
        onetCode: readCell(row, onetCodeIndex),
        onetTitle: readNullableCell(row, onetTitleIndex)
    }))
        .filter((row) => row.escoCode && row.onetCode);
}
function parseJobTitleRows(sheet) {
    const headeredRows = findHeaderedRows(sheet, ['O*NET-SOC Code', 'Job Title']);
    sheet = headeredRows;
    const onetCodeIndex = findHeaderIndex(sheet.headers, ['O*NET-SOC Code']);
    const titleIndex = findHeaderIndex(sheet.headers, ['Title']);
    const jobTitleIndex = findHeaderIndex(sheet.headers, ['Job Title']);
    const shortTitleIndex = findHeaderIndex(sheet.headers, ['Short Title']);
    const rows = [];
    for (const row of sheet.rows) {
        const onetCode = readCell(row, onetCodeIndex);
        const onetTitle = readNullableCell(row, titleIndex);
        const jobTitle = readCell(row, jobTitleIndex);
        const shortTitle = readCell(row, shortTitleIndex);
        if (onetCode && jobTitle) {
            rows.push({ onetCode, onetTitle, alias: jobTitle, sourceFileRole: 'job_title' });
        }
        if (onetCode && shortTitle) {
            rows.push({ onetCode, onetTitle, alias: shortTitle, sourceFileRole: 'job_title_short' });
        }
    }
    return rows;
}
function parseReportedTitleRows(sheet) {
    const headeredRows = findHeaderedRows(sheet, ['O*NET-SOC Code', 'Reported Job Title']);
    sheet = headeredRows;
    const onetCodeIndex = findHeaderIndex(sheet.headers, ['O*NET-SOC Code']);
    const titleIndex = findHeaderIndex(sheet.headers, ['Title']);
    const reportedTitleIndex = findHeaderIndex(sheet.headers, ['Reported Job Title']);
    return sheet.rows
        .map((row) => ({
        onetCode: readCell(row, onetCodeIndex),
        onetTitle: readNullableCell(row, titleIndex),
        alias: readCell(row, reportedTitleIndex),
        sourceFileRole: 'reported_title'
    }))
        .filter((row) => row.onetCode && row.alias);
}
async function writeBuildArtifact(connection, sourceName, result) {
    await connection.execute(`
      INSERT INTO ose_build_artifacts (
        artifact_key,
        artifact_scope,
        build_version,
        payload_json
      )
      VALUES (?, ?, ?, CAST(? AS JSON))
      ON DUPLICATE KEY UPDATE
        payload_json = VALUES(payload_json),
        created_at = CURRENT_TIMESTAMP
    `, [
        'onet_esco_alias_candidates',
        sourceName,
        'latest',
        JSON.stringify({
            sourceTag: result.sourceTag,
            sourceName: result.sourceName,
            downloadDir: result.downloadDir,
            reportPath: result.reportPath,
            summary: result.summary,
            samples: result.samples
        })
    ]);
}
function findHeaderIndex(headers, acceptedNames) {
    const normalizedHeaders = headers.map((header) => normalizeHeader(header));
    const accepted = acceptedNames.map((name) => normalizeHeader(name));
    const index = normalizedHeaders.findIndex((header) => accepted.includes(header));
    if (index === -1) {
        throw new Error(`Missing XLSX header. Expected one of: ${acceptedNames.join(', ')}. Found: ${headers.join(', ')}`);
    }
    return index;
}
function findHeaderedRows(sheet, requiredHeaders) {
    const candidateRows = [sheet.headers, ...sheet.rows];
    for (let rowIndex = 0; rowIndex < candidateRows.length; rowIndex += 1) {
        const normalizedHeaders = candidateRows[rowIndex].map((header) => normalizeHeader(header));
        const hasRequiredHeaders = requiredHeaders.every((requiredHeader) => normalizedHeaders.includes(normalizeHeader(requiredHeader)));
        if (hasRequiredHeaders) {
            return {
                headers: candidateRows[rowIndex],
                rows: candidateRows.slice(rowIndex + 1)
            };
        }
    }
    throw new Error(`Missing XLSX header row. Expected headers: ${requiredHeaders.join(', ')}`);
}
function normalizeHeader(value) {
    return value.trim().toLowerCase().replace(/\s+/gu, ' ');
}
function readCell(row, index) {
    return (row[index] ?? '').trim();
}
function readNullableCell(row, index) {
    const value = readCell(row, index);
    return value || null;
}
function uniqueTargets(targets) {
    const byId = new Map();
    for (const target of targets) {
        byId.set(target.graphNodeId, target);
    }
    return Array.from(byId.values());
}
function groupBy(items, keyForItem) {
    const groups = new Map();
    for (const item of items) {
        const key = keyForItem(item);
        const group = groups.get(key) ?? [];
        group.push(item);
        groups.set(key, group);
    }
    return groups;
}
function calculateOverlapScore(aliasTokens, targetTokens) {
    if (aliasTokens.length === 0 || targetTokens.length === 0) {
        return 0;
    }
    const targetTokenSet = new Set(targetTokens);
    const matched = aliasTokens.filter((token) => targetTokenSet.has(token)).length;
    return Number((matched / aliasTokens.length).toFixed(4));
}
function calculateCandidateConfidence(candidateMode, targetOverlapScore, crosswalkTargetCount, sourceFileRole) {
    if (candidateMode === 'exclude') {
        return 0.1;
    }
    const sourceWeight = sourceFileRole === 'job_title' ? 0.15 : sourceFileRole === 'job_title_short' ? 0.1 : 0.05;
    const ambiguityPenalty = Math.max(0, crosswalkTargetCount - 1) * 0.1;
    const modePenalty = candidateMode === 'review' ? 0.2 : 0;
    const confidence = 0.65 + sourceWeight + Math.min(targetOverlapScore, 0.2) - ambiguityPenalty - modePenalty;
    return Number(Math.max(0.2, Math.min(0.95, confidence)).toFixed(4));
}
function isGenericOneWordAlias(aliasTokens) {
    return aliasTokens.length === 1 && (GENERIC_ONE_WORD_ALIASES.has(aliasTokens[0]) || isGenericQueryToken(aliasTokens[0], 'en'));
}
function compareCandidates(left, right) {
    const modeOrder = { generate: 0, review: 1, exclude: 2 };
    return (modeOrder[left.candidateMode] - modeOrder[right.candidateMode] ||
        right.confidence - left.confidence ||
        left.alias.localeCompare(right.alias) ||
        (left.canonicalLabel ?? '').localeCompare(right.canonicalLabel ?? ''));
}
function columnNameToIndex(columnName) {
    return columnName.split('').reduce((index, char) => index * 26 + char.charCodeAt(0) - 64, 0) - 1;
}
function decodeXml(value) {
    return value
        .replace(/&lt;/gu, '<')
        .replace(/&gt;/gu, '>')
        .replace(/&quot;/gu, '"')
        .replace(/&apos;/gu, "'")
        .replace(/&amp;/gu, '&');
}
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
