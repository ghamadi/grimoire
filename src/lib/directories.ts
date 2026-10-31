import { readdirSync } from 'node:fs';
import { getDirectoryAccess, tryStatSync } from '@/lib/fs';
import { join } from 'node:path';
import { InvalidPathError } from '@/lib/errors';

/** A directory grimoire can read but not write to still passes. */
export function assertUsableDirectory(path: string): void {
  if (getDirectoryAccess(path) === 'unreadable') {
    throw new InvalidPathError({ path, reason: 'unreadable' });
  }

  const status = tryStatSync(path);

  if (!status) {
    throw new InvalidPathError({ path, reason: 'missing' });
  }

  if (!status.isDirectory()) {
    throw new InvalidPathError({ path, reason: 'not-a-directory' });
  }
}

/**
 * @returns a flat list of all files in the directory and its subdirectories.
 * Empty subdirectories are included if the `includeEmptyDirectories` option is true (default).
 */
export function flattenDirectory(
  path: string,
  options?: { includeEmptyDirectories?: boolean },
): string[] {
  const { includeEmptyDirectories = true } = options ?? {};

  function recurse(_path: string, isRoot: boolean) {
    const entries = readdirSync(_path, { withFileTypes: true });

    const paths: string[] = [];

    if (!isRoot && !entries.length && includeEmptyDirectories) {
      return [_path]; // include empty subdirectories in the list
    }

    for (const entry of entries) {
      const entryPath = join(_path, entry.name);

      if (entry.isDirectory()) {
        paths.push(...recurse(entryPath, false));
      } else {
        paths.push(entryPath);
      }
    }

    return paths;
  }

  return recurse(path, true);
}
