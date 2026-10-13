import { describe, expect, it } from 'vitest';
import { inferFiniteBucket } from '../src/inference/index.ts';
import { finalizeFinite } from '../src/matchers/finite.ts';
import type { Clause } from '../src/tokenizer.ts';

const CATEGORY_JOB_FUNCTIONS: [string, string[]][] = [
  ['Assisting / Administration', ['administration']],
  ['Construction / Real Estate', ['skilled_trades']],
  ['Electronics / Telecommunication', ['mechanical_technical']],
  ['Energetics / Natural resources', ['mining_natural_resources']],
  ['Finance', ['finance_accounting']],
  ['Media / New media / Creative', ['marketing_communications', 'arts_entertainment']],
  ['Information Technology', ['it_software_data']],
  ['Management', ['management']],
  ['Human Resources / Training', ['education_training', 'human_resources']],
  ['Culture / Entertainment / Recreation', ['arts_entertainment']],
  ['Agriculture / Forestry / Fishing', ['skilled_trades']],
  ['Mechanics / Engineering', ['mechanical_technical']],
  ['Sales / Retail', ['sales_commerce']],
  ['Security', ['security']],
  ['Public / Governmental Service', ['administration']],
  ['Customer Service', ['customer_support']],
  ['Health Care / Social work ', ['healthcare', 'community_social_services']],
  ['Catering', ['hospitality_food_service']],
  ['Transportation / Logistics', ['transport_driving', 'operations_logistics']],
  ['Tourism / Hotels', ['hospitality_food_service']],
  ['Marketing / Advertising / PR', ['marketing_communications']],
  ['Manufacturing / Production', ['skilled_trades']],
  ['Education / Science / Research', ['education_training', 'research_development']],
  ['Work at sea', ['transport_driving']],
  ['Law', ['legal_compliance']],
  ['Voluntary work', ['volunteering_internships']],
  ['Banking / Insurance', ['banking', 'insurance']],
];

const clause = (text: string): Clause[] => [{ text, source: 'text' }];

describe('category labels resolve to job_function', () => {
  it.each(CATEGORY_JOB_FUNCTIONS)('%s', (label, functions) => {
    const keys = inferFiniteBucket('job_function', clause(label), ['en']).map((t) => t.canonicalKey);
    expect(keys.sort()).toEqual(functions.map((f) => `job_function:${f}`).sort());
  });
});

const LOCALES = [undefined, 'en', 'ro', 'hu', 'et', 'lv', 'lt', 'ng', 'xx'] as const;

describe('English source-system labels resolve on every locale', () => {
  it.each(CATEGORY_JOB_FUNCTIONS.flatMap(([label, fns]) => LOCALES.map((l) => [label, l, fns] as const)))(
    '%s [%s]',
    (label, locale, functions) => {
      const keys = finalizeFinite('job_function', [], [{ text: label, source: 'structured' }], { locale, titleMode: true }).map(
        (t) => t.key,
      );
      expect(keys.sort()).toEqual(functions.map((f) => `job_function:${f}`).sort());
    },
  );
});

const JOB_LEVELS: [string, string[]][] = [
  ['Office Worker / Specialist', ['mid_level']],
  ['Skilled Worker / Professional', ['mid_level']],
  ['Service & Sales Representative', ['entry_level']],
  ['Midlevel Manager / Senior Specialist', ['manager', 'mid_level', 'senior']],
  ['Auxiliary Worker', ['entry_level']],
  ['Senior Manager / Director', ['director', 'manager', 'senior']],
];

describe('job level labels resolve on every locale', () => {
  it.each(JOB_LEVELS.flatMap(([label, levels]) => LOCALES.map((l) => [label, l, levels] as const)))(
    '%s [%s]',
    (label, locale, levels) => {
      const keys = finalizeFinite('level', [], [{ text: label, source: 'structured' }], { locale, titleMode: true }).map(
        (t) => t.key,
      );
      expect(keys.sort()).toEqual(levels.map((l) => `level:${l}`).sort());
    },
  );

  it('abstains on null and unrelated text', () => {
    for (const text of ['null', 'Other']) {
      expect(finalizeFinite('level', [], [{ text, source: 'structured' }], { locale: 'en', titleMode: true })).toEqual([]);
    }
  });
});
