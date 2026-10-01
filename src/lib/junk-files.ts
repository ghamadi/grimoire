import { closeSync, lstatSync, openSync, readSync } from 'node:fs';
import { basename } from 'node:path';
import { isErrnoException } from '#src/lib/fs';

const DS_STORE_NAME = '.DS_Store';

/** What every `.DS_Store` Finder writes starts with: `\0\0\0\1Bud1`. */
const DS_STORE_HEADER = Buffer.from([0x00, 0x00, 0x00, 0x01, 0x42, 0x75, 0x64, 0x31]);

/**
 * Whether `path` is a file the operating system wrote, not the user.
 *
 * True only when all three hold: the basename is exactly `.DS_Store`, `path` is
 * a regular file (not a symlink or a directory), and it starts with the header
 * Finder writes. Anything that cannot be proven junk is not junk — a missing
 * path, a file shorter than the header, one that cannot be opened — so the
 * caller treats it as the user's content.
 */
export function isJunkFile(params: { path: string }): boolean {
  const { path } = params;

  if (basename(path) !== DS_STORE_NAME) {
    return false;
  }

  if (!lstatSync(path, { throwIfNoEntry: false })?.isFile()) {
    return false;
  }

  return startsWithDsStoreHeader(path);
}

function startsWithDsStoreHeader(path: string): boolean {
  let descriptor: number | undefined;

  try {
    descriptor = openSync(path, 'r');

    const head = Buffer.alloc(DS_STORE_HEADER.length);
    const bytesRead = readSync(descriptor, head, 0, head.length, 0);

    return bytesRead === head.length && head.equals(DS_STORE_HEADER);
  } catch (error) {
    if (isErrnoException(error, 'EACCES') || isErrnoException(error, 'EPERM')) {
      return false;
    }

    throw error;
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}
