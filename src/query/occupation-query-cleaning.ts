import { normalizeSearchSurfaceText } from '../utils/texts.js';
import { peelOccupationTitleNoise } from './occupation-noise-peeling.js';
import { cleanOccupationTitleSignals } from './occupation-signal-oov-cleaner.js';

const DEFAULT_SOURCE_NAME = 'esco_1_2_1';

export async function cleanOccupationQuerySurface(value: string, locale: string | undefined): Promise<string> {
  const normalizedLocale = normalizeOccupationQueryLocale(locale);
  const rawSurface = normalizeSearchSurfaceText(value);

  if (!rawSurface) {
    return '';
  }

  const peeledSurface = peelOccupationTitleNoise(rawSurface, normalizedLocale);

  if (!peeledSurface) {
    return '';
  }

  const cleanedSurface = await cleanOccupationTitleSignals({
    sourceName: DEFAULT_SOURCE_NAME,
    locale: normalizedLocale,
    title: peeledSurface
  });

  return normalizeSearchSurfaceText(cleanedSurface || peeledSurface);
}

function normalizeOccupationQueryLocale(locale: string | undefined): string {
  const normalized = String(locale ?? '')
    .trim()
    .toLowerCase();
  return normalized || 'unknown';
}
