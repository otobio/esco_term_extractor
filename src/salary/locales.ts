/**
 * Per-locale lexicons for salary parsing. Period / tax / cue / exclude words are
 * single-language per block (never mixed in one regex). Currency identifiers and
 * amount/range syntax are language-neutral (handled in salary.ts).
 */
import type { SalaryPeriod as Period, SupportedLanguage } from '../types.ts';

export type { Period };

export interface SalaryLocale {
  language: SupportedLanguage;
  period: Record<Period, string[]>;
  gross: string[];
  net: string[];
  /** words that indicate the number IS pay (used to admit amounts without a currency). */
  cue: string[];
  /** contexts that mean the money is NOT salary (turnover, benefits, counts). */
  exclude: string[];
  /** ["between","and"]-style range framings for this language. */
  rangePairs: [string, string][];
}

const EN: SalaryLocale = {
  language: 'en',
  period: {
    hour: ['hour', 'hourly', 'hr', 'per hour'],
    day: ['day', 'daily', 'per day'],
    week: ['week', 'weekly', 'per week'],
    month: ['month', 'monthly', 'per month', 'mo'],
    year: ['year', 'yearly', 'annual', 'annually', 'per year', 'per annum', 'pa'],
  },
  gross: ['gross', 'pre-tax', 'before tax'],
  net: ['net', 'take home', 'take-home', 'after tax', 'in hand'],
  cue: ['salary', 'salaries', 'wage', 'wages', 'pay', 'compensation', 'remuneration', 'package', 'earn'],
  exclude: [
    'turnover',
    'revenue',
    'invested',
    'investment',
    'valuation',
    'funding',
    'raised',
    'clients',
    'customers',
    'stores',
    'employees',
    'users',
    'cities',
  ],
  rangePairs: [
    ['between', 'and'],
    ['from', 'to'],
  ],
};

const RO: SalaryLocale = {
  language: 'ro',
  period: {
    hour: ['ora', 'ore', 'orar', 'pe ora'],
    day: ['zi', 'pe zi', 'zilnic'],
    week: ['saptamana', 'saptamanal', 'pe saptamana'],
    month: ['luna', 'lunar', 'lunare', 'pe luna'],
    year: ['an', 'anual', 'pe an'],
  },
  gross: ['brut', 'brutto'],
  net: ['net', 'neto', 'in mana'],
  cue: ['salariu', 'salariul', 'salarial', 'salariala', 'remuneratie', 'remuneratia', 'pachet salarial', 'venit'],
  exclude: [
    'cifra de afaceri',
    'afaceri',
    'investit',
    'investitie',
    'investitii',
    'milioane',
    'miliarde',
    'magazine',
    'orase',
    'clienti',
    'angajati',
    'vouchere',
    'voucher',
    'tichete',
    'bonuri',
    'decont',
  ],
  rangePairs: [
    ['de la', 'la'],
    ['intre', 'si'],
  ],
};

const HU: SalaryLocale = {
  language: 'hu',
  period: {
    hour: ['ora', 'oras', 'oraban', 'orankent'],
    day: ['nap', 'napi', 'naponta'],
    week: ['het', 'heti', 'hetente'],
    month: ['havi', 'honap', 'ho', 'havonta'],
    year: ['ev', 'evi', 'evente'],
  },
  gross: ['brutto'],
  net: ['netto'],
  cue: ['fizetes', 'fizetesi', 'ber', 'berezes', 'javadalmazas'],
  exclude: ['forgalom', 'arbevetel', 'befektet', 'millio', 'milliard', 'ugyfel', 'uzlet', 'alkalmazott'],
  rangePairs: [],
};

const ET: SalaryLocale = {
  language: 'et',
  period: {
    hour: ['tunnis', 'tund', 'tunni'],
    day: ['paevas', 'paev'],
    week: ['nadalas', 'nadal'],
    month: ['kuus', 'kuu', 'kuis'],
    year: ['aastas', 'aastane', 'aasta'],
  },
  gross: ['bruto', 'brutopalk'],
  net: ['neto', 'netopalk', 'kattesaadav'],
  cue: ['palk', 'palga', 'tasu', 'tootasu'],
  exclude: ['kaive', 'investeer', 'miljon', 'klient', 'tootaja', 'kauplus'],
  rangePairs: [],
};

export const SALARY_LOCALES: readonly SalaryLocale[] = [EN, RO, HU, ET];
