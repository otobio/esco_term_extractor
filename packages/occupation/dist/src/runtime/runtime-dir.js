import path from 'node:path';
import { fileURLToPath } from 'node:url';
function resolvePackageRootFromCompiledModule() {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    while (path.basename(dir) !== 'dist') {
        const parent = path.dirname(dir);
        if (parent === dir) {
            throw new Error(`Could not locate package root: no 'dist' ancestor found above ${dir}`);
        }
        dir = parent;
    }
    return path.dirname(dir);
}
/**
 * Absolute path to the package's bundled runtime artifacts directory.
 *
 * Resolved relative to this module's nearest `dist/` ancestor rather than
 * `process.cwd()`, so the artifacts load the same whether the package is run
 * from its own repo root (its CLIs), imported as a dependency from another
 * workspace, or compiled into a nested output directory (e.g. the tests build's
 * dist/src/…). Per-artifact env overrides (OCCUPATION_*_ARTIFACT_PATH) still take
 * precedence in each loader. OCCUPATION_RUNTIME_DIR points all default runtime
 * artifact lookups at a shared deployment location such as a Lambda layer.
 */
export const DEFAULT_RUNTIME_DIR = process.env.OCCUPATION_RUNTIME_DIR?.trim() || path.resolve(resolvePackageRootFromCompiledModule(), 'artifacts/runtime');
