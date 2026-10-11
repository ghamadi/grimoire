import { lstatSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CommanderError, type Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GrimoireStore } from '@/domains/grimoire-store/index';
import { SKILL_MANIFEST } from '@/domains/skill/index';
import { EntityNotFoundError, UnlinkDeclinedError } from '@/lib/errors/index';
import { buildProgram } from '@/program';
import { tempRoot } from '@test-helpers/temp-root';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('unlink', () => {
  it('removes the link', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    run('workspaces', 'add', 'personal', path);
    symlinkSync(storeSkill(store, 'brainstorm'), join(path, 'brainstorm'));

    const { stdout, stderr } = run('unlink', 'brainstorm', 'personal');

    expect(stdout).toEqual(['unlinked brainstorm → personal']);
    expect(stderr).toEqual([]);
    expect(lstatSync(join(path, 'brainstorm'), { throwIfNoEntry: false })).toBeUndefined();
  });

  it('says nothing was there to unlink', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'brainstorm');

    expect(run('unlink', 'brainstorm', 'personal').stdout).toEqual(['not linked brainstorm → personal']);
  });

  it('groups unlinked and not-linked lines by outcome, not argument order', async () => {
    const { run, store } = await newCli();
    const work = await newDirectory('work');
    const club = await newDirectory('club');
    const personal = await newDirectory('personal');

    run('workspaces', 'add', 'work', work);
    run('workspaces', 'add', 'club', club);
    run('workspaces', 'add', 'personal', personal);
    storeSkill(store, 'brainstorm');
    mkdirSync(join(club, 'brainstorm'));
    symlinkSync(storeSkill(store, 'brainstorm'), join(personal, 'brainstorm'));

    const { stdout, stderr } = run('unlink', 'brainstorm', 'work', 'club', 'personal');

    expect(stdout).toEqual(['unlinked brainstorm → personal', 'not linked brainstorm → work']);
    expect(stderr).toEqual([
      `warning: could not unlink brainstorm → club: ${join(club, 'brainstorm')} is a directory, not a link`,
    ]);
  });

  it('lets a run that unlinked nothing at all escape as a refusal', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'brainstorm');
    mkdirSync(join(path, 'brainstorm'));

    expect(captureError(() => run('unlink', 'brainstorm', 'personal'))).toBeInstanceOf(
      UnlinkDeclinedError,
    );
  });

  it('refuses to run with no workspaces named', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    run('workspaces', 'add', 'personal', path);
    symlinkSync(storeSkill(store, 'brainstorm'), join(path, 'brainstorm'));

    const error = captureError(() => run('unlink', 'brainstorm'));

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).message).toBe(
      "error: missing required argument 'workspaces' (or use --all-workspaces)",
    );
    expect(lstatSync(join(path, 'brainstorm')).isSymbolicLink()).toBe(true);
  });

  it('lets an unknown skill escape as a refusal', async () => {
    const { run } = await newCli();

    run('workspaces', 'add', 'personal', await newDirectory('project'));

    expect(captureError(() => run('unlink', 'brainstorm', 'personal'))).toBeInstanceOf(
      EntityNotFoundError,
    );
  });

  describe('--all-workspaces', () => {
    it('reports every registered workspace, each group sorted by name', async () => {
      const { run, store } = await newCli();
      const work = await newDirectory('work');
      const personal = await newDirectory('personal');
      const club = await newDirectory('club');

      run('workspaces', 'add', 'work', work);
      run('workspaces', 'add', 'personal', personal);
      run('workspaces', 'add', 'club', club);
      const skillPath = storeSkill(store, 'brainstorm');
      symlinkSync(skillPath, join(work, 'brainstorm'));
      symlinkSync(skillPath, join(personal, 'brainstorm'));
      mkdirSync(join(club, 'brainstorm'));

      const { stdout, stderr } = run('unlink', 'brainstorm', '--all-workspaces');

      expect(stdout).toEqual(['unlinked brainstorm → personal', 'unlinked brainstorm → work']);
      expect(stderr).toEqual([
        `warning: could not unlink brainstorm → club: ${join(club, 'brainstorm')} is a directory, not a link`,
      ]);
    });

    it('says a workspace without the link was not linked', async () => {
      const { run, store } = await newCli();
      const work = await newDirectory('work');

      run('workspaces', 'add', 'personal', await newDirectory('personal'));
      run('workspaces', 'add', 'work', work);
      symlinkSync(storeSkill(store, 'brainstorm'), join(work, 'brainstorm'));

      expect(run('unlink', 'brainstorm', '--all-workspaces').stdout).toEqual([
        'unlinked brainstorm → work',
        'not linked brainstorm → personal',
      ]);
    });

    it('says why a run with no registered workspace printed nothing', async () => {
      const { run, store } = await newCli();

      storeSkill(store, 'brainstorm');

      const { stdout, stderr } = run('unlink', 'brainstorm', '--all-workspaces');

      expect(stdout).toEqual(['nothing to unlink: no workspace is registered']);
      expect(stderr).toEqual([]);
    });

    it('refuses to combine named workspaces with --all-workspaces, leaving the link in place', async () => {
      const { run, store } = await newCli();
      const path = await newDirectory('project');

      run('workspaces', 'add', 'personal', path);
      const linkPath = join(path, 'brainstorm');
      symlinkSync(storeSkill(store, 'brainstorm'), linkPath);

      const error = captureError(() => run('unlink', 'brainstorm', 'personal', '--all-workspaces'));

      expect(error).toBeInstanceOf(CommanderError);
      expect((error as CommanderError).message).toBe(
        'error: --all-workspaces cannot be combined with named workspaces',
      );
      expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
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

function storeSkill(store: GrimoireStore, name: string): string {
  const path = join(store.paths.skills, name);

  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, SKILL_MANIFEST), '# skill\n', 'utf8');

  return path;
}
