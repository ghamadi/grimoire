import { lstatSync, mkdirSync, readlinkSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CommanderError, type Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GrimoireStore, GrimoireStoreManager } from '@/domains/grimoire-store';
import { SKILL_MANIFEST } from '@/domains/skill';
import {
  EntityNotFoundError,
  LinkDeclinedError,
  MissingDestinationError,
  UnlinkDeclinedError,
} from '@/lib/errors';
import { buildProgram, type ProgramDependencies } from '@/program';
import { fakePicker } from '@test-helpers/fake-picker';
import { tempRoot } from '@test-helpers/temp-root';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('link', () => {
  it('confirms each link it wrote on stdout', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    await run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'brainstorm');

    const { stdout, stderr } = await run('link', 'brainstorm', '--to', 'personal');

    expect(stdout).toEqual(['linked brainstorm → personal']);
    expect(stderr).toEqual([]);
  });

  it('says a correct link was already in place', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    await run('workspaces', 'add', 'personal', path);
    symlinkSync(storeSkill(store, 'brainstorm'), join(path, 'brainstorm'));

    expect((await run('link', 'brainstorm', '--to', 'personal')).stdout).toEqual([
      'already linked brainstorm → personal',
    ]);
  });

  // The swap is silent: the store demonstrably held that content already.
  it('prints the plain confirmation for an identical directory it replaced', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');
    const occupied = join(path, 'brainstorm');

    await run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'brainstorm');
    writeSkillDirectory(occupied);

    const { stdout, stderr } = await run('link', 'brainstorm', '--to', 'personal');

    expect(stdout).toEqual(['linked brainstorm → personal']);
    expect(stderr).toEqual([]);
    expect(readlinkSync(occupied)).toBe(join(store.paths.skills, 'brainstorm'));
  });

  it('warns on stderr about what it declined and keeps its exit clean', async () => {
    const { run, store } = await newCli();
    const personal = await newDirectory('personal');
    const work = await newDirectory('work');
    const occupied = join(personal, 'brainstorm');

    await run('workspaces', 'add', 'personal', personal);
    await run('workspaces', 'add', 'work', work);
    storeSkill(store, 'brainstorm');
    writeSkillDirectory(occupied, { [SKILL_MANIFEST]: 'edited' });

    const { stdout, stderr } = await run('link', 'brainstorm', '--to', 'personal', 'work');

    expect(stdout).toEqual(['linked brainstorm → work']);
    expect(stderr).toEqual([
      `warning: could not link brainstorm → personal: ${occupied} holds a directory that differs from the store copy at "SKILL.md" — keep it with \`grimoire clone brainstorm --to personal\`, or delete it yourself`,
    ]);
  });

  it('warns that it left a recorded clone alone, and links the rest', async () => {
    const { run, manager, store } = await newCli();
    const personal = await newDirectory('personal');
    const work = await newDirectory('work');
    const cloned = join(personal, 'brainstorm');

    await run('workspaces', 'add', 'personal', personal);
    await run('workspaces', 'add', 'work', work);
    storeSkill(store, 'brainstorm');
    writeSkillDirectory(cloned);
    manager.recordClone({ skill: 'brainstorm', workspace: 'personal' });

    const { stdout, stderr } = await run('link', 'brainstorm', '--to', 'personal', 'work');

    expect(stdout).toEqual(['linked brainstorm → work']);
    expect(stderr).toEqual([
      `warning: could not link brainstorm → personal: ${cloned} is a clone — unclone it first with \`grimoire clone brainstorm --drop personal\``,
    ]);
    expect(lstatSync(cloned).isDirectory()).toBe(true);
  });

  it('links into every auto-link workspace when none is named', async () => {
    const { run, store } = await newCli();

    await run('workspaces', 'add', 'personal', await newDirectory('personal'), '--auto-link');
    await run('workspaces', 'add', 'work', await newDirectory('work'));
    storeSkill(store, 'brainstorm');

    expect((await run('link', 'brainstorm')).stdout).toEqual(['linked brainstorm → personal']);
  });

  // Nothing was stepped over, so there is no warning to print — and a command
  // that succeeded in silence is indistinguishable from one that broke.
  it('says why a run with no auto-link workspace printed nothing', async () => {
    const { run, store } = await newCli();

    await run('workspaces', 'add', 'personal', await newDirectory('project'));
    storeSkill(store, 'brainstorm');

    expect((await run('link', 'brainstorm')).stdout).toEqual([
      'nothing to link: no auto-link workspace is registered',
    ]);
  });

  it('refuses to run with neither a skill nor --all-skills', async () => {
    const { run } = await newCli();

    await run('workspaces', 'add', 'personal', await newDirectory('project'));

    const error = await captureError(() => run('link'));

    expect(error).toBeInstanceOf(CommanderError);
    expect(error.message).toBe("error: missing required argument 'skill' (or use --all-skills)");
  });

  it('keeps the workspaces in argument order under --all-skills', async () => {
    const { run, store } = await newCli();

    await run('workspaces', 'add', 'personal', await newDirectory('personal'));
    await run('workspaces', 'add', 'work', await newDirectory('work'));
    await run('workspaces', 'add', 'scratch', await newDirectory('scratch'));
    storeSkill(store, 'brainstorm');

    expect((await run('link', '--all-skills', '--to', 'work', 'personal', 'scratch')).stdout).toEqual([
      'linked brainstorm → work',
      'linked brainstorm → personal',
      'linked brainstorm → scratch',
    ]);
  });

  it('counts a workspace named twice under --all-skills once, at its first position', async () => {
    const { run, store } = await newCli();

    await run('workspaces', 'add', 'personal', await newDirectory('personal'));
    await run('workspaces', 'add', 'work', await newDirectory('work'));
    storeSkill(store, 'brainstorm');

    expect((await run('link', '--all-skills', '--to', 'work', 'personal', 'work')).stdout).toEqual([
      'linked brainstorm → work',
      'linked brainstorm → personal',
    ]);
  });

  it('lets a run that linked nothing at all escape as a refusal', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('project');

    await run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'brainstorm');
    writeFileSync(join(path, 'brainstorm'), 'not a skill', 'utf8');

    expect(await captureError(() => run('link', 'brainstorm', '--to', 'personal'))).toBeInstanceOf(
      LinkDeclinedError,
    );
  });

  describe('--drop', () => {
    it('removes the link', async () => {
      const { run, store } = await newCli();
      const path = await newDirectory('project');

      await run('workspaces', 'add', 'personal', path);
      symlinkSync(storeSkill(store, 'brainstorm'), join(path, 'brainstorm'));

      const { stdout, stderr } = await run('link', 'brainstorm', '--drop', 'personal');

      expect(stdout).toEqual(['unlinked brainstorm → personal']);
      expect(stderr).toEqual([]);
      expect(lstatSync(join(path, 'brainstorm'), { throwIfNoEntry: false })).toBeUndefined();
    });

    it('says nothing was there to unlink', async () => {
      const { run, store } = await newCli();
      const path = await newDirectory('project');

      await run('workspaces', 'add', 'personal', path);
      storeSkill(store, 'brainstorm');

      expect((await run('link', 'brainstorm', '--drop', 'personal')).stdout).toEqual([
        'not linked brainstorm → personal',
      ]);
    });

    it('groups unlinked and not-linked lines by outcome, not argument order', async () => {
      const { run, store } = await newCli();
      const work = await newDirectory('work');
      const club = await newDirectory('club');
      const personal = await newDirectory('personal');

      await run('workspaces', 'add', 'work', work);
      await run('workspaces', 'add', 'club', club);
      await run('workspaces', 'add', 'personal', personal);
      storeSkill(store, 'brainstorm');
      mkdirSync(join(club, 'brainstorm'));
      symlinkSync(storeSkill(store, 'brainstorm'), join(personal, 'brainstorm'));

      const { stdout, stderr } = await run('link', 'brainstorm', '--drop', 'work', 'club', 'personal');

      expect(stdout).toEqual(['unlinked brainstorm → personal', 'not linked brainstorm → work']);
      expect(stderr).toEqual([
        `warning: could not unlink brainstorm → club: ${join(club, 'brainstorm')} is a directory, not a link`,
      ]);
    });

    it('lets a run that unlinked nothing at all escape as a refusal', async () => {
      const { run, store } = await newCli();
      const path = await newDirectory('project');

      await run('workspaces', 'add', 'personal', path);
      storeSkill(store, 'brainstorm');
      mkdirSync(join(path, 'brainstorm'));

      expect(await captureError(() => run('link', 'brainstorm', '--drop', 'personal'))).toBeInstanceOf(
        UnlinkDeclinedError,
      );
    });

    it('lets an unknown skill escape as a refusal', async () => {
      const { run } = await newCli();

      await run('workspaces', 'add', 'personal', await newDirectory('project'));

      expect(await captureError(() => run('link', 'brainstorm', '--drop', 'personal'))).toBeInstanceOf(
        EntityNotFoundError,
      );
    });

    describe('--all-workspaces', () => {
      it('reports every registered workspace, each group sorted by name', async () => {
        const { run, store } = await newCli();
        const work = await newDirectory('work');
        const personal = await newDirectory('personal');
        const club = await newDirectory('club');

        await run('workspaces', 'add', 'work', work);
        await run('workspaces', 'add', 'personal', personal);
        await run('workspaces', 'add', 'club', club);
        const skillPath = storeSkill(store, 'brainstorm');
        symlinkSync(skillPath, join(work, 'brainstorm'));
        symlinkSync(skillPath, join(personal, 'brainstorm'));
        mkdirSync(join(club, 'brainstorm'));

        const { stdout, stderr } = await run('link', 'brainstorm', '--drop', '--all-workspaces');

        expect(stdout).toEqual(['unlinked brainstorm → personal', 'unlinked brainstorm → work']);
        expect(stderr).toEqual([
          `warning: could not unlink brainstorm → club: ${join(club, 'brainstorm')} is a directory, not a link`,
        ]);
      });

      it('says a workspace without the link was not linked', async () => {
        const { run, store } = await newCli();
        const work = await newDirectory('work');

        await run('workspaces', 'add', 'personal', await newDirectory('personal'));
        await run('workspaces', 'add', 'work', work);
        symlinkSync(storeSkill(store, 'brainstorm'), join(work, 'brainstorm'));

        expect((await run('link', 'brainstorm', '--drop', '--all-workspaces')).stdout).toEqual([
          'unlinked brainstorm → work',
          'not linked brainstorm → personal',
        ]);
      });

      it('says why a run with no registered workspace printed nothing', async () => {
        const { run, store } = await newCli();

        storeSkill(store, 'brainstorm');

        const { stdout, stderr } = await run('link', 'brainstorm', '--drop', '--all-workspaces');

        expect(stdout).toEqual(['nothing to unlink: no workspace is registered']);
        expect(stderr).toEqual([]);
      });

      it('refuses to combine named workspaces with --all-workspaces, leaving the link in place', async () => {
        const { run, store } = await newCli();
        const path = await newDirectory('project');

        await run('workspaces', 'add', 'personal', path);
        const linkPath = join(path, 'brainstorm');
        symlinkSync(storeSkill(store, 'brainstorm'), linkPath);

        const error = await captureError(() =>
          run('link', 'brainstorm', '--drop', 'personal', '--all-workspaces'),
        );

        expect(error).toBeInstanceOf(CommanderError);
        expect(error.message).toBe('error: --all-workspaces cannot be combined with named workspaces');
        expect(lstatSync(linkPath).isSymbolicLink()).toBe(true);
      });
    });

    describe('choosing workspaces', () => {
      it('offers every registered workspace in name order and unlinks the one picked', async () => {
        const picker = fakePicker({ choose: () => ['work'] });
        const { run, store } = await newCli({ picker });
        const work = await newDirectory('work');
        const personal = await newDirectory('personal');

        await run('workspaces', 'add', 'work', work);
        await run('workspaces', 'add', 'personal', personal);
        await run('workspaces', 'add', 'club', await newDirectory('club'));
        const skillPath = storeSkill(store, 'brainstorm');
        symlinkSync(skillPath, join(work, 'brainstorm'));
        symlinkSync(skillPath, join(personal, 'brainstorm'));

        const { stdout, stderr } = await run('link', 'brainstorm', '--drop');

        expect(picker.offered).toEqual(['club', 'personal', 'work']);
        expect(stdout).toEqual(['unlinked brainstorm → work']);
        expect(stderr).toEqual([]);
        expect(lstatSync(join(work, 'brainstorm'), { throwIfNoEntry: false })).toBeUndefined();
        expect(lstatSync(join(personal, 'brainstorm')).isSymbolicLink()).toBe(true);
      });

      it('unlinks the picked workspaces in name order whatever order they were picked in', async () => {
        const picker = fakePicker({ choose: (labels) => [...labels].reverse() });
        const { run, store } = await newCli({ picker });
        const work = await newDirectory('work');
        const personal = await newDirectory('personal');

        await run('workspaces', 'add', 'work', work);
        await run('workspaces', 'add', 'personal', personal);
        const skillPath = storeSkill(store, 'brainstorm');
        symlinkSync(skillPath, join(work, 'brainstorm'));
        symlinkSync(skillPath, join(personal, 'brainstorm'));

        expect((await run('link', 'brainstorm', '--drop')).stdout).toEqual([
          'unlinked brainstorm → personal',
          'unlinked brainstorm → work',
        ]);
      });

      it('says no workspace was selected when nothing is picked', async () => {
        const picker = fakePicker({ choose: () => [] });
        const { run, store } = await newCli({ picker });
        const path = await newDirectory('personal');

        await run('workspaces', 'add', 'personal', path);
        symlinkSync(storeSkill(store, 'brainstorm'), join(path, 'brainstorm'));

        const { stdout, stderr } = await run('link', 'brainstorm', '--drop');

        expect(stdout).toEqual(['nothing to unlink: no workspace selected']);
        expect(stderr).toEqual([]);
        expect(lstatSync(join(path, 'brainstorm')).isSymbolicLink()).toBe(true);
      });

      it('says no workspace is registered without offering a pick', async () => {
        const picker = fakePicker({ choose: (labels) => labels });
        const { run, store } = await newCli({ picker });

        storeSkill(store, 'brainstorm');

        const { stdout, stderr } = await run('link', 'brainstorm', '--drop');

        expect(stdout).toEqual(['nothing to unlink: no workspace is registered']);
        expect(stderr).toEqual([]);
        expect(picker.offered).toEqual([]);
      });

      it('refuses an unknown skill before offering a pick', async () => {
        const picker = fakePicker({ choose: (labels) => labels });
        const { run } = await newCli({ picker });

        await run('workspaces', 'add', 'personal', await newDirectory('personal'));

        const error = await captureError(() => run('link', 'brainstorm', '--drop'));

        expect(error).toBeInstanceOf(EntityNotFoundError);
        expect(picker.offered).toEqual([]);
      });

      it('refuses without a terminal, naming --drop, --all-workspaces and every registered workspace', async () => {
        const { run, store } = await newCli();
        const personal = await newDirectory('personal');

        await run('workspaces', 'add', 'personal', personal);
        await run('workspaces', 'add', 'work', await newDirectory('work'));
        symlinkSync(storeSkill(store, 'brainstorm'), join(personal, 'brainstorm'));

        const error = await captureError(() => run('link', 'brainstorm', '--drop'));

        expect(error).toBeInstanceOf(MissingDestinationError);
        expect(error.message.split('\n')).toEqual([
          'no workspace named, and no terminal to choose from',
          '  use --all-workspaces, or name them after --drop: personal work',
        ]);
        expect(lstatSync(join(personal, 'brainstorm')).isSymbolicLink()).toBe(true);
      });
    });
  });

  describe('refusals', () => {
    it.each([
      [['--all-skills', '--to', 'personal', '--drop'], 'error: --to cannot be combined with --drop'],
      [['--all-skills', '--drop', 'personal'], 'error: --all-skills cannot be combined with --drop'],
      [['brainstorm', '--all-workspaces'], 'error: --all-workspaces works only with --drop'],
      [['brainstorm', '--all-skills'], 'error: --all-skills cannot be combined with a named skill'],
      [
        ['--drop', 'personal', 'brainstorm'],
        "error: missing required argument 'skill'\n  --drop takes every name after it, so name the skill before it",
      ],
      [
        ['--drop', 'brainstorm', '--all-workspaces'],
        "error: missing required argument 'skill'\n  --drop takes every name after it, so name the skill before it",
      ],
      [
        ['--all-workspaces', '--drop', 'brainstorm'],
        "error: missing required argument 'skill'\n  --drop takes every name after it, so name the skill before it",
      ],
      [
        ['--to', 'personal', 'brainstorm'],
        "error: missing required argument 'skill' (or use --all-skills)\n  --to takes every name after it, so name the skill before it",
      ],
    ])('refuses link %j', async (argv, message) => {
      const { run, store } = await newCli();

      await run('workspaces', 'add', 'personal', await newDirectory('personal'));
      storeSkill(store, 'brainstorm');

      const error = await captureError(() => run('link', ...argv));

      expect(error).toBeInstanceOf(CommanderError);
      expect(error.message).toBe(message);
    });
  });

  it('no longer knows unlink as a command', async () => {
    const { run } = await newCli();

    const error = await captureError(() => run('unlink', 'brainstorm', 'personal'));

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe('commander.unknownCommand');
  });
});

/**
 * A program wired to a throwaway store, driven in process.
 *
 * `.exitOverride()` turns commander's `process.exit(1)` into a thrown
 * `CommanderError`, and console is spied rather than `configureOutput`-ed
 * because the actions print through console directly.
 */
async function newCli(dependencies: ProgramDependencies = {}) {
  const store = new GrimoireStore(await tempRoot());
  const manager = new GrimoireStoreManager(store);
  const program = silence(buildProgram(store, dependencies));

  async function run(...argv: string[]) {
    const stdout: string[] = [];
    const stderr: string[] = [];

    const log = vi.spyOn(console, 'log').mockImplementation((line: string) => void stdout.push(line));
    const toStderr = (line: string) => void stderr.push(line);
    const error = vi.spyOn(console, 'error').mockImplementation(toStderr);
    const warn = vi.spyOn(console, 'warn').mockImplementation(toStderr);

    try {
      await program.parseAsync(argv, { from: 'user' });
    } finally {
      log.mockRestore();
      error.mockRestore();
      warn.mockRestore();
    }

    return { stdout, stderr };
  }

  return { run, manager, store };
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
