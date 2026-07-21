/**
 * Absolute path to the package's bundled runtime artifacts directory.
 *
 * Resolved relative to this module (dist/runtime/…) rather than `process.cwd()`,
 * so the artifacts load the same whether the package is run from its own repo
 * root (its CLIs) or imported as a dependency from another workspace. Per-artifact
 * env overrides (OCCUPATION_*_ARTIFACT_PATH) still take precedence in each loader.
 */
export declare const DEFAULT_RUNTIME_DIR: string;
