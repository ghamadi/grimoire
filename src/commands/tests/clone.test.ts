import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { CommanderError, type Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GrimoireStore } from '#src/domains/grimoire-store/index';
import { SKILL_MANIFEST } from '#src/domains/skill/index';
import { CloneDeclinedError, EntityNotFoundError, UnportableSkillError } from '#src/lib/errors/index';
import { buildProgram } from '#src/program';
import { tempRoot } from '#test-helpers/temp-root';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('clone', () => {
  it('confirms a copy it wrote into an empty destination', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('personal');
    const dest = join(path, 'triage');

    run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'triage');

    const { stdout, stderr } = run('clone', 'triage', 'personal');

    expect(stdout).toEqual(['cloned triage → personal']);
    expect(stderr).toEqual([]);
    expect(lstatSync(dest).isDirectory()).toBe(true);
    expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe(
      readFileSync(join(store.paths.skills, 'triage', SKILL_MANIFEST), 'utf8'),
    );
  });

  it('says it replaced a link into the store', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('personal');
    const dest = join(path, 'triage');

    run('workspaces', 'add', 'personal', path);
    symlinkSync(storeSkill(store, 'triage'), dest);

    const { stdout, stderr } = run('clone', 'triage', 'personal');

    expect(stdout).toEqual(['cloned triage → personal (replaced the link)']);
    expect(stderr).toEqual([]);
    expect(lstatSync(dest).isSymbolicLink()).toBe(false);
  });

  it('leaves a recorded clone alone and says so', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('personal');
    const dest = join(path, 'triage');

    run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'triage');
    run('clone', 'triage', 'personal');
    writeFileSync(join(dest, 'notes.md'), 'mine', 'utf8');

    const { stdout, stderr } = run('clone', 'triage', 'personal');

    expect(stdout).toEqual(['already cloned triage → personal']);
    expect(stderr).toEqual([]);
    expect(readFileSync(join(dest, 'notes.md'), 'utf8')).toBe('mine');
  });

  it('prints each group in turn, keeping argument order inside it, and exits clean past a refusal', async () => {
    const { run, store } = await newCli();
    const lab = await newDirectory('lab');

    run('workspaces', 'add', 'lab', lab);
    run('workspaces', 'add', 'second', await newDirectory('second'));
    run('workspaces', 'add', 'third', await newDirectory('third'));
    run('workspaces', 'add', 'first', await newDirectory('first'));
    storeSkill(store, 'triage');
    writeSkillDirectory(join(lab, 'triage'));
    run('clone', 'triage', 'second');

    const { stdout, stderr } = run('clone', 'triage', 'lab', 'second', 'third', 'first');

    expect(stdout).toEqual([
      'cloned triage → third',
      'cloned triage → first',
      'already cloned triage → second',
    ]);
    expect(stderr).toEqual([
      `warning: could not clone triage → lab: ${join(lab, 'triage')} already holds a directory — rerun with --adopt to keep it as the clone`,
    ]);
  });

  it('confirms an adopted directory under --adopt', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('personal');

    run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'triage');
    writeSkillDirectory(join(path, 'triage'));

    const { stdout, stderr } = run('clone', 'triage', 'personal', '--adopt');

    expect(stdout).toEqual(['adopted triage → personal']);
    expect(stderr).toEqual([]);
  });

  it('prints cloned before adopted', async () => {
    const { run, store } = await newCli();
    const scratch = await newDirectory('scratch');

    run('workspaces', 'add', 'personal', await newDirectory('personal'));
    run('workspaces', 'add', 'scratch', scratch);
    storeSkill(store, 'triage');
    writeSkillDirectory(join(scratch, 'triage'));

    const { stdout } = run('clone', 'triage', 'scratch', 'personal', '--adopt');

    expect(stdout).toEqual(['cloned triage → personal', 'adopted triage → scratch']);
  });

  it('declines a directory with no SKILL.md under --adopt', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('personal');
    const dest = join(path, 'triage');

    run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'triage');
    mkdirSync(dest, { recursive: true });

    const error = captureError(() => run('clone', 'triage', 'personal', '--adopt'));

    expect(error).toBeInstanceOf(CloneDeclinedError);
    expect(error.message).toBe(
      `could not clone triage → personal: ${dest} holds no SKILL.md, so it cannot be adopted`,
    );
  });

  it('throws the refusal itself when the only destination is declined', async () => {
    const { run, store } = await newCli();
    const lab = await newDirectory('lab');
    const dest = join(lab, 'triage');

    run('workspaces', 'add', 'lab', lab);
    storeSkill(store, 'triage');
    writeSkillDirectory(dest);

    const error = captureError(() => run('clone', 'triage', 'lab'));

    expect(error).toBeInstanceOf(CloneDeclinedError);
    expect(error.message).toBe(
      `could not clone triage → lab: ${dest} already holds a directory — rerun with --adopt to keep it as the clone`,
    );
  });

  it('throws one error listing every refusal when nothing was cloned', async () => {
    const { run, store } = await newCli();
    const lab = await newDirectory('lab');
    const other = await newDirectory('other');

    run('workspaces', 'add', 'lab', lab);
    run('workspaces', 'add', 'other', other);
    storeSkill(store, 'triage');
    writeSkillDirectory(join(lab, 'triage'));
    writeFileSync(join(other, 'triage'), 'not a skill', 'utf8');

    const error = captureError(() => run('clone', 'triage', 'lab', 'other'));

    expect(error).toBeInstanceOf(CloneDeclinedError);
    expect(error.message.split('\n')).toEqual([
      'nothing cloned:',
      `  could not clone triage → lab: ${join(lab, 'triage')} already holds a directory — rerun with --adopt to keep it as the clone`,
      `  could not clone triage → other: ${join(other, 'triage')} is not a directory`,
    ]);
  });

  it('names the workspace path when the workspace directory is gone', async () => {
    const { run, store } = await newCli();
    const gone = await newDirectory('gone');

    run('workspaces', 'add', 'gone', gone);
    storeSkill(store, 'triage');
    rmSync(gone, { recursive: true });

    const error = captureError(() => run('clone', 'triage', 'gone'));

    expect(error).toBeInstanceOf(CloneDeclinedError);
    expect(error.message).toBe(`could not clone triage → gone: ${gone} is not an existing directory`);
  });

  it('refuses to run without a workspace', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('personal');

    run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'triage');

    const error = captureError(() => run('clone', 'triage'));

    expect(error).toBeInstanceOf(CommanderError);
    expect(error.message).toBe("error: missing required argument 'workspaces'");
    expect(existsSync(join(path, 'triage'))).toBe(false);
  });

  it('refuses a skill the store does not hold', async () => {
    const { run } = await newCli();
    const path = await newDirectory('personal');

    run('workspaces', 'add', 'personal', path);

    const error = captureError(() => run('clone', 'ghost', 'personal'));

    expect(error).toBeInstanceOf(EntityNotFoundError);
    expect(error.message).toBe('no skill named "ghost"');
    expect(existsSync(join(path, 'ghost'))).toBe(false);
  });

  it('refuses a skill that cannot travel', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('personal');
    const skillPath = storeSkill(store, 'triage');

    run('workspaces', 'add', 'personal', path);
    writeSkillDirectory(join(skillPath, 'nested'));

    const error = captureError(() => run('clone', 'triage', 'personal'));

    expect(error).toBeInstanceOf(UnportableSkillError);
    expect(error.message).toBe(`skill "${skillPath}" is not portable. Contains a nested skill.`);
    expect(existsSync(join(path, 'triage'))).toBe(false);
  });

  it('refuses a workspace that is not registered', async () => {
    const { run, store } = await newCli();

    storeSkill(store, 'triage');

    const error = captureError(() => run('clone', 'triage', 'ghost'));

    expect(error).toBeInstanceOf(EntityNotFoundError);
    expect(error.message).toBe('no workspace named "ghost"');
  });

  it('checks the skill before the workspaces', async () => {
    const { run, store } = await newCli();
    const skillPath = storeSkill(store, 'triage');

    const unknownSkill = captureError(() => run('clone', 'ghost', 'ghostspace'));

    expect(unknownSkill.message).toBe('no skill named "ghost"');

    writeSkillDirectory(join(skillPath, 'nested'));

    const unportableSkill = captureError(() => run('clone', 'triage', 'ghostspace'));

    expect(unportableSkill).toBeInstanceOf(UnportableSkillError);
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
