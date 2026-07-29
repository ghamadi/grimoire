import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CommanderError, type Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildProgram } from '#src/program';
import { GrimoireStore } from '#src/store/index';
import { tempRoot } from '#test-helpers/temp-root';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('repo add', () => {
  it('confirms the registration on stdout', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('skills');

    const { stdout } = run('repo', 'add', 'personal', path);

    expect(stdout).toEqual([`registered repo "personal" → ${path} (read-only)`]);
    expect(store.loadConfig().repos.personal).toEqual({ path, mode: 'read-only' });
  });

  it('honors an explicit --mode', async () => {
    const { run } = await newCli();
    const path = await newDirectory('skills');

    const { stdout } = run('repo', 'add', 'personal', path, '--mode', 'read-write');

    expect(stdout).toEqual([`registered repo "personal" → ${path} (read-write)`]);
  });

  // A warning is not a result: piping stdout to another command must not pick
  // it up.
  it('puts the .git warning on stderr, not stdout', async () => {
    const { run } = await newCli();
    const path = await newDirectory('skills');

    const { stdout, stderr } = run('repo', 'add', 'personal', path);

    expect(stderr).toEqual([`warning: no .git found at or above ${path}`]);
    expect(stdout.join('\n')).not.toContain('warning');
  });

  it('rejects an unknown mode before touching the store', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('skills');

    expect(() => run('repo', 'add', 'personal', path, '--mode', 'rw')).toThrow(CommanderError);

    expect(existsSync(store.paths.config)).toBe(false);
  });
});

describe('repo list', () => {
  it('prints name, mode, and path in columns', async () => {
    const { run } = await newCli();

    run('repo', 'add', 'personal', await newDirectory('personal'), '--mode', 'read-write');
    run('repo', 'add', 'team', await newDirectory('team'));

    const { stdout } = run('repo', 'list');

    expect(stdout).toHaveLength(2);
    expect(stdout[0]).toMatch(/^personal {2}read-write {2}\//);
    expect(stdout[1]).toMatch(/^team {6}read-only {3}\//);
  });

  it('says so when nothing is registered', async () => {
    const { run } = await newCli();

    expect(run('repo', 'list').stdout).toEqual(['No repos registered.']);
  });

  it('answers to ls identically', async () => {
    const { run } = await newCli();

    run('repo', 'add', 'personal', await newDirectory('personal'));

    expect(run('repo', 'ls').stdout).toEqual(run('repo', 'list').stdout);
  });
});

describe('repo remove', () => {
  it('unregisters without touching the directory', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('skills');

    run('repo', 'add', 'personal', path);

    const { stdout } = run('repo', 'remove', 'personal');

    expect(stdout).toEqual([`unregistered repo "personal" → ${path}`]);
    expect(store.loadConfig().repos).toEqual({});
    expect(existsSync(path)).toBe(true);
  });

  it('answers to rm identically', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('skills');

    run('repo', 'add', 'personal', path);
    const viaRm = run('repo', 'rm', 'personal');

    const configAfterRm = readFileSync(store.paths.config, 'utf8');

    run('repo', 'add', 'personal', path);
    const viaRemove = run('repo', 'remove', 'personal');

    expect(viaRm.stdout).toEqual(viaRemove.stdout);
    expect(readFileSync(store.paths.config, 'utf8')).toBe(configAfterRm);
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

/** A directory to register, outside the store root — a path inside it collides. */
async function newDirectory(name: string): Promise<string> {
  const path = join(await tempRoot(), name);

  mkdirSync(path, { recursive: true });

  return path;
}
