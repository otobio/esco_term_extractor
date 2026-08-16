import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildRoleHeadEquivalenceBinaryFiles, defaultOccupationRoleHeadEquivalentsArtifactPath, defaultOccupationRoleHeadEquivalentsReviewPath, parseRoleHeadEquivalenceArtifact } from '../runtime/occupation-role-head-equivalence-artifact.js';
import { foldSearchText, tokenizeNormalizedText } from '../utils/texts.js';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { writeRuntimeReviewJson } from '../runtime/runtime-review-artifacts.js';
import { loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';
const DEFAULT_SEED_PATH = path.resolve('src/runtime/seeds/occupation-role-head-equivalents.json');
const GENERATED_ALIAS_ROLES = new Set(['locale_primary']);
const FUNCTION_TERMS_BY_LOCALE = {
    en: new Set(['a', 'an', 'and', 'as', 'at', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']),
    ro: new Set(['a', 'al', 'ale', 'cu', 'de', 'din', 'in', 'la', 'o', 'pe', 'pentru', 'si', 'în', 'și']),
    hu: new Set(['a', 'az', 'egy', 'es', 'és', 'meg', 'vagy']),
    et: new Set(['ja', 'ning', 'voi', 'või']),
    unknown: new Set()
};
// English/Hungarian/Estonian occupation phrases put the head noun last (modifier-first, e.g.
// "industrial electrician"); Romanian occupation phrases put it first (noun-first, e.g.
// "electrician industrial" -- confirmed by sampling real ro locale_primary aliases against their
// en canonical labels). Only one token per phrase is ever a head candidate -- never both ends --
// so an unrelated modifier can't be bucketed into the same equivalence class as the real role head.
const HEAD_TOKEN_POSITION_BY_LOCALE = {
    en: 'last',
    ro: 'first',
    hu: 'last',
    et: 'last',
    unknown: 'last'
};
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const searchMetaArtifact = await loadOccupationSearchMetaArtifactRequired(options.sourceName);
    const seedContents = await readFile(options.seedPath, 'utf8');
    const seedArtifact = parseRoleHeadEquivalenceArtifact(seedContents, options.seedPath);
    const artifact = buildRoleHeadEquivalenceArtifact(searchMetaArtifact.getAllRecordsWithDetails(), seedArtifact);
    const manifestPath = path.resolve(options.outPath);
    const reviewJsonPath = options.reviewJsonOutPath ? path.resolve(options.reviewJsonOutPath) : null;
    const prefix = path.basename(manifestPath, '.manifest.json');
    const binary = buildRoleHeadEquivalenceBinaryFiles(artifact, prefix);
    const manifest = {
        schemaVersion: 1,
        generatedAt: new Date().toISOString(),
        description: artifact.description,
        classCount: artifact.classes.length,
        stringCount: binary.stringCount,
        termCount: binary.termCount,
        classIdValueCount: binary.classIdValueCount,
        files: binary.manifestFiles
    };
    await mkdir(path.dirname(manifestPath), { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await Promise.all(Array.from(binary.buffers.entries()).map(([fileName, buffer]) => writeFile(path.resolve(path.dirname(manifestPath), fileName), buffer)));
    if (reviewJsonPath) {
        await writeRuntimeReviewJson(reviewJsonPath, artifact);
    }
    console.log(`Exported ${artifact.classes.length} occupation role-head equivalence classes to ${manifestPath}`);
    console.log(`source=${options.sourceName}`);
    console.log(`seed=${path.resolve(options.seedPath)}`);
    if (reviewJsonPath) {
        console.log(`review_json=${reviewJsonPath}`);
    }
}
function parseCliOptions(args) {
    const options = {
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        seedPath: DEFAULT_SEED_PATH,
        outPath: defaultOccupationRoleHeadEquivalentsArtifactPath(),
        reviewJsonOutPath: defaultOccupationRoleHeadEquivalentsReviewPath()
    };
    for (const arg of args) {
        if (arg.startsWith('--source-name=')) {
            options.sourceName = arg.slice('--source-name='.length).trim();
            continue;
        }
        if (arg.startsWith('--seed=')) {
            options.seedPath = arg.slice('--seed='.length).trim();
            continue;
        }
        if (arg.startsWith('--out=')) {
            options.outPath = arg.slice('--out='.length).trim();
            continue;
        }
        if (arg.startsWith('--review-json-out=')) {
            options.reviewJsonOutPath = arg.slice('--review-json-out='.length).trim();
            continue;
        }
        if (arg === '--no-review-json') {
            options.reviewJsonOutPath = null;
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
function printHelp() {
    console.log([
        'Usage: node dist/cli/export-occupation-role-head-equivalence-artifact.js',
        `[--source-name=${DEFAULT_ESCO_SOURCE_NAME}]`,
        `[--seed=${DEFAULT_SEED_PATH}]`,
        `[--out=${defaultOccupationRoleHeadEquivalentsArtifactPath()}]`,
        `[--review-json-out=${defaultOccupationRoleHeadEquivalentsReviewPath()}]`,
        '[--no-review-json]'
    ].join(' '));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Occupation role-head equivalence artifact export failed.');
    console.error(message);
    process.exitCode = 1;
});
function buildRoleHeadEquivalenceArtifact(records, seedArtifact) {
    const classes = [...seedArtifact.classes, ...records.flatMap(buildRecordClasses)];
    return {
        description: [
            'Generated occupation role-head equivalence classes.',
            'Classes are derived from ESCO search-meta leaf canonical labels and occupation aliases, then supplemented by the tracked seed dictionary.'
        ].join(' '),
        classes: mergeClasses(classes)
    };
}
function buildRecordClasses(record) {
    const termsByLocale = emptyTermsByLocale();
    addHeadCandidates(termsByLocale, 'en', record.canonicalLabel);
    for (const alias of record.aliases) {
        if (!GENERATED_ALIAS_ROLES.has(alias.aliasRole)) {
            continue;
        }
        const locale = normalizeLocale(alias.localeCode);
        addHeadCandidates(termsByLocale, locale, alias.normalizedAlias || alias.alias);
    }
    const compactTermsByLocale = compactTermsByLocaleRecord(termsByLocale);
    const termCount = Object.values(compactTermsByLocale).reduce((count, terms) => count + terms.length, 0);
    if (termCount < 2) {
        return [];
    }
    return [
        {
            id: `esco_leaf_${record.graphNodeId}`,
            termsByLocale: compactTermsByLocale
        }
    ];
}
function addHeadCandidates(termsByLocale, locale, phrase) {
    const tokens = tokenizeNormalizedText(foldSearchText(phrase)).filter((token) => token.length > 1 && !FUNCTION_TERMS_BY_LOCALE[locale].has(token));
    if (tokens.length === 0) {
        return;
    }
    const position = HEAD_TOKEN_POSITION_BY_LOCALE[locale] ?? 'last';
    const headToken = position === 'first' ? tokens[0] : tokens[tokens.length - 1];
    termsForLocale(termsByLocale, locale).add(headToken);
}
function mergeClasses(classes) {
    const merged = new Map();
    for (const equivalenceClass of classes) {
        const classTerms = mergedClassTerms(merged, equivalenceClass.id);
        for (const [locale, terms] of Object.entries(equivalenceClass.termsByLocale)) {
            const normalizedLocale = normalizeLocale(locale);
            const localeTerms = termsForLocale(classTerms, normalizedLocale);
            for (const term of terms) {
                const folded = foldSearchText(term);
                if (folded) {
                    localeTerms.add(folded);
                }
            }
        }
    }
    return [...merged.entries()]
        .map(([id, termsByLocale]) => ({ id, termsByLocale: compactTermsByLocaleRecord(termsByLocale) }))
        .filter((record) => uniqueFoldedTerms(Object.values(record.termsByLocale).flat()).length >= 2)
        .sort((left, right) => left.id.localeCompare(right.id));
}
function emptyTermsByLocale() {
    return new Map();
}
function mergedClassTerms(merged, id) {
    let classTerms = merged.get(id);
    if (!classTerms) {
        classTerms = emptyTermsByLocale();
        merged.set(id, classTerms);
    }
    return classTerms;
}
function termsForLocale(termsByLocale, locale) {
    let terms = termsByLocale.get(locale);
    if (!terms) {
        terms = new Set();
        termsByLocale.set(locale, terms);
    }
    return terms;
}
function compactTermsByLocaleRecord(termsByLocale) {
    const record = {};
    for (const [locale, terms] of termsByLocale) {
        if (terms.size > 0) {
            record[locale] = [...terms].sort();
        }
    }
    return record;
}
function normalizeLocale(locale) {
    if (locale === 'en' || locale === 'ro' || locale === 'hu' || locale === 'et') {
        return locale;
    }
    return 'unknown';
}
function uniqueFoldedTerms(terms) {
    return [...new Set(terms.map((term) => foldSearchText(term)).filter((term) => term.length > 0))].sort();
}
