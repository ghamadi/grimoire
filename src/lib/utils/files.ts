import { randomUUID } from 'crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { isErrnoException } from '#src/lib/fs';

function extractFileContents(file: string): string | undefined {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (isErrnoException(error, 'ENOENT')) {
      return undefined;
    }
    throw error;
  }
}

export function extractJsonContent(file: string): unknown {
  const contents = extractFileContents(file);
  if (contents === undefined) {
    return undefined;
  }
  return JSON.parse(contents);
}

/**
 * Writes a file by `rename`-ing a fully written temp file over the target, so a
 * crash leaves either the old file or the new one and never a half-written one.
 *
 * The temp file sits beside the target `rename`. The random suffix keeps concurrent
 * processes off each other's temp path.
 */
export function writeAtomic(path: string, data: string): void {
  mkdirSync(dirname(path), { recursive: true });

  const tmp = `${path}.${randomUUID()}.tmp`;

  try {
    writeFileSync(tmp, data, 'utf8');
    renameSync(tmp, path);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}
