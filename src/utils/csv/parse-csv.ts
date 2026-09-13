import { parse } from 'csv-parse/sync';

export function parseCsvRecords(content: string): Array<Record<string, string | null>> {
  const rows = parse(normalizeCsvLineEndings(content), {
    bom: true,
    columns: true,
    delimiter: ',',
    relax_column_count: true,
    skip_empty_lines: true,
    trim: false
  }) as Array<Record<string, string>>;

  return rows.map((row) => {
    const normalizedEntries = Object.entries(row).map(([key, value]) => {
      const normalizedKey = key.trim();
      const normalizedValue = typeof value === 'string' ? value : '';
      return [normalizedKey, normalizedValue === '' ? null : normalizedValue] as const;
    });

    return Object.fromEntries(normalizedEntries);
  });
}

export function normalizeCsvLineEndings(content: string): string {
  return content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
