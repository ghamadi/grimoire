import { lstatSync, readdirSync, readFileSync, realpathSync, type Stats } from 'node:fs';
import { join } from 'node:path';
import { zipSync, type ZipAttributes, type ZipOptions } from 'fflate';

type ZipEntry = [key: string, value: [contents: Uint8Array, options: ZipOptions]];

/**
 * @throws Error for an entry below the root that is neither a folder nor a regular file:
 * following a link would change what the zip holds.
 */
export function zipDirectory(params: { directory: string; rootName: string }): Uint8Array {
  const { directory, rootName } = params;

  return zipSync(Object.fromEntries(getZipEntries({ path: realpathSync(directory), key: rootName })));
}

// -----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// -----------------------------------------------------------------------------

function getZipEntries(params: { path: string; key: string }): ZipEntry[] {
  const { path, key } = params;
  const stats = lstatSync(path);

  if (stats.isDirectory()) {
    return [
      [`${key}/`, [new Uint8Array(0), { ...getZipAttributes(stats), level: 0 }]],
      ...readdirSync(path)
        .sort()
        .flatMap((name) => getZipEntries({ path: join(path, name), key: `${key}/${name}` })),
    ];
  }

  if (stats.isFile()) {
    return [[key, [readFileSync(path), getZipAttributes(stats)]]];
  }

  throw new Error(`cannot zip ${path}: it is neither a folder nor a regular file`);
}

function getZipAttributes(stats: Stats): ZipAttributes {
  return {
    // The default origin is DOS, and extractors ignore a DOS entry's Unix mode.
    os: 3,
    attrs: (stats.mode & 0xffff) * 0x10000,
    mtime: clampToZipDateRange(stats.mtime),
  };
}

/** `zipSync` throws outside these years, and a file dated 1970 is ordinary after some unpacks. */
function clampToZipDateRange(date: Date): Date {
  if (date.getFullYear() < 1980) {
    return new Date(1980, 0, 1);
  }

  if (date.getFullYear() > 2099) {
    return new Date(2099, 11, 31, 23, 59, 58);
  }

  return date;
}
