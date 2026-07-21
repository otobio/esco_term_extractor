import { parse } from 'csv-parse/sync';
export function parseCsvRecords(content) {
    const rows = parse(content, {
        bom: true,
        columns: true,
        delimiter: ',',
        relax_column_count: true,
        skip_empty_lines: true,
        trim: false
    });
    return rows.map((row) => {
        const normalizedEntries = Object.entries(row).map(([key, value]) => {
            const normalizedKey = key.trim();
            const normalizedValue = typeof value === 'string' ? value : '';
            return [normalizedKey, normalizedValue === '' ? null : normalizedValue];
        });
        return Object.fromEntries(normalizedEntries);
    });
}
