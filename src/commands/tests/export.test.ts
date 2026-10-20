import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { CommanderError, type Command } from 'commander';
import { afterEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { GrimoireStore } from '@/domains/grimoire-store';
import { SKILL_MANIFEST } from '@/domains/skill';
import {
  EntityNotFoundError,
  ExportDeclinedError,
  ExportFailedError,
  InvalidPathError,
  MissingDestinationError,
  UnportableSkillError,
} from '@/lib/errors';
import { buildProgram, type ProgramDependencies } from '@/program';
import { fakePicker } from '@test-helpers/fake-picker';
import { tempGitRepo } from '@test-helpers/git-repo';
import { runsAsRoot } from '@test-helpers/locked-directory';
import { tempRoot } from '@test-helpers/temp-root';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();

  return { ...actual, rmSync: vi.fn(actual.rmSync) };
});

afterEach(() => {
  vi.restoreAllMocks();
});

const FORCE_LINE = '  commit first, or use --force to overwrite them';

describe('export', () => {
  it('confirms a copy it wrote into an empty destination', async () => {
    const { run, store, repo } = await newCli();
    const dest = join(repo.path, 'triage');

    storeSkill(store, 'triage');

    const { stdout, stderr } = await run('export', 'triage', '--to', 'library');

    expect(stdout).toEqual(['exported triage → library']);
    expect(stderr).toEqual([]);
    expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('# skill\n');
  });

  it('replaces a committed entry with the bare exported line', async () => {
    const { run, store, repo } = await newCli();
    const dest = join(repo.path, 'triage');

    storeSkill(store, 'triage');
    writeSkillDirectory(dest, { 'old.md': 'old' });
    repo.commitAll();

    const { stdout, stderr } = await run('export', 'triage', '--to', 'library');

    expect(stdout).toEqual(['exported triage → library']);
    expect(stderr).toEqual([]);
    expect(existsSync(join(dest, 'old.md'))).toBe(false);
  });

  it('warns about a decline beside an export and exits clean', async () => {
    const { run, store, repo } = await newCli();
    const dest = join(repo.path, 'triage');

    storeSkill(store, 'triage');
    storeSkill(store, 'review');
    writeSkillDirectory(dest, { 'notes.md': 'mine' });

    const { stdout, stderr } = await run('export', 'triage', 'review', '--to', 'library');

    expect(stdout).toEqual(['exported review → library']);
    expect(stderr).toEqual([
      `warning: could not export triage → library: ${dest} has uncommitted changes`,
    ]);
    expect(readFileSync(join(dest, 'notes.md'), 'utf8')).toBe('mine');
  });

  it('prints exported lines, then decline warnings, then stranded-entry warnings', async () => {
    const { run, store, repo } = await newCli();
    const staging = join(repo.path, '.grimoire-staging');

    for (const name of ['dirty', 'replaced', 'fresh', 'untracked']) {
      storeSkill(store, name);
    }

    writeSkillDirectory(join(repo.path, 'dirty'));
    writeSkillDirectory(join(repo.path, 'replaced'), { 'old.md': 'old' });
    repo.commitAll();
    writeFileSync(join(repo.path, 'dirty', 'notes.md'), 'mine', 'utf8');
    writeSkillDirectory(join(repo.path, 'untracked'));
    vi.mocked(rmSync).mockImplementationOnce(() => {
      throw Object.assign(new Error('delete failed'), { code: 'EACCES' });
    });

    const { stdout, stderr } = await run(
      'export',
      'dirty',
      'replaced',
      'untracked',
      'fresh',
      '--to',
      'library',
    );
    const [entry] = readdirSync(staging);

    expect(stdout).toEqual(['exported replaced → library', 'exported fresh → library']);
    expect(stderr).toEqual([
      `warning: could not export dirty → library: ${join(repo.path, 'dirty')} has uncommitted changes`,
      `warning: could not export untracked → library: ${join(repo.path, 'untracked')} has uncommitted changes`,
      `warning: exported replaced → library, but the old copy at ${join(staging, entry!)} could not be fully deleted: delete failed`,
    ]);
  });

  it('refuses when its one skill is declined, naming --force', async () => {
    const { run, runFailing, store, repo } = await newCli();
    const dest = join(repo.path, 'triage');

    storeSkill(store, 'triage');
    await run('export', 'triage', '--to', 'library');

    const { stdout, stderr, error } = await runFailing('export', 'triage', '--to', 'library');

    expect(stdout).toEqual([]);
    expect(stderr).toEqual([]);
    expect(error).toBeInstanceOf(ExportDeclinedError);
    expect(error.message.split('\n')).toEqual([
      `could not export triage → library: ${dest} has uncommitted changes`,
      FORCE_LINE,
    ]);
  });

  it('lists every decline under one header, with the --force line last', async () => {
    const { run, store, repo } = await newCli();

    storeSkill(store, 'triage');
    storeSkill(store, 'review');
    await run('export', 'triage', 'review', '--to', 'library');

    const error = await captureError(() => run('export', 'triage', 'review', '--to', 'library'));

    expect(error).toBeInstanceOf(ExportDeclinedError);
    expect(error.message.split('\n')).toEqual([
      'nothing exported:',
      `  could not export triage → library: ${join(repo.path, 'triage')} has uncommitted changes`,
      `  could not export review → library: ${join(repo.path, 'review')} has uncommitted changes`,
      FORCE_LINE,
    ]);
  });

  it('exports over uncommitted changes under --force', async () => {
    const { run, store, repo } = await newCli();
    const dest = join(repo.path, 'triage');

    storeSkill(store, 'triage');
    writeSkillDirectory(dest, { 'notes.md': 'mine' });

    const { stdout, stderr } = await run('export', 'triage', '--to', 'library', '--force');

    expect(stdout).toEqual(['exported triage → library']);
    expect(stderr).toEqual([]);
    expect(existsSync(join(dest, 'notes.md'))).toBe(false);
  });

  it.skipIf(runsAsRoot)(
    'prints the skills it wrote before throwing for the one whose write failed',
    async () => {
      const { runFailing, store, repo } = await newCli();
      const unreadable = join(storeSkill(store, 'triage'), 'secret.md');

      storeSkill(store, 'review');
      writeFileSync(unreadable, 'secret', 'utf8');
      chmodSync(unreadable, 0o000);
      onTestFinished(() => chmodSync(unreadable, 0o644));

      const { stdout, stderr, error } = await runFailing(
        'export',
        'triage',
        'review',
        '--to',
        'library',
      );

      expect(stdout).toEqual(['exported review → library']);
      expect(stderr).toEqual([]);
      expect(error).toBeInstanceOf(ExportFailedError);
      expect(error.message).toMatch(/^failed to export triage → library: EACCES/);
      expect(existsSync(join(repo.path, 'triage'))).toBe(false);
    },
  );

  it('throws for a skill whose staging directory is unusable', async () => {
    const { runFailing, store, repo } = await newCli();
    const staging = join(repo.path, '.grimoire-staging');

    storeSkill(store, 'triage');
    writeFileSync(staging, 'mine', 'utf8');

    const { stdout, error } = await runFailing('export', 'triage', '--to', 'library');

    expect(stdout).toEqual([]);
    expect(error).toBeInstanceOf(ExportFailedError);
    expect(error.message).toBe(`failed to export triage → library: ${staging} is not a directory`);
  });

  it('lists every failure under one header', async () => {
    const { runFailing, store, repo } = await newCli();
    const staging = join(repo.path, '.grimoire-staging');

    storeSkill(store, 'triage');
    storeSkill(store, 'review');
    writeFileSync(staging, 'mine', 'utf8');

    const { error } = await runFailing('export', 'triage', 'review', '--to', 'library');

    expect(error).toBeInstanceOf(ExportFailedError);
    expect(error.message.split('\n')).toEqual([
      'exports failed:',
      `  failed to export triage → library: ${staging} is not a directory`,
      `  failed to export review → library: ${staging} is not a directory`,
    ]);
  });

  it('warns about a decline beside a failure, then throws for the failure', async () => {
    const { runFailing, store, repo } = await newCli();
    const dest = join(repo.path, 'triage');
    const staging = join(repo.path, '.grimoire-staging');

    storeSkill(store, 'triage');
    storeSkill(store, 'review');
    writeSkillDirectory(dest, { 'notes.md': 'mine' });
    writeFileSync(staging, 'mine', 'utf8');

    const { stdout, stderr, error } = await runFailing('export', 'triage', 'review', '--to', 'library');

    expect(stdout).toEqual([]);
    expect(stderr).toEqual([
      `warning: could not export triage → library: ${dest} has uncommitted changes`,
    ]);
    expect(error).toBeInstanceOf(ExportFailedError);
    expect(error.message).toBe(`failed to export review → library: ${staging} is not a directory`);
    expect(readFileSync(join(dest, 'notes.md'), 'utf8')).toBe('mine');
  });

  it('exports every store skill in name order under --all-skills', async () => {
    const { run, store } = await newCli();

    storeSkill(store, 'triage');
    storeSkill(store, 'review');

    const { stdout, stderr } = await run('export', '--all-skills', '--to', 'library');

    expect(stdout).toEqual(['exported review → library', 'exported triage → library']);
    expect(stderr).toEqual([]);
  });

  it('warns about the skills still waiting on a commit under --all-skills, and exports the rest', async () => {
    const { run, store, repo } = await newCli();
    const dest = join(repo.path, 'triage');

    storeSkill(store, 'triage');
    storeSkill(store, 'review');
    writeSkillDirectory(dest, { 'notes.md': 'mine' });

    const { stdout, stderr } = await run('export', '--all-skills', '--to', 'library');

    expect(stdout).toEqual(['exported review → library']);
    expect(stderr).toEqual([
      `warning: could not export triage → library: ${dest} has uncommitted changes`,
    ]);
    expect(readFileSync(join(dest, 'notes.md'), 'utf8')).toBe('mine');
  });

  it('replaces uncommitted destinations under --all-skills --force', async () => {
    const { run, store, repo } = await newCli();
    const dest = join(repo.path, 'triage');

    storeSkill(store, 'triage');
    storeSkill(store, 'review');
    writeSkillDirectory(dest, { 'notes.md': 'mine' });

    const { stdout, stderr } = await run('export', '--all-skills', '--to', 'library', '--force');

    expect(stdout).toEqual(['exported review → library', 'exported triage → library']);
    expect(stderr).toEqual([]);
    expect(existsSync(join(dest, 'notes.md'))).toBe(false);
  });

  it('says the store holds no skills under --all-skills, before any repo check', async () => {
    const { run } = await newCli();

    const { stdout, stderr } = await run('export', '--all-skills', '--to', 'ghost');

    expect(stdout).toEqual(['nothing to export: the store holds no skills']);
    expect(stderr).toEqual([]);
  });

  it('exports skill by skill, each into every repo after --to', async () => {
    const { run, addRepo, store } = await newCli();

    await addRepo('dotfiles');
    storeSkill(store, 'triage');
    storeSkill(store, 'review');

    const { stdout, stderr } = await run('export', 'triage', 'review', '--to', 'library', 'dotfiles');

    expect(stdout).toEqual([
      'exported triage → library',
      'exported triage → dotfiles',
      'exported review → library',
      'exported review → dotfiles',
    ]);
    expect(stderr).toEqual([]);
  });

  describe('choosing repos', () => {
    it('offers the registered repos in name order and exports into the one picked', async () => {
      const picker = fakePicker({ choose: () => ['library'] });
      const { run, addRepo, store, repo } = await newCli({ picker });
      const dotfiles = await addRepo('dotfiles');

      storeSkill(store, 'triage');

      const { stdout, stderr } = await run('export', 'triage');

      expect(picker.offered).toEqual(['dotfiles', 'library']);
      expect(stdout).toEqual(['exported triage → library']);
      expect(stderr).toEqual([]);
      expect(existsSync(join(repo.path, 'triage'))).toBe(true);
      expect(existsSync(join(dotfiles.path, 'triage'))).toBe(false);
    });

    it('exports into the picked repos in name order whatever order they were picked in', async () => {
      const picker = fakePicker({ choose: (labels) => [...labels].reverse() });
      const { run, addRepo, store } = await newCli({ picker });

      await addRepo('dotfiles');
      storeSkill(store, 'triage');

      const { stdout } = await run('export', 'triage');

      expect(stdout).toEqual(['exported triage → dotfiles', 'exported triage → library']);
    });

    it('says no repo was selected when nothing is picked', async () => {
      const picker = fakePicker({ choose: () => [] });
      const { run, store, repo } = await newCli({ picker });

      storeSkill(store, 'triage');

      const { stdout, stderr } = await run('export', 'triage');

      expect(stdout).toEqual(['nothing to export: no repo selected']);
      expect(stderr).toEqual([]);
      expect(readdirSync(repo.path)).toEqual(['.git']);
    });

    it('says no repo is registered without offering a pick', async () => {
      const picker = fakePicker({ choose: (labels) => labels });
      const { run, store } = await newCli({ picker });

      storeSkill(store, 'triage');
      await run('repos', 'remove', 'library');

      const { stdout, stderr } = await run('export', 'triage');

      expect(stdout).toEqual(['nothing to export: no repo is registered']);
      expect(stderr).toEqual([]);
      expect(picker.offered).toEqual([]);
    });

    it('refuses without a terminal, naming --to and every registered repo', async () => {
      const { run, store, repo } = await newCli();

      storeSkill(store, 'triage');

      const error = await captureError(() => run('export', 'triage'));

      expect(error).toBeInstanceOf(MissingDestinationError);
      expect(error.message.split('\n')).toEqual([
        'no repo named, and no terminal to choose from',
        '  name them with --to: library',
      ]);
      expect(readdirSync(repo.path)).toEqual(['.git']);
    });

    it('says the store holds no skills under --all-skills without offering a pick', async () => {
      const picker = fakePicker({ choose: (labels) => labels });
      const { run } = await newCli({ picker });

      const { stdout, stderr } = await run('export', '--all-skills');

      expect(stdout).toEqual(['nothing to export: the store holds no skills']);
      expect(stderr).toEqual([]);
      expect(picker.offered).toEqual([]);
    });

    it('refuses a skill that cannot travel before offering a pick', async () => {
      const picker = fakePicker({ choose: (labels) => labels });
      const { run, store, repo } = await newCli({ picker });
      const skillPath = storeSkill(store, 'triage');

      writeSkillDirectory(join(skillPath, 'nested'));

      const error = await captureError(() => run('export', 'triage'));

      expect(error).toBeInstanceOf(UnportableSkillError);
      expect(picker.offered).toEqual([]);
      expect(readdirSync(repo.path)).toEqual(['.git']);
    });

    it('refuses an unknown skill before offering a pick', async () => {
      const picker = fakePicker({ choose: (labels) => labels });
      const { run, store } = await newCli({ picker });

      storeSkill(store, 'triage');

      const error = await captureError(() => run('export', 'triage', 'ghost'));

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect(error.message).toBe('no skill named "ghost"');
      expect(picker.offered).toEqual([]);
    });
  });

  describe('refusals', () => {
    it('refuses a run with neither skills nor --all-skills', async () => {
      const { run, repo } = await newCli();

      const error = await captureError(() => run('export'));

      expect(error).toBeInstanceOf(CommanderError);
      expect(error.message).toBe("error: missing required argument 'skills' (or use --all-skills)");
      expect(readdirSync(repo.path)).toEqual(['.git']);
    });

    it('says --to took the skills when they follow it', async () => {
      const { run, store, repo } = await newCli();

      storeSkill(store, 'triage');

      const error = await captureError(() => run('export', '--to', 'library', 'triage'));

      expect(error).toBeInstanceOf(CommanderError);
      expect(error.message.split('\n')).toEqual([
        "error: missing required argument 'skills' (or use --all-skills)",
        '  --to takes every name after it, so name the skills before it',
      ]);
      expect(readdirSync(repo.path)).toEqual(['.git']);
    });

    it('refuses --all-skills beside a named skill', async () => {
      const { run, store, repo } = await newCli();

      storeSkill(store, 'triage');

      const error = await captureError(() => run('export', 'triage', '--all-skills', '--to', 'library'));

      expect(error).toBeInstanceOf(CommanderError);
      expect(error.message).toBe('error: --all-skills cannot be combined with named skills');
      expect(existsSync(join(repo.path, 'triage'))).toBe(false);
    });

    it('refuses the whole run under --all-skills when one skill cannot travel', async () => {
      const { run, store, repo } = await newCli();
      const skillPath = storeSkill(store, 'triage');

      storeSkill(store, 'review');
      writeSkillDirectory(join(skillPath, 'nested'));

      const error = await captureError(() => run('export', '--all-skills', '--to', 'library'));

      expect(error).toBeInstanceOf(UnportableSkillError);
      expect(error.message).toBe(`skill "${skillPath}" is not portable. Contains a nested skill.`);
      expect(readdirSync(repo.path)).toEqual(['.git']);
    });

    it('refuses a repo that is not registered', async () => {
      const { run, store } = await newCli();

      storeSkill(store, 'triage');

      const error = await captureError(() => run('export', 'triage', '--to', 'ghost'));

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect(error.message).toBe('no repo named "ghost"');
    });

    it('reports an unknown skill ahead of an unknown repo', async () => {
      const { run } = await newCli();

      const error = await captureError(() => run('export', 'ghost', '--to', 'nowhere'));

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect(error.message).toBe('no skill named "ghost"');
    });

    it('refuses a skill the store does not hold, exporting none of the others', async () => {
      const { run, store, repo } = await newCli();

      storeSkill(store, 'triage');

      const error = await captureError(() => run('export', 'triage', 'ghost', '--to', 'library'));

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect(error.message).toBe('no skill named "ghost"');
      expect(existsSync(join(repo.path, 'triage'))).toBe(false);
    });

    it('refuses a skill that cannot travel, under --force too', async () => {
      const { run, store, repo } = await newCli();
      const skillPath = storeSkill(store, 'triage');

      writeSkillDirectory(join(skillPath, 'nested'));

      const error = await captureError(() => run('export', 'triage', '--to', 'library', '--force'));

      expect(error).toBeInstanceOf(UnportableSkillError);
      expect(error.message).toBe(`skill "${skillPath}" is not portable. Contains a nested skill.`);
      expect(existsSync(join(repo.path, 'triage'))).toBe(false);
    });

    it('refuses a repo directory that no longer exists', async () => {
      const { run, store, repo } = await newCli();

      storeSkill(store, 'triage');
      rmSync(repo.path, { recursive: true });

      const error = await captureError(() => run('export', 'triage', '--to', 'library'));

      expect(error).toBeInstanceOf(InvalidPathError);
      expect(error.message).toBe(`${repo.path} does not exist`);
    });

    it('refuses a repo path that is now a file', async () => {
      const { run, store, repo } = await newCli();

      storeSkill(store, 'triage');
      rmSync(repo.path, { recursive: true });
      writeFileSync(repo.path, 'mine', 'utf8');

      const error = await captureError(() => run('export', 'triage', '--to', 'library'));

      expect(error).toBeInstanceOf(InvalidPathError);
      expect(error.message).toBe(`${repo.path} is not a directory`);
    });

    it('refuses a repo path that is no longer inside a git work tree', async () => {
      const { run, store, repo } = await newCli();

      storeSkill(store, 'triage');
      rmSync(join(repo.path, '.git'), { recursive: true });

      const error = await captureError(() => run('export', 'triage', '--to', 'library'));

      expect(error).toBeInstanceOf(InvalidPathError);
      expect(error.message).toBe(`${repo.path} is not inside a git work tree`);
      expect(readdirSync(repo.path)).toEqual([]);
    });
  });
});

/**
 * A program wired to a throwaway store, driven in process, with an empty git
 * repository registered as `library`.
 *
 * `.exitOverride()` turns commander's `process.exit(1)` into a thrown
 * `CommanderError`, and console is spied rather than `configureOutput`-ed
 * because the actions print through console directly.
 */
async function newCli(dependencies: ProgramDependencies = {}) {
  const store = new GrimoireStore(await tempRoot());
  const program = silence(buildProgram(store, dependencies));

  /** Everything the command printed, and the error it threw, if any. */
  async function capture(argv: string[]) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    let thrown: unknown;

    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void stdout.push(line));
    const toStderr = (line: string) => void stderr.push(line);
    const error = vi.spyOn(console, 'error').mockImplementation(toStderr);
    const warn = vi.spyOn(console, 'warn').mockImplementation(toStderr);

    try {
      await program.parseAsync(argv, { from: 'user' });
    } catch (caught) {
      thrown = caught;
    } finally {
      log.mockRestore();
      error.mockRestore();
      warn.mockRestore();
    }

    return { stdout, stderr, thrown };
  }

  async function run(...argv: string[]) {
    const { stdout, stderr, thrown } = await capture(argv);

    if (thrown !== undefined) {
      throw thrown as Error;
    }

    return { stdout, stderr };
  }

  /** For a run that throws after it has printed: the lines come back with the error. */
  async function runFailing(...argv: string[]) {
    const { stdout, stderr, thrown } = await capture(argv);

    if (thrown === undefined) {
      throw new Error('expected a refusal');
    }

    return { stdout, stderr, error: thrown as Error };
  }

  async function addRepo(name: string) {
    const added = await tempGitRepo();
    await run('repos', 'add', name, added.path);

    return added;
  }

  const repo = await addRepo('library');

  return { run, runFailing, addRepo, store, repo };
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
async function captureError(operation: () => Promise<unknown>): Promise<Error> {
  try {
    await operation();
  } catch (error) {
    return error as Error;
  }

  throw new Error('expected a refusal');
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
