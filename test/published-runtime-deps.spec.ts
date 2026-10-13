/**
 * Guards the published surface: consumers install this package only, so nested
 * workspace packages (packages/*) get no dependency installation of their own.
 * Every third-party module reachable at runtime from a published entry point
 * must therefore be declared in the root `dependencies`.
 */
import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '..');
const MODULE_SPECIFIER = /^[\w@./-]+$/;
const IMPORT_SPECIFIER =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

interface PackageManifest {
  dependencies?: Record<string, string>;
  exports?: Record<string, { import?: string }>;
  main?: string;
}

const readManifest = (dir: string): PackageManifest => JSON.parse(readFileSync(resolve(dir, 'package.json'), 'utf8'));

const packageName = (specifier: string): string =>
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];

const isThirdParty = (specifier: string): boolean =>
  !specifier.startsWith('.') && !specifier.startsWith('node:') && !builtinModules.includes(packageName(specifier));

function entryPoints(packageDir: string): string[] {
  const manifest = readManifest(packageDir);
  const exported = Object.values(manifest.exports ?? {}).map((target) => target.import);
  return [...exported, manifest.main]
    .filter((entry): entry is string => Boolean(entry))
    .map((entry) => resolve(packageDir, entry));
}

function collectRuntimeImports(entries: string[]): Map<string, string> {
  const visited = new Set<string>();
  const thirdParty = new Map<string, string>();
  const pending = [...entries];

  while (pending.length > 0) {
    const file = pending.pop() as string;
    if (visited.has(file) || !file.endsWith('.js') || !existsSync(file)) continue;
    visited.add(file);

    for (const match of readFileSync(file, 'utf8').matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!MODULE_SPECIFIER.test(specifier)) continue;
      if (specifier.startsWith('.')) pending.push(resolve(dirname(file), specifier));
      else if (isThirdParty(specifier) && !thirdParty.has(packageName(specifier))) {
        thirdParty.set(packageName(specifier), file.replace(`${ROOT}/`, ''));
      }
    }
  }
  return thirdParty;
}

function workspacePackageDirs(): string[] {
  const dependencies = readManifest(ROOT).dependencies ?? {};
  return Object.values(dependencies)
    .filter((spec) => spec.startsWith('file:'))
    .map((spec) => resolve(ROOT, spec.slice('file:'.length)));
}

describe('published runtime dependencies', () => {
  const rootDependencies = new Set(Object.keys(readManifest(ROOT).dependencies ?? {}));
  const workspaceNames = new Set(
    workspacePackageDirs().map((dir) => (readManifest(dir) as { name?: string }).name as string),
  );

  it('declares every third-party module reachable from published entry points', () => {
    const entries = [ROOT, ...workspacePackageDirs()].flatMap(entryPoints);
    const undeclared = [...collectRuntimeImports(entries)]
      .filter(([name]) => !rootDependencies.has(name) && !workspaceNames.has(name))
      .map(([name, importedBy]) => `${name} (imported by ${importedBy})`);
    expect(undeclared).toEqual([]);
  });

  it('keeps nested workspace dependencies in sync with the root manifest', () => {
    const missing = workspacePackageDirs().flatMap((dir) =>
      Object.keys(readManifest(dir).dependencies ?? {})
        .filter((name) => !rootDependencies.has(name) && !workspaceNames.has(name))
        .map((name) => `${name} (declared by ${dir.replace(`${ROOT}/`, '')})`),
    );
    expect(missing).toEqual([]);
  });
});
