/**
 * location-store.ts — single-file importer + enrichment + storage manager for the
 * Jobs-focused location dataset that backs the runtime gazetteer.
 *
 * Flow:  GeoNames per-country dumps ──importer──▶ raw rows
 *                                   ──enrich()──▶ pruned, enriched LocationRecord[]
 *                                   ──sink─────▶ MySQL `location_search_engine`
 *                                                (place / place_surface / build_run)
 *                                                + optional JSONL export (runtime intermediate)
 *
 * The MySQL DB is the curated pre-runtime store; the runtime bundle is generated
 * from it in a later step. The resolver engine is untouched.
 *
 * Jobs-specific enrichment (no POI / streets / physical features):
 *   · country → admin → settlement hierarchy, depth computed from parent chain
 *   · PRUNE settlements below a population floor, but always keep every admin
 *     container, the country capital and first-order (ADM1) seats
 *   · multilingual match surfaces: native + GeoNames alternate names (Latin-script
 *     only) + admin type-word variants ("Adamawa State", "judetul Cluj")
 *   · population + capital/seat flags + derived prominence
 *   · per-(name, country) DOMINANCE marker for the same-name tiebreak
 *   · stop-word flag for names colliding with common words (seed list; replace with
 *     a frequency-derived list later)
 *
 * Population-floor pruning and unknown population: a GeoNames population of 0 (or
 * missing) means "never recorded", not "verified empty" — every candidate row is
 * fclass P, an inhabited place. A LOWER-tier admin seat (county/commune/district;
 * GeoNames fcode PPLA2+, tracked as is_lower_seat/isLowerSeat) is exempted from
 * the population floor ONLY when its own population is unknown; one with a real,
 * known-low population is still pruned exactly as before. isLowerSeat is
 * deliberately its own flag, separate from is_seat/isAdminSeat (first-order/PPLA
 * only): isAdminSeat feeds isMajor at pack time, which the resolver trusts as a
 * bare mention needing no county corroboration (resolver.ts `accept()`).
 * Broadening isAdminSeat itself to lower tiers would flood that resolve-time
 * trust with every commune seat and reintroduce the village-name false-positive
 * problem the admin-gating exists to prevent — isLowerSeat is consumed ONLY by
 * enrich()'s pruning step below, never by isAdminSeat/isMajor.
 *
 * CLI:
 *   tsx src/gazetteer/location-store.ts build   --geonames-dir <dir> [--database location_search_engine] [--min-pop 3000] [--file data/location]
 *   tsx src/gazetteer/location-store.ts stats    [--database location_search_engine]
 *   tsx src/gazetteer/location-store.ts validate  --file data/location
 *
 * MySQL (env, local defaults): MYSQL_HOST=localhost MYSQL_PORT=3306 MYSQL_USER=root
 *   MYSQL_PASSWORD=root MYSQL_DATABASE=location_search_engine . Requires `mysql2`.
 * GeoNames dumps: per-country `<ISO>.txt` from download.geonames.org/export/dump/.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { normalizeText } from './normalize.js';
export const DATASET_SCHEMA_VERSION = 1;
const CONTAINER_KINDS = new Set(['country', 'admin1', 'admin2', 'admin3']);
// ───────────────────────────────────────────────────────────────── coercions
const asStr = (v) => (v == null ? '' : String(v)).trim();
const asNum = (v) => {
    if (v == null || v === '')
        return null;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[, ]/g, ''));
    return Number.isFinite(n) ? n : null;
};
const asBool = (v) => v === true || v === 1 || v === '1' || String(v).toLowerCase() === 'true';
const asList = (v) => {
    const s = asStr(v);
    if (!s)
        return [];
    if (s.startsWith('[')) {
        try {
            const a = JSON.parse(s);
            if (Array.isArray(a))
                return a.map(asStr).filter(Boolean);
        }
        catch {
            /* fall through */
        }
    }
    return s
        .split(/[;|,]/)
        .map((x) => x.trim())
        .filter(Boolean);
};
/** The starter set: Romania, Nigeria, Hungary, Estonia (GeoNames uses EE for Estonia). */
export const DEFAULT_GEONAMES = [
    { file: 'RO.txt', iso: 'RO', locale: 'ro', countryName: 'Romania' },
    { file: 'NG.txt', iso: 'NG', locale: 'ng', countryName: 'Nigeria' },
    { file: 'HU.txt', iso: 'HU', locale: 'hu', countryName: 'Hungary' },
    { file: 'EE.txt', iso: 'EE', locale: 'et', countryName: 'Estonia' },
];
/** Keep only names we can match against RO/EN/HU/ET job text: has a Latin letter and
 *  no Cyrillic / Greek / Arabic / CJK / Hangul. Drops the non-Latin GeoNames aliases. */
const isLatinName = (s) => /[a-zA-Z]/.test(s) && !/[Ͱ-ϿЀ-ӿ԰-ۿ　-鿿가-힯]/.test(s);
/**
 * Parse GeoNames per-country dumps into flat rows with a resolved `parent_id`.
 * Keeps admin containers (ADM1/ADM2) and populated places (class P); synthesizes a
 * country node per file; drops everything else (ADM3+, mountains, rivers, …).
 * GeoNames columns (tab-sep): 0 id · 1 name · 2 ascii · 3 alternates · 4 lat · 5 lng
 *   · 6 fclass · 7 fcode · 8 cc · 10 admin1 · 11 admin2 · 14 population.
 */
export async function readGeonames(dir, files = DEFAULT_GEONAMES) {
    const out = [];
    for (const cf of files) {
        const text = await readFile(join(dir, cf.file), 'utf8');
        const countryId = `C_${cf.locale}`;
        out.push({
            id: countryId,
            name: cf.countryName,
            type: 'country',
            country_code: cf.locale,
            parent_id: '',
            population: '',
            is_capital: '0',
            is_seat: '0',
            is_lower_seat: '0',
            alternate_names: '',
            latitude: '',
            longitude: '',
            geonames_id: '',
        });
        // Containers = ADM1 only (clean, few, the corroboration tier jobs actually use).
        // ADM2 is dropped: it is inconsistent across countries (RO=communes with type
        // prefixes, NG=LGAs, HU=districts) and would pollute the trusted-bare set. The
        // job-relevant leaf layer is the populated places (class P), which have clean
        // names + population; their parent is resolved to the ADM1 by admin1_code.
        const adm1 = new Map(); // iso.a1 -> geonameid
        const kept = [];
        for (const line of text.split('\n')) {
            if (!line)
                continue;
            const c = line.split('\t');
            const fclass = c[6];
            const fcode = c[7];
            if (fclass === 'A' && fcode === 'ADM1') {
                kept.push(c);
                adm1.set(`${cf.iso}.${c[10]}`, c[0]);
            }
            else if (fclass === 'P')
                kept.push(c);
        }
        for (const c of kept) {
            const [gid, name, ascii, alt, lat, lng, fclass, fcode, , , a1] = c;
            const pop = c[14];
            let type;
            let parent;
            if (fclass === 'A') {
                type = 'admin1';
                parent = countryId;
            }
            else {
                type = 'settlement';
                parent = adm1.get(`${cf.iso}.${a1}`) ?? countryId;
            }
            const alts = [ascii, ...(alt ? alt.split(',') : [])].map((s) => s.trim()).filter((s) => s && isLatinName(s));
            out.push({
                id: gid,
                name,
                type,
                country_code: cf.locale,
                parent_id: parent,
                population: pop,
                is_capital: fcode === 'PPLC' ? '1' : '0',
                is_seat: fcode === 'PPLA' ? '1' : '0', // first-order admin seat (county/state capital)
                is_lower_seat: /^PPLA\d+$/.test(fcode) ? '1' : '0', // lower-order seat; see module doc
                alternate_names: JSON.stringify([...new Set(alts)].slice(0, 12)),
                geonames_ascii: ascii,
                latitude: lat,
                longitude: lng,
                geonames_id: gid,
            });
        }
    }
    return out;
}
/** European countries other than the four with full hierarchies (ro/hu/et/ng). */
export const DEFAULT_EUROPEAN_COUNTRIES = [
    { code: 'fr', name: 'France', aliases: ['Franta', 'Franța', 'Franciaorszag', 'Prantsusmaa'] },
    { code: 'de', name: 'Germany', aliases: ['Germania', 'Nemetorszag', 'Saksamaa'] },
    { code: 'it', name: 'Italy', aliases: ['Italia', 'Olaszorszag', 'Itaalia'] },
    { code: 'es', name: 'Spain', aliases: ['Spania', 'Spanyolorszag', 'Hispaania'] },
    { code: 'pt', name: 'Portugal', aliases: ['Portugalia', 'Portugal'] },
    { code: 'gb', name: 'United Kingdom', aliases: ['Marea Britanie', 'Anglia', 'Regatul Unit', 'Egyesult Kiralysag', 'Nagy-Britannia', 'Suurbritannia'] },
    { code: 'ie', name: 'Ireland', aliases: ['Irlanda', 'Irorszag', 'Iirimaa'] },
    { code: 'nl', name: 'Netherlands', aliases: ['Olanda', 'Hollandia', 'Holland'] },
    { code: 'be', name: 'Belgium', aliases: ['Belgia', 'Belgium'] },
    { code: 'lu', name: 'Luxembourg', aliases: ['Luxemburg'] },
    { code: 'ch', name: 'Switzerland', aliases: ['Elvetia', 'Elveția', 'Svajc', 'Sveits'] },
    { code: 'at', name: 'Austria', aliases: ['Austria', 'Ausztria'] },
    { code: 'se', name: 'Sweden', aliases: ['Suedia', 'Svedorszag', 'Rootsi'] },
    { code: 'no', name: 'Norway', aliases: ['Norvegia', 'Norra'] },
    { code: 'dk', name: 'Denmark', aliases: ['Danemarca', 'Dania', 'Taani'] },
    { code: 'fi', name: 'Finland', aliases: ['Finlanda', 'Finnorszag', 'Soome'] },
    { code: 'is', name: 'Iceland', aliases: ['Islanda', 'Izland', 'Island'] },
    { code: 'pl', name: 'Poland', aliases: ['Polonia', 'Lengyelorszag', 'Poola'] },
    { code: 'cz', name: 'Czechia', aliases: ['Cehia', 'Republica Ceha', 'Csehorszag', 'Tsehhi'] },
    { code: 'sk', name: 'Slovakia', aliases: ['Slovacia', 'Szlovakia', 'Slovakkia'] },
    { code: 'si', name: 'Slovenia', aliases: ['Slovenia', 'Szlovenia', 'Sloveenia'] },
    { code: 'hr', name: 'Croatia', aliases: ['Croatia', 'Croația', 'Horvatorszag', 'Horvaatia'] },
    { code: 'rs', name: 'Serbia', aliases: ['Serbia', 'Szerbia'] },
    { code: 'ba', name: 'Bosnia and Herzegovina', aliases: ['Bosnia si Hertegovina', 'Bosznia-Hercegovina', 'Bosnia ja Hertsegoviina'] },
    { code: 'mk', name: 'North Macedonia', aliases: ['Macedonia de Nord', 'Eszak-Macedonia', 'Pohja-Makedoonia'] },
    { code: 'me', name: 'Montenegro', aliases: ['Muntenegru', 'Montenegro'] },
    { code: 'al', name: 'Albania', aliases: ['Albania', 'Albaania'] },
    { code: 'bg', name: 'Bulgaria', aliases: ['Bulgaria', 'Bulgaaria'] },
    { code: 'gr', name: 'Greece', aliases: ['Grecia', 'Gorogorszag', 'Kreeka'] },
    { code: 'md', name: 'Moldova', aliases: ['Republica Moldova'] },
    { code: 'ua', name: 'Ukraine', aliases: ['Ucraina', 'Ukrajna', 'Ukraina'] },
    { code: 'by', name: 'Belarus', aliases: ['Belarus', 'Bielorusia', 'Feheroroszag', 'Valgevene'] },
    { code: 'ru', name: 'Russia', aliases: ['Rusia', 'Oroszorszag', 'Venemaa'] },
    { code: 'lt', name: 'Lithuania', aliases: ['Lituania', 'Litvania', 'Leedu'] },
    { code: 'lv', name: 'Latvia', aliases: ['Letonia', 'Lettorszag', 'Lati'] },
    { code: 'tr', name: 'Turkey', aliases: ['Turcia', 'Torokorszag', 'Turgi'] },
    { code: 'cy', name: 'Cyprus', aliases: ['Cipru', 'Ciprus', 'Kupros'] },
    { code: 'mt', name: 'Malta' },
];
/** Synthetic, childless RawRows for `countries` — same shape as the country row
 *  readGeonames() synthesizes per file, but with no admin/settlement children. */
export function europeanCountryRows(countries = DEFAULT_EUROPEAN_COUNTRIES) {
    return countries.map((c) => ({
        id: `C_${c.code}`,
        name: c.name,
        type: 'country',
        country_code: c.code,
        parent_id: '',
        population: '',
        is_capital: '0',
        is_seat: '0',
        is_lower_seat: '0',
        alternate_names: JSON.stringify([...new Set(c.aliases ?? [])]),
        latitude: '',
        longitude: '',
        geonames_id: '',
    }));
}
/**
 * Which alternate-name languages to keep PER COUNTRY: the local language + English
 * + relevant cross-border languages (Hungarian & German for Romania's Transylvanian
 * / Saxon names). This is what turns the untagged-and-capped alternates into clean
 * exonyms — keeps Kolozsvár/Temesvár, drops the "logos"→Lagos junk.
 */
export const ALT_LANGS_BY_COUNTRY = {
    ro: new Set(['ro', 'en', 'hu', 'de']),
    ng: new Set(['en']),
    hu: new Set(['hu', 'en']),
    et: new Set(['et', 'en']),
};
/**
 * Stream the GeoNames alternateNamesV2 dump and collect, per geonameid present in
 * `rows`, the alternate names whose `isolanguage` is allowed for that place's country.
 * Columns: 0 altId · 1 geonameid · 2 isolanguage · 3 name · … . Memory-safe (readline),
 * gated by the geonameid set so it stays fast despite the 19M-row file.
 */
export async function loadAlternateNames(v2path, rows, allowed = ALT_LANGS_BY_COUNTRY, perGidCap = 20) {
    const gidCountry = new Map();
    for (const r of rows) {
        const g = asStr(r.geonames_id);
        if (g)
            gidCountry.set(g, asStr(r.country_code));
    }
    const out = new Map();
    const rl = createInterface({ input: createReadStream(v2path, 'utf8'), crlfDelay: Infinity });
    for await (const line of rl) {
        if (!line)
            continue;
        const t = line.split('\t');
        const cc = gidCountry.get(t[1]);
        if (!cc)
            continue;
        const langs = allowed[cc];
        if (!langs?.has(t[2]) || !t[3] || !isLatinName(t[3]))
            continue;
        let arr = out.get(t[1]);
        if (!arr)
            out.set(t[1], (arr = []));
        if (arr.length < perGidCap && !arr.includes(t[3]))
            arr.push(t[3]);
    }
    return out;
}
/** Replace each row's alternates with (ascii + language-filtered exonyms). Returns
 *  the number of places that got at least one tagged exonym. */
export function applyAlternateNames(rows, altMap) {
    let hit = 0;
    for (const r of rows) {
        const alts = altMap.get(asStr(r.geonames_id));
        if (!alts?.length)
            continue;
        r.alternate_names = JSON.stringify([...new Set([asStr(r.geonames_ascii), ...alts].filter(Boolean))]);
        hit++;
    }
    return hit;
}
export const DEFAULT_COLUMNS = {
    id: 'id',
    name: 'name',
    kind: 'type',
    countryCode: 'country_code',
    parentId: 'parent_id',
    population: 'population',
    isCapital: 'is_capital',
    isSeat: 'is_seat',
    isLowerSeat: 'is_lower_seat',
    alternateNames: 'alternate_names',
    lat: 'latitude',
    lng: 'longitude',
    geonamesId: 'geonames_id',
};
export const DEFAULT_KIND_MAP = {
    country: 'country',
    admin1: 'admin1',
    state: 'admin1',
    province: 'admin1',
    region: 'admin1',
    admin2: 'admin2',
    county: 'admin2',
    district: 'admin2',
    lga: 'admin2',
    admin3: 'admin3',
    settlement: 'settlement',
    city: 'settlement',
    town: 'settlement',
    village: 'settlement',
    locality: 'settlement',
};
/** Admin type-words appended as surfaces so natural phrasings corroborate. Both orders. */
export const ADMIN_TYPE_WORDS = {
    ng: { admin1: ['state'], admin2: ['lga'] },
    ro: { admin1: ['judet', 'judetul', 'jud'] },
    hu: { admin1: ['megye'] },
    et: { admin1: ['maakond'] },
};
const ENGLISH_TYPE_WORDS = {
    admin1: ['state', 'county', 'province', 'region'],
    admin2: ['county', 'district'],
};
/** Drop a leading/trailing admin type-word token to expose the bare core name
 *  ("Delta State"→"delta", "Csongrád megye"→"csongrad"). Returns a normalized core. */
function stripTypeWord(name, words) {
    const toks = normalizeText(name).split(' ').filter(Boolean);
    if (toks.length > 1 && words.has(toks[toks.length - 1]))
        toks.pop();
    else if (toks.length > 1 && words.has(toks[0]))
        toks.shift();
    return toks.join(' ');
}
/** Seed common-word collisions per locale (replace with a frequency-derived list). */
export const DEFAULT_COMMON_WORDS = {
    ng: new Set(['delta', 'plateau', 'niger']),
};
const slugify = (s) => normalizeText(s).replace(/\s+/g, '_') || 'x';
const usableSurface = (norm) => norm.length >= 3 && !/^\d+$/.test(norm);
/** Pure: raw rows → validated, pruned, enriched records + a report. */
export function enrich(raw, cfg = {}) {
    const col = { ...DEFAULT_COLUMNS, ...cfg.columns };
    const kindMap = cfg.kindMap ?? DEFAULT_KIND_MAP;
    const minPop = cfg.minPopulation ?? 3000;
    const ratio = cfg.dominanceRatio ?? 3;
    const typeWords = cfg.adminTypeWords ?? ADMIN_TYPE_WORDS;
    const commonWords = cfg.commonWords ?? DEFAULT_COMMON_WORDS;
    const items = raw
        .map((r) => ({
        sourceId: asStr(r[col.id]),
        parentSourceId: asStr(r[col.parentId]) || null,
        name: asStr(r[col.name]),
        kind: kindMap[normalizeText(asStr(r[col.kind]))] ?? 'settlement',
        countryCode: asStr(r[col.countryCode]).toLowerCase(),
        population: asNum(r[col.population]),
        isCapital: asBool(r[col.isCapital]),
        isSeat: asBool(r[col.isSeat]),
        isLowerSeat: asBool(r[col.isLowerSeat]),
        alts: asList(r[col.alternateNames]),
        lat: asNum(r[col.lat]),
        lng: asNum(r[col.lng]),
        geonamesId: asStr(r[col.geonamesId]) || null,
        depth: 0,
        key: '',
        parentKey: null,
    }))
        .filter((it) => it.sourceId && it.name);
    const bySource = new Map(items.map((it) => [it.sourceId, it]));
    // depth via parent walk (cycle-guarded)
    let orphans = 0;
    for (const it of items) {
        let d = 0;
        let cur = it;
        const seen = new Set();
        while (cur?.parentSourceId) {
            if (seen.has(cur.sourceId))
                break;
            seen.add(cur.sourceId);
            const p = bySource.get(cur.parentSourceId);
            if (!p) {
                orphans++;
                break;
            }
            d++;
            cur = p;
        }
        it.depth = d;
    }
    // prune: keep containers + capital + first-order seat unconditionally, plus a
    // lower-tier seat with unknown population (rescued); settlements by population.
    // See module doc for the rationale.
    const keep = new Set();
    let prunedSettlements = 0;
    let rescuedUnknownPopulationSeats = 0;
    for (const it of items) {
        const populationUnknown = it.population == null || it.population === 0;
        const rescued = it.isLowerSeat && populationUnknown;
        if (CONTAINER_KINDS.has(it.kind) || it.isCapital || it.isSeat || rescued || (it.population ?? 0) >= minPop) {
            keep.add(it.sourceId);
            if (rescued && !it.isSeat && !it.isCapital && !CONTAINER_KINDS.has(it.kind))
                rescuedUnknownPopulationSeats++;
        }
        else
            prunedSettlements++;
    }
    for (const id of [...keep]) {
        // re-add ancestors so no chain breaks
        let cur = bySource.get(id);
        while (cur?.parentSourceId) {
            const p = bySource.get(cur.parentSourceId);
            if (!p || keep.has(p.sourceId))
                break;
            keep.add(p.sourceId);
            cur = p;
        }
    }
    const kept = items.filter((it) => keep.has(it.sourceId));
    // canonical keys + parent wiring
    const used = new Map();
    for (const it of kept) {
        const parent = it.parentSourceId ? bySource.get(it.parentSourceId) : undefined;
        const base = CONTAINER_KINDS.has(it.kind) || !parent ? slugify(it.name) : `${slugify(it.name)}_${slugify(parent.name)}`;
        let key = `location:depth${it.depth}:${base}`;
        const n = used.get(key);
        if (n !== undefined) {
            used.set(key, n + 1);
            key = `${key}_${n + 1}`;
        }
        else
            used.set(key, 0);
        it.key = key;
    }
    for (const it of kept)
        it.parentKey = it.parentSourceId && keep.has(it.parentSourceId) ? bySource.get(it.parentSourceId).key : null;
    // dominance per (country, normalized name)
    const groups = new Map();
    for (const it of kept) {
        const g = `${it.countryCode}|${normalizeText(it.name)}`;
        (groups.get(g) ?? groups.set(g, []).get(g)).push(it);
    }
    const dominantOf = new Set();
    let dominantGroups = 0;
    let ambiguousGroups = 0;
    for (const g of groups.values()) {
        if (g.length === 1) {
            dominantOf.add(g[0].sourceId);
            continue;
        }
        const s = [...g].sort((a, b) => (b.population ?? 0) - (a.population ?? 0));
        const top = s[0].population ?? 0;
        const second = s[1].population ?? 0;
        if (top > 0 && top >= ratio * second) {
            dominantOf.add(s[0].sourceId);
            dominantGroups++;
        }
        else
            ambiguousGroups++;
    }
    // surfaces (typed) + stopword + final records
    let stopwords = 0;
    const records = kept
        .map((it) => {
        const seen = new Set();
        const surfaces = [];
        const add = (raw, kind) => {
            const n = normalizeText(raw);
            if (usableSurface(n) && !seen.has(n)) {
                seen.add(n);
                surfaces.push({ text: n, kind });
            }
        };
        const ctryWords = typeWords[it.countryCode]?.[it.kind] ?? [];
        const engWords = ENGLISH_TYPE_WORDS[it.kind] ?? [];
        const core = stripTypeWord(it.name, new Set([...ctryWords, ...engWords])); // "Delta State" -> "delta"
        const appendWords = ctryWords.length ? ctryWords : engWords;
        add(it.name, 'native');
        if (core && core !== normalizeText(it.name))
            add(core, 'alt'); // bare core, e.g. "delta"
        for (const a of it.alts)
            add(a, 'alt');
        for (const w of appendWords) {
            add(`${core} ${w}`, 'typeword');
            add(`${w} ${core}`, 'typeword');
        }
        // stopword judged on the CORE (so "Delta State" flags via "delta")
        const stopword = core.length > 0 && !core.includes(' ') && (commonWords[it.countryCode]?.has(core) ?? false);
        if (stopword)
            stopwords++;
        const prominence = (it.population ?? 0) + (it.isCapital ? 5_000_000 : 0) + (it.isSeat ? 500_000 : 0);
        return {
            key: it.key,
            sourceId: it.sourceId,
            parentKey: it.parentKey,
            name: it.name,
            kind: it.kind,
            depth: it.depth,
            countryCode: it.countryCode,
            population: it.population,
            isCapital: it.isCapital,
            isAdminSeat: it.isSeat,
            prominence,
            dominant: dominantOf.has(it.sourceId),
            surfaces,
            stopword,
            lat: it.lat,
            lng: it.lng,
            geonamesId: it.geonamesId,
        };
    })
        .filter((r) => r.surfaces.length > 0);
    return {
        records,
        report: {
            read: items.length,
            kept: records.length,
            prunedSettlements,
            orphans,
            stopwords,
            dominantGroups,
            ambiguousGroups,
            rescuedUnknownPopulationSeats,
        },
    };
}
// ───────────────────────────────────────────────────── file sink (runtime intermediate)
const JSONL_FILE = 'location-dataset.jsonl';
const META_FILE = 'location-dataset.meta.json';
function buildMeta(records, sources, thresholds, jsonl) {
    const byKind = {};
    for (const r of records)
        byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    return {
        schemaVersion: DATASET_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        sources,
        thresholds,
        counts: {
            total: records.length,
            byKind,
            surfaces: records.reduce((s, r) => s + r.surfaces.length, 0),
            stopwords: records.filter((r) => r.stopword).length,
            dominant: records.filter((r) => r.dominant).length,
        },
        checksum: createHash('sha256').update(jsonl).digest('hex'),
    };
}
export async function saveFile(dir, records, sources, thresholds) {
    await mkdir(dir, { recursive: true });
    const jsonl = `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;
    const meta = buildMeta(records, sources, thresholds, jsonl);
    await writeFile(join(dir, JSONL_FILE), jsonl);
    await writeFile(join(dir, META_FILE), JSON.stringify(meta, null, 2));
    return meta;
}
export async function loadFile(dir) {
    const [jsonl, metaRaw] = await Promise.all([
        readFile(join(dir, JSONL_FILE), 'utf8'),
        readFile(join(dir, META_FILE), 'utf8'),
    ]);
    const meta = JSON.parse(metaRaw);
    if (meta.schemaVersion !== DATASET_SCHEMA_VERSION)
        throw new Error(`dataset schema ${meta.schemaVersion} != ${DATASET_SCHEMA_VERSION}`);
    if (createHash('sha256').update(jsonl).digest('hex') !== meta.checksum)
        throw new Error('dataset checksum mismatch');
    return {
        records: jsonl
            .split('\n')
            .filter(Boolean)
            .map((l) => JSON.parse(l)),
        meta,
    };
}
export function validate(records) {
    const issues = [];
    const byKey = new Map();
    for (const r of records) {
        if (byKey.has(r.key))
            issues.push({ key: r.key, problem: 'duplicate key' });
        byKey.set(r.key, r);
    }
    for (const r of records) {
        if (!r.countryCode)
            issues.push({ key: r.key, problem: 'missing countryCode' });
        if (!r.surfaces.length)
            issues.push({ key: r.key, problem: 'no surfaces' });
        if (r.parentKey) {
            const p = byKey.get(r.parentKey);
            if (!p)
                issues.push({ key: r.key, problem: `parentKey ${r.parentKey} not found` });
            else if (p.depth !== r.depth - 1)
                issues.push({ key: r.key, problem: `depth ${r.depth} != parent.depth+1 (${p.depth})` });
        }
        else if (r.kind !== 'country')
            issues.push({ key: r.key, problem: 'non-country has no parent' });
    }
    return issues;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function connect(cfg) {
    const spec = 'mysql2/promise';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mysql = await import(spec).catch(() => {
        throw new Error('mysql2 not installed — run: npm i mysql2');
    });
    return mysql.createConnection({
        host: cfg.host ?? process.env.MYSQL_HOST ?? 'localhost',
        port: cfg.port ?? Number(process.env.MYSQL_PORT ?? 3306),
        user: cfg.user ?? process.env.MYSQL_USER ?? 'root',
        password: cfg.password ?? process.env.MYSQL_PASSWORD ?? 'root',
        database: cfg.database ?? process.env.MYSQL_DATABASE ?? 'location_search_engine',
        multipleStatements: true,
    });
}
const DDL = `
CREATE TABLE IF NOT EXISTS place (
  \`key\` VARCHAR(191) PRIMARY KEY,
  source_id VARCHAR(64), parent_key VARCHAR(191) NULL,
  name VARCHAR(255) NOT NULL, kind VARCHAR(16) NOT NULL, depth TINYINT NOT NULL,
  country_code VARCHAR(8) NOT NULL, population INT NULL,
  is_capital TINYINT(1) NOT NULL DEFAULT 0, is_admin_seat TINYINT(1) NOT NULL DEFAULT 0,
  prominence BIGINT NOT NULL DEFAULT 0, dominant TINYINT(1) NOT NULL DEFAULT 0, stopword TINYINT(1) NOT NULL DEFAULT 0,
  lat DOUBLE NULL, lng DOUBLE NULL, geonames_id VARCHAR(32) NULL,
  INDEX idx_country (country_code), INDEX idx_parent (parent_key), INDEX idx_kind (kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS place_surface (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  place_key VARCHAR(191) NOT NULL, surface VARCHAR(191) NOT NULL, surface_kind VARCHAR(16) NOT NULL,
  INDEX idx_surface (surface), INDEX idx_place (place_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS build_run (
  id BIGINT AUTO_INCREMENT PRIMARY KEY, created_at DATETIME NOT NULL,
  sources TEXT, thresholds TEXT, counts TEXT, checksum CHAR(64)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`;
/** Create the schema, replace all rows, and record a build_run. Full rebuild. */
export async function writeMysql(cfg, records, meta) {
    const conn = await connect(cfg);
    try {
        await conn.query(DDL);
        await conn.query('DELETE FROM place_surface');
        await conn.query('DELETE FROM place');
        const chunk = 1000;
        const placeRows = records.map((r) => [
            r.key,
            r.sourceId,
            r.parentKey,
            r.name,
            r.kind,
            r.depth,
            r.countryCode,
            r.population,
            r.isCapital ? 1 : 0,
            r.isAdminSeat ? 1 : 0,
            r.prominence,
            r.dominant ? 1 : 0,
            r.stopword ? 1 : 0,
            r.lat,
            r.lng,
            r.geonamesId,
        ]);
        for (let i = 0; i < placeRows.length; i += chunk) {
            await conn.query('INSERT INTO place (`key`,source_id,parent_key,name,kind,depth,country_code,population,is_capital,is_admin_seat,prominence,dominant,stopword,lat,lng,geonames_id) VALUES ?', [placeRows.slice(i, i + chunk)]);
        }
        const surfRows = records.flatMap((r) => r.surfaces.map((s) => [r.key, s.text, s.kind]));
        for (let i = 0; i < surfRows.length; i += chunk) {
            await conn.query('INSERT INTO place_surface (place_key,surface,surface_kind) VALUES ?', [
                surfRows.slice(i, i + chunk),
            ]);
        }
        await conn.query('INSERT INTO build_run (created_at,sources,thresholds,counts,checksum) VALUES (NOW(),?,?,?,?)', [
            meta.sources,
            JSON.stringify(meta.thresholds),
            JSON.stringify(meta.counts),
            meta.checksum,
        ]);
    }
    finally {
        await conn.end();
    }
}
export async function statsMysql(cfg) {
    const conn = await connect(cfg);
    try {
        const [[pc]] = await conn.query('SELECT COUNT(*) n FROM place');
        const [[sc]] = await conn.query('SELECT COUNT(*) n FROM place_surface');
        const [byKind] = await conn.query('SELECT kind, COUNT(*) n FROM place GROUP BY kind ORDER BY n DESC');
        const [byCountry] = await conn.query('SELECT country_code, COUNT(*) n, SUM(dominant) dom, SUM(stopword) stop FROM place GROUP BY country_code');
        const [[run]] = await conn.query('SELECT created_at, checksum FROM build_run ORDER BY id DESC LIMIT 1');
        console.log(`place ${pc.n} · place_surface ${sc.n}`);
        console.log(`by kind: ${byKind.map((r) => `${r.kind}=${r.n}`).join(' ')}`);
        console.log(`by country: ${byCountry.map((r) => `${r.country_code}(${r.n}, dom ${r.dom}, stop ${r.stop})`).join(' ')}`);
        if (run)
            console.log(`last build ${run.created_at} · checksum ${String(run.checksum).slice(0, 12)}…`);
    }
    finally {
        await conn.end();
    }
}
// ─────────────────────────────────────────────────────────────────────── CLI
async function main() {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            'geonames-dir': { type: 'string' },
            altnames: { type: 'string' }, // path to alternateNamesV2.txt (language-tagged exonyms)
            database: { type: 'string', default: 'location_search_engine' },
            file: { type: 'string' }, // optional JSONL export dir
            'min-pop': { type: 'string', default: '3000' },
            'dominance-ratio': { type: 'string', default: '3' },
        },
    });
    const cmd = positionals[0] ?? 'build';
    if (cmd === 'build') {
        const dir = values['geonames-dir'];
        if (!dir)
            throw new Error('build requires --geonames-dir <dir with RO.txt/NG.txt/HU.txt/EE.txt>');
        const thresholds = { minPopulation: Number(values['min-pop']), dominanceRatio: Number(values['dominance-ratio']) };
        console.log(`Importing GeoNames from ${dir} → enrich (Jobs profile) → MySQL ${values.database} …`);
        const raw = await readGeonames(dir);
        if (values.altnames) {
            const m = await loadAlternateNames(values.altnames, raw);
            const hit = applyAlternateNames(raw, m);
            console.log(`alt-names: language-filtered exonyms attached to ${hit} places (from ${values.altnames})`);
        }
        const { records, report } = enrich(raw, {
            minPopulation: thresholds.minPopulation,
            dominanceRatio: thresholds.dominanceRatio,
        });
        const issues = validate(records);
        const jsonl = `${records.map((r) => JSON.stringify(r)).join('\n')}\n`;
        const meta = buildMeta(records, `geonames:${DEFAULT_GEONAMES.map((g) => g.iso).join(',')}`, thresholds, jsonl);
        console.log(`read ${report.read} · kept ${report.kept} · pruned ${report.prunedSettlements} · orphans ${report.orphans} · rescued (unknown-population admin seats) ${report.rescuedUnknownPopulationSeats}`);
        console.log(`surfaces ${meta.counts.surfaces} · stopwords ${report.stopwords} · dominant groups ${report.dominantGroups} · still-ambiguous ${report.ambiguousGroups}`);
        console.log(`by kind: ${JSON.stringify(meta.counts.byKind)}`);
        console.log(issues.length
            ? `⚠ ${issues.length} validation issues (first 10): ${JSON.stringify(issues.slice(0, 10))}`
            : '✓ validation clean');
        await writeMysql({ database: values.database }, records, meta);
        console.log(`✓ wrote MySQL ${values.database} (place + place_surface + build_run)`);
        if (values.file) {
            await saveFile(values.file, records, meta.sources, thresholds);
            console.log(`✓ exported JSONL → ${values.file}/`);
        }
        return;
    }
    if (cmd === 'stats') {
        await statsMysql({ database: values.database });
        return;
    }
    if (cmd === 'validate') {
        if (!values.file)
            throw new Error('validate requires --file <dir>');
        const { records } = await loadFile(values.file);
        const issues = validate(records);
        console.log(issues.length
            ? `⚠ ${issues.length} issues:\n${JSON.stringify(issues.slice(0, 20), null, 2)}`
            : `✓ ${records.length} records valid`);
        return;
    }
    if (cmd === 'add-countries') {
        if (!values.file)
            throw new Error('add-countries requires --file <dir>');
        const { records: existing, meta } = await loadFile(values.file);
        const existingCountries = new Set(existing.map((r) => r.countryCode));
        const rows = europeanCountryRows().filter((r) => {
            const cc = asStr(r.country_code);
            const already = existingCountries.has(cc);
            if (already)
                console.log(`skip ${asStr(r.name)} (${cc}): countryCode already present`);
            return !already;
        });
        const { records: added, report } = enrich(rows);
        const existingKeys = new Set(existing.map((r) => r.key));
        const collide = added.filter((r) => existingKeys.has(r.key));
        if (collide.length)
            throw new Error(`key collision: ${collide.map((r) => r.key).join(', ')}`);
        const merged = [...existing, ...added];
        const newMeta = await saveFile(values.file, merged, `${meta.sources};european-countries`, meta.thresholds);
        console.log(`added ${added.length} country records (${report.stopwords} stopwords) → ${merged.length} total`);
        console.log(`by kind: ${JSON.stringify(newMeta.counts.byKind)}`);
        return;
    }
    console.error(`unknown command: ${cmd} (build | stats | validate | add-countries)`);
    process.exit(1);
}
const invokedDirectly = process.argv[1] != null && import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly)
    main().catch((e) => {
        console.error(e);
        process.exit(1);
    });
