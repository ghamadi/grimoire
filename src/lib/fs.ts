import { statSync, type Stats } from 'node:fs';
import { InvalidPathError } from '#src/lib/errors/index';

/**
 * What sits at `path`, or `undefined` when nothing does.
 *
 * `throwIfNoEntry: false` answers `undefined` for a path that is missing *and*
 * for one buried under a file, so both arrive here as the same nothing. A
 * symlink cycle is the one unusable path it cannot answer that way: `stat`
 * follows links, so it raises ELOOP instead of returning, and every caller of a
 * plain `statSync` is a place a raw errno escapes as a crash.
 *
 * Translated rather than swallowed as `undefined`: a cycle is visible in
 * `ls -l`, so reporting it as a path that does not exist sends the reader
 * looking for a directory instead of at the link they have to repoint.
 */
export function tryStatSync(path: string): Stats | undefined {
  try {
    return statSync(path, { throwIfNoEntry: false });
  } catch (error) {
    if (isErrnoException(error, 'ELOOP')) {
      throw new InvalidPathError({ path, reason: 'unresolvable' });
    }

    throw error;
  }
}

export function isErrnoException(
  error: unknown,
  code: 'ENOENT' | 'ENOTDIR' | 'ELOOP',
): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}

export function isEnoentException(error: unknown): error is NodeJS.ErrnoException {
  return isErrnoException(error, 'ENOENT');
}
