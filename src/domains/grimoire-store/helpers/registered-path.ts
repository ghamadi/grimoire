import { lstatSync, mkdirSync, type Stats } from 'node:fs';
import { InvalidPathError } from '@/lib/errors';
import { isErrnoException } from '@/lib/fs';
import { normalizePath } from '@/lib/paths';
import { dirname, isAbsolute, sep } from 'node:path';

export type RegisteredPathParams = {
  /**
   * The path to register.
   */
  path: string;

  /**
   * Fills in the path's final segment when nothing is there — one segment,
   * never recursive, so a typo in the parent surfaces as a refusal naming the
   * parent rather than materializing a tree.
   */
  createIfMissing?: boolean;
};

export type RegisteredPath = {
  path: string;
  created: boolean;
};

/**
 * Checks if a path can be registered in the store as a repo or a workspace.
 */
export function canBeRegistered(path: string): boolean {
  return isAbsolute(path) || path === '~' || path.startsWith(`~${sep}`);
}

/**
 * The path a registration may carry, normalized, or the refusal it earns.
 * A symlink is refused rather than followed.
 *
 * With `createIfMissing`, this is the caller's **last** step: it writes to disk, and
 * everything a registration can refuse over has to have refused while the
 * directory still did not exist.
 */
export function toRegisteredPath(params: RegisteredPathParams): RegisteredPath {
  const { createIfMissing: create = false } = params;

  if (!canBeRegistered(params.path)) {
    throw new InvalidPathError({ path: params.path, reason: 'not-absolute' });
  }

  const path = normalizePath(params.path);
  const fileStatus = statusOf(path);

  if (!fileStatus) {
    if (!create) {
      throw new InvalidPathError({ path, reason: 'missing' });
    }

    createFinalSegment(path);

    return { path, created: true };
  }

  if (fileStatus.isSymbolicLink()) {
    throw new InvalidPathError({ path, reason: 'symlink' });
  }

  if (!fileStatus.isDirectory()) {
    throw new InvalidPathError({ path, reason: 'not-a-directory' });
  }

  return { path, created: false };
}

// ----------------------------------------------------------------------------
// INTERNAL HELPERS
// ----------------------------------------------------------------------------

/**
 * What holds the path, or `undefined` when nothing does.
 *
 * `lstat`, so a dangling symlink counts as holding it: `stat` reports nothing
 * there and leaves the creation below to fail on the link.
 */
function statusOf(path: string): Stats | undefined {
  try {
    return lstatSync(path, { throwIfNoEntry: false });
  } catch (error) {
    refuseUnusableParent(error, path);
  }
}

/**
 * Creates only the final segment of the path as a directory.
 * Assumes the parent is a directory, and the final segment does not yet exist.
 *
 * @throws InvalidPathError if the parent is not a directory
 * @throws Error if the directory cannot be created
 */
function createFinalSegment(path: string): void {
  try {
    mkdirSync(path);
  } catch (error) {
    refuseUnusableParent(error, path);
  }
}

/**
 * Translates the two errnos that mean the parent cannot hold a directory,
 * and throws the input error as-is for anything else.
 */
function refuseUnusableParent(error: unknown, path: string): never {
  if (isErrnoException(error, 'ENOENT')) {
    throw new InvalidPathError({ path: dirname(path), reason: 'missing' });
  }

  if (isErrnoException(error, 'ENOTDIR')) {
    throw new InvalidPathError({ path: dirname(path), reason: 'not-a-directory' });
  }

  throw error; // surface any other unexpected error
}
