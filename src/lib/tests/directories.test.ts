import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { assertUsableDirectory, safeFlattenDirectory } from '@/lib/directories';
import { InvalidPathError, type InvalidPathReason } from '@/lib/errors';
import { lockDirectory, runsAsRoot } from '@test-helpers/locked-directory';
import { tempRoot } from '@test-helpers/temp-root';

describe('directories', () => {
  describe('safeFlattenDirectory', () => {
    it('returns [] for an empty root directory', async () => {
      const root = await tempRoot();

      expect(flatten(root)).toEqual([]);
    });

    it('returns a single file at the root', async () => {
      const fixture = await newFixture();

      const file = fixture.file('notes.md', '# notes');

      expect(flatten(fixture.root)).toEqual([file]);
    });

    it('returns multiple files at the root', async () => {
      const fixture = await newFixture();

      const alpha = fixture.file('alpha.md', 'a');
      const beta = fixture.file('beta.md', 'b');

      expect(flatten(fixture.root)).toEqual(sorted([alpha, beta]));
    });

    it('returns files nested in subdirectories', async () => {
      const fixture = await newFixture();

      const rootFile = fixture.file('SKILL.md', '# skill');
      const nestedFile = fixture.file('reference/notes.md', 'notes');

      expect(flatten(fixture.root)).toEqual(sorted([rootFile, nestedFile]));
    });

    it('returns files from multiple sibling subtrees', async () => {
      const fixture = await newFixture();

      const left = fixture.file('left/a.md', 'a');
      const right = fixture.file('right/b.md', 'b');

      expect(flatten(fixture.root)).toEqual(sorted([left, right]));
    });

    it('returns files from deeply nested paths', async () => {
      const fixture = await newFixture();

      const deep = fixture.file('a/b/c/d/e.md', 'deep');

      expect(flatten(fixture.root)).toEqual([deep]);
    });

    it('does not include the root directory path', async () => {
      const fixture = await newFixture();

      fixture.file('SKILL.md', '# skill');

      expect(flatten(fixture.root)).not.toContain(fixture.root);
    });

    it('does not include a non-empty subdirectory path itself', async () => {
      const fixture = await newFixture();

      const nestedDir = fixture.directory('nested');
      const nestedFile = fixture.file('nested/notes.md', 'notes');

      expect(flatten(fixture.root)).toEqual([nestedFile]);
      expect(flatten(fixture.root)).not.toContain(nestedDir);
    });

    it('includes an empty subdirectory by default', async () => {
      const fixture = await newFixture();

      const empty = fixture.directory('empty');

      expect(flatten(fixture.root)).toEqual([empty]);
    });

    it('returns [] when called directly on an empty directory', async () => {
      const fixture = await newFixture();

      const empty = fixture.directory('empty');

      expect(flatten(empty)).toEqual([]);
    });

    it('includes multiple empty subdirectories at the same level', async () => {
      const fixture = await newFixture();

      const first = fixture.directory('first');
      const second = fixture.directory('second');

      expect(flatten(fixture.root)).toEqual(sorted([first, second]));
    });

    it('includes a nested empty subdirectory', async () => {
      const fixture = await newFixture();

      fixture.directory('parent');
      const nestedEmpty = fixture.directory('parent/child');

      expect(flatten(fixture.root)).toEqual([nestedEmpty]);
    });

    it('includes the leaf of a chain of nested empty directories', async () => {
      const fixture = await newFixture();

      fixture.directory('a');
      fixture.directory('a/b');
      const leaf = fixture.directory('a/b/c');

      expect(flatten(fixture.root)).toEqual([leaf]);
    });

    it('returns files and empty subdirectories together', async () => {
      const fixture = await newFixture();

      const file = fixture.file('SKILL.md', '# skill');
      const empty = fixture.directory('scratch');
      const nestedFile = fixture.file('reference/notes.md', 'notes');

      expect(flatten(fixture.root)).toEqual(sorted([file, empty, nestedFile]));
    });

    it('omits empty subdirectories when includeEmptyDirectories is false', async () => {
      const fixture = await newFixture();

      fixture.directory('empty');
      const file = fixture.file('notes.md', 'notes');

      expect(flatten(fixture.root, { includeEmptyDirectories: false })).toEqual([file]);
    });

    it('still returns files when includeEmptyDirectories is false', async () => {
      const fixture = await newFixture();

      const left = fixture.file('left/a.md', 'a');
      const right = fixture.file('right/b.md', 'b');
      fixture.directory('scratch');

      expect(flatten(fixture.root, { includeEmptyDirectories: false })).toEqual(sorted([left, right]));
    });

    it('omits nested empty subdirectories when includeEmptyDirectories is false', async () => {
      const fixture = await newFixture();

      fixture.directory('parent');
      fixture.directory('parent/child');

      expect(flatten(fixture.root, { includeEmptyDirectories: false })).toEqual([]);
    });

    it('includes hidden files and empty hidden subdirectories', async () => {
      const fixture = await newFixture();

      const hiddenFile = fixture.file('.env', 'SECRET=1');
      const hiddenEmpty = fixture.directory('.cache');

      expect(flatten(fixture.root)).toEqual(sorted([hiddenFile, hiddenEmpty]));
    });

    it('includes files with spaces and unusual characters in their names', async () => {
      const fixture = await newFixture();

      const spaced = fixture.file('my notes.md', 'notes');
      const unusual = fixture.file('résumé (final).md', 'cv');

      expect(flatten(fixture.root)).toEqual(sorted([spaced, unusual]));
    });

    it('lists a symlink to a directory without following it', async () => {
      const fixture = await newFixture();

      fixture.directory('real');
      const linkedFile = fixture.file('real/notes.md', 'notes');
      const linkPath = fixture.link('linked', join(fixture.root, 'real'));

      expect(flatten(fixture.root)).toEqual(sorted([linkedFile, linkPath]));
    });

    it('lists a symlink to a file without following it', async () => {
      const fixture = await newFixture();

      const target = fixture.file('target.md', 'notes');
      const linkPath = fixture.link('alias.md', target);

      expect(flatten(fixture.root)).toEqual(sorted([target, linkPath]));
    });

    it('includes an empty subdirectory under the real target of a directory symlink', async () => {
      const fixture = await newFixture();

      const realEmpty = fixture.directory('real/empty');
      fixture.link('linked', join(fixture.root, 'real'));

      expect(flatten(fixture.root)).toEqual(sorted([realEmpty, join(fixture.root, 'linked')]));
    });

    it('returns [] for a missing path', async () => {
      const root = await tempRoot();

      expect(safeFlattenDirectory(join(root, 'missing'))).toEqual([]);
    });

    it('returns [] when the path is a file', async () => {
      const fixture = await newFixture();
      const file = fixture.file('notes.md', '# notes');

      expect(safeFlattenDirectory(file)).toEqual([]);
    });

    it('warns and returns [] when flattening fails', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const root = await tempRoot();

      expect(safeFlattenDirectory(join(root, 'missing'))).toEqual([]);
      expect(warn).toHaveBeenCalledOnce();

      warn.mockRestore();
    });
  });

  describe('assertUsableDirectory', () => {
    it('accepts a directory', async () => {
      const root = await tempRoot();

      expect(() => assertUsableDirectory(root)).not.toThrow();
    });

    it('refuses a path that does not exist', async () => {
      const path = join(await tempRoot(), 'missing');

      expect(reasonFor(path)).toBe('missing');
    });

    it('refuses a file', async () => {
      const fixture = await newFixture();

      expect(reasonFor(fixture.file('notes.md', 'notes'))).toBe('not-a-directory');
    });

    describe.skipIf(runsAsRoot)('permissions', () => {
      it.each([
        ['cannot be entered', 0o600],
        ['cannot be listed', 0o300],
      ])('refuses a directory that %s', async (_, mode) => {
        const root = await tempRoot();

        lockDirectory({ path: root, mode });

        expect(reasonFor(root)).toBe('unreadable');
      });

      it('refuses a directory under one that cannot be entered', async () => {
        const fixture = await newFixture();
        const path = fixture.directory('locked/inner');

        lockDirectory({ path: dirname(path) });

        expect(reasonFor(path)).toBe('unreadable');
      });

      it('accepts a directory it can read but not write to', async () => {
        const root = await tempRoot();

        lockDirectory({ path: root, mode: 0o555 });

        expect(() => assertUsableDirectory(root)).not.toThrow();
      });
    });
  });
});

function reasonFor(path: string): InvalidPathReason | undefined {
  try {
    assertUsableDirectory(path);
  } catch (error) {
    if (error instanceof InvalidPathError) {
      return error.reason;
    }

    throw error;
  }

  return undefined;
}

function flatten(path: string, options?: { includeEmptyDirectories?: boolean }): string[] {
  return sorted(safeFlattenDirectory(path, options));
}

function sorted(paths: string[]): string[] {
  return [...paths].sort();
}

async function newFixture() {
  const root = await tempRoot();

  function file(rel: string, content: string | Buffer): string {
    const filePath = join(root, rel);

    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);

    return filePath;
  }

  function directory(rel: string): string {
    const dirPath = join(root, rel);

    mkdirSync(dirPath, { recursive: true });

    return dirPath;
  }

  function link(rel: string, target: string): string {
    const linkPath = join(root, rel);

    mkdirSync(dirname(linkPath), { recursive: true });
    symlinkSync(target, linkPath);

    return linkPath;
  }

  return { root, file, directory, link };
}
