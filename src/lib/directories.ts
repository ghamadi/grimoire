import { statSync } from 'node:fs';
import { InvalidPathError } from '#src/lib/errors/index';

/**
 * A path that does not exist has exactly one meaning — a typo.
 */
export function assertUsableDirectory(path: string): void {
  const status = statSync(path, { throwIfNoEntry: false });

  if (!status) {
    throw new InvalidPathError({ path, reason: 'missing' });
  }

  if (!status.isDirectory()) {
    throw new InvalidPathError({ path, reason: 'not-a-directory' });
  }
}
