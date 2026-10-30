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
  InvalidPathError,
  MissingDestinationError,
  UnportableSkillError,
} from '@/lib/errors';
import { buildProgram, type ProgramDependencies } from '@/program';
import { fakePicker } from '@test-helpers/fake-picker';
import { lockDirectory, runsAsRoot } from '@test-helpers/locked-directory';
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

    await run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'triage');

    const { stdout, stderr } = await run('clone', 'triage', '--to', 'personal');

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

    await run('workspaces', 'add', 'personal', path);
    symlinkSync(storeSkill(store, 'triage'), dest);

    const { stdout, stderr } = await run('clone', 'triage', '--to', 'personal');

    expect(stdout).toEqual(['cloned triage → personal (replaced the link)']);
    expect(stderr).toEqual([]);
    expect(lstatSync(dest).isSymbolicLink()).toBe(false);
  });

  it('leaves a recorded clone alone and says so', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('personal');
    const dest = join(path, 'triage');

    await run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'triage');
    await run('clone', 'triage', '--to', 'personal');
    writeFileSync(join(dest, 'notes.md'), 'mine', 'utf8');

    const { stdout, stderr } = await run('clone', 'triage', '--to', 'personal');

    expect(stdout).toEqual(['already cloned triage → personal']);
    expect(stderr).toEqual([]);
    expect(readFileSync(join(dest, 'notes.md'), 'utf8')).toBe('mine');
  });

  it('prints each group in turn, keeping argument order inside it, and exits clean past a refusal', async () => {
    const { run, store } = await newCli();
    const lab = await newDirectory('lab');
    const scratch = await newDirectory('scratch');

    await run('workspaces', 'add', 'lab', lab);
    await run('workspaces', 'add', 'scratch', scratch);
    await run('workspaces', 'add', 'second', await newDirectory('second'));
    await run('workspaces', 'add', 'third', await newDirectory('third'));
    await run('workspaces', 'add', 'first', await newDirectory('first'));
    storeSkill(store, 'triage');
    mkdirSync(join(lab, 'triage'), { recursive: true });
    writeSkillDirectory(join(scratch, 'triage'));
    await run('clone', 'triage', '--to', 'second');

    const { stdout, stderr } = await run(
      'clone',
      'triage',
      '--to',
      'lab',
      'scratch',
      'second',
      'third',
      'first',
    );

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

    await run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'triage');
    writeSkillDirectory(join(path, 'triage'));

    const { stdout, stderr } = await run('clone', 'triage', '--to', 'personal');

    expect(stdout).toEqual(['adopted triage → personal']);
    expect(stderr).toEqual([]);
  });

  it('prints cloned before adopted', async () => {
    const { run, store } = await newCli();
    const scratch = await newDirectory('scratch');

    await run('workspaces', 'add', 'personal', await newDirectory('personal'));
    await run('workspaces', 'add', 'scratch', scratch);
    storeSkill(store, 'triage');
    writeSkillDirectory(join(scratch, 'triage'));

    const { stdout } = await run('clone', 'triage', '--to', 'scratch', 'personal');

    expect(stdout).toEqual(['cloned triage → personal', 'adopted triage → scratch']);
  });

  it('declines a directory with no SKILL.md', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('personal');
    const dest = join(path, 'triage');

    await run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'triage');
    mkdirSync(dest, { recursive: true });

    const error = await captureError(() => run('clone', 'triage', '--to', 'personal'));

    expect(error).toBeInstanceOf(CloneDeclinedError);
    expect(error.message).toBe(
      `could not clone triage → personal: ${dest} is a directory with no SKILL.md`,
    );
  });

  it('rejects --adopt as an unknown option, touching nothing', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('personal');

    await run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'triage');
    writeSkillDirectory(join(path, 'triage'));

    const error = await captureError(() => run('clone', 'triage', '--to', 'personal', '--adopt'));

    expect(error).toBeInstanceOf(CommanderError);
    expect((error as CommanderError).code).toBe('commander.unknownOption');
    expect(error.message).toMatch(/^error: unknown option '--adopt'/);
    expect((await run('clone', 'triage', '--to', 'personal')).stdout).toEqual([
      'adopted triage → personal',
    ]);
  });

  it('replaces a recorded clone under --overwrite and says so', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('personal');
    const dest = join(path, 'triage');

    await run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'triage');
    await run('clone', 'triage', '--to', 'personal');
    writeFileSync(join(dest, 'notes.md'), 'mine', 'utf8');

    const { stdout, stderr } = await run('clone', 'triage', '--to', 'personal', '--overwrite');

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

    await run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'triage');
    await run('clone', 'triage', '--to', 'personal');

    const { stdout } = await run('clone', 'triage', '--to', 'personal', '--overwrite');

    expect(stdout).toEqual(['cloned triage → personal (replaced the directory)']);
    expect(existsSync(join(path, '.grimoire-staging'))).toBe(false);
  });

  it('fails the pair when the staging path is a file', async () => {
    const { run, runFailing, store } = await newCli();
    const path = await newDirectory('personal');
    const staging = join(path, '.grimoire-staging');

    await run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'triage');
    writeFileSync(staging, 'mine', 'utf8');

    const { error } = await runFailing('clone', 'triage', '--to', 'personal');

    expect(error).toBeInstanceOf(CloneFailedError);
    expect(error.message).toBe(`failed to clone triage → personal: ${staging} is not a directory`);
  });

  it('prints the pairs it wrote before throwing for the one whose write failed', async () => {
    const { run, runFailing, store } = await newCli();
    const first = await newDirectory('a');
    const second = await newDirectory('b');
    const third = await newDirectory('c');
    const staging = join(third, '.grimoire-staging');

    await run('workspaces', 'add', 'a', first);
    await run('workspaces', 'add', 'b', second);
    await run('workspaces', 'add', 'c', third);
    storeSkill(store, 'triage');
    writeSkillDirectory(join(first, 'triage'), { 'old.md': 'old' });
    writeSkillDirectory(join(second, 'triage'), { 'old.md': 'old' });
    writeFileSync(staging, 'mine', 'utf8');

    const { stdout, stderr, error } = await runFailing(
      'clone',
      'triage',
      '--to',
      'a',
      'b',
      'c',
      '--overwrite',
    );

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

    await run('workspaces', 'add', 'a', first);
    await run('workspaces', 'add', 'b', second);
    storeSkill(store, 'triage');
    writeFileSync(join(first, '.grimoire-staging'), 'mine', 'utf8');
    writeFileSync(join(second, '.grimoire-staging'), 'mine', 'utf8');

    const { error } = await runFailing('clone', 'triage', '--to', 'a', 'b');

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

    await run('workspaces', 'add', 'personal', path);
    storeSkill(store, 'triage');
    writeSkillDirectory(join(path, 'triage'), { 'old.md': 'old' });
    vi.mocked(rmSync).mockImplementationOnce(() => {
      throw Object.assign(new Error('delete failed'), { code: 'EACCES' });
    });

    const { stdout, stderr } = await run('clone', 'triage', '--to', 'personal', '--overwrite');
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

    await run('workspaces', 'add', 'lab', lab);
    await run('workspaces', 'add', 'fresh', await newDirectory('fresh'));
    await run('workspaces', 'add', 'linked', linked);
    const skillPath = storeSkill(store, 'triage');
    writeSkillDirectory(join(lab, 'triage'));
    symlinkSync(skillPath, join(linked, 'triage'));

    const { stdout, stderr } = await run(
      'clone',
      'triage',
      '--to',
      'lab',
      'fresh',
      'linked',
      '--overwrite',
    );

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

    await run('workspaces', 'add', 'personal', await newDirectory('personal'));
    await run('workspaces', 'add', 'lab', lab);
    storeSkill(store, 'triage');
    mkdirSync(join(lab, 'triage'), { recursive: true });
    writeFileSync(marker, 'mine', 'utf8');

    const { stdout, stderr } = await run('clone', 'triage', '--to', 'personal', 'lab', '--overwrite');

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

    await run('workspaces', 'add', 'lab', lab);
    storeSkill(store, 'triage');
    writeFileSync(dest, 'not a skill', 'utf8');

    const error = await captureError(() => run('clone', 'triage', '--to', 'lab'));

    expect(error).toBeInstanceOf(CloneDeclinedError);
    expect(error.message).toBe(`could not clone triage → lab: ${dest} is not a directory`);
  });

  it('throws one error listing every refusal when nothing was cloned', async () => {
    const { run, store } = await newCli();
    const lab = await newDirectory('lab');
    const other = await newDirectory('other');

    await run('workspaces', 'add', 'lab', lab);
    await run('workspaces', 'add', 'other', other);
    storeSkill(store, 'triage');
    mkdirSync(join(lab, 'triage'), { recursive: true });
    writeFileSync(join(other, 'triage'), 'not a skill', 'utf8');

    const error = await captureError(() => run('clone', 'triage', '--to', 'lab', 'other'));

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

    await run('workspaces', 'add', 'gone', gone);
    storeSkill(store, 'triage');
    rmSync(gone, { recursive: true });

    const error = await captureError(() => run('clone', 'triage', '--to', 'gone'));

    expect(error).toBeInstanceOf(CloneDeclinedError);
    expect(error.message).toBe(`could not clone triage → gone: ${gone} is not an existing directory`);
  });

  it('refuses a skill the store does not hold', async () => {
    const { run } = await newCli();
    const path = await newDirectory('personal');

    await run('workspaces', 'add', 'personal', path);

    const error = await captureError(() => run('clone', 'ghost', '--to', 'personal'));

    expect(error).toBeInstanceOf(EntityNotFoundError);
    expect(error.message).toBe('no skill named "ghost"');
    expect(existsSync(join(path, 'ghost'))).toBe(false);
  });

  it('refuses a skill that cannot travel', async () => {
    const { run, store } = await newCli();
    const path = await newDirectory('personal');
    const skillPath = storeSkill(store, 'triage');

    await run('workspaces', 'add', 'personal', path);
    writeSkillDirectory(join(skillPath, 'nested'));

    const error = await captureError(() => run('clone', 'triage', '--to', 'personal'));

    expect(error).toBeInstanceOf(UnportableSkillError);
    expect(error.message).toBe(`skill "${skillPath}" is not portable. Contains a nested skill.`);
    expect(existsSync(join(path, 'triage'))).toBe(false);
  });

  it.skipIf(runsAsRoot)(
    'refuses a skill holding a folder it cannot list, leaving no staging folder',
    async () => {
      const { run, store } = await newCli();
      const path = await newDirectory('personal');
      const locked = join(storeSkill(store, 'triage'), 'refs');

      await run('workspaces', 'add', 'personal', path);
      mkdirSync(locked);
      lockDirectory({ path: locked });

      const error = await captureError(() => run('clone', 'triage', '--to', 'personal'));

      expect(error).toBeInstanceOf(InvalidPathError);
      expect(error.message).toBe(`${locked} cannot be read`);
      expect(readdirSync(path)).toEqual([]);
    },
  );

  it('refuses a workspace that is not registered', async () => {
    const { run, store } = await newCli();

    storeSkill(store, 'triage');

    const error = await captureError(() => run('clone', 'triage', '--to', 'ghost'));

    expect(error).toBeInstanceOf(EntityNotFoundError);
    expect(error.message).toBe('no workspace named "ghost"');
  });

  it('checks the skill before the workspaces', async () => {
    const { run, store } = await newCli();
    const skillPath = storeSkill(store, 'triage');

    const unknownSkill = await captureError(() => run('clone', 'ghost', '--to', 'ghostspace'));

    expect(unknownSkill.message).toBe('no skill named "ghost"');

    writeSkillDirectory(join(skillPath, 'nested'));

    const unportableSkill = await captureError(() => run('clone', 'triage', '--to', 'ghostspace'));

    expect(unportableSkill).toBeInstanceOf(UnportableSkillError);
  });

  describe('choosing workspaces', () => {
    it('offers every registered workspace in name order and clones into the one picked', async () => {
      const picker = fakePicker({ choose: () => ['work'] });
      const { run, store } = await newCli({ picker });
      const personal = await newDirectory('personal');

      await run('workspaces', 'add', 'work', await newDirectory('work'));
      await run('workspaces', 'add', 'personal', personal);
      await run('workspaces', 'add', 'club', await newDirectory('club'));
      storeSkill(store, 'triage');

      const { stdout, stderr } = await run('clone', 'triage');

      expect(picker.offered).toEqual(['club', 'personal', 'work']);
      expect(stdout).toEqual(['cloned triage → work']);
      expect(stderr).toEqual([]);
      expect(existsSync(join(personal, 'triage'))).toBe(false);
    });

    it('clones into the picked workspaces in name order whatever order they were picked in', async () => {
      const picker = fakePicker({ choose: (labels) => [...labels].reverse() });
      const { run, store } = await newCli({ picker });

      await run('workspaces', 'add', 'work', await newDirectory('work'));
      await run('workspaces', 'add', 'personal', await newDirectory('personal'));
      storeSkill(store, 'triage');

      expect((await run('clone', 'triage')).stdout).toEqual([
        'cloned triage → personal',
        'cloned triage → work',
      ]);
    });

    it('says no workspace was selected when nothing is picked', async () => {
      const picker = fakePicker({ choose: () => [] });
      const { run, store } = await newCli({ picker });
      const path = await newDirectory('personal');

      await run('workspaces', 'add', 'personal', path);
      storeSkill(store, 'triage');

      const { stdout, stderr } = await run('clone', 'triage');

      expect(stdout).toEqual(['nothing to clone: no workspace selected']);
      expect(stderr).toEqual([]);
      expect(existsSync(join(path, 'triage'))).toBe(false);
    });

    it('says no workspace is registered without offering a pick', async () => {
      const picker = fakePicker({ choose: (labels) => labels });
      const { run, store } = await newCli({ picker });

      storeSkill(store, 'triage');

      const { stdout, stderr } = await run('clone', 'triage');

      expect(stdout).toEqual(['nothing to clone: no workspace is registered']);
      expect(stderr).toEqual([]);
      expect(picker.offered).toEqual([]);
    });

    it('refuses an unknown skill before offering a pick', async () => {
      const picker = fakePicker({ choose: (labels) => labels });
      const { run } = await newCli({ picker });

      await run('workspaces', 'add', 'personal', await newDirectory('personal'));

      const error = await captureError(() => run('clone', 'ghost'));

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect(picker.offered).toEqual([]);
    });

    it('refuses a skill that cannot travel before offering a pick', async () => {
      const picker = fakePicker({ choose: (labels) => labels });
      const { run, store } = await newCli({ picker });

      await run('workspaces', 'add', 'personal', await newDirectory('personal'));
      writeSkillDirectory(join(storeSkill(store, 'triage'), 'nested'));

      const error = await captureError(() => run('clone', 'triage'));

      expect(error).toBeInstanceOf(UnportableSkillError);
      expect(picker.offered).toEqual([]);
    });

    it('refuses without a terminal, naming --to and every registered workspace', async () => {
      const { run, store } = await newCli();
      const personal = await newDirectory('personal');

      await run('workspaces', 'add', 'personal', personal);
      await run('workspaces', 'add', 'work', await newDirectory('work'));
      storeSkill(store, 'triage');

      const error = await captureError(() => run('clone', 'triage'));

      expect(error).toBeInstanceOf(MissingDestinationError);
      expect(error.message.split('\n')).toEqual([
        'no workspace named, and no terminal to choose from',
        '  name them with --to: personal work',
      ]);
      expect(existsSync(join(personal, 'triage'))).toBe(false);
    });

    it('refuses without a terminal, naming only --to, when no workspace is registered', async () => {
      const { run, store } = await newCli();

      storeSkill(store, 'triage');

      const error = await captureError(() => run('clone', 'triage'));

      expect(error).toBeInstanceOf(MissingDestinationError);
      expect(error.message.split('\n')).toEqual([
        'no workspace named, and no terminal to choose from',
        '  name them with --to',
      ]);
      expect(existsSync(store.paths.state)).toBe(false);
    });

    it('refuses an unknown skill without a terminal', async () => {
      const { run } = await newCli();
      const personal = await newDirectory('personal');

      await run('workspaces', 'add', 'personal', personal);

      const error = await captureError(() => run('clone', 'ghost'));

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect(existsSync(join(personal, 'ghost'))).toBe(false);
    });
  });

  describe('--drop', () => {
    it('forgets the record without any skill in the store', async () => {
      const { run, store } = await newCli();

      await run('workspaces', 'add', 'personal', await newDirectory('project'));
      recordClone(store, 'triage', { workspace: 'personal' });

      const { stdout, stderr } = await run('clone', 'triage', '--drop', 'personal');

      expect(stdout).toEqual(['uncloned triage → personal']);
      expect(stderr).toEqual([]);
      expect(clonesOf(store, 'triage')).toEqual([]);
    });

    it('says nothing was recorded to forget', async () => {
      const { run } = await newCli();

      await run('workspaces', 'add', 'personal', await newDirectory('project'));

      expect((await run('clone', 'triage', '--drop', 'personal')).stdout).toEqual([
        'not cloned triage → personal',
      ]);
    });

    it('groups uncloned and not-cloned lines by outcome, keeping argument order within each', async () => {
      const { run, store } = await newCli();

      await run('workspaces', 'add', 'work', await newDirectory('work'));
      await run('workspaces', 'add', 'club', await newDirectory('club'));
      await run('workspaces', 'add', 'personal', await newDirectory('personal'));
      recordClone(store, 'triage', { workspace: 'work' });
      recordClone(store, 'triage', { workspace: 'club' });

      const { stdout } = await run('clone', 'triage', '--drop', 'personal', 'work', 'club');

      expect(stdout).toEqual([
        'uncloned triage → work',
        'uncloned triage → club',
        'not cloned triage → personal',
      ]);
    });

    it('forgets a path record and leaves the directory and its files on disk', async () => {
      const { run, store } = await newCli();
      const dir = await newDirectory('old');
      const skillFile = join(dir, 'triage', SKILL_MANIFEST);

      await run('workspaces', 'add', 'personal', await newDirectory('project'));
      writeSkillDirectory(join(dir, 'triage'));
      recordClone(store, 'triage', { path: dir });

      const { stdout } = await run('clone', 'triage', '--drop', `${dir}/`);

      expect(stdout).toEqual([`uncloned triage → ${dir}`]);
      expect(existsSync(skillFile)).toBe(true);
    });

    it('refuses an unregistered workspace before forgetting anything', async () => {
      const { run, store } = await newCli();

      await run('workspaces', 'add', 'personal', await newDirectory('project'));
      recordClone(store, 'triage', { workspace: 'personal' });

      const error = await captureError(() => run('clone', 'triage', '--drop', 'personal', 'ghost'));

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect(error.message).toBe('no workspace named "ghost"');
      expect(clonesOf(store, 'triage')).toEqual([{ workspace: 'personal' }]);
    });

    describe('choosing clones to drop', () => {
      it('offers the records in record order, labeling a path record by its normalized path, and forgets the one picked', async () => {
        const picker = fakePicker({ choose: () => ['personal'] });
        const { run, store } = await newCli({ picker });
        const personal = await newDirectory('personal');
        const old = await newDirectory('old');

        await run('workspaces', 'add', 'work', await newDirectory('work'));
        await run('workspaces', 'add', 'personal', personal);
        storeSkill(store, 'triage');
        recordClone(store, 'triage', { workspace: 'work' });
        recordClone(store, 'triage', { path: `${old}/` });
        recordClone(store, 'triage', { workspace: 'personal' });

        const { stdout, stderr } = await run('clone', 'triage', '--drop');

        expect(picker.offered).toEqual(['work', old, 'personal']);
        expect(stdout).toEqual(['uncloned triage → personal']);
        expect(stderr).toEqual([]);
        expect(clonesOf(store, 'triage')).toEqual([{ workspace: 'work' }, { path: `${old}/` }]);
      });

      it('forgets a picked record of a skill the store does not hold', async () => {
        const picker = fakePicker({ choose: (labels) => labels });
        const { run, store } = await newCli({ picker });
        const old = await newDirectory('old');

        await run('workspaces', 'add', 'personal', await newDirectory('personal'));
        recordClone(store, 'triage', { path: old });

        expect((await run('clone', 'triage', '--drop')).stdout).toEqual([`uncloned triage → ${old}`]);
        expect(clonesOf(store, 'triage')).toEqual([]);
      });

      it('says no clone was selected when nothing is picked, keeping the records', async () => {
        const picker = fakePicker({ choose: () => [] });
        const { run, store } = await newCli({ picker });

        await run('workspaces', 'add', 'personal', await newDirectory('personal'));
        recordClone(store, 'triage', { workspace: 'personal' });

        const { stdout, stderr } = await run('clone', 'triage', '--drop');

        expect(stdout).toEqual(['nothing to unclone: no clone selected']);
        expect(stderr).toEqual([]);
        expect(clonesOf(store, 'triage')).toEqual([{ workspace: 'personal' }]);
      });

      it('says the skill has no clone records without offering a pick', async () => {
        const picker = fakePicker({ choose: (labels) => labels });
        const { run } = await newCli({ picker });

        await run('workspaces', 'add', 'personal', await newDirectory('personal'));

        const { stdout, stderr } = await run('clone', 'triage', '--drop');

        expect(stdout).toEqual(['nothing to unclone: triage has no clone records']);
        expect(stderr).toEqual([]);
        expect(picker.offered).toEqual([]);
      });

      it('refuses without a terminal, naming --drop and every recorded target', async () => {
        const { run, store } = await newCli();
        const spaced = await newDirectory('old skills');

        await run('workspaces', 'add', 'personal', await newDirectory('personal'));
        recordClone(store, 'triage', { workspace: 'personal' });
        recordClone(store, 'triage', { path: spaced });

        const error = await captureError(() => run('clone', 'triage', '--drop'));

        expect(error).toBeInstanceOf(MissingDestinationError);
        expect(error.message.split('\n')).toEqual([
          'no clone named, and no terminal to choose from',
          `  name them after --drop: personal '${spaced}'`,
        ]);
        expect(clonesOf(store, 'triage')).toHaveLength(2);
      });

      it('refuses without a terminal, naming only --drop, when the skill has no clone records', async () => {
        const { run, store } = await newCli();

        await run('workspaces', 'add', 'personal', await newDirectory('personal'));

        const error = await captureError(() => run('clone', 'triage', '--drop'));

        expect(error).toBeInstanceOf(MissingDestinationError);
        expect(error.message.split('\n')).toEqual([
          'no clone named, and no terminal to choose from',
          '  name them after --drop',
        ]);
        expect(clonesOf(store, 'triage')).toEqual([]);
      });
    });
  });

  describe('refusals', () => {
    it.each([
      [[], "error: missing required argument 'skill'"],
      [
        ['--to', 'personal', 'triage'],
        "error: missing required argument 'skill'\n  --to takes every name after it, so name the skill before it",
      ],
      [
        ['--drop', 'personal', 'triage'],
        "error: missing required argument 'skill'\n  --drop takes every name after it, so name the skill before it",
      ],
      [
        ['triage', '--to', 'personal', '--drop', '--overwrite'],
        'error: --to cannot be combined with --drop',
      ],
      [
        ['triage', '--drop', 'personal', '--overwrite'],
        'error: --overwrite cannot be combined with --drop',
      ],
    ])('refuses clone %j', async (argv, message) => {
      const { run } = await newCli();

      const error = await captureError(() => run('clone', ...argv));

      expect(error).toBeInstanceOf(CommanderError);
      expect(error.message).toBe(message);
    });
  });

  it('no longer knows unclone as a command', async () => {
    const { run } = await newCli();

    const error = await captureError(() => run('unclone', 'triage', 'personal'));

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
