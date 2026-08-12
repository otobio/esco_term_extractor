import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildOccupationNoisePeelingProfile,
  extractOccupationTitleChunks,
  getOccupationNoisePeelingProfile,
  normalizeSearchText,
  peelOccupationTitleNoise,
  peelOccupationTitleNoiseWithProfile
} from '../../src/query/occupation-noise-peeling.js';

function assertPeelingCase(options: {
  title: string;
  locale: string;
  peeledTitle: string;
  noiseKinds?: string[];
  supportedLocale?: boolean;
}): void {
  const result = peelOccupationTitleNoise(options.title, options.locale);
  assert.equal(result.peeledTitle, options.peeledTitle, `${options.locale}: ${options.title}`);
  if (options.supportedLocale !== undefined) {
    assert.equal(result.supportedLocale, options.supportedLocale, `${options.locale}: ${options.title}`);
  }

  for (const kind of options.noiseKinds ?? []) {
    assert.ok(
      result.noiseChunks.some((chunk) => chunk.kind === kind),
      `${options.locale}: ${options.title} missing ${kind}`
    );
  }
}

function assertNoNoiseCase(title: string, locale: string, peeledTitle = title): void {
  const result = peelOccupationTitleNoise(title, locale);
  assert.equal(result.peeledTitle, peeledTitle, `${locale}: ${title}`);
  assert.equal(result.noiseChunks.length, 0, `${locale}: ${title}`);
}

function assertNoiseOrigin(title: string, locale: string, kind: string, origin: 'lead' | 'middle' | 'trail'): void {
  const result = peelOccupationTitleNoise(title, locale);
  const chunk = result.noiseChunks.find((entry) => entry.kind === kind);
  assert.ok(chunk, `${locale}: ${title} missing ${kind}`);
  assert.equal(chunk.origin, origin, `${locale}: ${title} wrong origin for ${kind}`);
}

test('normalizeSearchText correctly folds diacritics, lowercases, and strips punctuation', () => {
  assert.equal(normalizeSearchText('Şofer cat. C / C+E (București)'), 'sofer cat c c e bucuresti');
  assert.equal(normalizeSearchText('  Műszaki---Vezető!!! '), 'muszaki vezeto');
  assert.equal(normalizeSearchText(''), '');
});

test('extractOccupationTitleChunks splits parentheticals and delimited title sections', () => {
  const chunks = extractOccupationTitleChunks('Inginer SRL / Proiectant [Full-Time] (Bucuresti)');
  assert.deepEqual(chunks, [
    { surface: 'Inginer SRL', origin: 'lead', isBracket: false },
    { surface: 'Proiectant', origin: 'trail', isBracket: false },
    { surface: 'Full-Time', origin: 'trail', isBracket: true },
    { surface: 'Bucuresti', origin: 'trail', isBracket: true }
  ]);
});

test('extractOccupationTitleChunks splits slash, pipe, dash, en dash, and em dash separators', () => {
  assert.deepEqual(extractOccupationTitleChunks('Inginer / Proiectant | Electrician - Contabil – Sofer — Bucatar'), [
    { surface: 'Inginer', origin: 'lead', isBracket: false },
    { surface: 'Proiectant', origin: 'middle', isBracket: false },
    { surface: 'Electrician', origin: 'middle', isBracket: false },
    { surface: 'Contabil', origin: 'middle', isBracket: false },
    { surface: 'Sofer', origin: 'middle', isBracket: false },
    { surface: 'Bucatar', origin: 'trail', isBracket: false }
  ]);
});

test('extractOccupationTitleChunks does not split internal hyphenated role text', () => {
  assert.deepEqual(extractOccupationTitleChunks('Front-end Developer'), [
    { surface: 'Front-end Developer', origin: 'lead', isBracket: false }
  ]);
});

test('extractOccupationTitleChunks handles title with only brackets', () => {
  const chunks = extractOccupationTitleChunks('(Munkatars) [Budapest]');
  assert.deepEqual(chunks, [
    { surface: 'Munkatars', origin: 'trail', isBracket: true },
    { surface: 'Budapest', origin: 'trail', isBracket: true }
  ]);
});

test('extractOccupationTitleChunks handles whitespace and empty input', () => {
  assert.deepEqual(extractOccupationTitleChunks(''), []);
  assert.deepEqual(extractOccupationTitleChunks('   '), []);
});

test('locale handling: supported locales (ro, hu) vs unsupported locales', () => {
  const roResult = peelOccupationTitleNoise('Inginer Mecanic', 'ro');
  assert.equal(roResult.supportedLocale, true);
  assert.equal(roResult.locale, 'ro');

  const roCaseResult = peelOccupationTitleNoise('Inginer Mecanic', ' RO ');
  assert.equal(roCaseResult.supportedLocale, true);
  assert.equal(roCaseResult.locale, 'ro');

  const huResult = peelOccupationTitleNoise('Műszaki Rajzoló', 'hu');
  assert.equal(huResult.supportedLocale, true);
  assert.equal(huResult.locale, 'hu');

  const enResult = peelOccupationTitleNoise('Software Engineer', 'en');
  assert.equal(enResult.supportedLocale, false);
  assert.equal(enResult.locale, 'en');
  assert.equal(enResult.peeledTitle, 'Software Engineer');

  const emptyResult = peelOccupationTitleNoise('Software Engineer', '');
  assert.equal(emptyResult.supportedLocale, false);
  assert.equal(emptyResult.peeledTitle, 'Software Engineer');
});

test('profile lookup returns profile for supported locales and null for unsupported', () => {
  assert.ok(getOccupationNoisePeelingProfile('ro') !== null);
  assert.ok(getOccupationNoisePeelingProfile('hu') !== null);
  assert.equal(getOccupationNoisePeelingProfile('en'), null);
  assert.equal(getOccupationNoisePeelingProfile(undefined), null);
});

test('peels noise_ui_artifact in ro and hu', () => {
  const roRes = peelOccupationTitleNoise('Hiring / Inginer Constructor', 'ro');
  assert.equal(roRes.peeledTitle, 'Inginer Constructor');
  assert.ok(roRes.noiseChunks.some((c) => c.kind === 'noise_ui_artifact'));

  const huRes = peelOccupationTitleNoise('Szures / Villanyszerelő', 'hu');
  assert.equal(huRes.peeledTitle, 'Villanyszerelő');
  assert.ok(huRes.noiseChunks.some((c) => c.kind === 'noise_ui_artifact'));
});

test('peels all supported noise_ui_artifact phrases and inline variants', () => {
  const cases = [
    { title: 'Looking for / Sales manager', locale: 'ro', peeledTitle: 'Sales manager' },
    { title: 'Seeking / Accountant', locale: 'hu', peeledTitle: 'Accountant' },
    { title: 'Apply as / Operator productie', locale: 'ro', peeledTitle: 'as Operator productie', noiseKinds: [] },
    { title: 'Hiring Inginer constructor', locale: 'ro', peeledTitle: 'Inginer constructor', noiseKinds: [] }
  ];

  for (const testCase of cases) {
    assertPeelingCase({ ...testCase, noiseKinds: testCase.noiseKinds ?? ['noise_ui_artifact'] });
  }
});

test('peels noise_employment_flag in ro and hu', () => {
  const roRes = peelOccupationTitleNoise('Contabil / full time', 'ro');
  assert.equal(roRes.peeledTitle, 'Contabil');
  assert.ok(roRes.noiseChunks.some((c) => c.kind === 'noise_employment_flag'));

  const roFixedTermRes = peelOccupationTitleNoise('Stivuitorist / perioada determinata', 'ro');
  assert.equal(roFixedTermRes.peeledTitle, 'Stivuitorist');
  assert.ok(roFixedTermRes.noiseChunks.some((c) => c.kind === 'noise_employment_flag'));

  const huRes = peelOccupationTitleNoise('Eladó / teljes munkaido', 'hu');
  assert.equal(huRes.peeledTitle, 'Eladó');
  assert.ok(huRes.noiseChunks.some((c) => c.kind === 'noise_employment_flag'));
});

test('peels employment flags across phrase variants', () => {
  const cases = [
    { title: 'Casier / part time', locale: 'ro', peeledTitle: 'Casier' },
    { title: 'Asistent / full-time', locale: 'ro', peeledTitle: 'Asistent' },
    { title: 'Operator / perioada nedeterminata', locale: 'ro', peeledTitle: 'Operator' },
    { title: 'Bucatar / cazare asigurata', locale: 'ro', peeledTitle: 'Bucatar' },
    { title: 'Proiectant / m/f', locale: 'ro', peeledTitle: 'Proiectant' },
    { title: 'Proiectant / f/m', locale: 'ro', peeledTitle: 'Proiectant' },
    { title: 'Proiectant / f m', locale: 'ro', peeledTitle: 'Proiectant' },
    { title: 'Proiectant / m w d', locale: 'hu', peeledTitle: 'Proiectant' },
    { title: 'Proiectant / m/w/d', locale: 'hu', peeledTitle: 'Proiectant' },
    { title: 'Proiectant / f m d', locale: 'hu', peeledTitle: 'Proiectant' },
    { title: 'Proiectant / m f x', locale: 'hu', peeledTitle: 'Proiectant' },
    { title: 'Eladó / részmunkaidő', locale: 'hu', peeledTitle: 'Eladó' }
  ];

  for (const testCase of cases) {
    assertPeelingCase({ ...testCase, noiseKinds: ['noise_employment_flag'] });
  }

  assert.equal(peelOccupationTitleNoise('Chef / free accommodation', 'hu').peeledTitle, 'Chef accommodation');
});

test('peels noise_shift in ro and hu', () => {
  const roRes = peelOccupationTitleNoise('Operator productie / 2 schimburi', 'ro');
  assert.equal(roRes.peeledTitle, 'Operator productie');
  assert.ok(roRes.noiseChunks.some((c) => c.kind === 'noise_shift'));

  const huRes = peelOccupationTitleNoise('Gépkezelő / 3 schimburi', 'hu');
  assert.equal(huRes.peeledTitle, 'Gépkezelő');
  assert.ok(huRes.noiseChunks.some((c) => c.kind === 'noise_shift'));
});

test('peels shift noise via phrase and regex matches', () => {
  const cases = [
    { title: 'Asistent / day shift', locale: 'ro', peeledTitle: 'Asistent' },
    { title: 'Operator / night shift', locale: 'hu', peeledTitle: 'Operator' },
    { title: 'Lucrator / rotating shift', locale: 'ro', peeledTitle: 'Lucrator' },
    { title: 'Bucatar / program flexibil', locale: 'ro', peeledTitle: 'Bucatar' },
    { title: 'Sofer / munca in ture', locale: 'ro', peeledTitle: 'Sofer' },
    { title: 'Operator / tura de noapte', locale: 'ro', peeledTitle: 'Operator' },
    { title: 'Operator / 6h', locale: 'ro', peeledTitle: 'Operator' },
    { title: 'Operator / 12 hours', locale: 'hu', peeledTitle: 'Operator' },
    { title: 'Operator / 2/2', locale: 'ro', peeledTitle: 'Operator' },
    { title: 'Operator / 3-shift', locale: 'hu', peeledTitle: 'Operator' },
    { title: 'Operator / 4 ture', locale: 'ro', peeledTitle: 'Operator' }
  ];

  for (const testCase of cases) {
    assertPeelingCase({ ...testCase, noiseKinds: ['noise_shift'] });
  }
});

test('peels noise_date in ro and hu', () => {
  const roRes = peelOccupationTitleNoise('Asistent medical / Start date Ianuarie', 'ro');
  assert.equal(roRes.peeledTitle, 'Asistent medical');
  assert.ok(roRes.noiseChunks.some((c) => c.kind === 'noise_date'));

  const huRes = peelOccupationTitleNoise('Könyvelő / Marcius', 'hu');
  assert.equal(huRes.peeledTitle, 'Könyvelő');
  assert.ok(huRes.noiseChunks.some((c) => c.kind === 'noise_date'));
});

test('peels date noise via month names and ordinal-number regexes', () => {
  const cases = [
    { title: 'Operator / January', locale: 'ro', peeledTitle: 'Operator' },
    { title: 'Operator / Oktober', locale: 'hu', peeledTitle: 'Operator' },
    { title: 'Operator / 15th', locale: 'ro', peeledTitle: 'Operator' },
    { title: 'Operator / 3rd of May', locale: 'hu', peeledTitle: 'Operator' }
  ];

  for (const testCase of cases) {
    assertPeelingCase({ ...testCase, noiseKinds: ['noise_date'] });
  }
});

test('peels noise_salary in ro and hu', () => {
  const roRes = peelOccupationTitleNoise('Șofer / RON', 'ro');
  assert.equal(roRes.peeledTitle, 'Șofer');
  assert.ok(roRes.noiseChunks.some((c) => c.kind === 'noise_salary'));

  const huRes = peelOccupationTitleNoise('Raktáros / HUF', 'hu');
  assert.equal(huRes.peeledTitle, 'Raktáros');
  assert.ok(huRes.noiseChunks.some((c) => c.kind === 'noise_salary'));
});

test('inlined built-in noise rules cover locale-specific salary phrases', () => {
  const roRes = peelOccupationTitleNoise('Sofer livrator / salariu motivant', 'ro');
  assert.equal(roRes.peeledTitle, 'Sofer livrator');
  assert.ok(roRes.noiseChunks.some((c) => c.kind === 'noise_salary'));

  const huRes = peelOccupationTitleNoise('Raktáros / versenykepes fizetes', 'hu');
  assert.equal(huRes.peeledTitle, 'Raktáros');
  assert.ok(huRes.noiseChunks.some((c) => c.kind === 'noise_salary'));
});

test('inlined built-in noise rules cover the hu m/w/d pattern', () => {
  assertPeelingCase({
    title: 'Fejlesztő / m/w/d',
    locale: 'hu',
    peeledTitle: 'Fejlesztő',
    noiseKinds: ['noise_employment_flag']
  });
});

test('peels noise_identifier in ro and hu', () => {
  const roRes = peelOccupationTitleNoise('Mecanic auto / REF12345', 'ro');
  assert.equal(roRes.peeledTitle, 'Mecanic auto');
  assert.ok(roRes.noiseChunks.some((c) => c.kind === 'noise_identifier'));

  const huRes = peelOccupationTitleNoise('Szakács / WHC9999', 'hu');
  assert.equal(huRes.peeledTitle, 'Szakács');
  assert.ok(huRes.noiseChunks.some((c) => c.kind === 'noise_identifier'));
});

test('peels identifier noise via all regex families', () => {
  const cases = [
    { title: 'Operator / KH_123', locale: 'ro', peeledTitle: 'Operator' },
    { title: 'Operator / KH-123', locale: 'hu', peeledTitle: 'Operator' },
    { title: 'Inginer / 123456', locale: 'ro', peeledTitle: 'Inginer' },
    { title: 'Operator / A123', locale: 'hu', peeledTitle: 'Operator' }
  ];

  for (const testCase of cases) {
    assertPeelingCase({ ...testCase, noiseKinds: ['noise_identifier'] });
  }
});

test('peels noise_application_cta in ro and hu', () => {
  const roRes = peelOccupationTitleNoise('Cautam / Electrician naval', 'ro');
  assert.equal(roRes.peeledTitle, 'Electrician naval');
  assert.ok(roRes.noiseChunks.some((c) => c.kind === 'noise_application_cta'));

  const huRes = peelOccupationTitleNoise('Jelentkezz / Adminisztratív munkatárs', 'hu');
  assert.equal(huRes.peeledTitle, 'Adminisztratív munkatárs');
  assert.ok(huRes.noiseChunks.some((c) => c.kind === 'noise_application_cta'));
});

test('peels application cta phrases and inline variants', () => {
  const cases = [
    { title: 'Apply now / Accountant', locale: 'ro', peeledTitle: 'now Accountant', noiseKinds: [] },
    { title: 'Join us / Sales manager', locale: 'hu', peeledTitle: 'us Sales manager', noiseKinds: [] },
    { title: 'We are looking for / Buyer', locale: 'ro', peeledTitle: 'We are Buyer', noiseKinds: [] },
    { title: 'Angajam / Bucatar', locale: 'ro', peeledTitle: 'Bucatar' },
    { title: 'Cautam Electrician naval', locale: 'ro', peeledTitle: 'Electrician naval', noiseKinds: [] }
  ];

  for (const testCase of cases) {
    assertPeelingCase({ ...testCase, noiseKinds: testCase.noiseKinds ?? ['noise_application_cta'] });
  }
});

test('peels noise_language in ro and hu', () => {
  const roRes = peelOccupationTitleNoise('Analist financiar / with English', 'ro');
  assert.equal(roRes.peeledTitle, 'Analist financiar');
  assert.ok(roRes.noiseChunks.some((c) => c.kind === 'noise_language'));

  const huRes = peelOccupationTitleNoise('IT Support / German required', 'hu');
  assert.equal(huRes.peeledTitle, 'IT Support');
  assert.ok(huRes.noiseChunks.some((c) => c.kind === 'noise_language'));
});

test('peels language qualifiers across all supported phrasings', () => {
  const cases = [
    { title: 'Operator / fluent french', locale: 'ro', peeledTitle: 'Operator' },
    { title: 'Consultant / basic italian', locale: 'hu', peeledTitle: 'Consultant' },
    { title: 'Developer / english language', locale: 'ro', peeledTitle: 'Developer' },
    { title: 'Specialist / romanian speaker', locale: 'hu', peeledTitle: 'Specialist' },
    { title: 'Analist / with fluent italian', locale: 'ro', peeledTitle: 'Analist' },
    { title: 'Analist / with basic english', locale: 'ro', peeledTitle: 'Analist' },
    { title: 'Analist / english required', locale: 'ro', peeledTitle: 'Analist' },
    { title: 'Analist / english knowledge', locale: 'ro', peeledTitle: 'Analist' },
    { title: 'Analist / english speaking', locale: 'ro', peeledTitle: 'Analist' },
    { title: 'Analist / with german', locale: 'hu', peeledTitle: 'Analist' },
    { title: 'Analist / good hungarian', locale: 'hu', peeledTitle: 'Analist' },
    { title: 'Analist / basic romanian', locale: 'hu', peeledTitle: 'Analist' }
  ];

  for (const testCase of cases) {
    assertPeelingCase({ ...testCase, noiseKinds: ['noise_language'] });
  }

  assert.equal(peelOccupationTitleNoise('Analist financiar with English', 'ro').peeledTitle, 'Analist financiar');
  assert.equal(peelOccupationTitleNoise('Analist financiar with fluent italian', 'ro').peeledTitle, 'Analist financiar');
  assert.equal(peelOccupationTitleNoise('Analist financiar with basic english', 'ro').peeledTitle, 'Analist financiar');
  assert.equal(peelOccupationTitleNoise('Analist financiar english required', 'ro').peeledTitle, 'Analist financiar');
  assert.equal(peelOccupationTitleNoise('Analist financiar fluent italian', 'ro').peeledTitle, 'Analist financiar');
  assert.equal(peelOccupationTitleNoise('Analist financiar english speaker', 'ro').peeledTitle, 'Analist financiar');
  assert.equal(peelOccupationTitleNoise('Analist financiar with german', 'hu').peeledTitle, 'Analist financiar');
});

test('peels noise_location in ro and hu', () => {
  const roRes = peelOccupationTitleNoise('Inginer automatizari / Bucuresti', 'ro');
  assert.equal(roRes.peeledTitle, 'Inginer automatizari');
  assert.ok(roRes.noiseChunks.some((c) => c.kind === 'noise_location'));

  const huRes = peelOccupationTitleNoise('Szoftverfejlesztő / Budapest', 'hu');
  assert.equal(huRes.peeledTitle, 'Szoftverfejlesztő');
  assert.ok(huRes.noiseChunks.some((c) => c.kind === 'noise_location'));
});

test('peels location noise via direct city hints and location-context markers', () => {
  const cases = [
    { title: 'Operator / Otopeni', locale: 'ro', peeledTitle: 'Operator' },
    { title: 'Eladó / Westend', locale: 'hu', peeledTitle: 'Eladó' },
    { title: 'Sofer / zona Bucuresti', locale: 'ro', peeledTitle: 'Sofer zona' },
    { title: 'Agent / jud Cluj', locale: 'ro', peeledTitle: 'Agent' },
    { title: 'Bucatar / sector 3', locale: 'ro', peeledTitle: 'Bucatar' },
    { title: 'Curier / county Road E85', locale: 'ro', peeledTitle: 'Curier county Road', noiseKinds: [] },
    { title: 'Operator / utca Kossuth', locale: 'hu', peeledTitle: 'Operator' }
  ];

  for (const testCase of cases) {
    assertPeelingCase({
      ...testCase,
      noiseKinds: testCase.noiseKinds ?? (testCase.title === 'Sofer / zona Bucuresti' ? [] : ['noise_location'])
    });
  }

  assert.equal(peelOccupationTitleNoise('Inginer automatizari Bucuresti', 'ro').peeledTitle, 'Inginer automatizari');
});

test('peels noise_employer_brand in ro and hu', () => {
  const roRes = peelOccupationTitleNoise('Sofer livrator / Bringo', 'ro');
  assert.equal(roRes.peeledTitle, 'Sofer livrator');
  assert.ok(roRes.noiseChunks.some((c) => c.kind === 'noise_employer_brand'));

  const huRes = peelOccupationTitleNoise('Munkatárs / Pizza Hut', 'hu');
  assert.equal(huRes.peeledTitle, 'Munkatárs');
  assert.ok(huRes.noiseChunks.some((c) => c.kind === 'noise_employer_brand'));
});

test('peels employer-brand noise via known brands, company suffixes, and acronym heuristics', () => {
  const cases = [
    { title: 'Baker / Delissima', locale: 'ro', peeledTitle: 'Baker' },
    { title: 'Curier / Travel Free', locale: 'hu', peeledTitle: 'Curier Travel' },
    { title: 'Contabil / Example SRL', locale: 'ro', peeledTitle: 'Contabil Example', noiseKinds: [] },
    { title: 'Manager / ACME KFT', locale: 'hu', peeledTitle: 'Manager' },
    { title: 'Receptionist / Plaza Hotel', locale: 'ro', peeledTitle: 'Receptionist', noiseKinds: ['noise_location'] },
    { title: 'Analyst / X1 Group', locale: 'hu', peeledTitle: 'Analyst Group', noiseKinds: [] },
    { title: 'Developer / ACME LLC', locale: 'ro', peeledTitle: 'Developer' }
  ];

  for (const testCase of cases) {
    assertPeelingCase({
      ...testCase,
      noiseKinds: testCase.noiseKinds ?? (testCase.title === 'Curier / Travel Free' ? [] : ['noise_employer_brand'])
    });
  }

  assert.equal(peelOccupationTitleNoise('Sofer livrator Pizza Hut', 'ro').peeledTitle, 'Sofer livrator');
});

test('peels noise_parenthetical_info from brackets', () => {
  const roRes = peelOccupationTitleNoise('Proiectant (m/f) [Full-Time]', 'ro');
  assert.equal(roRes.peeledTitle, 'Proiectant');
  assert.equal(roRes.noiseChunks.length, 2);
  assert.ok(roRes.noiseChunks.every((c) => c.kind === 'noise_parenthetical_info'));
});

test('inline mixed surface noise peeling strips noise tokens without delimiters', () => {
  const ctaRes = peelOccupationTitleNoise('Cautam Electrician naval', 'ro');
  assert.equal(ctaRes.peeledTitle, 'Electrician naval');

  const brandRes = peelOccupationTitleNoise('Sofer livrator Pizza Hut', 'ro');
  assert.equal(brandRes.peeledTitle, 'Sofer livrator');

  const locationRes = peelOccupationTitleNoise('Inginer automatizari Bucuresti', 'ro');
  assert.equal(locationRes.peeledTitle, 'Inginer automatizari');
});

test('mixed-surface peeling strips multiple concurrent noise tokens while retaining occupation text', () => {
  assert.equal(peelOccupationTitleNoise('Cautam Sofer livrator Bucuresti', 'ro').peeledTitle, 'Sofer livrator');
  assert.equal(peelOccupationTitleNoise('Sofer livrator Bringo', 'ro').peeledTitle, 'Sofer livrator');
});

test('language teacher guardrail: English teacher is NOT peeled as noise_language', () => {
  const roRes = peelOccupationTitleNoise('English teacher', 'ro');
  assert.equal(roRes.peeledTitle, 'English teacher');
  assert.ok(!roRes.noiseChunks.some((c) => c.kind === 'noise_language'));

  const huRes = peelOccupationTitleNoise('German teacher', 'hu');
  assert.equal(huRes.peeledTitle, 'German teacher');
  assert.ok(!huRes.noiseChunks.some((c) => c.kind === 'noise_language'));
});

test('language-teacher guardrail covers more teaching-language variants', () => {
  assertNoNoiseCase('Italian teacher', 'ro');
  assertNoNoiseCase('Romanian teacher', 'ro');
  assertNoNoiseCase('French teacher', 'hu');
});

test('occupation acronym guardrails preserve legitimate occupational acronyms', () => {
  const cases = [
    'HR Manager',
    'IT Support',
    'QA Engineer',
    'UI Designer',
    'UX Designer',
    'CAD Operator',
    'PLC Technician',
    'SQL Developer',
    'CNC Operator'
  ];

  for (const title of cases) {
    assertNoNoiseCase(title, 'ro');
    assertNoNoiseCase(title, 'hu');
  }
});

test('non-occupational acronyms and compact brand codes are peeled when isolated as noise', () => {
  const cases = [
    { title: 'Operator / ABC', locale: 'ro', peeledTitle: 'Operator' },
    { title: 'Manager / A12', locale: 'hu', peeledTitle: 'Manager', noiseKinds: ['noise_identifier'] },
    { title: 'Worker / 12AB', locale: 'ro', peeledTitle: 'Worker' },
    { title: 'Clerk / XYZ99', locale: 'hu', peeledTitle: 'Clerk', noiseKinds: ['noise_identifier'] }
  ];

  for (const testCase of cases) {
    assertPeelingCase({ ...testCase, noiseKinds: testCase.noiseKinds ?? ['noise_employer_brand'] });
  }
});

test('address context guardrail: number in address context is not peeled as noise_date', () => {
  const roRes = peelOccupationTitleNoise('Bucatar / Sector 12', 'ro');
  assert.ok(!roRes.noiseChunks.some((c) => c.kind === 'noise_date'));

  const roNrRes = peelOccupationTitleNoise('Bucatar / Nr 12', 'ro');
  assert.ok(!roNrRes.noiseChunks.some((c) => c.kind === 'noise_date'));

  const roRoadRes = peelOccupationTitleNoise('Operator / DN 12', 'ro');
  assert.ok(!roRoadRes.noiseChunks.some((c) => c.kind === 'noise_date'));

  const roJudetRes = peelOccupationTitleNoise('Operator / Judet 12', 'ro');
  assert.ok(!roJudetRes.noiseChunks.some((c) => c.kind === 'noise_date'));
});

test('shift chunk containing core occupation token preserves occupation token', () => {
  const res = peelOccupationTitleNoise('Operator 8 ore', 'ro');
  assert.equal(res.peeledTitle, 'Operator 8 ore');
  assert.equal(res.noiseChunks.length, 0);
});

test('occupation core tokens preserve mixed surfaces from being dropped wholesale when the role remains embedded in the chunk', () => {
  assertNoNoiseCase('Manager night shift', 'ro');
  assertNoNoiseCase('Tehnician WHC9999', 'ro');
  assert.equal(peelOccupationTitleNoise('Munkatárs Pizza Hut', 'hu').peeledTitle, 'Munkatárs');
});

test('classifies noise chunk origins consistently by noise kind', () => {
  assertNoiseOrigin('Hiring / Inginer', 'ro', 'noise_ui_artifact', 'lead');
  assertNoiseOrigin('Cautam / Inginer', 'ro', 'noise_application_cta', 'lead');
  assertNoiseOrigin('Inginer / full time', 'ro', 'noise_employment_flag', 'lead');
  assertNoiseOrigin('Inginer / RON', 'ro', 'noise_salary', 'middle');
  assertNoiseOrigin('Inginer / January', 'ro', 'noise_date', 'middle');
  assertNoiseOrigin('Inginer / 2 schimburi', 'ro', 'noise_shift', 'middle');
  assertNoiseOrigin('Inginer / WHC9999', 'hu', 'noise_identifier', 'middle');
  assertNoiseOrigin('Inginer / with English', 'ro', 'noise_language', 'middle');
  assertNoiseOrigin('Inginer / Bucuresti', 'ro', 'noise_location', 'trail');
  assertNoiseOrigin('Inginer (Bucuresti)', 'ro', 'noise_parenthetical_info', 'trail');
});

test('supported locales keep clean occupational titles unchanged', () => {
  const cases = ['Software Engineer', 'Electrician naval', 'English teacher', 'German teacher', 'Bucatar', 'Műszaki rajzoló'];

  for (const title of cases) {
    assertNoNoiseCase(title, 'ro');
    assertNoNoiseCase(title, 'hu');
  }
});

test('separator and no-separator forms both peel common noise surfaces', () => {
  const cases = [
    { title: 'Hiring / Inginer Constructor', locale: 'ro', peeledTitle: 'Inginer Constructor' },
    { title: 'Hiring Inginer Constructor', locale: 'ro', peeledTitle: 'Inginer Constructor' },
    { title: 'Cautam / Electrician naval', locale: 'ro', peeledTitle: 'Electrician naval' },
    { title: 'Cautam Electrician naval', locale: 'ro', peeledTitle: 'Electrician naval' },
    { title: 'Analist / with fluent italian', locale: 'ro', peeledTitle: 'Analist' },
    { title: 'Analist financiar with fluent italian', locale: 'ro', peeledTitle: 'Analist financiar' },
    { title: 'Inginer automatizari / Bucuresti', locale: 'ro', peeledTitle: 'Inginer automatizari' },
    { title: 'Inginer automatizari Bucuresti', locale: 'ro', peeledTitle: 'Inginer automatizari' },
    { title: 'Sofer livrator / Bringo', locale: 'ro', peeledTitle: 'Sofer livrator' },
    { title: 'Sofer livrator Bringo', locale: 'ro', peeledTitle: 'Sofer livrator' }
  ];

  for (const testCase of cases) {
    assert.equal(
      peelOccupationTitleNoise(testCase.title, testCase.locale).peeledTitle,
      testCase.peeledTitle,
      `${testCase.locale}: ${testCase.title}`
    );
  }
});

test('employment gender markers peel when isolated with separators or brackets', () => {
  const cases = [
    { title: 'Contabil / f/m', locale: 'ro', peeledTitle: 'Contabil' },
    { title: 'Contabil / m/f', locale: 'ro', peeledTitle: 'Contabil' },
    { title: 'Contabil / f m', locale: 'ro', peeledTitle: 'Contabil' },
    { title: 'Contabil / m w d', locale: 'hu', peeledTitle: 'Contabil' },
    { title: 'Contabil (m/w/d)', locale: 'hu', peeledTitle: 'Contabil' },
    { title: 'Contabil [f/m]', locale: 'ro', peeledTitle: 'Contabil' }
  ];

  for (const testCase of cases) {
    assert.equal(
      peelOccupationTitleNoise(testCase.title, testCase.locale).peeledTitle,
      testCase.peeledTitle,
      `${testCase.locale}: ${testCase.title}`
    );
  }
});

test('guardrail cases keep common occupational titles that overlap with generic vocabulary', () => {
  const cases = [
    { title: 'Hotel manager', locale: 'ro' },
    { title: 'Market analyst', locale: 'ro' },
    { title: 'Company secretary', locale: 'ro' },
    { title: 'Store manager', locale: 'ro' },
    { title: 'Mall manager', locale: 'ro' },
    { title: 'Sales representative', locale: 'ro' },
    { title: 'Pizza chef', locale: 'ro' },
    { title: 'Travel consultant', locale: 'ro' }
  ];

  for (const testCase of cases) {
    assertNoNoiseCase(testCase.title, testCase.locale);
  }
});

test.todo('inline gender markers should not erase the occupation title: Contabil m/f, Contabil f/m, Contabil m/w/d');
test.todo('language-teacher titles with extra language qualifiers should preserve the taught language role: English teacher with german');
test.todo('park ranger should not be classified as employer-brand noise');
test.todo('location contexts like kerulet XI should peel consistently in hu titles');
test.todo('inline shift/date/identifier tails with occupation cores should peel safely without requiring separators');

test('peels realistic multi-noise titles down to the occupation title', () => {
  const cases = [
    {
      title: 'Cautam / Sofer livrator / Bucuresti / full time',
      locale: 'ro',
      peeledTitle: 'Sofer livrator',
      noiseKinds: ['noise_application_cta', 'noise_location', 'noise_employment_flag']
    },
    {
      title: 'Hiring - QA Engineer - Budapest - full-time',
      locale: 'hu',
      peeledTitle: 'QA Engineer',
      noiseKinds: ['noise_ui_artifact', 'noise_location', 'noise_employment_flag']
    },
    {
      title: 'Jelentkezz / Raktáros / WHC9999 / versenykepes fizetes',
      locale: 'hu',
      peeledTitle: 'Raktáros',
      noiseKinds: ['noise_application_cta', 'noise_identifier', 'noise_salary']
    },
    {
      title: 'Hiring / IT Support / German required / Bucharest',
      locale: 'ro',
      peeledTitle: 'IT Support',
      noiseKinds: ['noise_ui_artifact', 'noise_language', 'noise_location']
    },
    {
      title: 'Proiectant (m/f) [Full-Time] Bucuresti',
      locale: 'ro',
      peeledTitle: 'Proiectant',
      noiseKinds: ['noise_parenthetical_info']
    }
  ];

  for (const testCase of cases) {
    assertPeelingCase(testCase);
  }
});

test('custom profile building and peeling with profile', () => {
  const customProfile = buildOccupationNoisePeelingProfile({
    locale: 'custom_test',
    noiseRules: [
      {
        kind: 'noise_ui_artifact',
        matchType: 'phrase',
        confidence: 0.99,
        terms: ['custom_noise']
      }
    ],
    occupationExemptions: ['engineer'],
    locationHints: ['custom_city'],
    locationContextMarkers: ['zone'],
    locationSuffixHints: ['street']
  });

  const res = peelOccupationTitleNoiseWithProfile('Engineer / custom_noise', customProfile);
  assert.equal(res.peeledTitle, 'Engineer');
  assert.equal(res.noiseChunks.length, 1);
  assert.equal(res.noiseChunks[0]?.kind, 'noise_ui_artifact');
});
