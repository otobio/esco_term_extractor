import path from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Absolute path to the package's bundled runtime artifacts directory.
 *
 * Resolved relative to this module (dist/runtime/…) rather than `process.cwd()`,
 * so the artifacts load the same whether the package is run from its own repo
 * root (its CLIs) or imported as a dependency from another workspace. Per-artifact
 * env overrides (OCCUPATION_*_ARTIFACT_PATH) still take precedence in each loader.
 * OCCUPATION_RUNTIME_DIR points all default runtime artifact lookups at a shared
 * deployment location such as a Lambda layer.
 */
export const DEFAULT_RUNTIME_DIR = process.env.OCCUPATION_RUNTIME_DIR?.trim() ||
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../artifacts/runtime');
