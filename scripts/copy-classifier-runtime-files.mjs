import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

const mode = process.argv.includes('--tests') ? 'tests' : 'runtime';
const classifierRoot = mode === 'tests' ? path.join('dist', 'src', 'occupation-classifier') : path.join('dist', 'occupation-classifier');

await copyDirectory(
  path.join('src', 'occupation-classifier', 'specialization', 'specialization-schema'),
  path.join(classifierRoot, 'specialization', 'specialization-schema')
);
await copyFile(
  path.join('src', 'occupation-classifier', 'family-structure', 'family-structure-rules.tsv'),
  path.join(classifierRoot, 'family-structure', 'family-structure-rules.tsv')
);
await copyFile(
  path.join('src', 'occupation-classifier', 'family-structure', 'family-structure-bridges.tsv'),
  path.join(classifierRoot, 'family-structure', 'family-structure-bridges.tsv')
);

if (mode === 'tests') {
  await copyDirectory(
    path.join('tests', 'occupation-classifier', 'fixtures'),
    path.join('dist', 'tests', 'occupation-classifier', 'fixtures')
  );
}

async function copyDirectory(source, target) {
  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true, force: true });
}

async function copyFile(source, target) {
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target);
}
