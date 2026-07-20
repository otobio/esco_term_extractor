const EN = {
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
const RO = {
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
const HU = {
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
const ET = {
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
export const LOCALES = [EN, RO, HU, ET];
/** A non-capturing alternation of literal words. */
export function alt(words) {
    return `(?:${words.join('|')})`;
}
