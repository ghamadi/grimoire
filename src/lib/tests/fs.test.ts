import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { InvalidPathError } from '#src/lib/errors/index';
import { isResolvableDirectory, movePath, tryStatSync } from '#src/lib/fs';
import { tempRoot } from '#test-helpers/temp-root';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();

  return { ...actual, renameSync: vi.fn(actual.renameSync) };
});

describe('tryStat', () => {
  it('answers with the stats of what sits at the path', async () => {
    const root = await tempRoot();
    const path = join(root, 'skills');

    mkdirSync(path);

    expect(tryStatSync(path)?.isDirectory()).toBe(true);
  });

  it('answers undefined when nothing is at the path', async () => {
    const root = await tempRoot();

    expect(tryStatSync(join(root, 'gone'))).toBeUndefined();
  });

  /**
   * The ENOTDIR case `throwIfNoEntry` turns out to cover as well as ENOENT.
   * It reads as the same nothing to every caller, which is why none of them
   * needs to tell the two apart.
   */
  it('answers undefined for a path buried under a file', async () => {
    const root = await tempRoot();
    const file = join(root, 'notes.txt');

    writeFileSync(file, '', 'utf8');

    expect(tryStatSync(join(file, 'skills'))).toBeUndefined();
  });

  it('follows a symlink to the directory it names', async () => {
    const root = await tempRoot();
    const target = join(root, 'target');
    const link = join(root, 'link');

    mkdirSync(target);
    symlinkSync(target, link);

    expect(tryStatSync(link)?.isDirectory()).toBe(true);
  });

  /**
   * The one unusable path `stat` cannot answer by returning: it follows links,
   * so it raises ELOOP. Left untranslated, the errno escapes as a crash from
   * whichever command happened to touch the path.
   */
  describe('a path that cannot be resolved', () => {
    it('refuses a cycle between two symlinks', async () => {
      const root = await tempRoot();
      const first = join(root, 'a');

      symlinkSync(join(root, 'b'), first);
      symlinkSync(first, join(root, 'b'));

      const error = refusal(() => tryStatSync(first));

      expect(error).toBeInstanceOf(InvalidPathError);
      expect((error as InvalidPathError).reason).toBe('unresolvable');
    });

    it('refuses a symlink pointing at itself', async () => {
      const root = await tempRoot();
      const path = join(root, 'self');

      symlinkSync(path, path);

      expect((refusal(() => tryStatSync(path)) as InvalidPathError).reason).toBe('unresolvable');
    });

    // Not a cycle at all: the kernel gives up after a fixed number of hops, so
    // depth alone reaches the same refusal.
    it('refuses a chain longer than the kernel will follow', async () => {
      const root = await tempRoot();
      let previous = join(root, 'end');

      mkdirSync(previous);

      for (let hop = 0; hop < 60; hop++) {
        const link = join(root, `hop${hop}`);

        symlinkSync(previous, link);
        previous = link;
      }

      expect((refusal(() => tryStatSync(previous)) as InvalidPathError).reason).toBe('unresolvable');
    });

    // The spelling is what the reader has to go act on, and a cycle has no
    // target to name instead.
    it('names the path it was given', async () => {
      const root = await tempRoot();
      const path = join(root, 'self');

      symlinkSync(path, path);

      expect(refusal(() => tryStatSync(path)).message).toBe(
        `${path} cannot be resolved: too many levels of symbolic links`,
      );
    });
  });
});

describe('isResolvableDirectory', () => {
  it('answers true for a directory', async () => {
    const root = await tempRoot();
    const path = join(root, 'workspace');

    mkdirSync(path);

    expect(isResolvableDirectory(path)).toBe(true);
  });

  it('answers true for a symlink to a directory', async () => {
    const root = await tempRoot();
    const target = join(root, 'target');
    const link = join(root, 'link');

    mkdirSync(target);
    symlinkSync(target, link);

    expect(isResolvableDirectory(link)).toBe(true);
  });

  it('answers false for a file', async () => {
    const root = await tempRoot();
    const file = join(root, 'notes.txt');

    writeFileSync(file, '', 'utf8');

    expect(isResolvableDirectory(file)).toBe(false);
  });

  it('answers false when nothing is at the path', async () => {
    const root = await tempRoot();

    expect(isResolvableDirectory(join(root, 'gone'))).toBe(false);
  });

  it('answers false for a symlink cycle rather than throwing', async () => {
    const root = await tempRoot();
    const first = join(root, 'a');

    symlinkSync(join(root, 'b'), first);
    symlinkSync(first, join(root, 'b'));

    expect(isResolvableDirectory(first)).toBe(false);
  });
});

describe('movePath', () => {
  it('moves a directory tree and leaves nothing at the source', async () => {
    const root = await tempRoot();
    const from = join(root, 'from');
    const to = join(root, 'to');

    mkdirSync(join(from, 'nested'), { recursive: true });
    writeFileSync(join(from, 'nested', 'a.txt'), 'a', 'utf8');

    movePath({ from, to });

    expect(readFileSync(join(to, 'nested', 'a.txt'), 'utf8')).toBe('a');
    expect(existsSync(from)).toBe(false);
  });

  it('moves a single file', async () => {
    const root = await tempRoot();
    const from = join(root, 'from.txt');
    const to = join(root, 'to.txt');

    writeFileSync(from, 'a', 'utf8');

    movePath({ from, to });

    expect(readFileSync(to, 'utf8')).toBe('a');
    expect(existsSync(from)).toBe(false);
  });

  it('throws when the source does not exist', async () => {
    const root = await tempRoot();

    expect(() => movePath({ from: join(root, 'gone'), to: join(root, 'to') })).toThrow(/ENOENT/);
  });

  describe('across filesystems', () => {
    function crossDevice(): void {
      vi.mocked(renameSync).mockImplementationOnce(() => {
        throw Object.assign(new Error('cross-device link'), { code: 'EXDEV' });
      });
    }

    it('copies a tree with its contents, dotfiles, execute bits and symlinks intact, then removes the source', async () => {
      const root = await tempRoot();
      const from = join(root, 'from');
      const to = join(root, 'to');

      mkdirSync(join(from, 'nested'), { recursive: true });
      writeFileSync(join(from, 'nested', 'a.txt'), 'a', 'utf8');
      writeFileSync(join(from, '.hidden'), 'h', 'utf8');
      writeFileSync(join(from, 'run.sh'), '#!/bin/sh\n', 'utf8');
      chmodSync(join(from, 'run.sh'), 0o755);
      symlinkSync('nested/a.txt', join(from, 'link'));

      crossDevice();
      movePath({ from, to });

      expect(readFileSync(join(to, 'nested', 'a.txt'), 'utf8')).toBe('a');
      expect(readFileSync(join(to, '.hidden'), 'utf8')).toBe('h');
      expect(statSync(join(to, 'run.sh')).mode & 0o111).toBe(0o111);
      expect(lstatSync(join(to, 'link')).isSymbolicLink()).toBe(true);
      expect(readlinkSync(join(to, 'link'))).toBe('nested/a.txt');
      expect(existsSync(from)).toBe(false);
    });

    it('moves a single file', async () => {
      const root = await tempRoot();
      const from = join(root, 'from.txt');
      const to = join(root, 'to.txt');

      writeFileSync(from, 'a', 'utf8');

      crossDevice();
      movePath({ from, to });

      expect(readFileSync(to, 'utf8')).toBe('a');
      expect(existsSync(from)).toBe(false);
    });
  });
});

/** The error a refusal threw, so its whole message can be asserted on. */
function refusal(operation: () => unknown): Error {
  try {
    operation();
  } catch (error) {
    return error as Error;
  }

  throw new Error('expected a refusal');
}
