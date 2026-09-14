import { mkdirSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CommanderError, type Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GrimoireStore } from '#src/domains/grimoire-store/index';
import { SKILL_MANIFEST } from '#src/domains/skill/index';
import { LinkDeclinedError } from '#src/lib/errors/index';
import { buildProgram } from '#src/program';
import { tempRoot } from '#test-helpers/temp-root';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('link', () => {
  it('confirms each link it wrote on stdout', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    run('workspace', 'add', 'personal', path);
    storeSkill(store, 'brainstorm');

    const { stdout, stderr } = run('link', 'brainstorm', 'personal');

    expect(stdout).toEqual(['linked brainstorm → personal']);
    expect(stderr).toEqual([]);
  });

  it('says a correct link was already in place', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    run('workspace', 'add', 'personal', path);
    symlinkSync(storeSkill(store, 'brainstorm'), join(path, 'brainstorm'));

    expect(run('link', 'brainstorm', 'personal').stdout).toEqual([
      'already linked brainstorm → personal',
    ]);
  });

  // The swap is silent: the store demonstrably held that content already.
  it('prints the plain confirmation for an identical directory it replaced', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');
    const occupied = join(path, 'brainstorm');

    run('workspace', 'add', 'personal', path);
    storeSkill(store, 'brainstorm');
    writeSkillDirectory(occupied);

    const { stdout, stderr } = run('link', 'brainstorm', 'personal');

    expect(stdout).toEqual(['linked brainstorm → personal']);
    expect(stderr).toEqual([]);
    expect(readlinkSync(occupied)).toBe(join(store.paths.skills, 'brainstorm'));
  });

  it('warns on stderr about what it declined and keeps its exit clean', async () => {
    const { run, store } = await newCli();
    const personal = await newDirectory('personal');
    const work = await newDirectory('work');
    const occupied = join(personal, 'brainstorm');

    run('workspace', 'add', 'personal', personal);
    run('workspace', 'add', 'work', work);
    storeSkill(store, 'brainstorm');
    writeSkillDirectory(occupied, { [SKILL_MANIFEST]: 'edited' });

    const { stdout, stderr } = run('link', 'brainstorm', 'personal', 'work');

    expect(stdout).toEqual(['linked brainstorm → work']);
    expect(stderr).toEqual([
      `warning: could not link brainstorm → personal: ${occupied} holds a directory that differs from the store copy at "SKILL.md" — keep it with \`clone\`, or delete it yourself`,
    ]);
  });

  it('links into every auto-link workspace when none is named', async () => {
    const { run, store } = await newCli();

    run('workspace', 'add', 'personal', await newDirectory('personal'), '--auto-link');
    run('workspace', 'add', 'work', await newDirectory('work'));
    storeSkill(store, 'brainstorm');

    expect(run('link', 'brainstorm').stdout).toEqual(['linked brainstorm → personal']);
  });

  // Nothing was stepped over, so there is no warning to print — and a command
  // that succeeded in silence is indistinguishable from one that broke.
  it('says why a run with no auto-link workspace printed nothing', async () => {
    const { run, store } = await newCli();

    run('workspace', 'add', 'personal', await newDirectory('project'));
    storeSkill(store, 'brainstorm');

    expect(run('link', 'brainstorm').stdout).toEqual([
      'nothing to link: no auto-link workspace is registered',
    ]);
  });

  it('refuses to run with neither a skill nor --all', async () => {
    const { run } = await newCli();

    run('workspace', 'add', 'personal', await newDirectory('project'));

    const error = captureError(() => run('link'));

    expect(error).toBeInstanceOf(CommanderError);
    expect(error.message).toContain("missing required argument 'skill'");
  });

  it('lets a run that linked nothing at all escape as a refusal', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    run('workspace', 'add', 'personal', path);
    storeSkill(store, 'brainstorm');
    writeFileSync(join(path, 'brainstorm'), 'not a skill', 'utf8');

    expect(captureError(() => run('link', 'brainstorm', 'personal'))).toBeInstanceOf(LinkDeclinedError);
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

/** A skill directory, whose manifest any entry in `files` may override. */
function writeSkillDirectory(path: string, files: Record<string, string> = {}): string {
  mkdirSync(path, { recursive: true });

  for (const [name, content] of Object.entries({ [SKILL_MANIFEST]: '# skill\n', ...files })) {
    writeFileSync(join(path, name), content, 'utf8');
  }

  return path;
}

function storeSkill(store: GrimoireStore, name: string): string {
  return writeSkillDirectory(join(store.paths.skills, name));
}
