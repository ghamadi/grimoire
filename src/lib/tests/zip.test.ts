import { chmodSync, mkdirSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { zipDirectory } from '@/lib/zip';
import { tempRoot } from '@test-helpers/temp-root';
import { readZipEntries, requireZipEntry } from '@test-helpers/zip-entries';

async function newDirectory(): Promise<{ root: string; directory: string }> {
  const root = await tempRoot();
  const directory = join(root, 'source');

  mkdirSync(directory);
  writeFileSync(join(directory, 'SKILL.md'), '# skill\n');

  return { root, directory };
}

function zipAndRead(params: { root: string; directory: string }) {
  const path = join(params.root, 'out.zip');

  writeFileSync(path, zipDirectory({ directory: params.directory, rootName: 'triage' }));

  return readZipEntries({ path });
}

describe('zipDirectory', () => {
  it('puts every entry under one top-level folder, with its bytes', async () => {
    const { root, directory } = await newDirectory();

    mkdirSync(join(directory, 'refs'));
    writeFileSync(join(directory, 'refs', 'guide.md'), 'guide');

    const entries = zipAndRead({ root, directory });

    expect(entries.map(({ name }) => name)).toEqual([
      'triage/',
      'triage/SKILL.md',
      'triage/refs/',
      'triage/refs/guide.md',
    ]);
    expect(
      Buffer.from(requireZipEntry({ entries: entries, name: 'triage/refs/guide.md' }).data).toString(),
    ).toBe('guide');
  });

  it('keeps dotfiles, .DS_Store and a .git folder', async () => {
    const { root, directory } = await newDirectory();

    writeFileSync(join(directory, '.env'), 'x');
    writeFileSync(join(directory, '.DS_Store'), 'x');
    mkdirSync(join(directory, '.git'));
    writeFileSync(join(directory, '.git', 'HEAD'), 'x');

    expect(zipAndRead({ root, directory }).map(({ name }) => name)).toEqual(
      expect.arrayContaining(['triage/.env', 'triage/.DS_Store', 'triage/.git/', 'triage/.git/HEAD']),
    );
  });

  it('gives an empty folder its own entry', async () => {
    const { root, directory } = await newDirectory();

    mkdirSync(join(directory, 'empty'));

    expect(
      requireZipEntry({ entries: zipAndRead({ root, directory }), name: 'triage/empty/' }).data,
    ).toHaveLength(0);
  });

  it('keeps execute bits and exact modes, on files and folders', async () => {
    const { root, directory } = await newDirectory();

    writeFileSync(join(directory, 'run.sh'), '#!/bin/sh\n');
    chmodSync(join(directory, 'run.sh'), 0o755);
    writeFileSync(join(directory, 'secret'), 'x');
    chmodSync(join(directory, 'secret'), 0o600);
    mkdirSync(join(directory, 'private'));
    chmodSync(join(directory, 'private'), 0o700);

    const entries = zipAndRead({ root, directory });

    expect(requireZipEntry({ entries: entries, name: 'triage/run.sh' }).mode).toBe(0o100755);
    expect(requireZipEntry({ entries: entries, name: 'triage/secret' }).mode).toBe(0o100600);
    expect(requireZipEntry({ entries: entries, name: 'triage/private/' }).mode).toBe(0o040700);
  });

  it('round-trips a non-ASCII name and a file named __proto__', async () => {
    const { root, directory } = await newDirectory();

    writeFileSync(join(directory, 'résumé.md'), 'x');
    writeFileSync(join(directory, '__proto__'), 'x');

    expect(zipAndRead({ root, directory }).map(({ name }) => name)).toEqual(
      expect.arrayContaining(['triage/résumé.md', 'triage/__proto__']),
    );
  });

  it('gives identical bytes for the same tree', async () => {
    const { directory } = await newDirectory();

    mkdirSync(join(directory, 'refs'));
    writeFileSync(join(directory, 'refs', 'b.md'), 'b');
    writeFileSync(join(directory, 'refs', 'a.md'), 'a');

    expect(zipDirectory({ directory, rootName: 'triage' })).toEqual(
      zipDirectory({ directory, rootName: 'triage' }),
    );
  });

  it("keeps a file's timestamp", async () => {
    const { root, directory } = await newDirectory();
    const modifiedAt = new Date(2024, 2, 15, 10, 30, 42);

    utimesSync(join(directory, 'SKILL.md'), modifiedAt, modifiedAt);

    expect(
      requireZipEntry({ entries: zipAndRead({ root, directory }), name: 'triage/SKILL.md' }).modifiedAt,
    ).toEqual(modifiedAt);
  });

  it('accepts a file dated 1970, storing the earliest date a zip can hold', async () => {
    const { root, directory } = await newDirectory();
    const epoch = new Date(0);

    utimesSync(join(directory, 'SKILL.md'), epoch, epoch);

    expect(
      requireZipEntry({ entries: zipAndRead({ root, directory }), name: 'triage/SKILL.md' }).modifiedAt,
    ).toEqual(new Date(1980, 0, 1));
  });

  it('follows a symlink at the root', async () => {
    const { root, directory } = await newDirectory();
    const link = join(root, 'link');

    symlinkSync(directory, link);

    expect(zipAndRead({ root, directory: link }).map(({ name }) => name)).toEqual([
      'triage/',
      'triage/SKILL.md',
    ]);
  });

  it('throws on a symlink below the root', async () => {
    const { directory } = await newDirectory();
    const link = join(directory, 'alias.md');

    symlinkSync(join(directory, 'SKILL.md'), link);

    expect(() => zipDirectory({ directory, rootName: 'triage' })).toThrow(link);
  });
});
