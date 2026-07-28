import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { StoreFileError } from './errors.ts';

/**
 * Reads and validates a JSON file.
 *
 * Returns `undefined` when the file does not exist — absence is a first run,
 * not a failure. Anything else that goes wrong throws `StoreFileError`, so a
 * corrupt file is never silently treated as a fresh one.
 */
export function parseJsonFile<T>(file: string, schema: z.ZodType<T>): T | undefined {
  const contents = extractFileContents(file);

  if (!contents) {
    return undefined;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(contents);
  } catch (error) {
    throw new StoreFileError({
      file,
      reason: 'invalid-json',
      detail: 'file is not valid JSON',
      cause: error,
    });
  }

  const result = schema.safeParse(parsed);

  if (!result.success) {
    throw new StoreFileError({
      file,
      reason: 'invalid-shape',
      detail: z.prettifyError(result.error),
      cause: result.error,
    });
  }

  return result.data;
}

/**
 * Writes JSON by `rename`-ing a fully written temp file over the target, so a
 * crash leaves either the old file or the new one and never a half-written one.
 *
 * The temp file sits beside the target rather than in `os.tmpdir()`: `rename`
 * is atomic only within a single filesystem, and `/tmp` is routinely a
 * different one. The random suffix keeps concurrent processes off each other's
 * temp path.
 */
export function writeJsonFileAtomic(file: string, data: unknown): void {
  mkdirSync(dirname(file), { recursive: true });

  const tmp = `${file}.${randomUUID()}.tmp`;

  try {
    // Prettier's JSON style, so formatting a hand-edited file on save does not
    // produce a spurious diff against what the tool writes.
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    renameSync(tmp, file);
  } catch (error) {
    rmSync(tmp, { force: true });
    throw error;
  }
}

function extractFileContents(file: string): string | undefined {
  const isEnoentException = (error: unknown): error is NodeJS.ErrnoException =>
    error instanceof Error && 'code' in error && error.code === 'ENOENT';

  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (isEnoentException(error)) {
      return undefined;
    }
    throw error;
  }
}
