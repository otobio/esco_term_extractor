import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';

const DEFAULT_INPUTS = [
  {
    source: 'ejobs',
    path: '/Users/otobio/Downloads/ejobs_job_titles.csv'
  },
  {
    source: 'profession',
    path: '/Users/otobio/Downloads/profession_job_titles.csv'
  }
];

const DEFAULT_OUTPUT = path.join(process.cwd(), 'data', 'taxonomy-review', 'job-title-pattern-review.csv');

const NOISE_HINTS = [
  /\bapply\b/i,
  /\bapplied\b/i,
  /\bapplica/i,
  /\bhiring\b/i,
  /\blooking\s+for\b/i,
  /\bneed(?!s?\b)/i,
  /\bseeking\b/i,
  /\bfull[-\s]?time\b/i,
  /\bpart[-\s]?time\b/i,
  /\bentry\s+level\b/i,
  /\bdi[aá]kmunka\b/i,
  /\bstudent\b/i,
  /\bstart\s+date\b/i,
  /\bwhc\d+\b/i,
  /\bm\/w\/d\b/i,
  /\bf\/m\/d\b/i,
  /\bf\/m\b/i,
  /\bbonus\b/i,
  /\bsalary\b/i,
  /\bmunkaid[oő]?\b/i,
  /\bsz[uű]r[eé]s\b/i,
  /\b[eé]rt[eé]keld\s+munkahely[eé]det\b/i
];

const NOISE_PHRASE_HINTS = [
  'apply as',
  'hiring',
  'hiring for',
  'looking for',
  'need',
  'seeking',
  'full-time',
  'part-time',
  'entry level',
  'diákmunka',
  'student',
  'start date',
  'whc',
  'm/w/d',
  'f/m/d',
  'f/m',
  'bonus',
  'salary',
  'munkaidő',
  'szűrés',
  'értékeld munkahelyedet'
];

const MONTH_HINTS = [
  'january',
  'february',
  'march',
  'april',
  'may',
  'june',
  'july',
  'august',
  'september',
  'october',
  'november',
  'december',
  'január',
  'február',
  'március',
  'április',
  'május',
  'június',
  'július',
  'augusztus',
  'szeptember',
  'október',
  'november',
  'december',
  'ianuarie',
  'februarie',
  'martie',
  'aprilie',
  'mai',
  'iunie',
  'iulie',
  'august',
  'septembrie',
  'octombrie',
  'noiembrie',
  'decembrie'
];

const OCCUPATION_HINTS = [
  'engineer',
  'technician',
  'manager',
  'operator',
  'specialist',
  'assistant',
  'consultant',
  'analyst',
  'developer',
  'designer',
  'coordinator',
  'supervisor',
  'worker',
  'driver',
  'teacher',
  'nurse',
  'doctor',
  'receptionist',
  'accountant',
  'sales',
  'merchandiser',
  'producer',
  'installer',
  'mechanic',
  'electrician',
  'chef',
  'cook',
  'cleaner',
  'secretary',
  'guard',
  'representative',
  'architect',
  'advisor',
  'officer',
  'clerk',
  'buyer',
  'foreman',
  'hostess',
  'ambassador',
  'operator',
  'raktáros',
  'munkatárs',
  'értékesítő',
  'asszisztens',
  'mérnök',
  'technikus',
  'vezető',
  'szakács',
  'lakatos',
  'szerelő',
  'takarító',
  'eladó',
  'könyvelő',
  'tanár',
  'orvos',
  'ügyfél',
  'adminisztratív',
  'műszaki',
  'speciális',
  'inginer',
  'tehnician',
  'manager',
  'operator',
  'specialist',
  'asistent',
  'consilier',
  'analist',
  'dezvoltator',
  'designer',
  'coordonator',
  'supervizor',
  'lucrator',
  'șofer',
  'sofer',
  'profesor',
  'asistent',
  'doctor',
  'recepționer',
  'contabil',
  'vânzări',
  'vanzari',
  'merchandiser',
  'instalator',
  'mecanic',
  'electrician',
  'bucatar',
  'curățenie',
  'curatenie',
  'vânzător',
  'vanzator',
  'jurist',
  'avocat',
  'consilier'
];

function main() {
  const outPath = getArgValue('--out') ?? DEFAULT_OUTPUT;
  const inputs = DEFAULT_INPUTS.filter((input) => !getArgValue(`--${input.source}`) || getArgValue(`--${input.source}`) !== 'off');

  const chunkStats = new Map();
  const tokenStats = new Map();

  for (const input of inputs) {
    const rows = parse(readFileSync(input.path, 'utf8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });

    for (const row of rows) {
      const rawTitle = String(row.job_title ?? '').trim();
      if (!rawTitle) {
        continue;
      }

      const chunks = extractChunks(rawTitle);

      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        const normalized = normalize(chunk);
        if (!normalized) {
          continue;
        }

        const origin = index === 0 ? 'lead' : index === chunks.length - 1 ? 'trail' : 'middle';
        const chunkEntry = ensureEntry(chunkStats, normalized, chunk);
        chunkEntry.totalCount += 1;
        chunkEntry.sourceCounts[input.source] += 1;
        chunkEntry.originCounts[origin] += 1;
        chunkEntry.titleCount += 1;
        if (chunkEntry.examples.length < 3 && !chunkEntry.examples.includes(rawTitle)) {
          chunkEntry.examples.push(rawTitle);
        }

        const tokens = tokenize(chunk);
        for (let tokenIndex = 0; tokenIndex < tokens.length; tokenIndex += 1) {
          const token = tokens[tokenIndex];
          const normalizedToken = normalize(token);
          if (!normalizedToken) {
            continue;
          }

          const tokenEntry = ensureEntry(tokenStats, normalizedToken, token);
          tokenEntry.totalCount += 1;
          tokenEntry.sourceCounts[input.source] += 1;
          tokenEntry.originCounts[origin] += 1;
          tokenEntry.titleCount += 1;
          if (tokenIndex === 0) {
            tokenEntry.firstCount += 1;
          }
          if (tokenIndex === tokens.length - 1) {
            tokenEntry.lastCount += 1;
          }
          if (tokenEntry.examples.length < 3 && !tokenEntry.examples.includes(rawTitle)) {
            tokenEntry.examples.push(rawTitle);
          }
        }
      }
    }
  }

  const headTokenSet = derivePositionSet(tokenStats, 'lastCount', 0.58, 5, 'firstCount');
  const prefixTokenSet = derivePositionSet(tokenStats, 'firstCount', 0.58, 5, 'lastCount');

  const rows = [];

  for (const entry of chunkStats.values()) {
    const classification = classifyChunk(entry, headTokenSet, prefixTokenSet);
    if (entry.totalCount < 2 && classification.kind !== 'noise') {
      continue;
    }

    rows.push(toCsvRow(entry, classification, 'chunk'));
  }

  rows.sort((left, right) => {
    if (left.kindRank !== right.kindRank) {
      return left.kindRank - right.kindRank;
    }

    if (right.totalCount !== left.totalCount) {
      return right.totalCount - left.totalCount;
    }

    if (right.titleCount !== left.titleCount) {
      return right.titleCount - left.titleCount;
    }

    return left.normalizedSurface.localeCompare(right.normalizedSurface);
  });

  writeFileSync(outPath, `${renderCsv(rows)}\n`, 'utf8');
  console.log(`Wrote ${rows.length} review rows to ${outPath}`);
  console.log(
    [
      `sources=${inputs.map((input) => input.source).join(',') || 'none'}`,
      `chunk_rows=${rows.filter((row) => row.rowKind === 'chunk').length}`,
      `signal=${rows.filter((row) => row.kind === 'signal').length}`,
      `noise=${rows.filter((row) => row.kind === 'noise').length}`,
      `review=${rows.filter((row) => row.kind === 'review').length}`
    ].join('  ')
  );
}

function extractChunks(title) {
  const chunks = [];
  const bracketPattern = /\(([^)]*)\)|\[([^\]]*)\]|\{([^}]*)\}/gu;
  let stripped = title;

  for (;;) {
    const match = bracketPattern.exec(title);

    if (match === null) {
      break;
    }

    const bracket = match[1] ?? match[2] ?? match[3] ?? '';
    const normalized = cleanChunk(bracket);
    if (normalized) {
      chunks.push(normalized);
    }
  }

  stripped = stripped.replace(bracketPattern, ' ');
  for (const part of stripped.split(/\s+(?:[/|]|[-–—])\s+/u)) {
    const normalized = cleanChunk(part);
    if (normalized) {
      chunks.push(normalized);
    }
  }

  return chunks;
}

function tokenize(value) {
  return value.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [];
}

function cleanChunk(value) {
  return value
    .replace(/\s+/gu, ' ')
    .replace(/^[\s"'“”‘’.,;:!?]+/gu, '')
    .replace(/[\s"'“”‘’.,;:!?]+$/gu, '')
    .trim();
}

function normalize(value) {
  return cleanChunk(value).toLowerCase();
}

function ensureEntry(map, normalized, surface) {
  let entry = map.get(normalized);
  if (!entry) {
    entry = {
      surface,
      normalizedSurface: normalized,
      totalCount: 0,
      titleCount: 0,
      sourceCounts: { ejobs: 0, profession: 0 },
      originCounts: { lead: 0, middle: 0, trail: 0 },
      firstCount: 0,
      lastCount: 0,
      examples: []
    };
    map.set(normalized, entry);
  }

  return entry;
}

function derivePositionSet(map, field, minRatio, minCount, requireOtherField = null) {
  const result = new Set();
  for (const entry of map.values()) {
    const total = entry.totalCount || 0;
    if (total < minCount) {
      continue;
    }

    if (requireOtherField && entry[requireOtherField] <= 0) {
      continue;
    }

    const ratio = total > 0 ? entry[field] / total : 0;
    if (ratio >= minRatio) {
      result.add(entry.normalizedSurface);
    }
  }

  return result;
}

function classifyChunk(entry, headTokenSet, prefixTokenSet) {
  const tokens = tokenize(entry.surface)
    .map((token) => normalize(token))
    .filter(Boolean);
  const normalizedSurface = normalize(entry.surface);
  const hasDigits = /\d/u.test(entry.surface);
  const allCapsAcronym = /^[A-Z0-9&./-]{2,}$/u.test(entry.surface) && entry.surface === entry.surface.toUpperCase();
  const hasNoiseHint =
    NOISE_HINTS.some((pattern) => pattern.test(entry.surface)) || NOISE_PHRASE_HINTS.some((phrase) => normalizedSurface.includes(phrase));
  const hasMonth = MONTH_HINTS.some((month) => normalizedSurface.includes(month));
  const leadRatio = entry.originCounts.lead / Math.max(1, entry.totalCount);
  const trailRatio = entry.originCounts.trail / Math.max(1, entry.totalCount);
  const firstToken = tokens[0] ?? '';
  const lastToken = tokens[tokens.length - 1] ?? '';
  const firstIsPrefix = prefixTokenSet.has(firstToken);
  const lastIsHead = headTokenSet.has(lastToken);
  const multiWord = tokens.length >= 2;
  const shortChunk = tokens.length <= 2;
  const occupational = tokens.some((token) => isOccupationalToken(token)) || isOccupationalSurface(normalizedSurface);
  const locationLike = tokens.length === 1 && entry.totalCount >= 20 && /^[\p{Lu}]/u.test(entry.surface) && !hasNoiseHint && !occupational;

  const noiseScore =
    (hasNoiseHint ? 0.8 : 0) +
    (hasDigits ? 0.35 : 0) +
    (allCapsAcronym ? 0.3 : 0) +
    (hasMonth ? 0.2 : 0) +
    (locationLike ? 0.45 : 0) +
    (trailRatio >= 0.5 && shortChunk ? 0.2 : 0) +
    (entry.surface.length <= 4 ? 0.15 : 0);

  const signalScore =
    (multiWord ? 0.3 : 0) +
    (leadRatio >= 0.5 ? 0.2 : 0) +
    (firstIsPrefix ? 0.25 : 0) +
    (lastIsHead ? 0.35 : 0) +
    (occupational ? 0.25 : 0) +
    (!hasDigits && !hasNoiseHint ? 0.1 : 0);

  let kind = 'review';
  let role = 'mixed';

  if (hasNoiseHint || locationLike || noiseScore >= 0.6) {
    kind = 'noise';
    role = 'noise';
  } else if (signalScore >= 0.6) {
    kind = 'signal';
    if (lastIsHead) {
      role = 'suffix_head';
    } else if (firstIsPrefix) {
      role = 'prefix_modifier';
    } else {
      role = multiWord ? 'mixed_signal' : 'signal_token';
    }
  }

  const reason = buildReason({
    kind,
    role,
    hasDigits,
    hasNoiseHint,
    hasMonth,
    leadRatio,
    trailRatio,
    firstIsPrefix,
    lastIsHead,
    multiWord
  });

  return { kind, role, reason, signalScore, noiseScore, kindRank: kindRank(kind) };
}

function buildReason(fields) {
  const parts = [];
  if (fields.hasNoiseHint) {
    parts.push('noise_hint');
  }
  if (fields.hasDigits) {
    parts.push('digits');
  }
  if (fields.hasMonth) {
    parts.push('date_or_month');
  }
  if (fields.firstIsPrefix) {
    parts.push('prefix_token');
  }
  if (fields.lastIsHead) {
    parts.push('head_token');
  }
  if (fields.signalToken) {
    parts.push('token_row');
  }
  if (fields.multiWord) {
    parts.push('multi_word');
  }
  if (fields.leadRatio !== undefined && fields.leadRatio >= 0.5) {
    parts.push('lead_bias');
  }
  if (fields.trailRatio !== undefined && fields.trailRatio >= 0.5) {
    parts.push('trail_bias');
  }

  return parts.join('|') || 'review';
}

function isOccupationalToken(token) {
  return OCCUPATION_HINTS.some((hint) => token === hint || token.includes(hint));
}

function isOccupationalSurface(surface) {
  return OCCUPATION_HINTS.some((hint) => surface.includes(hint));
}

function toCsvRow(entry, classification, rowKind) {
  return {
    rowKind,
    kind: classification.kind,
    role: classification.role,
    reason: classification.reason,
    surface: entry.surface,
    normalizedSurface: entry.normalizedSurface,
    sourceEjobsCount: entry.sourceCounts.ejobs,
    sourceProfessionCount: entry.sourceCounts.profession,
    totalCount: entry.totalCount,
    titleCount: entry.titleCount,
    leadCount: entry.originCounts.lead,
    middleCount: entry.originCounts.middle,
    trailCount: entry.originCounts.trail,
    signalScore: round(classification.signalScore),
    noiseScore: round(classification.noiseScore),
    examples: entry.examples.join(' || '),
    kindRank: classification.kindRank
  };
}

function renderCsv(rows) {
  const header = [
    'row_kind',
    'kind_guess',
    'role_guess',
    'reason',
    'surface',
    'normalized_surface',
    'ejobs_count',
    'profession_count',
    'total_count',
    'title_count',
    'lead_count',
    'middle_count',
    'trail_count',
    'signal_score',
    'noise_score',
    'examples'
  ];

  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.rowKind,
        row.kind,
        row.role,
        row.reason,
        row.surface,
        row.normalizedSurface,
        row.sourceEjobsCount,
        row.sourceProfessionCount,
        row.totalCount,
        row.titleCount,
        row.leadCount,
        row.middleCount,
        row.trailCount,
        row.signalScore,
        row.noiseScore,
        row.examples
      ]
        .map(escapeCsv)
        .join(',')
    );
  }

  return lines.join('\n');
}

function escapeCsv(value) {
  const text = String(value ?? '');
  if (!/[",\n\r]/u.test(text)) {
    return text;
  }

  return `"${text.replace(/"/gu, '""')}"`;
}

function round(value) {
  return Math.round(value * 1000) / 1000;
}

function kindRank(kind) {
  if (kind === 'noise') {
    return 0;
  }
  if (kind === 'signal') {
    return 1;
  }
  return 2;
}

function getArgValue(name) {
  const prefix = `${name}=`;
  const arg = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : null;
}

main();
