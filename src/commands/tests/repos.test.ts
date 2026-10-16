import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CommanderError, type Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GrimoireStore } from '@/domains/grimoire-store/index';
import {
  CollidingRegistrationError,
  DuplicateNameError,
  EntityNotFoundError,
  InvalidPathError,
  PathCollisionError,
} from '@/lib/errors/index';
import { buildProgram } from '@/program';
import { tempGitRepo } from '@test-helpers/git-repo';
import { tempRoot } from '@test-helpers/temp-root';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('repos add', () => {
  it('confirms the registration on stdout', async () => {
    const { run, store } = await newCli();
    const { path: repo } = await tempGitRepo();

    const { stdout } = run('repos', 'add', 'library', repo);

    expect(stdout).toEqual([`registered repo "library" → ${repo}`]);
    expect(readRepos(store)).toEqual({ library: { path: repo } });
  });

  it('registers a subdirectory of a work tree', async () => {
    const { run, store } = await newCli();
    const { path: repo } = await tempGitRepo();
    const path = join(repo, 'skills');

    mkdirSync(path);

    const { stdout } = run('repos', 'add', 'library', path);

    expect(stdout).toEqual([`registered repo "library" → ${path}`]);
    expect(readRepos(store)).toEqual({ library: { path } });
  });

  it('registers under a name a workspace already has', async () => {
    const { run, store } = await newCli();
    const { path: repo } = await tempGitRepo();

    run('workspaces', 'add', 'personal', await newDirectory('project'));
    run('repos', 'add', 'personal', repo);

    expect(readRepos(store)).toEqual({ personal: { path: repo } });
  });

  describe('refusals', () => {
    it('refuses a name outside the allowed alphabet', async () => {
      const { run, store } = await newCli();
      const { path: repo } = await tempGitRepo();

      const error = captureError(() => run('repos', 'add', 'a/b', repo));

      expect(error.message).toBe(
        'repo name "a/b" must start with a letter or digit and contain only letters, digits, "-" and "_"',
      );
      expect(readRepos(store)).toEqual({});
    });

    it('refuses a name that is already registered, keeping the first path', async () => {
      const { run, store } = await newCli();
      const { path: taken } = await tempGitRepo();
      const { path: repo } = await tempGitRepo();

      run('repos', 'add', 'library', taken);

      const error = captureError(() => run('repos', 'add', 'library', repo));

      expect(error).toBeInstanceOf(DuplicateNameError);
      expect(error.message).toBe('repo "library" is already registered');
      expect(readRepos(store)).toEqual({ library: { path: taken } });
    });

    it('refuses a relative path, echoing it as typed', async () => {
      const { run, store } = await newCli();

      const error = captureError(() => run('repos', 'add', 'library', 'project'));

      expect(error).toBeInstanceOf(InvalidPathError);
      expect(error.message).toBe('project must be an absolute path or start with ~/');
      expect(readRepos(store)).toEqual({});
    });

    it('refuses a missing path, creating nothing', async () => {
      const { run, store } = await newCli();
      const path = join(await newDirectory('project'), 'skills');

      const error = captureError(() => run('repos', 'add', 'library', path));

      expect(error).toBeInstanceOf(InvalidPathError);
      expect(error.message).toBe(`${path} does not exist`);
      expect(existsSync(path)).toBe(false);
      expect(readRepos(store)).toEqual({});
    });

    it('refuses a path that is not inside a git work tree', async () => {
      const { run, store } = await newCli();
      const path = await tempRoot();

      const error = captureError(() => run('repos', 'add', 'library', path));

      expect(error).toBeInstanceOf(InvalidPathError);
      expect(error.message).toBe(`${path} is not inside a git work tree`);
      expect(readRepos(store)).toEqual({});
    });

    it('refuses a path sitting inside the store', async () => {
      const { run, store } = await newCli();
      const path = join(store.paths.skills, 'library');

      const error = captureError(() => run('repos', 'add', 'library', path));

      expect(error).toBeInstanceOf(PathCollisionError);
      expect(error.message).toBe(`${path} sits inside the grimoire store (${store.paths.root})`);
      expect(readRepos(store)).toEqual({});
    });

    it('refuses a path containing a registered workspace', async () => {
      const { run, store } = await newCli();
      const { path: repo } = await tempGitRepo();
      const workspace = join(repo, 'skills');

      run('workspaces', 'add', 'personal', workspace);

      const error = captureError(() => run('repos', 'add', 'library', repo));

      expect(error).toBeInstanceOf(PathCollisionError);
      expect(error.message).toBe(`${repo} contains workspace "personal" (${workspace})`);
      expect(readRepos(store)).toEqual({});
    });

    it('refuses an invocation naming no path', async () => {
      const { run, store } = await newCli();

      const error = captureError(() => run('repos', 'add', 'library'));

      expect(error).toBeInstanceOf(CommanderError);
      expect(readRepos(store)).toEqual({});
    });
  });
});

describe('repos list', () => {
  it('prints name and path in columns', async () => {
    const { run } = await newCli();
    const { path: docs } = await tempGitRepo();
    const { path: library } = await tempGitRepo();

    run('repos', 'add', 'docs', docs);
    run('repos', 'add', 'library', library);

    expect(run('repos', 'list').stdout).toEqual([`docs     ${docs}`, `library  ${library}`]);
  });

  it('sorts by name rather than by registration order', async () => {
    const { run } = await newCli();
    const { path: zeta } = await tempGitRepo();
    const { path: alpha } = await tempGitRepo();

    run('repos', 'add', 'zeta', zeta);
    run('repos', 'add', 'alpha', alpha);

    expect(run('repos', 'list').stdout).toEqual([`alpha  ${alpha}`, `zeta   ${zeta}`]);
  });

  it('says so when nothing is registered', async () => {
    const { run } = await newCli();

    expect(run('repos', 'list').stdout).toEqual(['No repos registered.']);
  });

  it('answers to ls identically', async () => {
    const { run } = await newCli();
    const { path: repo } = await tempGitRepo();

    run('repos', 'add', 'library', repo);

    expect(run('repos', 'ls').stdout).toEqual(run('repos', 'list').stdout);
  });

  it('refuses to load a repo overlapping a workspace, naming the workspace', async () => {
    const { run, store } = await newCli();
    const { path: repo } = await tempGitRepo();
    const workspace = join(repo, 'skills');

    mkdirSync(workspace);
    writeDocument(store, {
      workspaces: { personal: { path: workspace, autoLink: false } },
      repos: { library: { path: repo } },
    });

    const error = captureError(() => run('repos', 'list'));

    expect(error).toBeInstanceOf(CollidingRegistrationError);
    expect(error.message.split('\n')[0]).toBe(
      `workspace "personal" cannot be used: ${workspace} sits inside repo "library" (${repo})`,
    );
  });
});

describe('repos remove', () => {
  it('unregisters without touching the directory', async () => {
    const { run, store } = await newCli();
    const { path: repo } = await tempGitRepo();

    run('repos', 'add', 'library', repo);

    const { stdout } = run('repos', 'remove', 'library');

    expect(stdout).toEqual([`unregistered repo "library" \u2192 ${repo}`]);
    expect(readRepos(store)).toEqual({});
    expect(existsSync(repo)).toBe(true);
  });

  it('unregisters a repo whose directory is gone', async () => {
    const { run, store } = await newCli();
    const { path: repo } = await tempGitRepo();

    run('repos', 'add', 'library', repo);
    rmSync(repo, { recursive: true });

    const { stdout } = run('repos', 'remove', 'library');

    expect(stdout).toEqual([`unregistered repo "library" \u2192 ${repo}`]);
    expect(readRepos(store)).toEqual({});
  });

  it('refuses a name that is not registered', async () => {
    const { run } = await newCli();

    const error = captureError(() => run('repos', 'remove', 'ghost'));

    expect(error).toBeInstanceOf(EntityNotFoundError);
    expect(error.message).toBe('no repo named "ghost"');
  });

  it('answers to rm identically', async () => {
    const { run, store } = await newCli();
    const { path: repo } = await tempGitRepo();

    run('repos', 'add', 'library', repo);
    const viaRm = run('repos', 'rm', 'library');

    const stateAfterRm = readFileSync(store.paths.state, 'utf8');

    run('repos', 'add', 'library', repo);
    const viaRemove = run('repos', 'remove', 'library');

    expect(viaRm.stdout).toEqual(viaRemove.stdout);
    expect(readFileSync(store.paths.state, 'utf8')).toBe(stateAfterRm);
  });
});

describe('repos rename', () => {
  const library = { path: '/repos/library' };

  /** A CLI whose registry holds `library`, at a path that does not exist. */
  async function withLibrary() {
    const cli = await newCli();

    writeDocument(cli.store, { repos: { library } });

    return cli;
  }

  it('files the repo under the new name, keeping its path, even with its directory gone', async () => {
    const { run, store } = await withLibrary();

    const { stdout } = run('repos', 'rename', 'library', 'docs');

    expect(stdout).toEqual(['renamed repo "library" → "docs"']);
    expect(readRepos(store)).toEqual({ docs: library });
  });

  it('says so when the new name is the current one', async () => {
    const { run, store } = await withLibrary();

    const { stdout } = run('repos', 'rename', 'library', 'library');

    expect(stdout).toEqual(['nothing to rename: repo "library" already has that name']);
    expect(readRepos(store)).toEqual({ library });
  });

  describe('refusals', () => {
    it('refuses a name that is not registered', async () => {
      const { run, store } = await withLibrary();

      const error = captureError(() => run('repos', 'rename', 'ghost', 'docs'));

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect(error.message).toBe('no repo named "ghost"');
      expect(readRepos(store)).toEqual({ library });
    });

    it('refuses a new name outside the allowed alphabet', async () => {
      const { run, store } = await withLibrary();

      const error = captureError(() => run('repos', 'rename', 'library', 'a/b'));

      expect(error.message).toBe(
        'repo name "a/b" must start with a letter or digit and contain only letters, digits, "-" and "_"',
      );
      expect(readRepos(store)).toEqual({ library });
    });

    it('refuses a new name another repo holds', async () => {
      const { run, store } = await withLibrary();
      const docs = { path: '/repos/docs' };

      writeDocument(store, { repos: { library, docs } });

      const error = captureError(() => run('repos', 'rename', 'library', 'docs'));

      expect(error).toBeInstanceOf(DuplicateNameError);
      expect(error.message).toBe('repo "docs" is already registered');
      expect(readRepos(store)).toEqual({ library, docs });
    });

    it('refuses an invocation naming no new name', async () => {
      const { run, store } = await withLibrary();

      const error = captureError(() => run('repos', 'rename', 'library'));

      expect(error).toBeInstanceOf(CommanderError);
      expect(readRepos(store)).toEqual({ library });
    });
  });
});

/**
 * A program wired to a throwaway store, driven in process.
 *
 * `.exitOverride()` turns commander's `process.exit(1)` into a thrown
 * `CommanderError`, and console is spied rather than `configureOutput`-ed
 * because the actions print through console directly.
 */
async function newCli() {
  const store = new GrimoireStore(await tempRoot());
  const program = silence(buildProgram(store));

  function run(...argv: string[]) {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void stdout.push(line));
    const error = vi
      .spyOn(console, 'error')
      .mockImplementation((line: string) => void stderr.push(line));

    try {
      program.parse(argv, { from: 'user' });
    } finally {
      log.mockRestore();
      error.mockRestore();
    }

    return { stdout, stderr };
  }

  return { run, store };
}

/**
 * Makes the whole command tree throw instead of exiting, and keeps commander's
 * own error text out of the test runner's output.
 *
 * Applied to every command rather than just the root: commander copies these
 * settings into a subcommand when `.command()` creates it, so a tree that is
 * fully built before `.exitOverride()` is called never receives them, and
 * `.addCommand()` does not copy them at all.
 */
function silence(program: Command): Command {
  program.exitOverride().configureOutput({ writeOut: () => {}, writeErr: () => {} });

  for (const subcommand of program.commands) {
    silence(subcommand);
  }

  return program;
}

/** The error a refusal threw, so the whole multi-line message can be asserted on. */
function captureError(operation: () => unknown): Error {
  try {
    operation();
  } catch (error) {
    return error as Error;
  }

  throw new Error('expected a refusal');
}

/** A directory outside the store root and outside any git work tree. */
async function newDirectory(name: string): Promise<string> {
  const path = join(await tempRoot(), name);

  mkdirSync(path, { recursive: true });

  return path;
}

/** state.json as it sits on disk, carrying only the sections these tests touch. */
type StoredDocument = {
  workspaces?: Record<string, { path: string; autoLink: boolean }>;
  repos?: Record<string, { path: string }>;
};

/**
 * The registry as state.json holds it, keyed by name.
 *
 * Read off disk rather than through the manager, so an assertion about what was
 * written cannot be satisfied by the code that wrote it.
 */
function readRepos(store: GrimoireStore): Record<string, { path: string }> {
  return readDocument(store).repos ?? {};
}

/** Merged into whatever state.json already holds, the way an edit by hand would be. */
function writeDocument(store: GrimoireStore, sections: StoredDocument): void {
  writeFileSync(store.paths.state, JSON.stringify({ ...readDocument(store), ...sections }), 'utf8');
}

function readDocument(store: GrimoireStore): StoredDocument {
  if (!existsSync(store.paths.state)) {
    return {};
  }

  return JSON.parse(readFileSync(store.paths.state, 'utf8')) as StoredDocument;
}
