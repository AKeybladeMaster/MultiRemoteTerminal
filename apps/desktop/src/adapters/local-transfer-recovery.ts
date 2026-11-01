import { lstat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

const OPERATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function localTransferPartialName(operationId: string): string | undefined {
  return OPERATION_ID.test(operationId) ? `.mrt-${operationId}.partial` : undefined;
}

export async function findLocalTransferPartial(directory: string, operationId: string): Promise<string | undefined> {
  const name = localTransferPartialName(operationId);
  if (!name || !isAbsolute(directory) || directory.includes('\0')) return undefined;
  const path = join(resolve(directory), name);
  try {
    const details = await lstat(path);
    return details.isFile() && !details.isSymbolicLink() ? path : undefined;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
}
