/**
 * Per-locale numeric lexicons for the inference layer. Each locale owns its own
 * unit / cue words so the numeric parsers build ONE single-language regex per
 * locale (never a mixed-language alternation). Adding a locale is one block.
 */
import type { SupportedLanguage } from '../types.js';

export interface Locale {
  language: SupportedLanguage;
  /** hour unit words (h, ore, óra→ora, tundi). */
  hour: string[];
  /** "week" words. */
  week: string[];
  /** "day" words. */
  day: string[];
  /** connective glue between number and period ("per", "pe", "/"). */
  connect: string[];
  /** "year(s)" words. */
  years: string[];
  /** "experience" words. */
  experience: string[];
  /** minimum qualifiers ("minim", "at least", "peste"). */
  minimum: string[];
  /** words that signal a clock time-range is a work schedule. */
  scheduleCue: string[];
}

const EN: Locale = {
  language: 'en',
  hour: ['h', 'hr', 'hrs', 'hour', 'hours'],
  week: ['week', 'weekly'],
  day: ['day', 'daily'],
  connect: ['per', 'of', 'a'],
  years: ['year', 'years', 'yr', 'yrs'],
  experience: ['experience'],
  minimum: ['minimum', 'min', 'at least', 'over', 'more than'],
  scheduleCue: ['program', 'schedule', 'hours', 'shift', 'between', 'monday', 'mon', 'friday', 'fri'],
};

const RO: Locale = {
  language: 'ro',
  hour: ['h', 'ora', 'ore'],
  week: ['saptamana', 'saptamanal', 'sapt'],
  day: ['zi', 'zilnic'],
  connect: ['pe', 'la', 'de'],
  years: ['an', 'ani'],
  experience: ['experienta', 'experient'],
  minimum: ['minim', 'peste', 'cel putin', 'de minim'],
  scheduleCue: ['program', 'orar', 'tura', 'ture', 'schimb', 'schimburi', 'luni', 'vineri', 'intre', 'ora'],
};

const HU: Locale = {
  language: 'hu',
  hour: ['h', 'ora', 'oras'],
  week: ['het', 'heti'],
  day: ['nap', 'napi'],
  connect: ['ora', 'egy'],
  years: ['ev', 'eve', 'evet'],
  experience: ['tapasztalat'],
  minimum: ['legalabb', 'minimum', 'min'],
  scheduleCue: ['munkaido', 'muszak', 'hetfo', 'pentek'],
};

const ET: Locale = {
  language: 'et',
  hour: ['h', 'tund', 'tundi'],
  week: ['nadal', 'nadalas'],
  day: ['paev', 'paevas'],
  connect: ['kohta'],
  years: ['aasta', 'aastat'],
  experience: ['kogemus'],
  minimum: ['vahemalt', 'min'],
  scheduleCue: ['tooaeg', 'vahetus', 'graafik'],
};

const LV: Locale = {
  language: 'lv',
  hour: ['h', 'st', 'stunda', 'stundas', 'stundu'],
  week: ['nedela', 'nedelas', 'nedelu'],
  day: ['diena', 'dienas', 'dienu'],
  connect: ['par'],
  years: ['gads', 'gadi', 'gadu', 'gadus', 'gadiem'],
  experience: ['pieredze', 'pieredzi', 'pieredzes'],
  minimum: ['vismaz', 'min', 'ne mazak ka'],
  scheduleCue: ['darba laiks', 'grafiks', 'maina', 'mainas', 'pirmdiena', 'piektdiena'],
};

const LT: Locale = {
  language: 'lt',
  hour: ['h', 'val', 'valanda', 'valandos', 'valandu'],
  week: ['savaite', 'savaitei', 'savaites'],
  day: ['diena', 'dienai', 'dienos'],
  connect: ['per'],
  years: ['metai', 'metu', 'metus'],
  experience: ['patirtis', 'patirties', 'patirti'],
  minimum: ['ne maziau kaip', 'bent', 'min', 'maziausiai'],
  scheduleCue: ['darbo laikas', 'grafikas', 'pamaina', 'pamainos', 'pirmadieni', 'penktadieni'],
};

export const LOCALES: readonly Locale[] = [EN, RO, HU, ET, LV, LT];

/** A non-capturing alternation of literal words. */
export function alt(words: string[]): string {
  return `(?:${words.join('|')})`;
}
