import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { peelOccupationTitleNoise } from '../dist/query/occupation-noise-peeling.js';

const INPUT_PATH = '/Users/otobio/Downloads/ejobs_job_titles.csv';
const BOOTSTRAP_PATH = path.join(process.cwd(), 'data', 'taxonomy-review', 'semantic-bootstrap.ro.json');
const OUTPUT_DIR = path.join(process.cwd(), 'data', 'taxonomy-review');
const OUTPUT_ROWS_PATH = path.join(OUTPUT_DIR, 'semantic-bootstrap.ro.review.csv');
const OUTPUT_MISS_SUMMARY_PATH = path.join(OUTPUT_DIR, 'semantic-bootstrap.ro.miss-summary.csv');

const STOP_TOKENS = new Set([
  'de',
  'la',
  'si',
  'sau',
  'in',
  'din',
  'pe',
  'cu',
  'f',
  'm',
  'mf',
  'fm',
  'mfd',
  'x',
  'the',
  'and',
  'for',
  'to',
  'of',
  'in',
  'on',
  'at',
  'cu',
  'un',
  'o'
]);

const REVIEW_ROW_HEADERS = [
  'row_index',
  'title',
  'peeled_title',
  'normalized_title',
  'noise_removed',
  'token_count',
  'role_hits',
  'domain_hits',
  'noise_hits',
  'occupation_signal',
  'penalty_signal',
  'net_signal',
  'decision',
  'matched_rules'
];

const MISS_SUMMARY_HEADERS = ['kind', 'rank', 'term', 'count'];

async function main() {
  const bootstrap = JSON.parse(readFileSync(BOOTSTRAP_PATH, 'utf8'));
  const titles = loadTitles(INPUT_PATH);
  const rows = [];
  const stats = {
    total: 0,
    roleHit: 0,
    domainHit: 0,
    noiseHit: 0,
    clean: 0,
    help: 0,
    neutral: 0,
    hurt: 0
  };
  const missTokenCounts = new Map();
  const missPhraseCounts = new Map();
  const bootstrapTokenSet = new Set(bootstrap.tokenRules.map((rule) => normalize(rule.token)));
  const bootstrapPhraseSet = new Set(bootstrap.phraseRules.map((rule) => normalize(rule.phrase)));

  for (const [index, title] of titles.entries()) {
    const peeled = peelOccupationTitleNoise(title, 'ro');
    const evaluation = evaluateTitle(peeled.peeledTitle || title, bootstrap);
    rows.push(toReviewRow(index + 1, title, evaluation));

    stats.total += 1;
    if (evaluation.roleHits.length > 0) stats.roleHit += 1;
    if (evaluation.domainHits.length > 0) stats.domainHit += 1;
    if (evaluation.noiseHits.length > 0) stats.noiseHit += 1;
    if (evaluation.roleHits.length === 0 && evaluation.domainHits.length === 0 && evaluation.noiseHits.length === 0) stats.clean += 1;
    stats[evaluation.decision] += 1;

    if (evaluation.roleHits.length === 0 && evaluation.domainHits.length === 0 && evaluation.noiseHits.length === 0) {
      collectMissCandidates(title, missTokenCounts, missPhraseCounts, bootstrapTokenSet, bootstrapPhraseSet);
    }
  }

  writeFileSync(OUTPUT_ROWS_PATH, toCsv(rows, REVIEW_ROW_HEADERS), 'utf8');
  writeFileSync(OUTPUT_MISS_SUMMARY_PATH, toMissSummaryCsv(missTokenCounts, missPhraseCounts), 'utf8');

  console.log(
    [
      `titles=${stats.total}`,
      `role_hit=${stats.roleHit}`,
      `domain_hit=${stats.domainHit}`,
      `noise_hit=${stats.noiseHit}`,
      `clean=${stats.clean}`,
      `help=${stats.help}`,
      `neutral=${stats.neutral}`,
      `hurt=${stats.hurt}`,
      `rows_out=${OUTPUT_ROWS_PATH}`,
      `miss_summary_out=${OUTPUT_MISS_SUMMARY_PATH}`
    ].join('  ')
  );

  console.log('Top miss tokens:');
  for (const [rank, entry] of topEntries(missTokenCounts, 20).entries()) {
    console.log(`${rank + 1}. ${entry[0]} (${entry[1]})`);
  }

  console.log('Top miss phrases:');
  for (const [rank, entry] of topEntries(missPhraseCounts, 20).entries()) {
    console.log(`${rank + 1}. ${entry[0]} (${entry[1]})`);
  }
}

function loadTitles(filePath) {
  const sourceRows = parse(readFileSync(filePath, 'utf8'), {
    columns: true,
    skip_empty_lines: true,
    trim: true
  });

  return sourceRows.map((row) => String(row.job_title ?? '').trim()).filter((title) => title.length > 0);
}

function evaluateTitle(title, bootstrap) {
  const normalized = normalize(title);
  const matchedRules = [];
  const roleHits = [];
  const domainHits = [];
  const noiseHits = [];
  let occupationSignal = 0;
  let penaltySignal = 0;

  for (const rule of bootstrap.tokenRules) {
    if (containsTerm(normalized, rule.token)) {
      matchedRules.push(`${rule.kind}:${rule.token}`);
      if (rule.kind === 'role_head') {
        roleHits.push(rule.token);
        occupationSignal += rule.occupationSignal;
      } else if (rule.kind === 'domain_modifier') {
        domainHits.push(rule.token);
        occupationSignal += rule.occupationSignal * 0.75;
      } else if (rule.kind === 'generic_noise') {
        noiseHits.push(rule.token);
        penaltySignal += rule.penaltySignal;
      }
    }
  }

  for (const rule of bootstrap.phraseRules) {
    if (containsTerm(normalized, rule.phrase)) {
      matchedRules.push(`${rule.kind}:${rule.phrase}`);
      if (rule.kind === 'role_phrase') {
        roleHits.push(rule.phrase);
        occupationSignal += rule.occupationSignal;
      } else if (rule.kind === 'generic_phrase') {
        noiseHits.push(rule.phrase);
        penaltySignal += rule.penaltySignal;
      }
    }
  }

  occupationSignal = clampScore(occupationSignal);
  penaltySignal = clampScore(penaltySignal);
  const netSignal = roundNumber(occupationSignal - penaltySignal);
  const decision = classifyTitleContribution(occupationSignal, penaltySignal, bootstrap.thresholds);

  return {
    title,
    normalized,
    roleHits,
    domainHits,
    noiseHits,
    occupationSignal,
    penaltySignal,
    netSignal,
    decision,
    matchedRules
  };
}

function classifyTitleContribution(occupationSignal, penaltySignal, thresholds) {
  const netSignal = occupationSignal - penaltySignal;

  if (
    penaltySignal >= thresholds.tokenHurtMinPenaltySignal &&
    occupationSignal <= thresholds.tokenHurtMaxOccupationSignal &&
    netSignal <= -thresholds.tokenNeutralNetBand
  ) {
    return 'hurt';
  }

  if (occupationSignal >= thresholds.tokenHelpMinOccupationSignal && penaltySignal <= thresholds.tokenHelpMaxPenaltySignal) {
    return 'help';
  }

  return 'neutral';
}

function collectMissCandidates(title, tokenCounts, phraseCounts, bootstrapTokenSet, bootstrapPhraseSet) {
  const tokens = tokenize(title);
  const filtered = tokens.filter((token) => token.length > 2 && !STOP_TOKENS.has(token) && !bootstrapTokenSet.has(token));

  for (const token of filtered) {
    tokenCounts.set(token, (tokenCounts.get(token) ?? 0) + 1);
  }

  for (let size = 2; size <= 3; size += 1) {
    for (let index = 0; index <= filtered.length - size; index += 1) {
      const phrase = filtered.slice(index, index + size).join(' ');
      if (phrase.length <= 3 || bootstrapPhraseSet.has(phrase)) {
        continue;
      }

      phraseCounts.set(phrase, (phraseCounts.get(phrase) ?? 0) + 1);
    }
  }
}

function toReviewRow(rowIndex, title, evaluation) {
  return {
    row_index: String(rowIndex),
    title,
    peeled_title: evaluation.title,
    normalized_title: evaluation.normalized,
    noise_removed: evaluation.title === title ? 'no' : 'yes',
    token_count: String(tokenize(title).length),
    role_hits: evaluation.roleHits.join('|'),
    domain_hits: evaluation.domainHits.join('|'),
    noise_hits: evaluation.noiseHits.join('|'),
    occupation_signal: formatNumber(evaluation.occupationSignal),
    penalty_signal: formatNumber(evaluation.penaltySignal),
    net_signal: formatNumber(evaluation.netSignal),
    decision: evaluation.decision,
    matched_rules: evaluation.matchedRules.join('|')
  };
}

function toMissSummaryCsv(tokenCounts, phraseCounts) {
  const rows = [];

  topEntries(tokenCounts, 50).forEach(([term, count], index) => {
    rows.push({
      kind: 'token',
      rank: String(index + 1),
      term,
      count: String(count)
    });
  });

  topEntries(phraseCounts, 50).forEach(([term, count], index) => {
    rows.push({
      kind: 'phrase',
      rank: String(index + 1),
      term,
      count: String(count)
    });
  });

  return toCsv(rows, MISS_SUMMARY_HEADERS);
}

function topEntries(counts, limit) {
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit);
}

function tokenize(value) {
  return normalize(value).split(' ').filter(Boolean);
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

function clampScore(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }

  if (value <= 0) {
    return 0;
  }

  if (value >= 1) {
    return 1;
  }

  return value;
}

function roundNumber(value) {
  return Math.round(value * 1000) / 1000;
}

function formatNumber(value) {
  return roundNumber(value).toFixed(3);
}

function toCsv(rows, headers) {
  return `${[headers.join(','), ...rows.map((row) => headers.map((header) => escapeCsv(row[header] ?? '')).join(','))].join('\n')}\n`;
}

function escapeCsv(value) {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

main().catch((error) => {
  console.error('Semantic bootstrap review failed.');
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
