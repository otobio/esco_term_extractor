import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Absolute path to the package's bundled runtime artifacts directory.
 *
 * Resolved relative to this module (dist/runtime/…) rather than `process.cwd()`,
 * so the artifacts load the same whether the package is run from its own repo
 * root (its CLIs) or imported as a dependency from another workspace. Per-artifact
 * env overrides (OCCUPATION_*_ARTIFACT_PATH) still take precedence in each loader.
 */
export const DEFAULT_RUNTIME_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../artifacts/runtime');
