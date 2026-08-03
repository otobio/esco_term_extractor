/**
 * Resolve profiles — input-specific pipelines over the shared matcher tools.
 *
 * `title` runs the full longest-match span scan (worth it for short,
 * bucket-dense titles). Other profiles (e.g. a lighter `description` path) can
 * be added here without touching the matcher or the default CLI behavior.
 */
export { parseDescriptionSections, resolveDescription } from './description.js';
export { resolveTitle } from './title.js';
import { resolveDescription } from './description.js';
import { resolveTitle } from './title.js';
/** Registry of available profiles by name. */
export const PROFILES = { title: resolveTitle, description: resolveDescription };
