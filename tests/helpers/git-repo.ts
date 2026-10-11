import { execFileSync } from 'node:child_process';
import { tempRoot } from '@test-helpers/temp-root';

export type TempGitRepo = {
  /** The work tree's root. */
  path: string;
  /** Commits everything in the repository, untracked files included, even when nothing changed. */
  commitAll: () => void;
};

/**
 * A fresh, empty git repository for one test, cleaned up when that test
 * finishes. Nothing is committed, so `HEAD` is unborn until `commitAll`.
 *
 * `commitAll` comes bound to the repository rather than exported taking a
 * path, so no test can commit anywhere but the repository it created.
 */
export async function tempGitRepo(): Promise<TempGitRepo> {
  const path = await tempRoot();

  execFileSync('git', ['-C', path, 'init', '-q'], { stdio: 'pipe' });

  return { path, commitAll: () => commitEverything({ repo: path }) };
}

// -----------------------------------------------------------------------------
// INTERNAL HELPER FUNCTIONS
// -----------------------------------------------------------------------------

/**
 * Identity, signing, and hooks are pinned on the command so the commit never
 * depends on the developer's git config. `core.hooksPath` disables
 * `post-commit` too, which `--no-verify` would not.
 */
function commitEverything(params: { repo: string }): void {
  const { repo } = params;

  execFileSync('git', ['-C', repo, 'add', '-A'], { stdio: 'pipe' });
  execFileSync(
    'git',
    [
      '-C',
      repo,
      '-c',
      'user.name=grimoire-test',
      '-c',
      'user.email=test@grimoire.invalid',
      '-c',
      'commit.gpgsign=false',
      '-c',
      'core.hooksPath=/dev/null',
      'commit',
      '-q',
      '--allow-empty',
      '-m',
      'commit',
    ],
    { stdio: 'pipe' },
  );
}
