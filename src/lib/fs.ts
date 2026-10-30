import { randomUUID } from 'node:crypto';
import {
  accessSync,
  constants,
  cpSync,
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { basename, join } from 'node:path';
import { InvalidPathError } from '@/lib/errors';

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

/** How far grimoire can get into a directory. */
export type DirectoryAccess = 'accessible' | 'unresolvable' | 'unreadable';

/**
 * How far grimoire can get into the directory at `path`.
 *
 * - `unresolvable`: nothing is there, it is a file, a file sits above it in the
 *   path, or it is a symlink cycle. The cycle is the reason for the catch:
 *   `tryStatSync` translates ELOOP rather than returning.
 * - `unreadable`: the directory cannot be listed or entered, or an ancestor
 *   cannot be entered. EACCES and EPERM arrive from `stat` when it is the
 *   ancestor, and from `access` when it is the directory itself.
 * - `accessible`: read lets a caller list it, and search lets it work on the
 *   entries inside.
 */
export function getDirectoryAccess(path: string): DirectoryAccess {
  try {
    if (!tryStatSync(path)?.isDirectory()) {
      return 'unresolvable';
    }

    accessSync(path, constants.R_OK | constants.X_OK);

    return 'accessible';
  } catch (error) {
    if (error instanceof InvalidPathError) {
      return 'unresolvable';
    }

    if (isErrnoException(error, 'EACCES') || isErrnoException(error, 'EPERM')) {
      return 'unreadable';
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

/** With no `code`, answers whether `error` is any errno error: an `Error` carrying a string `code`. */
export function isErrnoException(
  error: unknown,
  code?: 'ENOENT' | 'ENOTDIR' | 'ELOOP' | 'EXDEV' | 'EACCES' | 'EPERM' | 'ENOTEMPTY',
): error is NodeJS.ErrnoException {
  if (!(error instanceof Error) || !('code' in error)) {
    return false;
  }

  return code === undefined ? typeof error.code === 'string' : error.code === code;
}

/** Stricter than `isErrnoException`, which also accepts Node's own `ERR_*` errors: those are bugs. */
export function isSystemError(error: unknown): error is NodeJS.ErrnoException {
  return isErrnoException(error) && error.syscall !== undefined;
}

// -----------------------------------------------------------------------------
// STAGED WRITES
// -----------------------------------------------------------------------------

export const STAGING_DIRECTORY_NAME = '.grimoire-staging';

export type StagedTreeWrite = {
  from: string;
  /** May hold nothing, a symlink, or a directory. Replaced whole. */
  to: string;
  /** Must share a filesystem with `to`. Created when missing, removed when left empty. */
  stagingDirectory: string;
};

export type StagedTreeWriteResult =
  /** `strandedOldEntry` is set when the swap held but deleting the old entry failed: it is partly deleted. */
  | { kind: 'written'; strandedOldEntry?: { path: string; error: NodeJS.ErrnoException } }
  | { kind: 'failed'; error: NodeJS.ErrnoException | InvalidPathError };

/**
 * Replaces whatever is at `to` with a copy of `from`, so that `to` only ever
 * holds the whole old entry or the whole new copy.
 *
 * The copy is built in `stagingDirectory`, the old entry is renamed aside
 * rather than deleted, and the copy is renamed into place. A recursive delete
 * can fail halfway; a rename cannot, and can be undone.
 *
 * Filesystem failures (errno errors and an unusable `stagingDirectory`) are
 * returned as `failed`. Anything else is a bug and is rethrown.
 */
export function writeTreeStaged(params: StagedTreeWrite): StagedTreeWriteResult {
  const { from, to, stagingDirectory } = params;

  const id = randomUUID();
  const incomingTempContainer = join(stagingDirectory, `${basename(to)}.${id}.incoming`);
  const disposableTempContainer = join(stagingDirectory, `${basename(to)}.${id}.outgoing`);

  try {
    ensureStagingDirectory(stagingDirectory);
    copyTree({ from, to: incomingTempContainer });

    // If the destination is occupied, back it up to `.outgoing`.
    const hasOccupant = lstatSync(to, { throwIfNoEntry: false }) !== undefined;
    if (hasOccupant) {
      renameSync(to, disposableTempContainer);
    }

    try {
      // Move the new copy into place.
      renameSync(incomingTempContainer, to);
    } catch (error) {
      // If the move failed, restore the old entry if it was backed up.
      if (hasOccupant) {
        ignoreErrors(() => renameSync(disposableTempContainer, to));
      }

      throw error;
    }
  } catch (error) {
    ignoreErrors(() => rmSync(incomingTempContainer, { recursive: true, force: true }));
    removeIfEmpty(stagingDirectory);

    if (error instanceof InvalidPathError || isErrnoException(error)) {
      return { kind: 'failed', error };
    }

    throw error;
  }

  let result: StagedTreeWriteResult = { kind: 'written' };

  try {
    rmSync(disposableTempContainer, { recursive: true, force: true });
  } catch (error) {
    if (!isErrnoException(error)) {
      throw error;
    }

    result = { kind: 'written', strandedOldEntry: { path: disposableTempContainer, error } };
  }

  removeIfEmpty(stagingDirectory);

  return result;
}

export type StagedFileWrite = {
  getContents: () => Uint8Array;
  to: string;
  /** Must share a filesystem with `to`. */
  stagingDirectory: string;
};

export type StagedFileWriteResult =
  { kind: 'written' } | { kind: 'failed'; error: NodeJS.ErrnoException | InvalidPathError };

/**
 * Writes a file at `to` through `stagingDirectory`, so `to` never holds part of it.
 *
 * Filesystem failures, including one raised by `getContents`, are returned as
 * `failed`. Anything else is a bug and is rethrown.
 */
export function writeFileStaged(params: StagedFileWrite): StagedFileWriteResult {
  const { getContents, to, stagingDirectory } = params;

  const incomingFile = join(stagingDirectory, `${basename(to)}.${randomUUID()}.incoming`);

  try {
    ensureStagingDirectory(stagingDirectory);
    writeFileSync(incomingFile, getContents());
    renameSync(incomingFile, to);
  } catch (error) {
    ignoreErrors(() => rmSync(incomingFile, { force: true }));
    removeIfEmpty(stagingDirectory);

    if (error instanceof InvalidPathError || isErrnoException(error)) {
      return { kind: 'failed', error };
    }

    throw error;
  }

  removeIfEmpty(stagingDirectory);

  return { kind: 'written' };
}

// -----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// -----------------------------------------------------------------------------

/**
 * Creates `path` when missing. A symlink to a directory is refused like a
 * file: writing through it stages somewhere else.
 */
function ensureStagingDirectory(path: string): void {
  const stats = lstatSync(path, { throwIfNoEntry: false });

  if (stats !== undefined && !stats.isDirectory()) {
    throw new InvalidPathError({ path, reason: 'not-a-directory' });
  }

  mkdirSync(path, { recursive: true });
}

/** Best-effort: a staging directory left behind is clutter, never a failed write. */
function removeIfEmpty(directory: string): void {
  ignoreErrors(() => rmdirSync(directory));
}

function ignoreErrors(action: () => void): void {
  try {
    action();
  } catch {
    // Cleanup must not replace the error that caused it.
  }
}
