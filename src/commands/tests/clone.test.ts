import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { CommanderError, type Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GrimoireStore } from '@/domains/grimoire-store';
import { SKILL_MANIFEST } from '@/domains/skill';
import {
  CloneDeclinedError,
  CloneFailedError,
  EntityNotFoundError,
  UnportableSkillError,
} from '@/lib/errors';
import { buildProgram } from '@/program';
import { tempRoot } from '@test-helpers/temp-root';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();

  return { ...actual, rmSync: vi.fn(actual.rmSync) };
});

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
    const scratch = await newDirectory('scratch');

    run('workspaces', 'add', 'lab', lab);
    run('workspaces', 'add', 'scratch', scratch);
    run('workspaces', 'add', 'second', await newDirectory('second'));
    run('workspaces', 'add', 'third', await newDirectory('third'));
    run('workspaces', 'add', 'first', await newDirectory('first'));
    storeSkill(store, 'triage');
    mkdirSync(join(lab, 'triage'), { recursive: true });
    writeSkillDirectory(join(scratch, 'triage'));
    run('clone', 'triage', 'second');

    const { stdout, stderr } = run('clone', 'triage', 'lab', 'scratch', 'second', 'third', 'first');

    expect(stdout).toEqual([
      'cloned triage → third',
      'cloned triage → first',
      'adopted triage → scratch',
      'already cloned triage → second',
    ]);
    expect(stderr).toEqual([
      `warning: could not clone triage → lab: ${join(lab, 'triage')} is a directory with no SKILL.md`,
    ]);
  });

  it('confirms an adopted directory', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('personal');

    run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'triage');
    writeSkillDirectory(join(path, 'triage'));

    const { stdout, stderr } = run('clone', 'triage', 'personal');

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

    const { stdout } = run('clone', 'triage', 'scratch', 'personal');

    expect(stdout).toEqual(['cloned triage → personal', 'adopted triage → scratch']);
  });

  it('declines a directory with no SKILL.md', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('personal');
    const dest = join(path, 'triage');

    run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'triage');
    mkdirSync(dest, { recursive: true });

    const error = captureError(() => run('clone', 'triage', 'personal'));

    expect(error).toBeInstanceOf(CloneDeclinedError);
    expect(error.message).toBe(
      `could not clone triage → personal: ${dest} is a directory with no SKILL.md`,
    );
  });

  it('rejects --adopt as an unknown option, touching nothing', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('personal');

    run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'triage');
    writeSkillDirectory(join(path, 'triage'));

    const error = captureError(() => run('clone', 'triage', 'personal', '--adopt'));

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe('commander.unknownOption');
    expect(error.message).toMatch(/^error: unknown option '--adopt'/);
    expect(run('clone', 'triage', 'personal').stdout).toEqual(['adopted triage → personal']);
  });

  it('replaces a recorded clone under --overwrite and says so', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('personal');
    const dest = join(path, 'triage');

    run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'triage');
    run('clone', 'triage', 'personal');
    writeFileSync(join(dest, 'notes.md'), 'mine', 'utf8');

    const { stdout, stderr } = run('clone', 'triage', 'personal', '--overwrite');

    expect(stdout).toEqual(['cloned triage → personal (replaced the directory)']);
    expect(stderr).toEqual([]);
    expect(existsSync(join(dest, 'notes.md'))).toBe(false);
    expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe(
      readFileSync(join(store.paths.skills, 'triage', SKILL_MANIFEST), 'utf8'),
    );
  });

  it('leaves no staging directory in the workspace after --overwrite', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('personal');

    run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'triage');
    run('clone', 'triage', 'personal');

    const { stdout } = run('clone', 'triage', 'personal', '--overwrite');

    expect(stdout).toEqual(['cloned triage → personal (replaced the directory)']);
    expect(existsSync(join(path, '.grimoire-staging'))).toBe(false);
  });

  it('fails the pair when the staging path is a file', async () => {
    const { run, runFailing, store } = await newCli();
    const path = await newDirectory('personal');
    const staging = join(path, '.grimoire-staging');

    run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'triage');
    writeFileSync(staging, 'mine', 'utf8');

    const { error } = runFailing('clone', 'triage', 'personal');

    expect(error).toBeInstanceOf(CloneFailedError);
    expect(error.message).toBe(`failed to clone triage → personal: ${staging} is not a directory`);
  });

  it('prints the pairs it wrote before throwing for the one whose write failed', async () => {
    const { run, runFailing, store } = await newCli();
    const first = await newDirectory('a');
    const second = await newDirectory('b');
    const third = await newDirectory('c');
    const staging = join(third, '.grimoire-staging');

    run('workspaces', 'add', 'a', first);
    run('workspaces', 'add', 'b', second);
    run('workspaces', 'add', 'c', third);
    storeSkill(store, 'triage');
    writeSkillDirectory(join(first, 'triage'), { 'old.md': 'old' });
    writeSkillDirectory(join(second, 'triage'), { 'old.md': 'old' });
    writeFileSync(staging, 'mine', 'utf8');

    const { stdout, stderr, error } = runFailing('clone', 'triage', 'a', 'b', 'c', '--overwrite');

    expect(stdout).toEqual([
      'cloned triage → a (replaced the directory)',
      'cloned triage → b (replaced the directory)',
    ]);
    expect(stderr).toEqual([]);
    expect(error).toBeInstanceOf(CloneFailedError);
    expect(error.message).toBe(`failed to clone triage → c: ${staging} is not a directory`);
    expect(existsSync(join(first, 'triage', 'old.md'))).toBe(false);
  });

  it('lists every failure under one header', async () => {
    const { run, runFailing, store } = await newCli();
    const first = await newDirectory('a');
    const second = await newDirectory('b');

    run('workspaces', 'add', 'a', first);
    run('workspaces', 'add', 'b', second);
    storeSkill(store, 'triage');
    writeFileSync(join(first, '.grimoire-staging'), 'mine', 'utf8');
    writeFileSync(join(second, '.grimoire-staging'), 'mine', 'utf8');

    const { error } = runFailing('clone', 'triage', 'a', 'b');

    expect(error).toBeInstanceOf(CloneFailedError);
    expect(error.message.split('\n')).toEqual([
      'clones failed:',
      `  failed to clone triage → a: ${join(first, '.grimoire-staging')} is not a directory`,
      `  failed to clone triage → b: ${join(second, '.grimoire-staging')} is not a directory`,
    ]);
  });

  it('warns about an old copy it could not fully delete, still printing the cloned line', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('personal');
    const staging = join(path, '.grimoire-staging');

    run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'triage');
    writeSkillDirectory(join(path, 'triage'), { 'old.md': 'old' });
    vi.mocked(rmSync).mockImplementationOnce(() => {
      throw Object.assign(new Error('delete failed'), { code: 'EACCES' });
    });

    const { stdout, stderr } = run('clone', 'triage', 'personal', '--overwrite');
    const [entry] = readdirSync(staging);

    expect(stdout).toEqual(['cloned triage → personal (replaced the directory)']);
    expect(stderr).toEqual([
      `warning: cloned triage → personal, but the old copy at ${join(staging, entry!)} could not be fully deleted: delete failed`,
    ]);
  });

  it('replaces an adoptable directory instead of adopting it under --overwrite, in argument order', async () => {
    const { run, store } = await newCli();
    const lab = await newDirectory('lab');
    const linked = await newDirectory('linked');

    run('workspaces', 'add', 'lab', lab);
    run('workspaces', 'add', 'fresh', await newDirectory('fresh'));
    run('workspaces', 'add', 'linked', linked);
    const skillPath = storeSkill(store, 'triage');
    writeSkillDirectory(join(lab, 'triage'));
    symlinkSync(skillPath, join(linked, 'triage'));

    const { stdout, stderr } = run('clone', 'triage', 'lab', 'fresh', 'linked', '--overwrite');

    expect(stdout).toEqual([
      'cloned triage → lab (replaced the directory)',
      'cloned triage → fresh',
      'cloned triage → linked (replaced the link)',
    ]);
    expect(stderr).toEqual([]);
  });

  it('still warns about a declined destination under --overwrite', async () => {
    const { run, store } = await newCli();
    const lab = await newDirectory('lab');
    const marker = join(lab, 'triage', 'marker.md');

    run('workspaces', 'add', 'personal', await newDirectory('personal'));
    run('workspaces', 'add', 'lab', lab);
    storeSkill(store, 'triage');
    mkdirSync(join(lab, 'triage'), { recursive: true });
    writeFileSync(marker, 'mine', 'utf8');

    const { stdout, stderr } = run('clone', 'triage', 'personal', 'lab', '--overwrite');

    expect(stdout).toEqual(['cloned triage → personal']);
    expect(stderr).toEqual([
      `warning: could not clone triage → lab: ${join(lab, 'triage')} is a directory with no SKILL.md`,
    ]);
    expect(existsSync(marker)).toBe(true);
  });

  it('throws the refusal itself when the only destination is declined', async () => {
    const { run, store } = await newCli();
    const lab = await newDirectory('lab');
    const dest = join(lab, 'triage');

    run('workspaces', 'add', 'lab', lab);
    storeSkill(store, 'triage');
    writeFileSync(dest, 'not a skill', 'utf8');

    const error = captureError(() => run('clone', 'triage', 'lab'));

    expect(error).toBeInstanceOf(CloneDeclinedError);
    expect(error.message).toBe(`could not clone triage → lab: ${dest} is not a directory`);
  });

  it('throws one error listing every refusal when nothing was cloned', async () => {
    const { run, store } = await newCli();
    const lab = await newDirectory('lab');
    const other = await newDirectory('other');

    run('workspaces', 'add', 'lab', lab);
    run('workspaces', 'add', 'other', other);
    storeSkill(store, 'triage');
    mkdirSync(join(lab, 'triage'), { recursive: true });
    writeFileSync(join(other, 'triage'), 'not a skill', 'utf8');

    const error = captureError(() => run('clone', 'triage', 'lab', 'other'));

    expect(error).toBeInstanceOf(CloneDeclinedError);
    expect(error.message.split('\n')).toEqual([
      'nothing cloned:',
      `  could not clone triage → lab: ${join(lab, 'triage')} is a directory with no SKILL.md`,
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

  /** Everything the command printed, and the error it threw, if any. */
  function capture(argv: string[]) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let thrown: unknown;

    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void stdout.push(line));
    const toStderr = (line: string) => void stderr.push(line);
    const error = vi.spyOn(console, 'error').mockImplementation(toStderr);
    const warn = vi.spyOn(console, 'warn').mockImplementation(toStderr);

    try {
      program.parse(argv, { from: 'user' });
    } catch (caught) {
      thrown = caught;
    } finally {
      log.mockRestore();
      error.mockRestore();
      warn.mockRestore();
    }

    return { stdout, stderr, thrown };
  }

  function run(...argv: string[]) {
    const { stdout, stderr, thrown } = capture(argv);

    if (thrown !== undefined) {
      throw thrown as Error;
    }

    return { stdout, stderr };
  }

  /** For a run that throws after it has printed: the lines come back with the error. */
  function runFailing(...argv: string[]) {
    const { stdout, stderr, thrown } = capture(argv);

    if (thrown === undefined) {
      throw new Error('expected a refusal');
    }

    return { stdout, stderr, error: thrown as Error };
  }

  return { run, runFailing, store };
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
