import { cpSync, renameSync, rmSync, statSync, type Stats } from 'node:fs';
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

/**
 * Whether `path` is a directory an operation can act in.
 *
 * Every way a path can fail to be one answers `false`: nothing is there, a file
 * sits above it in the path, or it is a symlink cycle. The cycle is the reason
 * for the catch — `tryStatSync` translates ELOOP rather than returning, and a
 * caller asking this question has already decided an unusable path is not one
 * it acts in.
 */
export function isResolvableDirectory(path: string): boolean {
  try {
    return !!tryStatSync(path)?.isDirectory();
  } catch (error) {
    if (error instanceof InvalidPathError) {
      return false;
    }

    throw error;
  }
}

/**
 * Copies a tree as it is: symlinks stay symlinks with their targets unrewritten,
 * and an occupied destination is refused rather than merged into.
 */
export function copyTree(params: { from: string; to: string }): void {
  cpSync(params.from, params.to, {
    recursive: true,
    errorOnExist: true,
    force: false,
    verbatimSymlinks: true,
    preserveTimestamps: true,
  });
}

/** Moves a path, falling back to copy-then-remove when `rename` answers EXDEV. */
export function movePath(params: { from: string; to: string }): void {
  const { from, to } = params;

  try {
    renameSync(from, to);
  } catch (error) {
    if (!isErrnoException(error, 'EXDEV')) {
      throw error;
    }

    copyTree({ from, to });
    rmSync(from, { recursive: true, force: true });
  }
}

export function isErrnoException(
  error: unknown,
  code: 'ENOENT' | 'ENOTDIR' | 'ELOOP' | 'EXDEV',
): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code;
}
