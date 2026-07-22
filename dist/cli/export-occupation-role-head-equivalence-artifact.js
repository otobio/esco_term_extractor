import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { defaultOccupationRoleHeadEquivalentsArtifactPath, parseRoleHeadEquivalenceArtifact } from '../query/occupation-role-head-equivalence.js';
import { foldSearchText, tokenizeNormalizedText } from '../query/query-preparation.js';
import { DEFAULT_ESCO_SOURCE_NAME } from '../retrieval/occupation-candidates.js';
import { loadOccupationSearchMetaArtifactRequired } from '../runtime/occupation-search-meta-artifact.js';
const DEFAULT_SEED_PATH = path.resolve('src/runtime/seeds/occupation-role-head-equivalents.json');
const GENERATED_ALIAS_ROLES = new Set([
    'locale_primary'
]);
const FUNCTION_TERMS_BY_LOCALE = {
    en: new Set(['a', 'an', 'and', 'as', 'at', 'for', 'in', 'of', 'on', 'or', 'the', 'to', 'with']),
    ro: new Set(['a', 'al', 'ale', 'cu', 'de', 'din', 'in', 'la', 'o', 'pe', 'pentru', 'si', 'în', 'și']),
    hu: new Set(['a', 'az', 'egy', 'es', 'és', 'meg', 'vagy']),
    et: new Set(['ja', 'ning', 'voi', 'või']),
    unknown: new Set()
};
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const searchMetaArtifact = await loadOccupationSearchMetaArtifactRequired(options.sourceName);
    const seedContents = await readFile(options.seedPath, 'utf8');
    const seedArtifact = parseRoleHeadEquivalenceArtifact(seedContents, options.seedPath);
    const artifact = buildRoleHeadEquivalenceArtifact(searchMetaArtifact.getAllRecordsWithDetails(), seedArtifact);
    const outPath = path.resolve(options.outPath);
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
    console.log(`Exported ${artifact.classes.length} occupation role-head equivalence classes to ${outPath}`);
    console.log(`source=${options.sourceName}`);
    console.log(`seed=${path.resolve(options.seedPath)}`);
}
function parseCliOptions(args) {
    const options = {
        sourceName: DEFAULT_ESCO_SOURCE_NAME,
        seedPath: DEFAULT_SEED_PATH,
        outPath: defaultOccupationRoleHeadEquivalentsArtifactPath()
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
        `[--out=${defaultOccupationRoleHeadEquivalentsArtifactPath()}]`
    ].join(' '));
}
main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Occupation role-head equivalence artifact export failed.');
    console.error(message);
    process.exitCode = 1;
});
function buildRoleHeadEquivalenceArtifact(records, seedArtifact) {
    const classes = [
        ...seedArtifact.classes,
        ...records.flatMap(buildRecordClasses)
    ];
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
    addHeadCandidates(termsByLocale, 'en', record.canonicalLabel, 'canonical');
    for (const alias of record.aliases) {
        if (!GENERATED_ALIAS_ROLES.has(alias.aliasRole)) {
            continue;
        }
        const locale = normalizeLocale(alias.localeCode);
        addHeadCandidates(termsByLocale, locale, alias.normalizedAlias || alias.alias, 'locale_alias');
    }
    const compactTermsByLocale = compactTermsByLocaleRecord(termsByLocale);
    const termCount = Object.values(compactTermsByLocale).reduce((count, terms) => count + terms.length, 0);
    if (termCount < 2) {
        return [];
    }
    return [{
            id: `esco_leaf_${record.graphNodeId}`,
            termsByLocale: compactTermsByLocale
        }];
}
function addHeadCandidates(termsByLocale, locale, phrase, sourceKind) {
    const tokens = tokenizeNormalizedText(foldSearchText(phrase))
        .filter((token) => token.length > 1 && !FUNCTION_TERMS_BY_LOCALE[locale].has(token));
    if (tokens.length === 0) {
        return;
    }
    const localeTerms = termsForLocale(termsByLocale, locale);
    localeTerms.add(tokens[tokens.length - 1]);
    if (sourceKind === 'locale_alias' && locale !== 'en' && tokens.length > 1) {
        localeTerms.add(tokens[0]);
    }
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
    return [...new Set(terms
            .map((term) => foldSearchText(term))
            .filter((term) => term.length > 0))].sort();
}
