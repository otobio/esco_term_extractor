import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';
import { buildOccupationIntentVocabularyInputs, buildOccupationIntentVocabularyRecords, classifyIntentVocabularyTerm, defaultOccupationIntentVocabularyOverridePath, loadOccupationIntentVocabularyOverridesIfPresent } from '../runtime/occupation-intent-vocabulary-artifact.js';
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const searchMeta = await loadOccupationSearchMetaArtifactRequired(options.sourceName);
    const overrides = await loadOccupationIntentVocabularyOverridesIfPresent(options.overridePaths);
    const records = buildOccupationIntentVocabularyRecords(searchMeta.getAllRecordsWithDetails(), overrides);
    const inputs = buildOccupationIntentVocabularyInputs(searchMeta.getAllRecordsWithDetails());
    const englishRecord = requiredLocaleRecord(records, 'en');
    const audits = options.locales.map((locale) => buildLocaleAudit(locale, requiredLocaleRecord(records, locale), inputs.statsByLocale.get(locale) ?? new Map(), englishRecord, options.sampleLimit));
    const output = options.format === 'json' ? JSON.stringify(audits, null, 2) : formatText(audits);
    if (options.outPath) {
        await writeFile(path.resolve(options.outPath), `${output}\n`, 'utf8');
    }
    else {
        console.log(output);
    }
}
function buildLocaleAudit(locale, record, stats, englishRecord, sampleLimit) {
    const rows = Array.from(stats.entries()).map(([term, termStats]) => termAuditRow(term, termStats, locale, record, englishRecord));
    return {
        locale,
        bucketCounts: {
            role_heads: record.roleHeadTerms.length,
            role_modifiers: record.roleModifierTerms.length,
            domain_modifiers: record.domainModifierTerms.length,
            credential_modifiers: record.credentialModifierTerms.length,
            ambiguous_modifiers: record.ambiguousModifierTerms.length,
            role_phrases: record.rolePhrases.length,
            domain_phrases: record.domainPhrases.length
        },
        domainCandidates: rows
            .filter((row) => row.currentBucket !== 'domainModifierTerms' &&
            (row.suggestedClass === 'domain_modifier' || row.englishBucket === 'domainModifierTerms'))
            .sort(compareAuditRows)
            .slice(0, sampleLimit),
        ambiguousCandidates: rows
            .filter((row) => row.currentBucket !== 'ambiguousModifierTerms' && row.suggestedClass === 'ambiguous_modifier')
            .sort(compareAuditRows)
            .slice(0, sampleLimit),
        englishCarryoverCandidates: rows
            .filter((row) => locale !== 'en' && row.englishBucket !== null && row.currentBucket !== row.englishBucket)
            .sort(compareAuditRows)
            .slice(0, sampleLimit)
    };
}
function termAuditRow(term, stats, locale, record, englishRecord) {
    const total = Math.max(1, stats.totalCount);
    const familyRatio = stats.familyCount / Math.max(1, stats.familyCount + stats.totalCount);
    return {
        term,
        currentBucket: bucketForTerm(record, term),
        suggestedClass: classifyIntentVocabularyTerm(term, stats, locale),
        englishBucket: bucketForTerm(englishRecord, term),
        totalCount: stats.totalCount,
        headCount: stats.headCount,
        prefixCount: stats.prefixCount,
        familyCount: stats.familyCount,
        capabilityCount: stats.capabilityCount,
        headRatio: stats.headCount / total,
        prefixRatio: stats.prefixCount / total,
        familyRatio
    };
}
function bucketForTerm(record, term) {
    if (record.roleHeadTerms.includes(term))
        return 'roleHeadTerms';
    if (record.roleModifierTerms.includes(term))
        return 'roleModifierTerms';
    if (record.domainModifierTerms.includes(term))
        return 'domainModifierTerms';
    if (record.credentialModifierTerms.includes(term))
        return 'credentialModifierTerms';
    if (record.ambiguousModifierTerms.includes(term))
        return 'ambiguousModifierTerms';
    if (record.rolePhrases.includes(term))
        return 'rolePhrases';
    if (record.domainPhrases.includes(term))
        return 'domainPhrases';
    return 'unclassified';
}
function compareAuditRows(left, right) {
    return (right.familyCount - left.familyCount ||
        right.prefixCount - left.prefixCount ||
        right.totalCount - left.totalCount ||
        left.term.localeCompare(right.term));
}
function requiredLocaleRecord(records, locale) {
    const record = records.find((entry) => entry.localeCode === locale);
    if (!record) {
        throw new Error(`Missing intent vocabulary locale record: ${locale}`);
    }
    return record;
}
function formatText(audits) {
    const lines = [];
    for (const audit of audits) {
        lines.push(`locale=${audit.locale}`);
        lines.push(`bucket_counts=${JSON.stringify(audit.bucketCounts)}`);
        lines.push(formatRows('domain_candidates', audit.domainCandidates));
        lines.push(formatRows('ambiguous_candidates', audit.ambiguousCandidates));
        lines.push(formatRows('english_carryover_candidates', audit.englishCarryoverCandidates));
        lines.push('');
    }
    return lines.join('\n').trim();
}
function formatRows(label, rows) {
    if (rows.length === 0) {
        return `${label}=none`;
    }
    return [
        `${label}=`,
        ...rows.map((row) => `  - ${row.term} current=${row.currentBucket} suggested=${row.suggestedClass} english=${row.englishBucket ?? 'none'} counts(total=${row.totalCount},head=${row.headCount},prefix=${row.prefixCount},family=${row.familyCount})`)
    ].join('\n');
}
function parseCliOptions(args) {
    const options = {
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        locales: ['en', 'ro'],
        format: 'text',
        outPath: null,
        overridePaths: ['en', 'ro', 'hu', 'et', 'unknown'].map((localeCode) => defaultOccupationIntentVocabularyOverridePath(localeCode)),
        sampleLimit: 100
    };
    for (const arg of args) {
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
            continue;
        }
        if (arg.startsWith('--locales=')) {
            options.locales = arg
                .slice('--locales='.length)
                .split(',')
                .map((value) => value.trim().toLowerCase())
                .filter(isSupportedLocale);
            continue;
        }
        if (arg.startsWith('--format=')) {
            options.format = parseFormat(arg.slice('--format='.length).trim());
            continue;
        }
        if (arg.startsWith('--out=')) {
            options.outPath = arg.slice('--out='.length).trim();
            continue;
        }
        if (arg.startsWith('--override=')) {
            options.overridePaths.push(arg.slice('--override='.length).trim());
            continue;
        }
        if (arg === '--no-overrides') {
            options.overridePaths = [];
            continue;
        }
        if (arg.startsWith('--sample-limit=')) {
            options.sampleLimit = parsePositiveInteger(arg.slice('--sample-limit='.length).trim(), 'sample-limit');
            continue;
        }
        if (arg === '--help') {
            printHelp();
            process.exit(0);
        }
        throw new Error(`Unknown argument: ${arg}`);
    }
    return options;
}
function parseFormat(value) {
    if (value === 'text' || value === 'json') {
        return value;
    }
    throw new Error(`Invalid format "${value}". Use text or json.`);
}
function parsePositiveInteger(value, name) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new Error(`Invalid ${name}: ${value}`);
    }
    return parsed;
}
function isSupportedLocale(value) {
    return value === 'en' || value === 'ro' || value === 'hu' || value === 'et' || value === 'unknown';
}
function printHelp() {
    console.log([
        'Usage: node dist/cli/audit-occupation-intent-vocabulary.js',
        `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
        '[--locales=en,ro]',
        '[--format=text|json]',
        '[--out=data/runtime-review/occupation-intent-vocabulary.audit.en-ro.json]',
        '[--sample-limit=100]',
        '[--override=data/runtime-review/occupation-intent-vocabulary.overrides.ro.json]',
        '[--no-overrides]'
    ].join(' '));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Occupation intent-vocabulary audit failed.');
    console.error(message);
    process.exitCode = 1;
});
