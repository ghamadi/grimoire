import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { InvalidPathError } from '#src/lib/errors/index';
import { getDirectoryAccess, movePath, tryStatSync, writeTreeStaged } from '#src/lib/fs';
import { lockDirectory, runsAsRoot } from '#test-helpers/locked-directory';
import { tempRoot } from '#test-helpers/temp-root';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();

  return {
    ...actual,
    cpSync: vi.fn(actual.cpSync),
    renameSync: vi.fn(actual.renameSync),
    rmSync: vi.fn(actual.rmSync),
  };
});

const actualFs = await vi.importActual<typeof import('node:fs')>('node:fs');

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

describe('getDirectoryAccess', () => {
  it('answers accessible for a directory', async () => {
    const root = await tempRoot();
    const path = join(root, 'workspace');

    mkdirSync(path);

    expect(getDirectoryAccess(path)).toBe('accessible');
  });

  it('answers accessible for a symlink to a directory', async () => {
    const root = await tempRoot();
    const target = join(root, 'target');
    const link = join(root, 'link');

    mkdirSync(target);
    symlinkSync(target, link);

    expect(getDirectoryAccess(link)).toBe('accessible');
  });

  it('answers unresolvable for a file', async () => {
    const root = await tempRoot();
    const file = join(root, 'notes.txt');

    writeFileSync(file, '', 'utf8');

    expect(getDirectoryAccess(file)).toBe('unresolvable');
  });

  it('answers unresolvable when nothing is at the path', async () => {
    const root = await tempRoot();

    expect(getDirectoryAccess(join(root, 'gone'))).toBe('unresolvable');
  });

  it('answers unresolvable for a path under a file', async () => {
    const root = await tempRoot();
    const file = join(root, 'notes.txt');

    writeFileSync(file, '', 'utf8');

    expect(getDirectoryAccess(join(file, 'skills'))).toBe('unresolvable');
  });

  it('answers unresolvable for a symlink cycle rather than throwing', async () => {
    const root = await tempRoot();
    const first = join(root, 'a');

    symlinkSync(join(root, 'b'), first);
    symlinkSync(first, join(root, 'b'));

    expect(getDirectoryAccess(first)).toBe('unresolvable');
  });

  describe.skipIf(runsAsRoot)('a directory that cannot be used', () => {
    it('answers unreadable for a directory with no permissions', async () => {
      const root = await tempRoot();
      const path = join(root, 'workspace');

      mkdirSync(path);
      lockDirectory({ path });

      expect(getDirectoryAccess(path)).toBe('unreadable');
    });

    it('answers unreadable for a directory that can be listed but not entered', async () => {
      const root = await tempRoot();
      const path = join(root, 'workspace');

      mkdirSync(path);
      lockDirectory({ path, mode: 0o444 });

      expect(getDirectoryAccess(path)).toBe('unreadable');
    });

    it('answers unreadable for a directory that can be entered but not listed', async () => {
      const root = await tempRoot();
      const path = join(root, 'workspace');

      mkdirSync(path);
      lockDirectory({ path, mode: 0o111 });

      expect(getDirectoryAccess(path)).toBe('unreadable');
    });

    it('answers unreadable for a directory under one that cannot be entered', async () => {
      const root = await tempRoot();
      const parent = join(root, 'parent');
      const path = join(parent, 'workspace');

      mkdirSync(path, { recursive: true });
      lockDirectory({ path: parent });

      expect(getDirectoryAccess(path)).toBe('unreadable');
    });
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

describe('writeTreeStaged', () => {
  const NEW_SKILL_FILES = { 'SKILL.md': 'new skill', 'refs/guide.md': 'new guide' };

  /** A store skill, a workspace, and the paths a clone into it touches. */
  async function sandbox(params: { skillFiles?: Record<string, string> } = {}) {
    const root = await tempRoot();
    const from = join(root, 'store', 'triage');
    const workspace = join(root, 'workspace');
    const stagingDirectory = join(workspace, '.grimoire-staging');
    const to = join(workspace, 'triage');

    writeFiles(from, params.skillFiles ?? NEW_SKILL_FILES);
    mkdirSync(workspace);

    return { root, from, stagingDirectory, to };
  }

  describe('a successful write', () => {
    it('writes into an empty destination', async () => {
      const { from, to, stagingDirectory } = await sandbox();

      const result = writeTreeStaged({ from, to, stagingDirectory });

      expect(result).toStrictEqual({ kind: 'written' });
      expect(readTree(to)).toEqual(NEW_SKILL_FILES);
    });

    it('replaces a directory wholesale, so a file only the old one held is gone', async () => {
      const { from, to, stagingDirectory } = await sandbox();

      writeFiles(to, { 'SKILL.md': 'old skill', 'old-only.md': 'old' });

      const result = writeTreeStaged({ from, to, stagingDirectory });

      expect(result).toStrictEqual({ kind: 'written' });
      expect(readTree(to)).toEqual(NEW_SKILL_FILES);
    });

    it('replaces a symlink and leaves the directory it pointed at untouched', async () => {
      const { root, from, to, stagingDirectory } = await sandbox();
      const target = join(root, 'target');

      writeFiles(target, { 'SKILL.md': 'target skill' });
      symlinkSync(target, to);

      writeTreeStaged({ from, to, stagingDirectory });

      expect(lstatSync(to).isDirectory()).toBe(true);
      expect(readTree(to)).toEqual(NEW_SKILL_FILES);
      expect(readTree(target)).toEqual({ 'SKILL.md': 'target skill' });
    });

    it('replaces a dangling symlink', async () => {
      const { root, from, to, stagingDirectory } = await sandbox();

      symlinkSync(join(root, 'gone'), to);

      writeTreeStaged({ from, to, stagingDirectory });

      expect(lstatSync(to).isDirectory()).toBe(true);
      expect(readTree(to)).toEqual(NEW_SKILL_FILES);
    });

    it('copies verbatim: dotfiles, nested directories, and symlinks with their text unchanged', async () => {
      const { from, to, stagingDirectory } = await sandbox({
        skillFiles: { 'SKILL.md': 'skill', '.hidden': 'h', 'a/b/c.md': 'c' },
      });

      symlinkSync('a/b/c.md', join(from, 'inner-link'));

      writeTreeStaged({ from, to, stagingDirectory });

      expect(readTree(to)).toEqual({
        'SKILL.md': 'skill',
        '.hidden': 'h',
        'a/b/c.md': 'c',
        'inner-link': '-> a/b/c.md',
      });
      expect(readlinkSync(join(to, 'inner-link'))).toBe('a/b/c.md');
    });
  });

  describe('the staging directory', () => {
    it('is created when missing and gone after a successful write', async () => {
      const { from, to, stagingDirectory } = await sandbox();

      writeTreeStaged({ from, to, stagingDirectory });

      expect(existsSync(stagingDirectory)).toBe(false);
    });

    it('is used and removed when it already exists empty', async () => {
      const { from, to, stagingDirectory } = await sandbox();

      mkdirSync(stagingDirectory);

      writeTreeStaged({ from, to, stagingDirectory });

      expect(existsSync(to)).toBe(true);
      expect(existsSync(stagingDirectory)).toBe(false);
    });

    it('is used and kept when it holds another run’s entry, which stays byte-for-byte unchanged', async () => {
      const { from, to, stagingDirectory } = await sandbox();

      writeFiles(join(stagingDirectory, 'other.abc.outgoing'), { 'notes.md': 'someone else' });

      writeTreeStaged({ from, to, stagingDirectory });

      expect(readTree(to)).toEqual(NEW_SKILL_FILES);
      expect(readTree(stagingDirectory)).toEqual({ 'other.abc.outgoing/notes.md': 'someone else' });
    });

    it('serves two consecutive writes to the same destination', async () => {
      const { from, to, stagingDirectory } = await sandbox();

      writeTreeStaged({ from, to, stagingDirectory });
      writeTreeStaged({ from, to, stagingDirectory });

      expect(readTree(to)).toEqual(NEW_SKILL_FILES);
      expect(existsSync(stagingDirectory)).toBe(false);
    });
  });

  describe('preconditions', () => {
    it('fails on a staging path that is a file, leaving the file intact', async () => {
      const { from, to, stagingDirectory } = await sandbox();

      writeFileSync(stagingDirectory, 'not a directory', 'utf8');

      const result = writeTreeStaged({ from, to, stagingDirectory });

      expect(result).toMatchObject({ kind: 'failed', error: expect.any(InvalidPathError) as unknown });
      expect(readFileSync(stagingDirectory, 'utf8')).toBe('not a directory');
      expect(existsSync(to)).toBe(false);
    });

    it('fails on a staging path that is a symlink to a directory, writing nothing through it', async () => {
      const { root, from, to, stagingDirectory } = await sandbox();
      const elsewhere = join(root, 'elsewhere');

      mkdirSync(elsewhere);
      symlinkSync(elsewhere, stagingDirectory);
      writeFiles(to, { 'SKILL.md': 'old skill' });

      const result = writeTreeStaged({ from, to, stagingDirectory });

      expect(result).toMatchObject({ kind: 'failed', error: expect.any(InvalidPathError) as unknown });
      expect(readdirSync(elsewhere)).toEqual([]);
      expect(readlinkSync(stagingDirectory)).toBe(elsewhere);
      expect(readTree(to)).toEqual({ 'SKILL.md': 'old skill' });
    });

    it('fails without moving anything when the destination is the staging directory itself', async () => {
      const { from, stagingDirectory } = await sandbox();

      const result = writeTreeStaged({ from, to: stagingDirectory, stagingDirectory });

      expect(result).toMatchObject({ kind: 'failed', error: { code: 'EINVAL' } });
      expect(existsSync(stagingDirectory)).toBe(false);
    });

    it('fails on a source that does not exist, and removes the staging directory it made', async () => {
      const { root, to, stagingDirectory } = await sandbox();

      writeFiles(to, { 'SKILL.md': 'old skill' });

      const result = writeTreeStaged({ from: join(root, 'gone'), to, stagingDirectory });

      expect(result).toMatchObject({ kind: 'failed', error: { code: 'ENOENT' } });
      expect(readTree(to)).toEqual({ 'SKILL.md': 'old skill' });
      expect(existsSync(stagingDirectory)).toBe(false);
    });
  });

  describe.skipIf(runsAsRoot)('a copy that fails', () => {
    async function sandboxWithUnreadableFile() {
      const context = await sandbox();
      const unreadable = join(context.from, 'refs', 'secret.md');

      writeFileSync(unreadable, 'secret', 'utf8');
      chmodSync(unreadable, 0o000);
      onTestFinished(() => {
        chmodSync(unreadable, 0o644);
      });

      return context;
    }

    it('leaves a directory at the destination as it was', async () => {
      const { from, to, stagingDirectory } = await sandboxWithUnreadableFile();

      writeFiles(to, { 'SKILL.md': 'old skill', 'refs/old.md': 'old' });

      const result = writeTreeStaged({ from, to, stagingDirectory });

      expect(result).toMatchObject({ kind: 'failed', error: { code: 'EACCES' } });
      expect(readTree(to)).toEqual({ 'SKILL.md': 'old skill', 'refs/old.md': 'old' });
      expect(existsSync(stagingDirectory)).toBe(false);
    });

    it('leaves a symlink at the destination as it was', async () => {
      const { root, from, to, stagingDirectory } = await sandboxWithUnreadableFile();

      mkdirSync(join(root, 'target'));
      symlinkSync(join(root, 'target'), to);

      const result = writeTreeStaged({ from, to, stagingDirectory });

      expect(result).toMatchObject({ kind: 'failed', error: { code: 'EACCES' } });
      expect(readlinkSync(to)).toBe(join(root, 'target'));
      expect(existsSync(stagingDirectory)).toBe(false);
    });

    it('leaves nothing at an empty destination', async () => {
      const { from, to, stagingDirectory } = await sandboxWithUnreadableFile();

      const result = writeTreeStaged({ from, to, stagingDirectory });

      expect(result).toMatchObject({ kind: 'failed', error: { code: 'EACCES' } });
      expect(lstatSync(to, { throwIfNoEntry: false })).toBeUndefined();
      expect(existsSync(stagingDirectory)).toBe(false);
    });
  });

  describe('a swap that fails', () => {
    const renameFailure = (code: string) => () => {
      throw Object.assign(new Error(`rename failed: ${code}`), { code });
    };

    const realRename: typeof renameSync = (from, to) => actualFs.renameSync(from, to);

    it('leaves the destination alone when the old entry cannot be moved aside', async () => {
      const { from, to, stagingDirectory } = await sandbox();

      writeFiles(to, { 'SKILL.md': 'old skill' });
      vi.mocked(renameSync).mockImplementationOnce(renameFailure('EIO'));

      const result = writeTreeStaged({ from, to, stagingDirectory });

      expect(result).toMatchObject({ kind: 'failed', error: { code: 'EIO' } });
      expect(readTree(to)).toEqual({ 'SKILL.md': 'old skill' });
      expect(existsSync(stagingDirectory)).toBe(false);
    });

    it('puts the old directory back when the new copy cannot be moved in', async () => {
      const { from, to, stagingDirectory } = await sandbox();

      writeFiles(to, { 'SKILL.md': 'old skill', 'refs/old.md': 'old' });
      vi.mocked(renameSync)
        .mockImplementationOnce(realRename)
        .mockImplementationOnce(renameFailure('EIO'));

      const result = writeTreeStaged({ from, to, stagingDirectory });

      expect(result).toMatchObject({ kind: 'failed', error: { code: 'EIO' } });
      expect(readTree(to)).toEqual({ 'SKILL.md': 'old skill', 'refs/old.md': 'old' });
      expect(existsSync(stagingDirectory)).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('reports the old entry as stranded, and leaves the complete new copy, when it cannot be deleted', async () => {
      const { from, to, stagingDirectory } = await sandbox();

      writeFiles(to, { 'SKILL.md': 'old skill' });
      vi.mocked(rmSync).mockImplementationOnce(() => {
        throw Object.assign(new Error('delete failed'), { code: 'EACCES' });
      });

      const result = writeTreeStaged({ from, to, stagingDirectory });

      const [entry, ...others] = readdirSync(stagingDirectory);

      expect(others).toEqual([]);
      expect(entry!.endsWith('.outgoing')).toBe(true);
      expect(result).toMatchObject({
        kind: 'written',
        strandedOldEntry: { path: join(stagingDirectory, entry!), error: { code: 'EACCES' } },
      });
      expect(readTree(to)).toEqual(NEW_SKILL_FILES);
    });

    it('rethrows an error that is not a filesystem failure', async () => {
      const { from, to, stagingDirectory } = await sandbox();

      vi.mocked(cpSync).mockImplementationOnce(() => {
        throw new Error('programming error');
      });

      expect(() => writeTreeStaged({ from, to, stagingDirectory })).toThrow('programming error');
      expect(existsSync(stagingDirectory)).toBe(false);
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

/** Writes `files` — paths relative to `directory` — creating every directory on the way. */
function writeFiles(directory: string, files: Record<string, string>): void {
  mkdirSync(directory, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const path = join(directory, relativePath);

    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }
}

/** Every file under `directory` by relative path, with a symlink read as `-> <text>`. */
function readTree(directory: string, prefix = ''): Record<string, string> {
  const tree: Record<string, string> = {};

  for (const entry of readdirSync(join(directory, prefix), { withFileTypes: true })) {
    const relativePath = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    const path = join(directory, relativePath);

    if (entry.isSymbolicLink()) {
      tree[relativePath] = `-> ${readlinkSync(path)}`;
    } else if (entry.isDirectory()) {
      Object.assign(tree, readTree(directory, relativePath));
    } else {
      tree[relativePath] = readFileSync(path, 'utf8');
    }
  }

  return tree;
}
