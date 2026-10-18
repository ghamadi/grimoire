import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { GitUnavailableError } from '@/lib/errors';
import { isErrnoException } from '@/lib/fs';

/**
 * Whether `directory` is inside a git work tree. `.git` itself is not: git
 * answers `false` there.
 *
 * Any failure to ask reads as `false` — a missing path, a file, a directory
 * outside every repository.
 *
 * @throws GitUnavailableError when git cannot be spawned.
 */
export function isInsideGitWorkTree(params: { directory: string }): boolean {
  const { directory } = params;
  const result = runGit({ directory, args: ['rev-parse', '--is-inside-work-tree'] });

  return result.status === 0 && result.stdout.trim() === 'true';
}

/**
 * Whether anything at `entry` — resolved against `directory` — differs from
 * the last commit: modified, staged, deleted, or untracked. Ignored files do
 * not count. `entry` matches whatever its case, so on a case-sensitive
 * filesystem a sibling differing only in case counts too.
 *
 * @throws GitUnavailableError when git cannot be spawned.
 * @throws Error when `directory` is not inside a work tree, or git fails otherwise.
 */
export function hasUncommittedChanges(params: { directory: string; entry: string }): boolean {
  const { directory, entry } = params;
  const result = runGit({
    directory,
    args: [
      // Without it, `status` rewrites the index, racing any other git process the user has running.
      '--no-optional-locks',
      'status',
      '--porcelain',
      // Without it, a user's `status.showUntrackedFiles=no` hides new files.
      // `normal`, not `all`: an untracked directory answers in one line rather than one per file.
      '--untracked-files=normal',
      '--',
      // Without `literal`, an entry like `mod*` is a glob and matches siblings.
      // Without `icase`, a case-insensitive filesystem serves `Triage/` at `triage` while git,
      // matching by case, reports nothing there.
      `:(icase,literal)${entry}`,
    ],
  });

  if (result.status !== 0) {
    throw new Error(`could not check ${directory} for uncommitted changes: ${result.stderr.trim()}`);
  }

  return result.stdout.length > 0;
}

// -----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// -----------------------------------------------------------------------------

function runGit(params: { directory: string; args: string[] }): SpawnSyncReturns<string> {
  const { directory, args } = params;

  // `-C`, not spawn's `cwd`: a missing `cwd` also fails with ENOENT, which would read as git not being installed.
  const result = spawnSync('git', ['-C', directory, ...args], {
    encoding: 'utf8',
    // Without it, a `status` listing past 1 MB fails the spawn with ENOBUFS.
    maxBuffer: Infinity,
  });

  if (result.error) {
    throw isErrnoException(result.error, 'ENOENT') ? new GitUnavailableError() : result.error;
  }

  return result;
}
