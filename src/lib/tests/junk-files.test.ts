import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isJunkFile } from '#src/lib/junk-files';
import { DS_STORE_NAME, finderDsStoreBytes } from '#test-helpers/ds-store';
import { lockDirectory, runsAsRoot } from '#test-helpers/locked-directory';
import { tempRoot } from '#test-helpers/temp-root';

describe('isJunkFile', () => {
  it('recognizes a Finder .DS_Store at a directory root', async () => {
    const root = await tempRoot();
    const path = join(root, DS_STORE_NAME);

    writeFileSync(path, finderDsStoreBytes());

    expect(isJunkFile({ path })).toBe(true);
  });

  it('recognizes a Finder .DS_Store inside a nested directory', async () => {
    const root = await tempRoot();
    const path = join(root, 'reference', 'deep', DS_STORE_NAME);

    mkdirSync(join(root, 'reference', 'deep'), { recursive: true });
    writeFileSync(path, finderDsStoreBytes());

    expect(isJunkFile({ path })).toBe(true);
  });

  it('does not recognize a .DS_Store holding arbitrary text', async () => {
    const root = await tempRoot();
    const path = join(root, DS_STORE_NAME);

    writeFileSync(path, 'my own notes, in a file that happens to be named like this');

    expect(isJunkFile({ path })).toBe(false);
  });

  it('does not recognize a .DS_Store holding only part of the header', async () => {
    const root = await tempRoot();
    const path = join(root, DS_STORE_NAME);

    writeFileSync(path, finderDsStoreBytes().subarray(0, 7));

    expect(isJunkFile({ path })).toBe(false);
  });

  it('does not recognize an empty .DS_Store', async () => {
    const root = await tempRoot();
    const path = join(root, DS_STORE_NAME);

    writeFileSync(path, '');

    expect(isJunkFile({ path })).toBe(false);
  });

  it('does not recognize a Finder-shaped file under another name', async () => {
    const root = await tempRoot();
    const path = join(root, 'notes.md');

    writeFileSync(path, finderDsStoreBytes());

    expect(isJunkFile({ path })).toBe(false);
  });

  it.each(['Thumbs.db', 'desktop.ini', '._notes.md', '.Spotlight-V100'])(
    'does not recognize %s on the strength of a .DS_Store header',
    async (name) => {
      const root = await tempRoot();
      const path = join(root, name);

      writeFileSync(path, finderDsStoreBytes());

      expect(isJunkFile({ path })).toBe(false);
    },
  );

  it('does not recognize a directory named .DS_Store', async () => {
    const root = await tempRoot();
    const path = join(root, DS_STORE_NAME);

    mkdirSync(path);

    expect(isJunkFile({ path })).toBe(false);
  });

  it('does not recognize a symlink named .DS_Store, even to a Finder-shaped file', async () => {
    const root = await tempRoot();
    const path = join(root, DS_STORE_NAME);

    writeFileSync(join(root, 'real'), finderDsStoreBytes());
    symlinkSync(join(root, 'real'), path);

    expect(isJunkFile({ path })).toBe(false);
  });

  it('does not recognize a path that is missing', async () => {
    const root = await tempRoot();

    expect(isJunkFile({ path: join(root, DS_STORE_NAME) })).toBe(false);
  });

  it.skipIf(runsAsRoot)(
    'does not recognize a Finder-shaped .DS_Store that cannot be opened',
    async () => {
      const root = await tempRoot();
      const path = join(root, DS_STORE_NAME);

      writeFileSync(path, finderDsStoreBytes());
      lockDirectory({ path });

      expect(isJunkFile({ path })).toBe(false);
    },
  );
});
