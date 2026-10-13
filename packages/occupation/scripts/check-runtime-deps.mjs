#!/usr/bin/env node
// Guard-rail: every third-party module reachable at runtime from the package entry point must be
// declared in `dependencies`. Consumers install this package without its devDependencies, so an
// import that only a devDependency provides fails at load time in their environment.
import { existsSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MODULE_SPECIFIER = /^[\w@./-]+$/;
const IMPORT_SPECIFIER =
  /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;

const manifest = JSON.parse(readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
const declared = new Set(Object.keys(manifest.dependencies ?? {}));

const packageName = (specifier) =>
  specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0];

const isThirdParty = (specifier) =>
  !specifier.startsWith('.') && !specifier.startsWith('node:') && !builtinModules.includes(packageName(specifier));

function collectThirdPartyImports(entries) {
  const visited = new Set();
  const found = new Map();
  const pending = [...entries];
  while (pending.length > 0) {
    const file = pending.pop();
    if (visited.has(file) || !file.endsWith('.js') || !existsSync(file)) continue;
    visited.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(IMPORT_SPECIFIER)) {
      const specifier = match[1] ?? match[2] ?? match[3];
      if (!MODULE_SPECIFIER.test(specifier)) continue;
      if (specifier.startsWith('.')) pending.push(path.resolve(path.dirname(file), specifier));
      else if (isThirdParty(specifier) && !found.has(packageName(specifier))) {
        found.set(packageName(specifier), path.relative(REPO_ROOT, file));
      }
    }
  }
  return found;
}

const entries = Object.values(manifest.exports ?? {}).map((target) => path.resolve(REPO_ROOT, target.import));
const undeclared = [...collectThirdPartyImports(entries)].filter(([name]) => !declared.has(name));

if (undeclared.length > 0) {
  console.error('Runtime imports missing from package.json "dependencies":');
  for (const [name, importedBy] of undeclared) console.error(`  ${name} (imported by ${importedBy})`);
  process.exit(1);
}
console.log('check-runtime-deps: all runtime third-party imports are declared in dependencies');
