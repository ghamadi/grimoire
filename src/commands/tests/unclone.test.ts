import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CommanderError, type Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GrimoireStore } from '#src/domains/grimoire-store/index';
import { EntityNotFoundError } from '#src/lib/errors/index';
import { buildProgram } from '#src/program';
import { tempRoot } from '#test-helpers/temp-root';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('unclone', () => {
  it('forgets the record without any skill in the store', async () => {
    const { run, store } = await newCli();

    run('workspaces', 'add', 'personal', await newDirectory('project'));
    recordClone(store, 'triage', { workspace: 'personal' });

    const { stdout, stderr } = run('unclone', 'triage', 'personal');

    expect(stdout).toEqual(['uncloned triage → personal']);
    expect(stderr).toEqual([]);
    expect(clonesOf(store, 'triage')).toEqual([]);
  });

  it('says nothing was recorded to forget', async () => {
    const { run } = await newCli();

    run('workspaces', 'add', 'personal', await newDirectory('project'));

    expect(run('unclone', 'triage', 'personal').stdout).toEqual(['not cloned triage → personal']);
  });

  it('groups uncloned and not-cloned lines by outcome, keeping argument order within each', async () => {
    const { run, store } = await newCli();

    run('workspaces', 'add', 'work', await newDirectory('work'));
    run('workspaces', 'add', 'club', await newDirectory('club'));
    run('workspaces', 'add', 'personal', await newDirectory('personal'));
    recordClone(store, 'triage', { workspace: 'work' });
    recordClone(store, 'triage', { workspace: 'club' });

    const { stdout } = run('unclone', 'triage', 'personal', 'work', 'club');

    expect(stdout).toEqual([
      'uncloned triage → work',
      'uncloned triage → club',
      'not cloned triage → personal',
    ]);
  });

  it('forgets a path record and leaves the directory and its files on disk', async () => {
    const { run, store } = await newCli();
    const dir = await newDirectory('old');
    const skillFile = join(dir, 'triage', 'SKILL.md');

    run('workspaces', 'add', 'personal', await newDirectory('project'));
    mkdirSync(join(dir, 'triage'));
    writeFileSync(skillFile, '# triage\n', 'utf8');
    recordClone(store, 'triage', { path: dir });

    const { stdout } = run('unclone', 'triage', `${dir}/`);

    expect(stdout).toEqual([`uncloned triage → ${dir}`]);
    expect(existsSync(skillFile)).toBe(true);
  });

  it('refuses to run with no targets, leaving the record in place', async () => {
    const { run, store } = await newCli();

    run('workspaces', 'add', 'personal', await newDirectory('project'));
    recordClone(store, 'triage', { workspace: 'personal' });

    const error = captureError(() => run('unclone', 'triage'));

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).message).toBe("error: missing required argument 'targets'");
    expect(clonesOf(store, 'triage')).toEqual([{ workspace: 'personal' }]);
  });

  it('refuses an unregistered workspace before forgetting anything', async () => {
    const { run, store } = await newCli();

    run('workspaces', 'add', 'personal', await newDirectory('project'));
    recordClone(store, 'triage', { workspace: 'personal' });

    const error = captureError(() => run('unclone', 'triage', 'personal', 'ghost'));

    expect(error).toBeInstanceOf(EntityNotFoundError);
    expect(error.message).toBe('no workspace named "ghost"');
    expect(clonesOf(store, 'triage')).toEqual([{ workspace: 'personal' }]);
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
    const toStderr = (line: string) => void stderr.push(line);
    const error = vi.spyOn(console, 'error').mockImplementation(toStderr);
    const warn = vi.spyOn(console, 'warn').mockImplementation(toStderr);

    try {
      program.parse(argv, { from: 'user' });
    } finally {
      log.mockRestore();
      error.mockRestore();
      warn.mockRestore();
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

/** Appends a clone record to the skill's, keeping whatever `state.json` already holds. */
function recordClone(
  store: GrimoireStore,
  skill: string,
  record: { workspace: string } | { path: string },
): void {
  const state = readState(store);
  const skills = state.skills ?? {};
  const clones = skills[skill]?.clones ?? [];

  writeFileSync(
    store.paths.state,
    JSON.stringify(
      { ...state, skills: { ...skills, [skill]: { clones: [...clones, record] } } },
      null,
      2,
    ),
    'utf8',
  );
}

function clonesOf(store: GrimoireStore, skill: string): unknown[] {
  return readState(store).skills?.[skill]?.clones ?? [];
}

function readState(store: GrimoireStore): { skills?: Record<string, { clones?: unknown[] }> } {
  return JSON.parse(readFileSync(store.paths.state, 'utf8')) as ReturnType<typeof readState>;
}
