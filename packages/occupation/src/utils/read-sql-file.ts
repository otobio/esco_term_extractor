import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, '..', '..');

export async function readSqlFile(relativePath: string): Promise<string> {
  const absolutePath = path.resolve(repoRoot, relativePath);
  return readFile(absolutePath, 'utf8');
}
