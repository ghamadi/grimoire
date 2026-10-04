import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { describe, expect, it, onTestFinished, vi } from 'vitest';
import { GrimoireStore, GrimoireStoreManager } from '#src/domains/grimoire-store/index';
import { SKILL_MANIFEST } from '#src/domains/skill/index';
import {
  CloneDeclinedError,
  type CloneFailure,
  EntityNotFoundError,
  InvalidPathError,
  UnportableSkillError,
} from '#src/lib/errors/index';
import { lockDirectory, runsAsRoot } from '#test-helpers/locked-directory';
import { tempRoot } from '#test-helpers/temp-root';
import { type CloneSkillReport, type CloneWritten, createCloneSkillUseCase } from '../factory.ts';

describe('clone-skill-use-case factory', () => {
  describe('the preflight', () => {
    it('throws on a skill the store does not hold, touching nothing', async () => {
      const { cloneSkill, workspace } = await newUseCase();
      const personal = workspace('personal');

      expect(refusal(() => cloneSkill({ skillName: 'ghost', workspaces: ['personal'] }))).toBeInstanceOf(
        EntityNotFoundError,
      );
      expect(existsSync(join(personal, 'brainstorm'))).toBe(false);
    });

    it('throws on a store directory holding no SKILL.md', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');

      mkdirSync(join(store.paths.skills, 'brainstorm'), { recursive: true });

      expect(
        refusal(() => cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] })),
      ).toBeInstanceOf(UnportableSkillError);
      expect(existsSync(join(personal, 'brainstorm'))).toBe(false);
    });

    it('throws on an unregistered workspace name, touching nothing', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');

      storeSkill(store, 'brainstorm');

      expect(
        refusal(() => cloneSkill({ skillName: 'brainstorm', workspaces: ['ghost'] })),
      ).toBeInstanceOf(EntityNotFoundError);
      expect(existsSync(join(personal, 'brainstorm'))).toBe(false);
    });

    it('carries the first of two unknown workspace names', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();

      workspace('second');
      storeSkill(store, 'brainstorm');

      const error = refusal(() =>
        cloneSkill({ skillName: 'brainstorm', workspaces: ['first', 'second'] }),
      );

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect((error as EntityNotFoundError).entryName).toBe('first');
    });

    it('throws for the skill when both a ghost skill and a ghost workspace are named', async () => {
      const { cloneSkill, workspace } = await newUseCase();
      const personal = workspace('personal');

      const error = refusal(() => cloneSkill({ skillName: 'ghost', workspaces: ['ghost-workspace'] }));

      expect(error).toBeInstanceOf(EntityNotFoundError);
      expect((error as EntityNotFoundError).entity).toBe('skill');
      expect(existsSync(join(personal, 'brainstorm'))).toBe(false);
    });

    it('throws UnportableSkillError beside a ghost workspace, before the workspace name is checked', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');

      mkdirSync(join(store.paths.skills, 'brainstorm'), { recursive: true });

      const error = refusal(() =>
        cloneSkill({ skillName: 'brainstorm', workspaces: ['ghost-workspace'] }),
      );

      expect(error).toBeInstanceOf(UnportableSkillError);
      expect(existsSync(join(personal, 'brainstorm'))).toBe(false);
    });
  });

  describe('what it copies', () => {
    it('copies an empty destination verbatim and records the clone', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');

      storeSkill(store, 'brainstorm', { 'references/notes.md': 'deep notes' });

      const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

      expect(report.cloned).toEqual([
        { skill: 'brainstorm', workspace: 'personal', replaced: 'nothing' },
      ]);
      expect(readFileSync(join(personal, 'brainstorm', 'references', 'notes.md'), 'utf8')).toBe(
        'deep notes',
      );
      expect(manager.listSkillClones('brainstorm')).toEqual([
        { origin: 'personal', path: join(personal, 'brainstorm'), record: { workspace: 'personal' } },
      ]);
    });

    it('replaces a symlink into this store skill, marking it replaced', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');
      const skillPath = storeSkill(store, 'brainstorm');

      symlinkSync(skillPath, dest);

      const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

      expect(report.cloned).toEqual([{ skill: 'brainstorm', workspace: 'personal', replaced: 'link' }]);
      expect(lstatSync(dest).isSymbolicLink()).toBe(false);
      expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('# skill\n');
      expect(existsSync(join(skillPath, SKILL_MANIFEST))).toBe(true);
    });

    it('declines a symlink into a different store skill, leaving it in place', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      const triagePath = storeSkill(store, 'triage');
      symlinkSync(triagePath, dest);

      const error = refusal(() => cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] }));

      expect(error).toBeInstanceOf(CloneDeclinedError);
      expect((error as CloneDeclinedError).refusals).toEqual([
        {
          kind: 'occupied',
          skill: 'brainstorm',
          workspace: 'personal',
          path: dest,
          occupant: { kind: 'foreign-symlink' },
        },
      ]);
      expect(readlinkSync(dest)).toBe(triagePath);
    });

    it('copies before it records the clone', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');

      const record = manager.recordClone.bind(manager);
      const seen: boolean[] = [];
      vi.spyOn(manager, 'recordClone').mockImplementation((params) => {
        seen.push(existsSync(join(dest, SKILL_MANIFEST)));
        record(params);
      });

      cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

      expect(seen).toEqual([true]);
      expect(manager.listSkillClones('brainstorm')).toEqual([
        { origin: 'personal', path: dest, record: { workspace: 'personal' } },
      ]);
    });
  });

  describe('the destinations it declines', () => {
    it('declines a plain file at the destination, leaving its content untouched', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      writeFileSync(dest, 'not a skill', 'utf8');

      const error = refusal(() => cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] }));

      expect((error as CloneDeclinedError).refusals).toEqual([
        {
          kind: 'occupied',
          skill: 'brainstorm',
          workspace: 'personal',
          path: dest,
          occupant: { kind: 'not-a-directory' },
        },
      ]);
      expect(readFileSync(dest, 'utf8')).toBe('not a skill');
    });

    it('declines a registered directory that is gone, cloning into the rest', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const gone = workspace('personal');
      workspace('work');

      rmSync(gone, { recursive: true });
      storeSkill(store, 'brainstorm');

      const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] });

      expect(report.declined).toEqual([
        { kind: 'workspace-unreachable', skill: 'brainstorm', workspace: 'personal', path: gone },
      ]);
      expect(report.cloned).toEqual([{ skill: 'brainstorm', workspace: 'work', replaced: 'nothing' }]);
    });

    it('declines a registered path that has become a file, cloning into the rest', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const path = workspace('personal');
      workspace('work');

      rmSync(path, { recursive: true });
      writeFileSync(path, '', 'utf8');
      storeSkill(store, 'brainstorm');

      const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] });

      expect(report.declined).toEqual([
        { kind: 'workspace-unreachable', skill: 'brainstorm', workspace: 'personal', path },
      ]);
      expect(report.cloned).toEqual([{ skill: 'brainstorm', workspace: 'work', replaced: 'nothing' }]);
    });

    it('declines a registered path that is a symlink cycle, cloning into the rest', async () => {
      const { cloneSkill, store, workspace, root } = await newUseCase();
      const work = workspace('work');
      const cycle = join(root, 'a');

      symlinkSync(join(root, 'b'), cycle);
      symlinkSync(cycle, join(root, 'b'));
      handEditState(store, {
        personal: { path: cycle, autoLink: false },
        work: { path: work, autoLink: false },
      });
      storeSkill(store, 'brainstorm');

      const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] });

      expect(report.declined).toEqual([
        { kind: 'workspace-unreachable', skill: 'brainstorm', workspace: 'personal', path: cycle },
      ]);
      expect(report.cloned).toEqual([{ skill: 'brainstorm', workspace: 'work', replaced: 'nothing' }]);
    });

    describe.skipIf(runsAsRoot)('a workspace that cannot be read', () => {
      it('declines it rather than throwing, cloning into the rest', async () => {
        const { cloneSkill, store, workspace } = await newUseCase();
        const personal = workspace('personal');
        workspace('work');

        storeSkill(store, 'brainstorm');
        lockDirectory({ path: personal });

        const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] });

        expect(report.declined).toEqual([
          { kind: 'workspace-unreadable', skill: 'brainstorm', workspace: 'personal', path: personal },
        ]);
        expect(report.cloned).toEqual([{ skill: 'brainstorm', workspace: 'work', replaced: 'nothing' }]);
      });
    });
  });

  describe('recorded destinations', () => {
    it('reports a recorded directory as already cloned without inspecting or refreshing it', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      writeSkillDirectory(dest, { [SKILL_MANIFEST]: 'drifted' });
      manager.recordClone({ skill: 'brainstorm', workspace: 'personal' });

      const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

      expect(report.alreadyCloned).toEqual([{ skill: 'brainstorm', workspace: 'personal' }]);
      expect(report.cloned).toEqual([]);
      expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('drifted');
    });

    it('reports a recorded directory as already cloned without inspecting its content', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'triage');

      storeSkill(store, 'triage');
      writeSkillDirectory(dest);
      manager.recordClone({ skill: 'triage', workspace: 'personal' });
      rmSync(join(dest, SKILL_MANIFEST));

      const report = cloneSkill({ skillName: 'triage', workspaces: ['personal'] });

      expect(report.alreadyCloned).toEqual([{ skill: 'triage', workspace: 'personal' }]);
      expect(report.adopted).toEqual([]);
      expect(report.declined).toEqual([]);
    });

    it('reports already cloned through a sibling workspace registered at the same path', async () => {
      const { cloneSkill, manager, store, root } = await newUseCase();
      const shared = join(root, 'shared');
      mkdirSync(shared, { recursive: true });

      manager.registerWorkspace({ name: 'first', path: shared, autoLink: false });
      manager.registerWorkspace({ name: 'second', path: shared, autoLink: false });

      storeSkill(store, 'brainstorm');
      writeSkillDirectory(join(shared, 'brainstorm'));
      manager.recordClone({ skill: 'brainstorm', workspace: 'first' });

      const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['second'] });

      expect(report.alreadyCloned).toEqual([{ skill: 'brainstorm', workspace: 'second' }]);
      expect(report.cloned).toEqual([]);
    });

    it('re-copies under a { path } record for a directory the user deleted', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      manager.recordClone({ skill: 'brainstorm', workspace: 'personal' });
      manager.recordClonesByPath({ workspace: 'personal', path: personal });
      rmSync(dest, { recursive: true, force: true });

      const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

      expect(report.cloned).toEqual([
        { skill: 'brainstorm', workspace: 'personal', replaced: 'nothing' },
      ]);
      expect(existsSync(join(dest, SKILL_MANIFEST))).toBe(true);
      expect(manager.listSkillClones('brainstorm')).toEqual([
        { origin: personal, path: dest, record: { path: personal } },
      ]);
    });
  });

  describe('adopting', () => {
    it('records a directory that differs from the store copy without touching either', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'triage');
      const storePath = storeSkill(store, 'triage');

      writeSkillDirectory(dest, { [SKILL_MANIFEST]: 'edited' });

      const report = cloneSkill({ skillName: 'triage', workspaces: ['personal'] });

      expect(report.adopted).toEqual([{ skill: 'triage', workspace: 'personal' }]);
      expect(report.cloned).toEqual([]);
      expect(report.declined).toEqual([]);
      expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('edited');
      expect(readFileSync(join(storePath, SKILL_MANIFEST), 'utf8')).toBe('# skill\n');
      expect(manager.listSkillClones('triage')).toEqual([
        { origin: 'personal', path: dest, record: { workspace: 'personal' } },
      ]);
    });

    it('declines a directory holding no SKILL.md and records nothing', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'triage');

      storeSkill(store, 'triage');
      mkdirSync(dest, { recursive: true });

      const error = refusal(() => cloneSkill({ skillName: 'triage', workspaces: ['personal'] }));

      expect(error).toBeInstanceOf(CloneDeclinedError);
      expect((error as CloneDeclinedError).refusals).toEqual([
        {
          kind: 'occupied',
          skill: 'triage',
          workspace: 'personal',
          path: dest,
          occupant: { kind: 'not-a-skill' },
        },
      ]);
      expect(manager.listSkillClones('triage')).toEqual([]);
    });
  });

  describe('overwriting', () => {
    it('replaces a recorded directory wholesale, keeping its record', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      writeSkillDirectory(dest, { [SKILL_MANIFEST]: 'drifted', 'extra.md': 'mine' });
      manager.recordClone({ skill: 'brainstorm', workspace: 'personal' });

      const report = cloneSkill({
        skillName: 'brainstorm',
        workspaces: ['personal'],
        overwrite: true,
      });

      expect(report).toEqual(
        clonedReport({ skill: 'brainstorm', workspace: 'personal', replaced: 'directory' }),
      );
      expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('# skill\n');
      expect(existsSync(join(dest, 'extra.md'))).toBe(false);
      expect(manager.listSkillClones('brainstorm')).toEqual([
        { origin: 'personal', path: dest, record: { workspace: 'personal' } },
      ]);
    });

    it('replaces a recorded directory holding no SKILL.md', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'triage');

      storeSkill(store, 'triage');
      writeSkillDirectory(dest);
      manager.recordClone({ skill: 'triage', workspace: 'personal' });
      rmSync(join(dest, SKILL_MANIFEST));

      const report = cloneSkill({ skillName: 'triage', workspaces: ['personal'], overwrite: true });

      expect(report).toEqual(
        clonedReport({ skill: 'triage', workspace: 'personal', replaced: 'directory' }),
      );
      expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('# skill\n');
    });

    it('replaces an unrecorded directory holding SKILL.md, recording it once after the copy', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'triage');

      storeSkill(store, 'triage');
      writeSkillDirectory(dest, { [SKILL_MANIFEST]: 'edited' });

      const record = manager.recordClone.bind(manager);
      const seen: string[] = [];
      vi.spyOn(manager, 'recordClone').mockImplementation((params) => {
        seen.push(readFileSync(join(dest, SKILL_MANIFEST), 'utf8'));
        record(params);
      });

      const report = cloneSkill({ skillName: 'triage', workspaces: ['personal'], overwrite: true });

      expect(report).toEqual(
        clonedReport({ skill: 'triage', workspace: 'personal', replaced: 'directory' }),
      );
      expect(seen).toEqual(['# skill\n']);
      expect(manager.listSkillClones('triage')).toEqual([
        { origin: 'personal', path: dest, record: { workspace: 'personal' } },
      ]);
    });

    it('replaces a directory under a { path } record without adding a second record', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      writeSkillDirectory(dest, { [SKILL_MANIFEST]: 'drifted' });
      manager.recordClone({ skill: 'brainstorm', workspace: 'personal' });
      manager.recordClonesByPath({ workspace: 'personal', path: personal });

      const report = cloneSkill({
        skillName: 'brainstorm',
        workspaces: ['personal'],
        overwrite: true,
      });

      expect(report).toEqual(
        clonedReport({ skill: 'brainstorm', workspace: 'personal', replaced: 'directory' }),
      );
      expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('# skill\n');
      expect(manager.listSkillClones('brainstorm')).toEqual([
        { origin: personal, path: dest, record: { path: personal } },
      ]);
    });

    it('still declines an unrecorded directory holding no SKILL.md, deleting nothing', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'triage');

      storeSkill(store, 'triage');
      mkdirSync(dest, { recursive: true });
      writeFileSync(join(dest, 'marker.txt'), 'mine', 'utf8');

      const error = refusal(() =>
        cloneSkill({ skillName: 'triage', workspaces: ['personal'], overwrite: true }),
      );

      expect(error).toBeInstanceOf(CloneDeclinedError);
      expect((error as CloneDeclinedError).refusals).toEqual([
        {
          kind: 'occupied',
          skill: 'triage',
          workspace: 'personal',
          path: dest,
          occupant: { kind: 'not-a-skill' },
        },
      ]);
      expect(readFileSync(join(dest, 'marker.txt'), 'utf8')).toBe('mine');
      expect(manager.listSkillClones('triage')).toEqual([]);
    });

    it('still declines a plain file, leaving its content untouched', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      writeFileSync(dest, 'not a skill', 'utf8');

      const error = refusal(() =>
        cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'], overwrite: true }),
      );

      expect((error as CloneDeclinedError).refusals).toEqual([
        {
          kind: 'occupied',
          skill: 'brainstorm',
          workspace: 'personal',
          path: dest,
          occupant: { kind: 'not-a-directory' },
        },
      ]);
      expect(readFileSync(dest, 'utf8')).toBe('not a skill');
      expect(manager.listSkillClones('brainstorm')).toEqual([]);
    });

    it('still declines a symlink into a different store skill, leaving it in place', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      const triagePath = storeSkill(store, 'triage');
      symlinkSync(triagePath, dest);

      const error = refusal(() =>
        cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'], overwrite: true }),
      );

      expect((error as CloneDeclinedError).refusals).toEqual([
        {
          kind: 'occupied',
          skill: 'brainstorm',
          workspace: 'personal',
          path: dest,
          occupant: { kind: 'foreign-symlink' },
        },
      ]);
      expect(readlinkSync(dest)).toBe(triagePath);
      expect(manager.listSkillClones('brainstorm')).toEqual([]);
    });

    it('throws on an unportable store skill before deleting a recorded destination', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');

      mkdirSync(join(store.paths.skills, 'brainstorm'), { recursive: true });
      writeSkillDirectory(dest, { 'keep.md': 'mine' });
      manager.recordClone({ skill: 'brainstorm', workspace: 'personal' });

      const error = refusal(() =>
        cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'], overwrite: true }),
      );

      expect(error).toBeInstanceOf(UnportableSkillError);
      expect(readFileSync(join(dest, 'keep.md'), 'utf8')).toBe('mine');
      expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('# skill\n');
    });

    it('reports nothing at the destination as replaced: nothing', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();

      workspace('personal');
      storeSkill(store, 'brainstorm');

      const report = cloneSkill({
        skillName: 'brainstorm',
        workspaces: ['personal'],
        overwrite: true,
      });

      expect(report).toEqual(
        clonedReport({ skill: 'brainstorm', workspace: 'personal', replaced: 'nothing' }),
      );
    });

    it('reports a symlink into this store skill as replaced: link', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');

      symlinkSync(storeSkill(store, 'brainstorm'), dest);

      const report = cloneSkill({
        skillName: 'brainstorm',
        workspaces: ['personal'],
        overwrite: true,
      });

      expect(report).toEqual(
        clonedReport({ skill: 'brainstorm', workspace: 'personal', replaced: 'link' }),
      );
      expect(lstatSync(dest).isSymbolicLink()).toBe(false);
    });

    it('returns rather than throwing when a replacement sits beside a refusal', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const work = workspace('work');

      storeSkill(store, 'brainstorm');
      writeSkillDirectory(join(personal, 'brainstorm'), { [SKILL_MANIFEST]: 'drifted' });
      manager.recordClone({ skill: 'brainstorm', workspace: 'personal' });
      writeFileSync(join(work, 'brainstorm'), 'not a skill', 'utf8');

      const report = cloneSkill({
        skillName: 'brainstorm',
        workspaces: ['personal', 'work'],
        overwrite: true,
      });

      expect(report.cloned).toEqual([
        { skill: 'brainstorm', workspace: 'personal', replaced: 'directory' },
      ]);
      expect(report.declined).toEqual([
        {
          kind: 'occupied',
          skill: 'brainstorm',
          workspace: 'work',
          path: join(work, 'brainstorm'),
          occupant: { kind: 'not-a-directory' },
        },
      ]);
    });
  });

  describe('staging', () => {
    it('leaves no staging directory after cloning into an empty destination', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');

      storeSkill(store, 'brainstorm', { 'references/notes.md': 'deep notes' });

      cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

      expect(existsSync(stagingPath(personal))).toBe(false);
      expect(readFileSync(join(personal, 'brainstorm', 'references', 'notes.md'), 'utf8')).toBe(
        'deep notes',
      );
    });

    it('leaves no staging directory after replacing a symlink into this store skill', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');

      symlinkSync(storeSkill(store, 'brainstorm'), dest);

      cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

      expect(existsSync(stagingPath(personal))).toBe(false);
      expect(lstatSync(dest).isDirectory()).toBe(true);
      expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('# skill\n');
    });

    it('leaves no staging directory after overwriting a recorded directory', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      writeSkillDirectory(dest, { [SKILL_MANIFEST]: 'drifted' });
      manager.recordClone({ skill: 'brainstorm', workspace: 'personal' });

      cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'], overwrite: true });

      expect(existsSync(stagingPath(personal))).toBe(false);
      expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('# skill\n');
    });

    it('leaves no staging directory after overwriting an unrecorded skill directory', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm');
      writeSkillDirectory(dest, { [SKILL_MANIFEST]: 'edited' });

      cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'], overwrite: true });

      expect(existsSync(stagingPath(personal))).toBe(false);
      expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('# skill\n');
    });

    it('records the clone only once the whole copy is in place and staging is gone', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const dest = join(personal, 'brainstorm');

      storeSkill(store, 'brainstorm', { 'references/notes.md': 'deep notes' });

      const record = manager.recordClone.bind(manager);
      const seen: { manifest: boolean; notes: boolean; staging: boolean }[] = [];
      vi.spyOn(manager, 'recordClone').mockImplementation((params) => {
        seen.push({
          manifest: existsSync(join(dest, SKILL_MANIFEST)),
          notes: existsSync(join(dest, 'references', 'notes.md')),
          staging: existsSync(stagingPath(personal)),
        });
        record(params);
      });

      cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

      expect(seen).toEqual([{ manifest: true, notes: true, staging: false }]);
    });

    it('is not blocked by a leftover entry from a killed run, and leaves it in place', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const leftover = join(stagingPath(personal), 'brainstorm.old-id.outgoing', 'notes.md');

      storeSkill(store, 'brainstorm');
      mkdirSync(dirname(leftover), { recursive: true });
      writeFileSync(leftover, 'old notes', 'utf8');

      const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

      expect(report.cloned).toEqual([
        { skill: 'brainstorm', workspace: 'personal', replaced: 'nothing' },
      ]);
      expect(readFileSync(leftover, 'utf8')).toBe('old notes');
    });

    describe('an unusable staging path', () => {
      it('fails the pair for a file there, writing neither the copy nor a record', async () => {
        const { cloneSkill, manager, store, workspace } = await newUseCase();
        const personal = workspace('personal');

        storeSkill(store, 'brainstorm');
        writeFileSync(stagingPath(personal), 'mine', 'utf8');

        const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

        expect(report.cloned).toEqual([]);
        expect(report.failed).toEqual([
          {
            skill: 'brainstorm',
            workspace: 'personal',
            path: join(personal, 'brainstorm'),
            error: expect.any(InvalidPathError) as unknown,
          },
        ]);
        expect(existsSync(join(personal, 'brainstorm'))).toBe(false);
        expect(readFileSync(stagingPath(personal), 'utf8')).toBe('mine');
        expect(manager.listSkillClones('brainstorm')).toEqual([]);
      });

      it('fails the pair for a file there under overwrite, leaving the recorded directory untouched', async () => {
        const { cloneSkill, manager, store, workspace } = await newUseCase();
        const personal = workspace('personal');
        const dest = join(personal, 'brainstorm');

        storeSkill(store, 'brainstorm');
        writeSkillDirectory(dest, { [SKILL_MANIFEST]: 'drifted', 'extra.md': 'mine' });
        manager.recordClone({ skill: 'brainstorm', workspace: 'personal' });
        writeFileSync(stagingPath(personal), 'mine', 'utf8');

        const report = cloneSkill({
          skillName: 'brainstorm',
          workspaces: ['personal'],
          overwrite: true,
        });

        expect(failureOf(report).error).toBeInstanceOf(InvalidPathError);
        expect(report.cloned).toEqual([]);
        expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('drifted');
        expect(readFileSync(join(dest, 'extra.md'), 'utf8')).toBe('mine');
      });

      it('fails the pair for a symlink there, writing nothing through it', async () => {
        const { cloneSkill, root, store, workspace } = await newUseCase();
        const personal = workspace('personal');
        const elsewhere = join(root, 'elsewhere');

        storeSkill(store, 'brainstorm');
        mkdirSync(elsewhere);
        symlinkSync(elsewhere, stagingPath(personal));

        const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

        expect(failureOf(report).error).toBeInstanceOf(InvalidPathError);
        expect(readdirSync(elsewhere)).toEqual([]);
      });

      it('does not stop a recorded directory from reading as already cloned', async () => {
        const { cloneSkill, manager, store, workspace } = await newUseCase();
        const personal = workspace('personal');

        storeSkill(store, 'brainstorm');
        writeSkillDirectory(join(personal, 'brainstorm'));
        manager.recordClone({ skill: 'brainstorm', workspace: 'personal' });
        writeFileSync(stagingPath(personal), 'mine', 'utf8');

        const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

        expect(report.alreadyCloned).toEqual([{ skill: 'brainstorm', workspace: 'personal' }]);
      });
    });

    describe.skipIf(runsAsRoot)('a copy that fails', () => {
      /** A store skill holding one file that cannot be read, and the call that makes it readable again. */
      function storeUnreadableSkill(store: GrimoireStore, name: string) {
        const skillPath = storeSkill(store, name, { 'secret.md': 'secret' });
        const unreadable = join(skillPath, 'secret.md');
        const makeReadable = () => chmodSync(unreadable, 0o644);

        chmodSync(unreadable, 0o000);
        onTestFinished(makeReadable);

        return { skillPath, makeReadable };
      }

      it('leaves a recorded directory and its record as they were under overwrite', async () => {
        const { cloneSkill, manager, store, workspace } = await newUseCase();
        const personal = workspace('personal');
        const dest = join(personal, 'brainstorm');

        storeUnreadableSkill(store, 'brainstorm');
        writeSkillDirectory(dest, { [SKILL_MANIFEST]: 'drifted', 'extra.md': 'mine' });
        manager.recordClone({ skill: 'brainstorm', workspace: 'personal' });

        const report = cloneSkill({
          skillName: 'brainstorm',
          workspaces: ['personal'],
          overwrite: true,
        });

        expect(failureOf(report)).toMatchObject({
          workspace: 'personal',
          path: dest,
          error: { code: 'EACCES' },
        });
        expect(report.cloned).toEqual([]);
        expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('drifted');
        expect(readFileSync(join(dest, 'extra.md'), 'utf8')).toBe('mine');
        expect(manager.listSkillClones('brainstorm')).toEqual([
          { origin: 'personal', path: dest, record: { workspace: 'personal' } },
        ]);
        expect(existsSync(stagingPath(personal))).toBe(false);
      });

      it('leaves an unrecorded skill directory whole, so a rerun with overwrite can still replace it', async () => {
        const { cloneSkill, manager, store, workspace } = await newUseCase();
        const personal = workspace('personal');
        const dest = join(personal, 'brainstorm');

        const { makeReadable } = storeUnreadableSkill(store, 'brainstorm');
        writeSkillDirectory(dest, { [SKILL_MANIFEST]: 'edited', 'extra.md': 'mine' });

        const failedReport = cloneSkill({
          skillName: 'brainstorm',
          workspaces: ['personal'],
          overwrite: true,
        });

        expect(failureOf(failedReport)).toMatchObject({ path: dest, error: { code: 'EACCES' } });
        expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('edited');
        expect(readFileSync(join(dest, 'extra.md'), 'utf8')).toBe('mine');
        expect(manager.listSkillClones('brainstorm')).toEqual([]);

        makeReadable();

        const report = cloneSkill({
          skillName: 'brainstorm',
          workspaces: ['personal'],
          overwrite: true,
        });

        expect(report).toEqual(
          clonedReport({ skill: 'brainstorm', workspace: 'personal', replaced: 'directory' }),
        );
      });

      it('leaves an empty destination empty, so a plain rerun still clones into it', async () => {
        const { cloneSkill, manager, store, workspace } = await newUseCase();
        const personal = workspace('personal');
        const dest = join(personal, 'brainstorm');

        const { makeReadable } = storeUnreadableSkill(store, 'brainstorm');

        const failedReport = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

        expect(failureOf(failedReport)).toMatchObject({ path: dest, error: { code: 'EACCES' } });
        expect(lstatSync(dest, { throwIfNoEntry: false })).toBeUndefined();
        expect(manager.listSkillClones('brainstorm')).toEqual([]);

        makeReadable();

        const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

        expect(report).toEqual(
          clonedReport({ skill: 'brainstorm', workspace: 'personal', replaced: 'nothing' }),
        );
      });

      it('leaves a symlink into this store skill in place', async () => {
        const { cloneSkill, store, workspace } = await newUseCase();
        const personal = workspace('personal');
        const dest = join(personal, 'brainstorm');

        const { skillPath } = storeUnreadableSkill(store, 'brainstorm');
        symlinkSync(skillPath, dest);

        const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal'] });

        expect(failureOf(report)).toMatchObject({ path: dest, error: { code: 'EACCES' } });
        expect(readlinkSync(dest)).toBe(skillPath);
      });
    });

    describe.skipIf(runsAsRoot)('a replaced directory that cannot be deleted', () => {
      it('counts the pair as cloned and recorded, naming the partly deleted old copy', async () => {
        const { cloneSkill, manager, store, workspace } = await newUseCase();
        const personal = workspace('personal');
        const dest = join(personal, 'brainstorm');

        storeSkill(store, 'brainstorm', { 'references/notes.md': 'deep notes' });
        writeSkillDirectory(dest, { [SKILL_MANIFEST]: 'edited', 'readonly/old.md': 'old' });
        chmodSync(join(dest, 'readonly'), 0o555);

        // Not `lockDirectory`: the directory is moved into staging before the
        // delete fails, so the path it would restore no longer exists.
        const makeWritable = () => {
          for (const entry of readdirSync(stagingPath(personal))) {
            chmodSync(join(stagingPath(personal), entry, 'readonly'), 0o755);
          }
        };
        onTestFinished(makeWritable);

        const report = cloneSkill({
          skillName: 'brainstorm',
          workspaces: ['personal'],
          overwrite: true,
        });
        const [entry] = readdirSync(stagingPath(personal));

        expect(report.failed).toEqual([]);
        expect(report.cloned).toEqual([
          {
            skill: 'brainstorm',
            workspace: 'personal',
            replaced: 'directory',
            strandedOldEntry: {
              path: join(stagingPath(personal), entry!),
              error: expect.objectContaining({ code: 'EACCES' }) as unknown,
            },
          },
        ]);
        expect(readFileSync(join(dest, SKILL_MANIFEST), 'utf8')).toBe('# skill\n');
        expect(readFileSync(join(dest, 'references', 'notes.md'), 'utf8')).toBe('deep notes');
        expect(existsSync(join(dest, 'readonly'))).toBe(false);
        expect(manager.listSkillClones('brainstorm')).toEqual([
          { origin: 'personal', path: dest, record: { workspace: 'personal' } },
        ]);
      });
    });
  });

  describe('the batch', () => {
    it('reports two workspaces in argument order', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();

      workspace('work');
      workspace('personal');
      storeSkill(store, 'brainstorm');

      expect(
        cloneSkill({ skillName: 'brainstorm', workspaces: ['work', 'personal'] }).cloned.map(
          ({ workspace: name }) => name,
        ),
      ).toEqual(['work', 'personal']);
    });

    it('clones once for a workspace named twice', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();

      workspace('personal');
      storeSkill(store, 'brainstorm');

      expect(
        cloneSkill({ skillName: 'brainstorm', workspaces: ['personal', 'personal'] }).cloned,
      ).toEqual([{ skill: 'brainstorm', workspace: 'personal', replaced: 'nothing' }]);
    });

    it('interleaves declined entries in argument order rather than grouping by kind', async () => {
      const { cloneSkill, store, workspace, root } = await newUseCase();
      const first = workspace('first');
      const gone = join(root, 'gone');
      const third = workspace('third');

      mkdirSync(join(first, 'brainstorm'), { recursive: true });
      mkdirSync(join(third, 'brainstorm'), { recursive: true });
      handEditState(store, {
        first: { path: first, autoLink: false },
        second: { path: gone, autoLink: false },
        third: { path: third, autoLink: false },
      });
      storeSkill(store, 'brainstorm');

      const error = refusal(() =>
        cloneSkill({ skillName: 'brainstorm', workspaces: ['first', 'second', 'third'] }),
      );

      expect((error as CloneDeclinedError).refusals.map((refusal) => refusal.kind)).toEqual([
        'occupied',
        'workspace-unreachable',
        'occupied',
      ]);
    });

    it('throws with the "nothing cloned:" block when every workspace was declined', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const work = workspace('work');

      storeSkill(store, 'brainstorm');
      writeFileSync(join(personal, 'brainstorm'), 'not a skill', 'utf8');
      writeFileSync(join(work, 'brainstorm'), 'not a skill', 'utf8');

      const error = refusal(() =>
        cloneSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] }),
      );

      expect(error.message.split('\n')).toEqual([
        'nothing cloned:',
        `  could not clone brainstorm → personal: ${join(personal, 'brainstorm')} is not a directory`,
        `  could not clone brainstorm → work: ${join(work, 'brainstorm')} is not a directory`,
      ]);
    });

    it('returns rather than throwing when an alreadyCloned pair sits beside a refusal', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const work = workspace('work');

      storeSkill(store, 'brainstorm');
      writeSkillDirectory(join(personal, 'brainstorm'));
      manager.recordClone({ skill: 'brainstorm', workspace: 'personal' });
      writeFileSync(join(work, 'brainstorm'), 'not a skill', 'utf8');

      const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] });

      expect(report.alreadyCloned).toEqual([{ skill: 'brainstorm', workspace: 'personal' }]);
      expect(report.declined).toHaveLength(1);
    });

    it('returns rather than throwing when an adoption sits beside a refusal', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const work = workspace('work');

      storeSkill(store, 'triage');
      writeSkillDirectory(join(personal, 'triage'));
      writeFileSync(join(work, 'triage'), 'not a skill', 'utf8');

      const report = cloneSkill({ skillName: 'triage', workspaces: ['personal', 'work'] });

      expect(report.adopted).toEqual([{ skill: 'triage', workspace: 'personal' }]);
      expect(report.declined).toEqual([
        {
          kind: 'occupied',
          skill: 'triage',
          workspace: 'work',
          path: join(work, 'triage'),
          occupant: { kind: 'not-a-directory' },
        },
      ]);
    });

    it('carries on past a failed pair, leaving the pairs around it cloned and recorded', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const first = workspace('first');
      const second = workspace('second');
      const third = workspace('third');

      storeSkill(store, 'brainstorm');
      writeFileSync(stagingPath(second), 'mine', 'utf8');

      const report = cloneSkill({
        skillName: 'brainstorm',
        workspaces: ['first', 'second', 'third'],
      });

      expect(report.cloned.map(({ workspace: name }) => name)).toEqual(['first', 'third']);
      expect(failureOf(report)).toMatchObject({ workspace: 'second', path: join(second, 'brainstorm') });
      expect(existsSync(join(first, 'brainstorm'))).toBe(true);
      expect(existsSync(join(second, 'brainstorm'))).toBe(false);
      expect(existsSync(join(third, 'brainstorm'))).toBe(true);
      expect(manager.listSkillClones('brainstorm').map(({ origin }) => origin)).toEqual([
        'first',
        'third',
      ]);
    });

    it('returns a report rather than throwing when every pair failed', async () => {
      const { cloneSkill, manager, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const work = workspace('work');

      storeSkill(store, 'brainstorm');
      writeFileSync(stagingPath(personal), 'mine', 'utf8');
      writeFileSync(stagingPath(work), 'mine', 'utf8');

      const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] });

      expect(report.failed.map(({ workspace: name }) => name)).toEqual(['personal', 'work']);
      expect(report.cloned).toEqual([]);
      expect(manager.listSkillClones('brainstorm')).toEqual([]);
    });

    it('returns a report rather than throwing when one pair was declined and the other failed', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');
      const work = workspace('work');

      storeSkill(store, 'brainstorm');
      writeFileSync(join(personal, 'brainstorm'), 'not a skill', 'utf8');
      writeFileSync(stagingPath(work), 'mine', 'utf8');

      const report = cloneSkill({ skillName: 'brainstorm', workspaces: ['personal', 'work'] });

      expect(report.declined).toHaveLength(1);
      expect(failureOf(report)).toMatchObject({ workspace: 'work' });
    });

    it('returns an empty report and writes nothing for an empty workspaces array', async () => {
      const { cloneSkill, store, workspace } = await newUseCase();
      const personal = workspace('personal');

      storeSkill(store, 'brainstorm');

      expect(cloneSkill({ skillName: 'brainstorm', workspaces: [] })).toEqual({
        cloned: [],
        adopted: [],
        alreadyCloned: [],
        declined: [],
        failed: [],
      });
      expect(existsSync(join(personal, 'brainstorm'))).toBe(false);
    });
  });
});

// ----------------------------------------------------------------------------
// TEST HELPERS
// ----------------------------------------------------------------------------

async function newUseCase() {
  const root = await tempRoot();
  const store = new GrimoireStore(join(root, '.grimoire'));
  const manager = new GrimoireStoreManager(store);

  /** A registered workspace, returning the path it was registered at. */
  function workspace(name: string, options: { autoLink?: boolean; path?: string } = {}): string {
    const path = options.path ?? join(root, name);

    if (!options.path) {
      mkdirSync(path, { recursive: true });
    }

    return manager.registerWorkspace({ name, path, autoLink: options.autoLink }).path;
  }

  return {
    cloneSkill: createCloneSkillUseCase({ storeManager: manager }),
    manager,
    store,
    root,
    workspace,
  };
}

/** A skill directory, whose manifest any entry in `files` may override. */
function writeSkillDirectory(path: string, files: Record<string, string> = {}): string {
  mkdirSync(path, { recursive: true });

  for (const [name, content] of Object.entries({ [SKILL_MANIFEST]: '# skill\n', ...files })) {
    const filePath = join(path, name);
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, content, 'utf8');
  }

  return path;
}

function stagingPath(workspacePath: string): string {
  return join(workspacePath, '.grimoire-staging');
}

function storeSkill(store: GrimoireStore, name: string, files: Record<string, string> = {}): string {
  return writeSkillDirectory(join(store.paths.skills, name), files);
}

/** A report whose only entries are the `cloned` ones. */
function clonedReport(...cloned: CloneWritten[]): CloneSkillReport {
  return { cloned, adopted: [], alreadyCloned: [], declined: [], failed: [] };
}

/** The one failure a report holds. */
function failureOf(report: CloneSkillReport): CloneFailure {
  expect(report.failed).toHaveLength(1);

  return report.failed[0]!;
}

/**
 * A `state.json` written past the manager, for the states only a hand-edit can
 * reach — `registerWorkspace` refuses every one of them.
 */
function handEditState(
  store: GrimoireStore,
  workspaces: Record<string, { path: string; autoLink: boolean }>,
): void {
  mkdirSync(dirname(store.paths.state), { recursive: true });
  writeFileSync(store.paths.state, JSON.stringify({ workspaces }, null, 2), 'utf8');
}

/** The error a refusal threw, so its whole message can be asserted on. */
function refusal(operation: () => unknown): Error {
  try {
    operation();
  } catch (error) {
    return error as Error;
  }

  throw new Error('expected a refusal');
}
