import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildRoleHeadEquivalenceBinaryFiles, defaultOccupationRoleHeadEquivalentsArtifactPath, defaultOccupationRoleHeadEquivalentsReviewPath, parseRoleHeadEquivalenceArtifact } from '../runtime/occupation-role-head-equivalence-artifact.js';
import { foldSearchText } from '../utils/texts.js';
import { writeRuntimeReviewJson } from '../runtime/runtime-review-artifacts.js';
const DEFAULT_SEED_PATH = path.resolve('src/runtime/seeds/occupation-role-head-equivalents.json');
const DEFAULT_LEAF_TERMS_SEED_PATH = path.resolve('src/runtime/seeds/occupation-role-head-leaf-terms.json');
async function main() {
    const options = parseCliOptions(process.argv.slice(2));
    const seedArtifact = await loadSeedArtifact(options.seedPath);
    const leafTermsSeedArtifact = await loadSeedArtifact(options.leafTermsSeedPath);
    const artifact = buildRoleHeadEquivalenceArtifact(seedArtifact, leafTermsSeedArtifact);
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
    console.log(`seed=${path.resolve(options.seedPath)}`);
    console.log(`leaf_terms_seed=${path.resolve(options.leafTermsSeedPath)}`);
    if (reviewJsonPath) {
        console.log(`review_json=${reviewJsonPath}`);
    }
}
async function loadSeedArtifact(seedPath) {
    const seedContents = await readFile(seedPath, 'utf8');
    return parseRoleHeadEquivalenceArtifact(seedContents, seedPath);
}
function parseCliOptions(args) {
    const options = {
        seedPath: DEFAULT_SEED_PATH,
        leafTermsSeedPath: DEFAULT_LEAF_TERMS_SEED_PATH,
        outPath: defaultOccupationRoleHeadEquivalentsArtifactPath(),
        reviewJsonOutPath: defaultOccupationRoleHeadEquivalentsReviewPath()
    };
    for (const arg of args) {
        if (arg.startsWith('--seed=')) {
            options.seedPath = arg.slice('--seed='.length).trim();
            continue;
        }
        if (arg.startsWith('--leaf-terms-seed=')) {
            options.leafTermsSeedPath = arg.slice('--leaf-terms-seed='.length).trim();
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
        `[--seed=${DEFAULT_SEED_PATH}]`,
        `[--leaf-terms-seed=${DEFAULT_LEAF_TERMS_SEED_PATH}]`,
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
function buildRoleHeadEquivalenceArtifact(seedArtifact, leafTermsSeedArtifact) {
    const classes = [...seedArtifact.classes, ...leafTermsSeedArtifact.classes];
    return {
        description: [
            'Curated occupation role-head equivalence classes.',
            'Merged from the tracked synonym-class seed dictionary and the tracked per-leaf role-head seed dictionary.'
        ].join(' '),
        classes: mergeClasses(classes)
    };
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
function mergedClassTerms(merged, id) {
    let classTerms = merged.get(id);
    if (!classTerms) {
        classTerms = new Map();
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
