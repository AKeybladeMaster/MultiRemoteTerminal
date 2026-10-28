import { mkdir, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export async function createWorkspaceTempDirectory(prefix: string): Promise<string> {
  const root = resolve('.tmp');
  await mkdir(root, { recursive: true });
  return mkdtemp(join(root, prefix));
}
