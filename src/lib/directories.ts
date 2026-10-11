import { readdirSync } from 'node:fs';
import { tryStatSync } from '@/lib/fs';
import { join } from 'node:path';
import { InvalidPathError } from '@/lib/errors/index';

/**
 * A path that does not exist has exactly one meaning — a typo.
 */
export function assertUsableDirectory(path: string): void {
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
 *
 * Never throws. If an error occurs, an empty array is returned.
 */
export function safeFlattenDirectory(
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

  try {
    return recurse(path, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.warn(`Error flattening directory \`${path}\`: ${message}`);
    return [];
  }
}
