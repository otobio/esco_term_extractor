import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { peelOccupationTitleNoise } from '../dist/query/occupation-noise-peeling.js';

const INPUTS = [
  {
    locale: 'ro',
    path: '/Users/otobio/Downloads/ejobs_job_titles.csv'
  },
  {
    locale: 'hu',
    path: '/Users/otobio/Downloads/profession_job_titles_01.csv'
  },
  {
    locale: 'hu',
    path: '/Users/otobio/Downloads/profession_job_titles_02.csv'
  }
];

const BOOTSTRAP_DIR = path.join(process.cwd(), 'data', 'taxonomy-review');
const SAMPLE_LIMIT = 100;

async function main() {
  for (const locale of ['ro', 'hu']) {
    const bootstrap = JSON.parse(readFileSync(path.join(BOOTSTRAP_DIR, `semantic-bootstrap.${locale}.json`), 'utf8'));
    const titles = loadTitles(locale).slice(0, SAMPLE_LIMIT);
    const rows = titles.map((title) => {
      const peeled = peelOccupationTitleNoise(title, locale);
      return evaluateTitle(peeled.peeledTitle || title, bootstrap, title);
    });

    const roleHitCount = rows.filter((row) => row.roleHits.length > 0).length;
    const domainHitCount = rows.filter((row) => row.domainHits.length > 0).length;
    const noiseHitCount = rows.filter((row) => row.noiseHits.length > 0).length;
    const cleanHitCount = rows.filter((row) => row.roleHits.length === 0 && row.domainHits.length === 0 && row.noiseHits.length === 0).length;

    console.log(
      [
        `locale=${locale}`,
        `sample=${rows.length}`,
        `role_hit=${roleHitCount}`,
        `domain_hit=${domainHitCount}`,
        `noise_hit=${noiseHitCount}`,
        `clean=${cleanHitCount}`,
        `head_rule=${bootstrap.headRule}`
      ].join('  ')
    );

    for (const row of rows.slice(0, 10)) {
      console.log(
        [
          `title=${row.title}`,
          `role=${row.roleHits.join('|') || '-'}`,
          `domain=${row.domainHits.join('|') || '-'}`,
          `noise=${row.noiseHits.join('|') || '-'}`
        ].join('  ')
      );
    }
  }
}

function loadTitles(locale) {
  const rows = [];
  for (const input of INPUTS.filter((entry) => entry.locale === locale)) {
    const sourceRows = parse(readFileSync(input.path, 'utf8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    for (const row of sourceRows) {
      const title = String(row.job_title ?? '').trim();
      if (title) {
        rows.push(title);
      }
    }
  }
  return sampleRows(rows, SAMPLE_LIMIT, locale);
}

function evaluateTitle(title, bootstrap, originalTitle) {
  const normalized = normalize(title);
  const roleHits = [];
  const domainHits = [];
  const noiseHits = [];

  for (const rule of bootstrap.tokenRules) {
    if (containsTerm(normalized, rule.token)) {
      if (rule.kind === 'role_head') {
        roleHits.push(rule.token);
      } else if (rule.kind === 'domain_modifier') {
        domainHits.push(rule.token);
      } else if (rule.kind === 'generic_noise') {
        noiseHits.push(rule.token);
      }
    }
  }

  for (const rule of bootstrap.phraseRules) {
    if (containsTerm(normalized, rule.phrase)) {
      if (rule.kind === 'role_phrase') {
        roleHits.push(rule.phrase);
      } else if (rule.kind === 'generic_phrase') {
        noiseHits.push(rule.phrase);
      }
    }
  }

  return { title, originalTitle, roleHits, domainHits, noiseHits };
}

function containsTerm(text, term) {
  const needle = normalize(term);
  if (!needle) {
    return false;
  }

  return ` ${text} `.includes(` ${needle} `);
}

function normalize(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function sampleRows(rows, limit, seed) {
  const items = Array.from(rows);
  if (items.length <= limit) {
    return items;
  }

  const random = mulberry32(hashSeed(seed));
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [items[index], items[swapIndex]] = [items[swapIndex], items[index]];
  }

  return items.slice(0, limit);
}

function hashSeed(value) {
  const text = String(value ?? '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

main().catch((error) => {
  console.error('Semantic bootstrap evaluation failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
