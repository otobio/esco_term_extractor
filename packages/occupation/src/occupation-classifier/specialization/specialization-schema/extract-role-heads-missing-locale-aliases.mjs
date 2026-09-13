#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const schemaDir = dirname(fileURLToPath(import.meta.url));

const roleHeadsPath = resolve(schemaDir, 'specialization-role-heads.csv');
const globalAliasesPath = resolve(schemaDir, 'specialization-role-head-aliases.csv');
const outputPath = resolve(schemaDir, 'role-heads-missing-ro-hu-aliases.csv');

const localeAliasFiles = [
  ['ro', resolve(schemaDir, 'specialization-role-head-aliases.ro.csv')],
  ['hu', resolve(schemaDir, 'specialization-role-head-aliases.hu.csv')],
];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...dataRows] = rows.filter((csvRow) => csvRow.some((value) => value.trim().length > 0));
  if (!header) {
    return [];
  }

  return dataRows.map((csvRow) =>
    Object.fromEntries(header.map((name, index) => [name, csvRow[index] ?? ''])),
  );
}

function formatCsvField(value) {
  if (value == null) {
    return '';
  }
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function formatCsv(rows, header) {
  return `${header.join(',')}\n${rows
    .map((row) => header.map((name) => formatCsvField(row[name])).join(','))
    .join('\n')}\n`;
}

function loadRows(path) {
  if (!existsSync(path)) {
    return [];
  }
  return parseCsv(readFileSync(path, 'utf8'));
}

function aliasMapFor(rows) {
  const map = new Map();
  for (const row of rows) {
    const roleHead = row.role_head?.trim();
    const alias = row.alias?.trim();
    if (!roleHead || !alias) {
      continue;
    }
    const aliases = map.get(roleHead) ?? [];
    aliases.push(alias);
    map.set(roleHead, aliases);
  }
  return map;
}

const roleHeads = loadRows(roleHeadsPath)
  .map((row) => row.role_head?.trim())
  .filter(Boolean);
const globalAliases = aliasMapFor(loadRows(globalAliasesPath));
const localeAliases = new Map(
  localeAliasFiles.map(([locale, path]) => [locale, { path, aliases: aliasMapFor(loadRows(path)) }]),
);

const rows = roleHeads
  .map((roleHead) => {
    const roAliases = localeAliases.get('ro').aliases.get(roleHead) ?? [];
    const huAliases = localeAliases.get('hu').aliases.get(roleHead) ?? [];

    return {
      role_head: roleHead,
      global_aliases: (globalAliases.get(roleHead) ?? []).join('; '),
      current_ro_aliases: roAliases.join('; '),
      current_hu_aliases: huAliases.join('; '),
      missing_locales: [
        roAliases.length === 0 ? 'ro' : '',
        huAliases.length === 0 ? 'hu' : '',
      ]
        .filter(Boolean)
        .join(';'),
      ro_aliases_to_add: '',
      hu_aliases_to_add: '',
      note: '',
    };
  })
  .filter((row) => row.missing_locales.length > 0);

const header = [
  'role_head',
  'global_aliases',
  'current_ro_aliases',
  'current_hu_aliases',
  'missing_locales',
  'ro_aliases_to_add',
  'hu_aliases_to_add',
  'note',
];

writeFileSync(outputPath, formatCsv(rows, header));

console.log(`Wrote ${rows.length} role heads to ${basename(outputPath)}.`);
for (const [locale, { path }] of localeAliases) {
  if (!existsSync(path)) {
    console.log(`No ${locale} alias file found at ${basename(path)}; all role heads are marked missing ${locale}.`);
  }
}
