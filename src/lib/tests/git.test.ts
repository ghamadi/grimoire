import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { GitUnavailableError, GrimoireError } from '@/lib/errors';
import { hasUncommittedChanges, isInsideGitWorkTree } from '@/lib/git';
import { tempGitRepo } from '@test-helpers/git-repo';
import { tempRoot } from '@test-helpers/temp-root';

// -----------------------------------------------------------------------------
// isInsideGitWorkTree
// -----------------------------------------------------------------------------

describe('isInsideGitWorkTree', () => {
  it('is true at the work-tree root', async () => {
    const { path: repo } = await tempGitRepo();

    expect(isInsideGitWorkTree({ directory: repo })).toBe(true);
  });

  it('is true in a subdirectory of the work tree', async () => {
    const { path: repo } = await tempGitRepo();
    mkdirSync(join(repo, 'nested'));

    expect(isInsideGitWorkTree({ directory: join(repo, 'nested') })).toBe(true);
  });

  it('is true in a linked worktree', async () => {
    const { path: repo, commitAll } = await tempGitRepo();
    write({ repo, path: 'a.txt' });
    commitAll();
    const linked = join(await tempRoot(), 'linked');
    git({ repo, args: ['worktree', 'add', '--detach', linked] });

    expect(isInsideGitWorkTree({ directory: linked })).toBe(true);
  });

  it('is false inside .git', async () => {
    const { path: repo } = await tempGitRepo();

    expect(isInsideGitWorkTree({ directory: join(repo, '.git') })).toBe(false);
  });

  it('is false outside any repository', async () => {
    expect(isInsideGitWorkTree({ directory: await tempRoot() })).toBe(false);
  });

  it('is false for a missing path', async () => {
    const root = await tempRoot();

    expect(isInsideGitWorkTree({ directory: join(root, 'missing') })).toBe(false);
  });

  it('is false for a file', async () => {
    const { path: repo } = await tempGitRepo();
    write({ repo, path: 'a.txt' });

    expect(isInsideGitWorkTree({ directory: join(repo, 'a.txt') })).toBe(false);
  });
});

// -----------------------------------------------------------------------------
// hasUncommittedChanges
// -----------------------------------------------------------------------------

describe('hasUncommittedChanges', () => {
  it('is false when committed and unchanged', async () => {
    const { path: repo, commitAll } = await tempGitRepo();
    write({ repo, path: 'library/a.txt' });
    commitAll();

    expect(hasUncommittedChanges({ directory: repo, entry: 'library' })).toBe(false);
  });

  it('is false when nothing exists at entry', async () => {
    const { path: repo, commitAll } = await tempGitRepo();
    write({ repo, path: 'other/a.txt' });
    commitAll();

    expect(hasUncommittedChanges({ directory: repo, entry: 'library' })).toBe(false);
  });

  it('is true for a modified tracked file', async () => {
    const { path: repo, commitAll } = await tempGitRepo();
    write({ repo, path: 'library/a.txt' });
    commitAll();
    write({ repo, path: 'library/a.txt', content: 'changed' });

    expect(hasUncommittedChanges({ directory: repo, entry: 'library' })).toBe(true);
  });

  it('is true for a new file that is staged but not committed', async () => {
    const { path: repo, commitAll } = await tempGitRepo();
    write({ repo, path: 'library/a.txt' });
    commitAll();
    write({ repo, path: 'library/b.txt' });
    git({ repo, args: ['add', 'library/b.txt'] });

    expect(hasUncommittedChanges({ directory: repo, entry: 'library' })).toBe(true);
  });

  it('is true for a deleted tracked file', async () => {
    const { path: repo, commitAll } = await tempGitRepo();
    write({ repo, path: 'library/a.txt' });
    commitAll();
    rmSync(join(repo, 'library/a.txt'));

    expect(hasUncommittedChanges({ directory: repo, entry: 'library' })).toBe(true);
  });

  it('is true for an untracked file', async () => {
    const { path: repo, commitAll } = await tempGitRepo();
    write({ repo, path: 'library/a.txt' });
    commitAll();
    write({ repo, path: 'library/b.txt' });

    expect(hasUncommittedChanges({ directory: repo, entry: 'library' })).toBe(true);
  });

  it('is true when the changes fill more than the 1 MB a spawn buffers by default', async () => {
    const { path: repo, commitAll } = await tempGitRepo();
    const longName = 'n'.repeat(200);
    const fileCount = Math.ceil((1024 * 1024) / (2 * longName.length)) + 1;

    for (let index = 0; index < fileCount; index++) {
      write({ repo, path: join('library', longName, `${longName}-${index}`) });
    }

    // Committed, then deleted: untracked, the whole directory would answer in one line.
    commitAll();
    rmSync(join(repo, 'library'), { recursive: true });

    expect(hasUncommittedChanges({ directory: repo, entry: 'library' })).toBe(true);
  });

  it('is false when the only change is a file ignored by the in-repo .gitignore', async () => {
    const { path: repo, commitAll } = await tempGitRepo();
    write({ repo, path: '.gitignore', content: '*.log\n' });
    write({ repo, path: 'library/a.txt' });
    commitAll();
    write({ repo, path: 'library/debug.log' });

    expect(hasUncommittedChanges({ directory: repo, entry: 'library' })).toBe(false);
  });

  it('does not count a change in a sibling that shares the entry as a prefix', async () => {
    const { path: repo, commitAll } = await tempGitRepo();
    write({ repo, path: 'library/a.txt' });
    write({ repo, path: 'library-extra/a.txt' });
    commitAll();
    write({ repo, path: 'library-extra/a.txt', content: 'changed' });

    expect(hasUncommittedChanges({ directory: repo, entry: 'library' })).toBe(false);
  });

  it('resolves entry relative to directory when directory is a subdirectory of the work tree', async () => {
    const { path: repo, commitAll } = await tempGitRepo();
    write({ repo, path: 'sub/library/a.txt' });
    write({ repo, path: 'library/a.txt' });
    commitAll();
    write({ repo, path: 'library/a.txt', content: 'changed' });

    expect(hasUncommittedChanges({ directory: join(repo, 'sub'), entry: 'library' })).toBe(false);

    write({ repo, path: 'sub/library/a.txt', content: 'changed' });

    expect(hasUncommittedChanges({ directory: join(repo, 'sub'), entry: 'library' })).toBe(true);
  });

  it('throws a plain Error outside a work tree', async () => {
    const directory = await tempRoot();

    const error = catchError(() => hasUncommittedChanges({ directory, entry: 'library' }));

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(GrimoireError);
  });

  it('throws a plain Error inside .git', async () => {
    const { path: repo } = await tempGitRepo();

    const error = catchError(() =>
      hasUncommittedChanges({ directory: join(repo, '.git'), entry: 'library' }),
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(GrimoireError);
  });
});

// -----------------------------------------------------------------------------
// untracked directories
// -----------------------------------------------------------------------------

describe('hasUncommittedChanges on untracked directories', () => {
  it('is true for an entry that is untracked as a whole', async () => {
    const { path: repo, commitAll } = await tempGitRepo();
    write({ repo, path: 'other/a.txt' });
    commitAll();
    write({ repo, path: 'library/sub/a.txt' });

    expect(hasUncommittedChanges({ directory: repo, entry: 'library' })).toBe(true);
  });

  it('is true for a new directory inside a committed entry', async () => {
    const { path: repo, commitAll } = await tempGitRepo();
    write({ repo, path: 'library/a.txt' });
    commitAll();
    write({ repo, path: 'library/new/deep/b.txt' });

    expect(hasUncommittedChanges({ directory: repo, entry: 'library' })).toBe(true);
  });

  it('is false for an untracked entry holding only ignored files', async () => {
    const { path: repo, commitAll } = await tempGitRepo();
    write({ repo, path: '.gitignore', content: '*.log\n' });
    commitAll();
    write({ repo, path: 'library/sub/debug.log' });

    expect(hasUncommittedChanges({ directory: repo, entry: 'library' })).toBe(false);
  });

  it('is true for an untracked entry holding an untracked file beside ignored ones', async () => {
    const { path: repo, commitAll } = await tempGitRepo();
    write({ repo, path: '.gitignore', content: '*.log\n' });
    commitAll();
    write({ repo, path: 'library/logs/debug.log' });
    write({ repo, path: 'library/notes/a.txt' });

    expect(hasUncommittedChanges({ directory: repo, entry: 'library' })).toBe(true);
  });

  it('is false for an untracked entry holding only empty directories', async () => {
    const { path: repo, commitAll } = await tempGitRepo();
    write({ repo, path: 'other/a.txt' });
    commitAll();
    mkdirSync(join(repo, 'library/empty/deeper'), { recursive: true });

    expect(hasUncommittedChanges({ directory: repo, entry: 'library' })).toBe(false);
  });

  it('answers for the entry alone when directory is itself untracked', async () => {
    const { path: repo, commitAll } = await tempGitRepo();
    write({ repo, path: 'other/a.txt' });
    commitAll();
    write({ repo, path: 'skills/review/a.txt' });

    expect(hasUncommittedChanges({ directory: join(repo, 'skills'), entry: 'library' })).toBe(false);

    write({ repo, path: 'skills/library/a.txt' });

    expect(hasUncommittedChanges({ directory: join(repo, 'skills'), entry: 'library' })).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// the flags and the pathspec magic
// -----------------------------------------------------------------------------

describe('hasUncommittedChanges flags and pathspec magic', () => {
  it('reports an untracked file even when the repo config hides untracked files', async () => {
    const { path: repo, commitAll } = await tempGitRepo();
    write({ repo, path: 'library/a.txt' });
    commitAll();
    git({ repo, args: ['config', 'status.showUntrackedFiles', 'no'] });
    write({ repo, path: 'library/b.txt' });

    expect(hasUncommittedChanges({ directory: repo, entry: 'library' })).toBe(true);
  });

  it('treats an entry containing glob characters literally', async () => {
    const { path: repo, commitAll } = await tempGitRepo();
    write({ repo, path: 'mod*/a.txt' });
    write({ repo, path: 'modified/a.txt' });
    commitAll();
    write({ repo, path: 'modified/a.txt', content: 'changed' });

    expect(hasUncommittedChanges({ directory: repo, entry: 'mod*' })).toBe(false);

    write({ repo, path: 'mod*/a.txt', content: 'changed' });

    expect(hasUncommittedChanges({ directory: repo, entry: 'mod*' })).toBe(true);
  });

  it.each([
    { change: 'modified', committed: 'Library/a.txt', changed: 'Library/a.txt' },
    { change: 'untracked', committed: 'other/a.txt', changed: 'Library/a.txt' },
  ])('counts a $change file under an entry differing only in case', async (paths) => {
    const { path: repo, commitAll } = await tempGitRepo();
    write({ repo, path: paths.committed });
    commitAll();
    write({ repo, path: paths.changed, content: 'changed' });

    expect(hasUncommittedChanges({ directory: repo, entry: 'library' })).toBe(true);
  });

  it('leaves .git/index untouched when only a stat is stale', async () => {
    const { path: repo, commitAll } = await tempGitRepo();
    write({ repo, path: 'library/a.txt' });
    commitAll();
    const past = new Date(Date.now() - 60_000);
    utimesSync(join(repo, 'library/a.txt'), past, past);
    const before = readFileSync(join(repo, '.git/index'));

    hasUncommittedChanges({ directory: repo, entry: 'library' });

    expect(readFileSync(join(repo, '.git/index')).equals(before)).toBe(true);
  });
});

// -----------------------------------------------------------------------------
// git missing
// -----------------------------------------------------------------------------

describe('with git missing from PATH', () => {
  it('makes isInsideGitWorkTree throw GitUnavailableError', async () => {
    const { path: repo } = await tempGitRepo();
    vi.stubEnv('PATH', '');
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });

    expect(() => isInsideGitWorkTree({ directory: repo })).toThrow(GitUnavailableError);
  });

  it('makes hasUncommittedChanges throw GitUnavailableError', async () => {
    const { path: repo } = await tempGitRepo();
    vi.stubEnv('PATH', '');
    onTestFinished(() => {
      vi.unstubAllEnvs();
    });

    expect(() => hasUncommittedChanges({ directory: repo, entry: 'library' })).toThrow(
      GitUnavailableError,
    );
  });
});

// -----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// -----------------------------------------------------------------------------

function git(params: { repo: string; args: string[] }): void {
  const { repo, args } = params;

  execFileSync('git', ['-C', repo, ...args], { stdio: 'pipe' });
}

function write(params: { repo: string; path: string; content?: string }): void {
  const { repo, path, content = 'content' } = params;
  const target = join(repo, path);

  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function catchError(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }

  throw new Error('expected the call to throw');
}
