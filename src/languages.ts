import type { SupportedLanguage } from './types.ts';

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = ['ro', 'en', 'hu', 'et', 'global'];

/**
 * Normalize a caller-supplied language filter.
 *
 * Returns `undefined` (meaning "consider every indexed language") when no filter
 * is given. When a filter IS given we always add `global`, because a set of
 * language-neutral canonical terms (e.g. `employment:full_time`, some workplace
 * types) is stored under the `global` code — scoping to `['ro','en']` must never
 * silently drop them. In practice callers pass a local language + `en`
 * (`['ro','en']`, `['hu','en']`, `['et','en']`).
 */
export function resolveLanguages(languages?: SupportedLanguage[]): SupportedLanguage[] | undefined {
  if (!languages?.length) return undefined;
  const set = new Set<SupportedLanguage>(languages);
  set.add('global');
  return [...set];
}
