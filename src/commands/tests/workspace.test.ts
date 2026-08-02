import { existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import type { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceInUseError } from '#src/lib/errors/index';
import { buildProgram } from '#src/program';
import { GrimoireStore } from '#src/store/index';
import { tempRoot } from '#test-helpers/temp-root';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('workspace add', () => {
  it('confirms the registration on stdout', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    const { stdout } = run('workspace', 'add', 'personal', path);

    expect(stdout).toEqual([`registered workspace "personal" → ${path} (manual)`]);
    expect(store.loadConfig().workspaces.personal).toEqual({ path, autoLink: false });
  });

  it('honors --auto-link', async () => {
    const { run } = await newCli();
    const path = await newDirectory('project');

    const { stdout } = run('workspace', 'add', 'personal', path, '--auto-link');

    expect(stdout).toEqual([`registered workspace "personal" → ${path} (auto-link)`]);
  });

  // A created directory is a result, not a warning: it belongs on stdout.
  it('announces a directory it had to create, above the confirmation', async () => {
    const { run } = await newCli();
    const path = join(await newDirectory('project'), 'skills');

    const { stdout, stderr } = run('workspace', 'add', 'personal', path);

    expect(stdout).toEqual([`created ${path}`, `registered workspace "personal" → ${path} (manual)`]);
    expect(stderr).toEqual([]);
  });

  it('says nothing about creation when the directory was already there', async () => {
    const { run } = await newCli();

    const { stdout } = run('workspace', 'add', 'personal', await newDirectory('project'));

    expect(stdout).toHaveLength(1);
  });
});

describe('workspace list', () => {
  it('prints name, auto-link, and path in columns', async () => {
    const { run } = await newCli();
    const personal = await newDirectory('personal');
    const work = await newDirectory('work');

    run('workspace', 'add', 'personal', personal, '--auto-link');
    run('workspace', 'add', 'work', work);

    expect(run('workspace', 'list').stdout).toEqual([
      `personal  auto-link  ${personal}`,
      `work      manual     ${work}`,
    ]);
  });

  it('says so when nothing is registered', async () => {
    const { run } = await newCli();

    expect(run('workspace', 'list').stdout).toEqual(['No workspaces registered.']);
  });

  it('answers to ls identically', async () => {
    const { run } = await newCli();

    run('workspace', 'add', 'personal', await newDirectory('personal'));

    expect(run('workspace', 'ls').stdout).toEqual(run('workspace', 'list').stdout);
  });
});

describe('workspace remove', () => {
  it('unregisters without touching the directory', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    run('workspace', 'add', 'personal', path);

    const { stdout } = run('workspace', 'remove', 'personal');

    expect(stdout).toEqual([`unregistered workspace "personal" → ${path}`]);
    expect(store.loadConfig().workspaces).toEqual({});
    expect(existsSync(path)).toBe(true);
  });

  it('answers to rm identically', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    run('workspace', 'add', 'personal', path);
    const viaRm = run('workspace', 'rm', 'personal');

    const configAfterRm = readFileSync(store.paths.config, 'utf8');

    run('workspace', 'add', 'personal', path);
    const viaRemove = run('workspace', 'remove', 'personal');

    expect(viaRm.stdout).toEqual(viaRemove.stdout);
    expect(readFileSync(store.paths.config, 'utf8')).toBe(configAfterRm);
  });

  it('refuses while links still point at the workspace, naming all of them', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    run('workspace', 'add', 'personal', path);
    link({ store, workspacePath: path, skill: 'triage' });
    link({ store, workspacePath: path, skill: 'brainstorm' });

    const error = captureError(() => run('workspace', 'remove', 'personal'));

    expect(error).toBeInstanceOf(WorkspaceInUseError);
    expect(error.message).toBe(
      [
        'workspace "personal" is still in use',
        '  links: brainstorm, triage',
        '  use --hard to clear them',
      ].join('\n'),
    );
  });

  it('reports the clone records it rewrote to a path', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    run('workspace', 'add', 'personal', path);
    mkdirSync(join(path, 'deploy'));
    store.saveState({ deploy: { clones: [{ workspace: 'personal' }] } });

    const { stdout } = run('workspace', 'remove', 'personal');

    expect(stdout).toEqual([
      '1 clone now recorded by path: deploy',
      `unregistered workspace "personal" → ${path}`,
    ]);
    expect(store.loadState().deploy?.clones).toEqual([{ path }]);
  });

  it('reports what --hard cleared and what it left behind', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    run('workspace', 'add', 'personal', path);
    link({ store, workspacePath: path, skill: 'triage' });
    link({ store, workspacePath: path, skill: 'brainstorm' });
    mkdirSync(join(path, 'deploy'));
    store.saveState({ deploy: { clones: [{ workspace: 'personal' }] } });

    const { stdout } = run('workspace', 'remove', 'personal', '--hard');

    expect(stdout).toEqual([
      'removed 2 links: brainstorm, triage',
      'forgot 1 clone record: deploy',
      `unregistered workspace "personal" → ${path}`,
      'cloned directories were left in place',
    ]);
    expect(existsSync(join(path, 'deploy'))).toBe(true);
  });

  it("warns on stderr when the registered path turned out to be a repo's", async () => {
    const { run, store } = await newCli();
    const repo = await newDirectory('repo');
    const path = join(repo, 'skills');

    mkdirSync(path);
    store.saveConfig({
      ...store.loadConfig(),
      repos: { dots: { path: repo, mode: 'read-only' } },
      workspaces: { personal: { path, autoLink: false } },
    });
    link({ store, workspacePath: path, skill: 'brainstorm' });

    const { stdout, stderr } = run('workspace', 'remove', 'personal', '--hard');

    expect(stderr).toEqual([
      `warning: ${path} sits inside repo "dots" (${repo}) — no links were cleared from it`,
    ]);
    expect(stdout).toEqual([`unregistered workspace "personal" → ${path}`]);
    expect(existsSync(join(path, 'brainstorm'))).toBe(true);
  });

  it('does not claim anything survived when the cleared record names a directory that is gone', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    run('workspace', 'add', 'personal', path);
    store.saveState({ deploy: { clones: [{ workspace: 'personal' }] } });

    const { stdout } = run('workspace', 'remove', 'personal', '--hard');

    expect(stdout).toEqual([
      'forgot 1 clone record: deploy',
      `unregistered workspace "personal" → ${path}`,
    ]);
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

/** A directory to register, outside the store root — a path inside it collides. */
async function newDirectory(name: string): Promise<string> {
  const path = join(await tempRoot(), name);

  mkdirSync(path, { recursive: true });

  return path;
}

/** What the `link` command will write, hand-built — it does not exist yet. */
function link(fixture: { store: GrimoireStore; workspacePath: string; skill: string }): void {
  const target = join(fixture.store.paths.skills, fixture.skill);

  mkdirSync(target, { recursive: true });
  symlinkSync(target, join(fixture.workspacePath, fixture.skill));
}
