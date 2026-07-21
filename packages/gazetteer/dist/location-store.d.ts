export declare const DATASET_SCHEMA_VERSION = 1;
export type LocationKind = 'country' | 'admin1' | 'admin2' | 'admin3' | 'settlement';
export type SurfaceKind = 'native' | 'alt' | 'typeword';
export interface Surface {
    text: string;
    kind: SurfaceKind;
}
/** One enriched place — the unit of the stored dataset. */
export interface LocationRecord {
    key: string;
    sourceId: string;
    parentKey: string | null;
    name: string;
    kind: LocationKind;
    depth: number;
    countryCode: string;
    population: number | null;
    isCapital: boolean;
    isAdminSeat: boolean;
    prominence: number;
    dominant: boolean;
    surfaces: Surface[];
    stopword: boolean;
    lat: number | null;
    lng: number | null;
    geonamesId: string | null;
}
export interface DatasetMeta {
    schemaVersion: number;
    generatedAt: string;
    sources: string;
    thresholds: {
        minPopulation: number;
        dominanceRatio: number;
    };
    counts: {
        total: number;
        byKind: Record<string, number>;
        surfaces: number;
        stopwords: number;
        dominant: number;
    };
    checksum: string;
}
export type RawRow = Record<string, unknown>;
/** One GeoNames per-country dump + how its ISO maps to our runtime locale code. */
export interface GeonamesCountryFile {
    file: string;
    iso: string;
    locale: string;
    countryName: string;
}
/** The starter set: Romania, Nigeria, Hungary, Estonia (GeoNames uses EE for Estonia). */
export declare const DEFAULT_GEONAMES: GeonamesCountryFile[];
/**
 * Parse GeoNames per-country dumps into flat rows with a resolved `parent_id`.
 * Keeps admin containers (ADM1/ADM2) and populated places (class P); synthesizes a
 * country node per file; drops everything else (ADM3+, mountains, rivers, …).
 * GeoNames columns (tab-sep): 0 id · 1 name · 2 ascii · 3 alternates · 4 lat · 5 lng
 *   · 6 fclass · 7 fcode · 8 cc · 10 admin1 · 11 admin2 · 14 population.
 */
export declare function readGeonames(dir: string, files?: GeonamesCountryFile[]): Promise<RawRow[]>;
/**
 * Which alternate-name languages to keep PER COUNTRY: the local language + English
 * + relevant cross-border languages (Hungarian & German for Romania's Transylvanian
 * / Saxon names). This is what turns the untagged-and-capped alternates into clean
 * exonyms — keeps Kolozsvár/Temesvár, drops the "logos"→Lagos junk.
 */
export declare const ALT_LANGS_BY_COUNTRY: Record<string, ReadonlySet<string>>;
/**
 * Stream the GeoNames alternateNamesV2 dump and collect, per geonameid present in
 * `rows`, the alternate names whose `isolanguage` is allowed for that place's country.
 * Columns: 0 altId · 1 geonameid · 2 isolanguage · 3 name · … . Memory-safe (readline),
 * gated by the geonameid set so it stays fast despite the 19M-row file.
 */
export declare function loadAlternateNames(v2path: string, rows: RawRow[], allowed?: Record<string, ReadonlySet<string>>, perGidCap?: number): Promise<Map<string, string[]>>;
/** Replace each row's alternates with (ascii + language-filtered exonyms). Returns
 *  the number of places that got at least one tagged exonym. */
export declare function applyAlternateNames(rows: RawRow[], altMap: Map<string, string[]>): number;
export interface ColumnMap {
    id: string;
    name: string;
    kind: string;
    countryCode: string;
    parentId: string;
    population: string;
    isCapital: string;
    isSeat: string;
    isLowerSeat: string;
    alternateNames: string;
    lat: string;
    lng: string;
    geonamesId: string;
}
export declare const DEFAULT_COLUMNS: ColumnMap;
export declare const DEFAULT_KIND_MAP: Record<string, LocationKind>;
/** Admin type-words appended as surfaces so natural phrasings corroborate. Both orders. */
export declare const ADMIN_TYPE_WORDS: Record<string, Partial<Record<LocationKind, string[]>>>;
/** Seed common-word collisions per locale (replace with a frequency-derived list). */
export declare const DEFAULT_COMMON_WORDS: Record<string, ReadonlySet<string>>;
export interface EnrichConfig {
    columns?: Partial<ColumnMap>;
    kindMap?: Record<string, LocationKind>;
    minPopulation?: number;
    dominanceRatio?: number;
    commonWords?: Record<string, ReadonlySet<string>>;
    adminTypeWords?: Record<string, Partial<Record<LocationKind, string[]>>>;
}
export interface EnrichReport {
    read: number;
    kept: number;
    prunedSettlements: number;
    orphans: number;
    stopwords: number;
    dominantGroups: number;
    ambiguousGroups: number;
    /** Lower-tier admin seats (county/commune/district) kept despite no reliable
     *  population figure — a data gap, not a verified-empty place. See enrich(). */
    rescuedUnknownPopulationSeats: number;
}
/** Pure: raw rows → validated, pruned, enriched records + a report. */
export declare function enrich(raw: RawRow[], cfg?: EnrichConfig): {
    records: LocationRecord[];
    report: EnrichReport;
};
export declare function saveFile(dir: string, records: LocationRecord[], sources: string, thresholds: DatasetMeta['thresholds']): Promise<DatasetMeta>;
export declare function loadFile(dir: string): Promise<{
    records: LocationRecord[];
    meta: DatasetMeta;
}>;
export interface Issue {
    key: string;
    problem: string;
}
export declare function validate(records: LocationRecord[]): Issue[];
export interface MysqlSink {
    host?: string;
    port?: number;
    user?: string;
    password?: string;
    database?: string;
}
/** Create the schema, replace all rows, and record a build_run. Full rebuild. */
export declare function writeMysql(cfg: MysqlSink, records: LocationRecord[], meta: DatasetMeta): Promise<void>;
export declare function statsMysql(cfg: MysqlSink): Promise<void>;
